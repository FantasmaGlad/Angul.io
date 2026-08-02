import { add, scale } from '@angulio/shared';
import type { BotConfig } from '../mods/parametric/config.js';
import { BotManager } from './bots/botManager.js';
import type { CustomBotSpawnOptions } from './bots/botTypes.js';
import type { GameMod } from './mod.js';
import {
  DEFAULT_RESET_SCHEDULE,
  delayUntilNextReset,
  type RoomResetSchedule,
} from './resetSchedule.js';
import type { PlayerId, PlayerInput } from './types.js';
import { World } from './world.js';

/** Passé aux auditeurs de mort (voir `onPlayerDeath`) — de quoi construire l'écran de mort
 * personnalisé côté réseau (broadcast.ts) sans que celui-ci ait à recalculer quoi que ce soit
 * lui-même. */
export interface PlayerDeathInfo {
  /** Pseudo du dernier joueur ayant mangé un morceau de la victime — résolu ici (pas seulement
   * l'id) car l'attaquant peut lui-même s'être déconnecté entre-temps ; `undefined` si personne
   * ne l'a mangée cette vie ou si l'attaquant n'est plus dans le monde. */
  killerNickname?: string;
  survivalTimeSec: number;
}

export interface RoomOptions {
  mapSize: number;
  tickRateHz: number;
  kArea?: number;
  maxPlayers?: number;
  bots?: BotConfig;
  /** Planification du reset automatique (Lot 2.4, §2.1 du cahier des charges) — par défaut
   * 1x/24h à 10h heure de Paris (`DEFAULT_RESET_SCHEDULE`). `null` désactive le reset
   * automatique (le salon ne se réinitialise alors que via un appel manuel à `reset()`). */
  resetSchedule?: RoomResetSchedule | null;
}

/**
 * Assemble World + mod + boucle de tick fixe. Une room = une simulation indépendante
 * (cahier des charges §4.3) ; plusieurs rooms peuvent tourner en parallèle dans le même
 * process pour le MVP.
 */
/** Nombre de durées de tick conservées pour `tickMetrics()` (~3s d'historique à 20Hz) — assez
 * pour un p95 représentatif sans faire grossir la mémoire par salon indéfiniment. */
const TICK_DURATION_SAMPLE_SIZE = 60;

/** Un tick est compté comme "en retard" (`tickMetrics().overruns`) si son intervalle réel dépasse
 * 1.5x l'intervalle nominal attendu (`tickIntervalMs`) — signe que l'event loop était occupé
 * ailleurs (autre salon, sérialisation réseau) au moment où ce tick aurait dû démarrer. Voir
 * server/src/net/metrics.ts, qui expose ce compteur via `/api/admin/health`. */
const TICK_OVERRUN_FACTOR = 1.5;

export class Room {
  world: World;
  botManager?: BotManager;
  /** Exposée (pas seulement `tickIntervalMs`) pour que le réseau puisse l'annoncer au client dans
   * `welcome` (écran de diagnostic F3, `Server TPS`) sans dupliquer la constante. */
  readonly tickRateHz: number;
  /** Ni l'un ni l'autre `readonly` (contrairement au reste de cette classe) : `switchMod` (admin,
   * "changement de mode à chaud" §4.4 cahier_des_charges_admin.md) les reconstruit entièrement en
   * place plutôt que de recréer toute la `Room` — la `Room` elle-même (donc l'id de salon, les
   * sockets réseau, `botManager`) doit rester la même instance. */
  private mod: GameMod;
  private readonly tickIntervalMs: number;
  /** Joueurs gelés par l'admin (§4.3, "Gel/Freeze") — vecteurs de vitesse forcés à zéro chaque
   * tick, entrée ignorée tant qu'ils y figurent (voir `handleInput`/`tick`). */
  private readonly frozenPlayerIds = new Set<PlayerId>();
  /** Marionnette (§9.3, P4) — un joueur/bot possédé ignore son input NORMAL (`handleInput`, qu'il
   * vienne d'un vrai client WebSocket ou de l'IA d'un bot, voir `BotManager.update` qui appelle
   * exactement le même `handleInput`) ; seul `possessInput` (contourne volontairement ce garde-fou)
   * fait autorité tant qu'il y figure. Même mécanisme que `frozenPlayerIds` ci-dessus — aucune
   * modification nécessaire côté `BotManager`, qui continue d'appeler `handleInput` sans savoir
   * qu'il est possédé, exactement comme il le fait déjà pour un bot gelé. */
  private readonly possessedPlayerIds = new Set<PlayerId>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTickAt = 0;
  private nextTickTargetAt = 0;
  private tickCount = 0;
  /** PAS `readonly` (P6, §8.3 plan-implementation-admin.md) : `setResetSchedule` la reprogramme
   * pour un salon vivant sans reset immédiat (voir plus bas). */
  private resetSchedule: RoomResetSchedule | undefined;
  private readonly stateListeners: Array<(tick: number) => void> = [];
  private readonly deathListeners: Array<(playerId: PlayerId, info: PlayerDeathInfo) => void> = [];
  private readonly resetListeners: Array<() => void> = [];
  /** Durée (ms) du travail de tick le plus récent (hors attente du timer), la plus ancienne en
   * premier — voir `tickMetrics()`. */
  private readonly recentTickDurationsMs: number[] = [];
  private tickOverruns = 0;

  constructor(mod: GameMod, options: RoomOptions) {
    this.world = new World({ mapSize: options.mapSize, kArea: options.kArea });
    this.mod = mod;
    this.tickRateHz = options.tickRateHz;
    this.tickIntervalMs = 1000 / options.tickRateHz;
    this.resetSchedule =
      options.resetSchedule === null
        ? undefined
        : (options.resetSchedule ?? DEFAULT_RESET_SCHEDULE);

    if (options.bots?.enabled) {
      this.botManager = new BotManager(this, options.bots, options.maxPlayers ?? 50);
    }

    this.mod.onRoomInit?.(this.world);
  }

  start(): void {
    this.lastTickAt = performance.now();
    this.nextTickTargetAt = this.lastTickAt + this.tickIntervalMs;
    this.scheduleNextTick();
    this.scheduleReset();
  }

  private scheduleNextTick(): void {
    const delay = Math.max(0, this.nextTickTargetAt - performance.now());
    this.timer = setTimeout(() => {
      this.tick();
      this.nextTickTargetAt += this.tickIntervalMs;
      if (performance.now() > this.nextTickTargetAt + this.tickIntervalMs * 2) {
        this.nextTickTargetAt = performance.now() + this.tickIntervalMs;
      }
      this.scheduleNextTick();
    }, delay);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  /** Reprogramme le reset automatique SANS déclencher de reset immédiat (P6, §8.3
   * cahier_des_charges_admin.md — synchro à chaud d'un salon d'accueil dont `resetDurationMin` a
   * changé) : annule le minuteur en cours, remplace `resetSchedule`, reprogramme depuis MAINTENANT
   * (`scheduleReset` recalcule toujours la prochaine échéance à partir de l'heure réelle, jamais
   * un report bête de l'ancienne échéance — même logique que le déclenchement normal, voir son
   * commentaire). `null`/`undefined` désactive tout reset automatique pour ce salon. */
  setResetSchedule(schedule: RoomResetSchedule | null | undefined): void {
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetSchedule = schedule ?? undefined;
    this.scheduleReset();
  }

  private scheduleReset(): void {
    if (!this.resetSchedule) return;
    const delay = delayUntilNextReset(this.resetSchedule);
    this.resetTimer = setTimeout(() => {
      this.reset();
      this.scheduleReset(); // reprogrammé à chaque déclenchement (recalcule la prochaine
      // occurrence à partir de l'heure réelle plutôt que d'ajouter bêtement 24h, pour rester
      // correct malgré les changements d'heure — voir resetSchedule.ts).
    }, delay);
  }

  /** Réinitialise le salon (Lot 2.4) : vide entièrement le monde (morceaux ET nourriture — la
   * nourriture repousse ensuite via la logique habituelle du mod, `onTick`) puis fait
   * respawner chaque joueur encore connecté comme s'il venait de rejoindre. Les joueurs restent
   * connectés (pas de déconnexion, pas de perte de pseudo) ; `onReset` notifie le réseau pour
   * qu'il prévienne chaque client (voir net/server.ts, réutilise le message `died` existant —
   * la sensation "je viens de mourir, je respawn" est exactement ce qui se passe). Invocable
   * automatiquement (planification) ou manuellement (tests, admin plus tard).
   *
   * Chaque joueur ENCORE EN VIE au moment du reset (`pieceIds.length > 0`) est d'abord annoncé
   * aux `deathListeners`, EXACTEMENT comme une mort normale (voir la boucle de `tick()`) — sans
   * ça, la vie en cours d'un joueur était silencieusement effacée sans jamais être créditée
   * (retour utilisateur : "quand le salon se reset, rien n'est enregistré", ni le score/meilleur
   * score ni l'XP — `RoomInstance.handleDeath`, engine/worker/roomInstance.ts, est l'unique
   * abonné réel de `deathListeners` et fait déjà tout ce travail — masse de pointe/XP de la vie
   * lues puis remises à zéro, message transmis à `broadcast.ts` qui crédite la DB — pour une
   * mort ordinaire ; un reset s'y annonce désormais de la même façon AVANT que les morceaux ne
   * disparaissent, plutôt que de contourner ce pipeline). `killerNickname` reste `undefined`
   * (personne n'a mangé personne) ; `survivalTimeSec` mesure la vie écoulée jusqu'à CE reset,
   * comme pour toute mort. Fait AVANT de vider le monde : `handleDeath` a besoin de lire la
   * masse de pointe/l'XP encore intacts de cette vie. */
  reset(): void {
    const now = performance.now();
    for (const player of this.world.allPlayers()) {
      if (player.pieceIds.length === 0) continue;
      const info: PlayerDeathInfo = {
        killerNickname: undefined,
        survivalTimeSec: (now - player.spawnedAtMs) / 1000,
      };
      for (const listener of this.deathListeners) listener(player.id, info);
    }

    for (const entity of this.world.allEntities()) this.world.removeEntity(entity.id);
    for (const player of this.world.allPlayers()) this.mod.onPlayerJoin?.(this.world, player.id);
    this.botManager?.onReset();
    for (const listener of this.resetListeners) listener();
  }

  /** Notifié à chaque reset (automatique ou manuel) — utile au réseau pour prévenir les
   * clients connectés, indépendamment du mod. */
  onReset(listener: () => void): void {
    this.resetListeners.push(listener);
  }

  /** Exécute un seul tick manuellement (utile pour les tests, sans dépendre d'un vrai timer). */
  tick(): void {
    const now = performance.now();
    // Temps réel écoulé depuis le tick précédent — jamais injecté dans la physique (voir `dt`
    // fixe ci-dessous) : sert uniquement à détecter une surcharge (`tickOverruns`), un diagnostic
    // qui doit refléter l'horloge murale réelle.
    const realDt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.tickCount += 1;

    if (this.tickCount > 1 && realDt > (this.tickIntervalMs / 1000) * TICK_OVERRUN_FACTOR) {
      this.tickOverruns += 1;
    }

    // Pas de temps FIXE (`tickIntervalMs`, jamais le temps réel écoulé) pour toute la physique —
    // "fix your timestep" : sinon la moindre gigue de `setTimeout` (charge d'un autre salon dans
    // le même process, GC, sérialisation réseau...) se traduit directement par du bruit dans la
    // position AUTORITAIRE elle-même, tick après tick. Sous surcharge soutenue, la simulation
    // prend du retard sur l'horloge murale (déjà visible via `tickOverruns`/le TPS annoncé au
    // client) plutôt que de propager ce bruit de timing à tous les clients connectés.
    const dt = this.tickIntervalMs / 1000;

    this.mod.onTick?.(this.world, dt);
    this.botManager?.update(dt);

    for (const playerId of this.frozenPlayerIds) {
      for (const piece of this.world.getPiecesByOwner(playerId)) piece.velocity = { x: 0, y: 0 };
    }

    for (const entity of this.world.allEntities()) {
      // Capturée AVANT l'intégration : sert au test de collision balayé (`World.findOverlappingPairs`,
      // correctif anti-tunneling) pour reconstruire le trajet réel de ce tick, pas seulement son
      // point de départ/arrivée.
      entity.previousPosition = entity.position;
      entity.position = add(entity.position, scale(entity.velocity, dt));
    }

    this.mod.onPostMove?.(this.world, dt);

    this.world.rebuildSpatialHash();
    for (const [a, b] of this.world.findOverlappingPairs()) {
      // une collision précédente dans cette même passe a pu retirer l'une des deux entités
      if (this.world.getEntity(a.id) && this.world.getEntity(b.id)) {
        this.mod.onCollision?.(this.world, a, b, dt);
      }
    }

    for (const player of this.world.allPlayers()) {
      const currentlyAlive = player.pieceIds.length > 0;
      if (player.alive && !currentlyAlive) {
        this.mod.onPlayerDeath?.(this.world, player.id);
        this.botManager?.onPlayerDeath(player.id);
        const killer = player.lastAttackerId
          ? this.world.getPlayer(player.lastAttackerId)
          : undefined;
        const info: PlayerDeathInfo = {
          killerNickname: killer?.nickname,
          survivalTimeSec: (now - player.spawnedAtMs) / 1000,
        };
        for (const listener of this.deathListeners) listener(player.id, info);
      }
      player.alive = currentlyAlive;
    }

    for (const listener of this.stateListeners) listener(this.tickCount);

    this.recordTickDuration(performance.now() - now);
  }

  private recordTickDuration(durationMs: number): void {
    this.recentTickDurationsMs.push(durationMs);
    if (this.recentTickDurationsMs.length > TICK_DURATION_SAMPLE_SIZE) {
      this.recentTickDurationsMs.shift();
    }
  }

  /** Métriques de charge de ce salon (voir server/src/net/metrics.ts, `/api/admin/health`) —
   * calculées à la demande plutôt que maintenues en continu, un salon n'étant interrogé qu'au
   * rythme des requêtes admin (pas à chaque tick). */
  tickMetrics(): { avgMs: number; p95Ms: number; overruns: number } {
    const samples = this.recentTickDurationsMs;
    if (samples.length === 0) return { avgMs: 0, p95Ms: 0, overruns: this.tickOverruns };

    const sorted = [...samples].sort((a, b) => a - b);
    const avgMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return { avgMs, p95Ms: sorted[p95Index]!, overruns: this.tickOverruns };
  }

  private readonly playerJoinListeners: Array<
    (id: PlayerId, nickname: string, skin?: string) => void
  > = [];

  addPlayer(id: PlayerId, nickname: string, skin?: string): void {
    this.world.addPlayer(id, nickname, skin);
    this.mod.onPlayerJoin?.(this.world, id);
    for (const listener of this.playerJoinListeners) {
      listener(id, nickname, skin);
    }
    if (!this.botManager?.isBot(id)) {
      this.botManager?.adjustPopulation();
    }
  }

  onPlayerJoin(
    listener: (id: PlayerId, nickname: string, skin?: string) => void,
  ): void {
    this.playerJoinListeners.push(listener);
  }

  removePlayer(id: PlayerId): void {
    this.mod.onPlayerLeave?.(this.world, id);
    this.world.removePlayer(id);
    // Sans ça, `frozenPlayerIds` accumulait une entrée par joueur ayant un jour été gelé
    // (admin, ou délai de grâce à la déconnexion, voir net/ws/connectionHandler.ts) sans jamais
    // la libérer, pour un salon de longue durée — fuite mineure mais désormais bien plus
    // fréquente qu'avant (une entrée par déconnexion, pas seulement par action admin manuelle).
    this.frozenPlayerIds.delete(id);
    // Même raisonnement que `frozenPlayerIds.delete(id)` ci-dessus : sans ça, une possession
    // orpheline (joueur déconnecté/retiré pendant qu'il était possédé) laissait une entrée morte,
    // et un futur `playerId` ré-attribué (compteur séquentiel, voir `RoomInstance.join`) aurait pu
    // hériter silencieusement d'une possession qui n'était plus la sienne.
    this.possessedPlayerIds.delete(id);
    if (!this.botManager?.isBot(id)) {
      this.botManager?.adjustPopulation();
    }
  }

  handleInput(playerId: PlayerId, input: PlayerInput): void {
    if (this.frozenPlayerIds.has(playerId)) return;
    if (this.possessedPlayerIds.has(playerId)) return; // suspendu : voir `possessInput`
    this.mod.onPlayerInput?.(this.world, playerId, input);
  }

  // --- Marionnette (§9.3, P4) --------------------------------------------------------------

  /** Contourne volontairement la suspension de `handleInput` ci-dessus — seul point d'entrée qui
   * fait autorité pour un joueur actuellement possédé (voir `setPossessed`). Appelé QUE le joueur
   * soit réellement possédé ou non : un `possessInput` reçu après un `unpossess`/une déconnexion
   * (message en vol) reste inoffensif, simplement redondant avec l'input normal qui a repris la
   * main entre-temps. */
  possessInput(playerId: PlayerId, input: PlayerInput): void {
    this.mod.onPlayerInput?.(this.world, playerId, input);
  }

  setPossessed(playerId: PlayerId, possessed: boolean): void {
    if (possessed) this.possessedPlayerIds.add(playerId);
    else this.possessedPlayerIds.delete(playerId);
  }

  isPossessed(playerId: PlayerId): boolean {
    return this.possessedPlayerIds.has(playerId);
  }

  // --- Actions admin (cahier_des_charges_admin.md §4.3-4.4) -------------------------------

  /** Élimination instantanée (§4.3, "Kill") — retire tous les morceaux du joueur ; la transition
   * vivant -> mort est détectée génériquement au tick suivant (voir `tick()`), donc `onPlayerDeath`
   * se déclenche normalement (écran de mort, XP créditée, etc.) sans logique dupliquée ici.
   * `false` si le joueur est inconnu. */
  killPlayer(playerId: PlayerId): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player) return false;
    for (const pieceId of [...player.pieceIds]) this.world.removeEntity(pieceId);
    return true;
  }

  /** Gel/dégel (§4.3) — un joueur gelé ignore ses inputs (`handleInput` ci-dessus) et voit sa
   * vélocité forcée à zéro chaque tick (voir `tick()`), quel que soit le mod. */
  setFrozen(playerId: PlayerId, frozen: boolean): void {
    if (frozen) this.frozenPlayerIds.add(playerId);
    else this.frozenPlayerIds.delete(playerId);
  }

  isFrozen(playerId: PlayerId): boolean {
    return this.frozenPlayerIds.has(playerId);
  }

  /** Ajuste la masse totale d'un joueur (§4.3, slider/saisie directe) — répartie
   * proportionnellement entre ses morceaux existants (conserve le nombre de morceaux et leurs
   * masses relatives) plutôt que de tout regrouper en un seul, générique (indépendant du mod,
   * contrairement au split/à la fusion naturels). `false` si le joueur n'a aucun morceau. */
  setPlayerMass(playerId: PlayerId, targetMass: number): boolean {
    const pieces = this.world.getPiecesByOwner(playerId);
    if (pieces.length === 0) return false;
    const currentTotal = pieces.reduce((sum, piece) => sum + piece.mass, 0);
    if (currentTotal <= 0) return false;
    const ratio = Math.max(targetMass, pieces.length) / currentTotal;
    for (const piece of pieces) this.world.setMass(piece, Math.max(1, piece.mass * ratio));
    return true;
  }

  /** Déplacement physique du barycentre (§9.1) — translate chaque morceau du joueur par le même
   * delta (nouveau barycentre - ancien), ce qui préserve automatiquement leurs offsets relatifs
   * (contrairement à une reconstitution "en cercle" autour du point cible). Aucun clamp aux bords
   * de la carte ici : le prochain tick applique déjà `mod.onPostMove` (bordure) à toute position,
   * qu'elle vienne de la physique normale ou d'un déplacement admin — même repli que le reste du
   * moteur (voir `Room.tick()`). `false` si le joueur n'a aucun morceau. */
  dragMovePlayer(playerId: PlayerId, target: { x: number; y: number }): boolean {
    const pieces = this.world.getPiecesByOwner(playerId);
    if (pieces.length === 0) return false;
    let totalMass = 0;
    let cx = 0;
    let cy = 0;
    for (const piece of pieces) {
      totalMass += piece.mass;
      cx += piece.position.x * piece.mass;
      cy += piece.position.y * piece.mass;
    }
    if (totalMass <= 0) return false;
    const dx = target.x - cx / totalMass;
    const dy = target.y - cy / totalMass;
    for (const piece of pieces) {
      piece.position = { x: piece.position.x + dx, y: piece.position.y + dy };
    }
    return true;
  }

  /** Split forcé (§4.3) — synthétise un input `split: true` plutôt que de dupliquer la logique de
   * split (propre à chaque mod, voir `mods/parametric/index.ts` `trySplitPiece`) : générique et
   * toujours cohérent avec les règles réelles du mod actif (masse min, nombre max de morceaux…).
   * Direction arbitraire (vers la droite) : un outil de debug admin, pas une action de jeu où la
   * direction du split compte. `false` si le joueur n'a aucun morceau. */
  forceSplit(playerId: PlayerId): boolean {
    const pieces = this.world.getPiecesByOwner(playerId);
    if (pieces.length === 0) return false;
    const center = pieces[0]!.position;
    this.handleInput(playerId, { target: { x: center.x + 1, y: center.y }, intensity: 1, split: true });
    return true;
  }

  /** Refusion forcée (§4.3) — regroupe tous les morceaux du joueur en un seul, en ignorant le
   * cooldown de fusion normal (`World.mergeEntities` directement, pas `tryMerge` du mod).
   * `false` si le joueur n'a aucun morceau. */
  forceRemerge(playerId: PlayerId): boolean {
    let pieces = this.world.getPiecesByOwner(playerId);
    if (pieces.length === 0) return false;
    while (pieces.length > 1) {
      this.world.mergeEntities(pieces[0]!, pieces[1]!);
      pieces = this.world.getPiecesByOwner(playerId);
    }
    return true;
  }

  /** Spawn de nourriture à des coordonnées précises (§4.4, outil pinceau/spawner). */
  spawnFood(position: { x: number; y: number }, mass: number): void {
    this.world.spawnParticle(position, mass);
  }

  /** Spawn de virus manuel à des coordonnées précises (§10.2) — formule masse/rayon dupliquée
   * depuis la maintenance organique du mod paramétrique (`mods/parametric/index.ts`, "vType === 2
   * ? 300/150 : 200/100") plutôt que réutilisée : `Room` reste indépendante du mod actif
   * (`GameMod` générique, jamais couplée à `ParametricModConfig`), et cette constante d'équilibrage
   * change rarement. */
  spawnVirus(position: { x: number; y: number }, virusType: 1 | 2 | 3): void {
    const mass = virusType === 2 ? 300 : 200;
    const radius = virusType === 2 ? 150 : 100;
    const virus = this.world.spawnVirus(position, mass, virusType);
    virus.radius = radius;
  }

  /** Apparence à la volée (§9.4) — met à jour l'état de SESSION du joueur (`PlayerState`, jamais le
   * compte persistant en base) ; le rappel au réseau (rediffusion du message `player`) est à la
   * charge de l'appelant (voir `RoomInstance.adminAction`, qui réutilise `playerJoinListeners`
   * pour ça — `Room` elle-même ne connaît aucune socket). `false` si le joueur est inconnu. */
  setAppearance(playerId: PlayerId, appearance: { nickname?: string; skin?: string }): boolean {
    const player = this.world.getPlayer(playerId);
    if (!player) return false;
    const trimmedNickname = appearance.nickname?.trim();
    if (trimmedNickname) player.nickname = trimmedNickname;
    if (appearance.skin !== undefined) player.skin = appearance.skin;
    return true;
  }

  /** Vide toutes les pastilles de nourriture du salon (§4.4, "Nettoyage") — renvoie le nombre
   * retiré (affichage admin). */
  clearFood(): number {
    let count = 0;
    for (const entity of this.world.allEntities()) {
      if (entity.kind === 'particle') {
        this.world.removeEntity(entity.id);
        count++;
      }
    }
    return count;
  }

  /** Supprime tous les bots du salon (§4.4) — `BotManager.adjustPopulation` (appelé au tick
   * suivant) les fera réapparaître progressivement si le salon a des bots activés : un nettoyage
   * temporaire, pas une désactivation durable. */
  clearBots(): number {
    return this.botManager?.clearAll() ?? 0;
  }

  /** Force le spawn immédiat d'un bot supplémentaire (§4.4), optionnellement PERSONNALISÉ
   * (§9.3/§17 cahier_des_charges_admin.md, "Bots personnalisés" — pseudo/masse/position imposés,
   * voir `BotManager.forceSpawnOne`) — `false` si les bots sont désactivés pour ce salon. */
  forceSpawnBot(options?: CustomBotSpawnOptions): boolean {
    if (!this.botManager) return false;
    this.botManager.forceSpawnOne(options);
    return true;
  }

  /** Vague de bots (§10.3) — ADDITIF, ne touche pas `forceSpawnBot` ci-dessus (bot personnalisé
   * unitaire, existant, inchangé — voir plan-implementation-admin.md §1). Chaque bot de la vague
   * garde une personnalité aléatoire (fuis/neutre/agressif, comme un spawn ambiant normal) ; seuls
   * `mass`/`behaviorProfile` sont partagés par tous. `false` si les bots sont désactivés pour ce
   * salon. */
  forceSpawnBots(count: number, mass?: number, behaviorProfile?: string): boolean {
    if (!this.botManager) return false;
    this.botManager.forceSpawnMany(count, { mass, behaviorId: behaviorProfile });
    return true;
  }

  /** Changement de mode à chaud (§4.4) — reconstruit `world`/`mod`/`botManager` en place (même
   * instance de `Room`, mêmes sockets réseau connectées) plutôt que de recréer tout le salon.
   * Équivalent d'un `reset()` sous les nouvelles règles : chaque joueur humain encore connecté est
   * re-spawné dans le nouveau monde (mêmes id, donc pas de reconnexion nécessaire côté réseau),
   * les bots sont abandonnés puis re-peuplés par `BotManager.adjustPopulation()` (pas d'intérêt à
   * les faire survivre à un changement de règles). `onReset` est notifié comme pour un reset
   * classique — le réseau (broadcast.ts) prévient les clients exactement de la même façon. */
  switchMod(
    mod: GameMod,
    options: { mapSize: number; kArea?: number; maxPlayers?: number; bots?: BotConfig },
  ): void {
    const previousHumans = this.world
      .allPlayers()
      .filter((player) => !this.botManager?.isBot(player.id))
      .map((player) => ({ id: player.id, nickname: player.nickname }));

    this.frozenPlayerIds.clear();
    this.mod = mod;
    this.world = new World({ mapSize: options.mapSize, kArea: options.kArea });
    this.botManager = options.bots?.enabled
      ? new BotManager(this, options.bots, options.maxPlayers ?? 50)
      : undefined;
    this.mod.onRoomInit?.(this.world);

    for (const player of previousHumans) {
      this.world.addPlayer(player.id, player.nickname);
      this.mod.onPlayerJoin?.(this.world, player.id);
    }
    this.botManager?.adjustPopulation();

    for (const listener of this.resetListeners) listener();
  }

  /** Délègue au mod (voir `GameMod.getAccelerationForMass`) — `undefined` si le mod ne
   * l'implémente pas. */
  getAccelerationForMass(mass: number): number | undefined {
    return this.mod.getAccelerationForMass?.(mass);
  }

  /** Délègue au mod (voir `GameMod.transformScoreForAccount`, Lot 4) — identité si le mod ne
   * l'implémente pas (score/XP bruts inchangés). */
  transformScoreForAccount(rawScore: number, rawXp: number): { score: number; xp: number } {
    return this.mod.transformScoreForAccount?.(rawScore, rawXp) ?? { score: rawScore, xp: rawXp };
  }

  onState(listener: (tick: number) => void): void {
    this.stateListeners.push(listener);
  }

  /** Notifié quand un joueur passe de "a au moins un morceau" à "n'en a plus aucun" — utile au
   * réseau (net/server.ts) pour envoyer un message `died` sans avoir à décorer le mod. */
  onPlayerDeath(listener: (playerId: PlayerId, info: PlayerDeathInfo) => void): void {
    this.deathListeners.push(listener);
  }

  get currentTick(): number {
    return this.tickCount;
  }
}

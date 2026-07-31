import { type EntitySnapshot, type LeaderboardEntry, type ServerMessage } from '@angulio/shared';
import { isGodPlayerId } from '../godmode.js';
import type { GameMod } from '../mod.js';
import type { Room } from '../room.js';
import type { Entity, PlayerId, PlayerState } from '../types.js';
import type { World } from '../world.js';
import { activeComboLevel } from '../xp.js';

/** Un spectateur (`?spectate=1`, fond animé de l'accueil — voir SpectatorBackground.tsx) regarde
 * la carte entière très dézoomée : un rayon d'intérêt ne réduirait rien pour lui (tout est déjà
 * dans le champ de la caméra), contrairement à un joueur. Le vrai levier est le volume envoyé —
 * avant ce correctif, chaque spectateur recevait *toutes* les entités du salon à *chaque* tick
 * (20 Hz), sans aucun filtre : N visiteurs de l'accueil = N fois la sérialisation+envoi du salon
 * entier, 20x/s, même si personne ne joue (source du lag observé dès l'écran d'accueil). Deux
 * réductions, combinées : cadence divisée par `SPECTATOR_TICK_DIVISOR`, et nourriture
 * échantillonnée (les pastilles individuelles n'apportent presque rien visuellement à cette
 * échelle) plutôt qu'envoyée en totalité — les morceaux de joueurs/bots, eux, restent tous
 * envoyés (peu nombreux, visuellement significatifs pour un fond "vue d'ensemble du serveur"). */
export const SPECTATOR_TICK_DIVISOR = 4;
/** pastilles de nourriture pour spectateur : 1 sur N (id % N === 0) envoyée — le reste est omis.
 * Relevé à 6 (était 4, régression déjà corrigée à ce niveau — voir plan_performance_reseau.md
 * §4.1) : audit lag lobby — un visiteur d'accueil supplémentaire ne doit quasiment rien coûter,
 * combiné au sous-échantillonnage côté client (voir renderEngine.ts `subsampleForSpectator`). */
export const SPECTATOR_FOOD_SAMPLE_EVERY = 6;

export function isVisibleToSpectator(entity: Entity): boolean {
  if (entity.kind !== 'particle') return true;
  return Number(entity.id) % SPECTATOR_FOOD_SAMPLE_EVERY === 0;
}

export interface TopScoreEntry {
  id: PlayerId;
  nickname: string;
  score: number;
}

/** Classement calculé une seule fois par tick (voir buildStateMessage, appelé une fois par
 * socket) — indépendant du destinataire, seul `isSelf` varie par joueur. */
export function computeTopScores(
  world: World,
  players: PlayerState[],
  maxMassMap?: Map<PlayerId, number>,
): TopScoreEntry[] {
  return players
    .filter((p) => !isGodPlayerId(p.id)) // Blob Dieu (§4.2 cahier_des_charges_admin.md) : invisible du classement
    .map((p) => {
      let currentMass = 0;
      for (const pieceId of p.pieceIds) {
        const piece = world.getEntity(pieceId);
        if (piece) currentMass += piece.mass;
      }
      const peakMass = maxMassMap?.get(p.id) ?? currentMass;
      const score = Math.max(currentMass, peakMass);
      return { id: p.id, nickname: p.nickname, score: Math.floor(score) };
    })
    .filter((p) => p.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundMass(value: number): number {
  return Math.round(value);
}

export function toSnapshot(entity: Entity): EntitySnapshot {
  if (entity.kind === 'particle') {
    // Cache réutilisé UNIQUEMENT pour une particule à vélocité nulle : la nourriture normale ne
    // bouge jamais après son spawn (position/masse figées), donc reconstruire ce petit objet à
    // chaque tick pour des milliers de pastilles était un gaspillage pur. Une particule éjectée
    // (`tryEjectMass`, mods/parametric/index.ts) a en revanche une vélocité non nulle tant
    // qu'elle n'a pas fini de freiner (`EJECT_FRICTION_PER_SEC`, onTick) : sa position continue
    // de changer tick après tick côté serveur (collision comprise), donc mettre son snapshot en
    // cache la ferait apparaître IMMOBILE à tous les clients pendant qu'elle se déplace
    // réellement — un bug de rendu, pas seulement une optimisation manquée. Reconstruit un
    // snapshot frais à chaque appel tant que la vélocité n'est pas retombée à zéro ; redevient
    // éligible au cache une fois immobile (position de repos), comme la nourriture normale.
    if (entity.velocity.x === 0 && entity.velocity.y === 0) {
      let snap = (entity as any)._snapshot as EntitySnapshot | undefined;
      if (!snap) {
        snap = {
          i: entity.id,
          k: 'f',
          x: round1(entity.position.x),
          y: round1(entity.position.y),
          r: round1(entity.radius),
          m: roundMass(entity.mass),
          p: entity.ownerId,
        };
        (entity as any)._snapshot = snap;
      }
      return snap;
    }
    return {
      i: entity.id,
      k: 'f',
      x: round1(entity.position.x),
      y: round1(entity.position.y),
      r: round1(entity.radius),
      m: roundMass(entity.mass),
      p: entity.ownerId,
    };
  }
  return {
    i: entity.id,
    k: 'c',
    x: round1(entity.position.x),
    y: round1(entity.position.y),
    r: round1(entity.radius),
    m: roundMass(entity.mass),
    p: entity.ownerId,
  };
}

export function centroidOf(pieces: Entity[]): { x: number; y: number } | undefined {
  if (pieces.length === 0) return undefined;

  let totalMass = 0;
  let x = 0;
  let y = 0;
  for (const piece of pieces) {
    totalMass += piece.mass;
    x += piece.position.x * piece.mass;
    y += piece.position.y * piece.mass;
  }
  return { x: x / totalMass, y: y / totalMass };
}

/** Snapshot des entités visibles pour une CATÉGORIE de destinataire (joueurs vs spectateurs) —
 * calculé une seule fois par tick et PARTAGÉ par tous les viewers de cette catégorie (voir
 * roomInstance.ts `handleTick`), plutôt que refiltré/remappé à chaque destinataire individuel.
 * Chargement dynamique par intérêt retiré (demande utilisateur) : un joueur reçoit désormais le
 * salon ENTIER, comme un spectateur — l'ancien filtrage par rayon autour de la caméra
 * (`interestHash`/rayon effectif) supposait un volume d'entités que ce jeu n'atteint jamais en
 * pratique (quelques dizaines de joueurs/bots, quelques milliers de pastilles), un coût de
 * filtrage (+ une grille spatiale d'intérêt reconstruite à chaque tick) pour un bénéfice de bande
 * passante non justifié ici. Seul le fond spectateur de l'accueil garde un allègement dédié
 * (`isVisibleToSpectator`, échantillonnage de la nourriture) : lui est consulté par N visiteurs
 * simultanés du lobby, pas juste les joueurs d'un salon. */
export function buildVisibleEntitySnapshots(
  allEntities: Entity[],
  isSpectator: boolean,
): EntitySnapshot[] {
  const visible = isSpectator ? allEntities.filter(isVisibleToSpectator) : allEntities;
  return visible.map(toSnapshot);
}

export interface BuildStateMessageParams {
  room: Room;
  playerId: PlayerId;
  tick: number;
  /** Snapshot déjà construit pour CE tick (voir `buildVisibleEntitySnapshots`), partagé entre
   * tous les destinataires de la même catégorie (joueurs ou spectateurs) — ni refiltré ni
   * remappé ici : `playerId` ne sert plus qu'à calculer les champs `self` (propres au
   * destinataire), jamais à sélectionner un sous-ensemble d'entités. */
  entities: EntitySnapshot[];
  topScores: TopScoreEntry[];
}

/** Construit le message `state` d'un seul destinataire (joueur ou spectateur) — logique
 * inchangée par rapport à l'ancienne boucle par-socket de `broadcast.ts` (`wireRoom`), seulement
 * extraite en fonction pure/testable et réutilisable telle quelle une fois la simulation du salon
 * hébergée dans un worker (voir plan_implementation, "worker_threads"). Retourne aussi `totalMass`
 * (nécessaire à l'appelant pour tenir `maxMassByPlayer` à jour, voir RoomRuntime). */
export function buildStateMessage(
  params: BuildStateMessageParams,
): { message: ServerMessage; totalMass: number } {
  const { room, playerId, tick, entities, topScores } = params;
  const world = room.world;

  const ownPieces = world.getPiecesByOwner(playerId);
  const totalMass = ownPieces.reduce((sum, piece) => sum + piece.mass, 0);
  const accelerationPerSec2 = totalMass > 0 ? room.getAccelerationForMass(totalMass) : undefined;

  const player = world.getPlayer(playerId);
  const comboLevel = player ? activeComboLevel(player.lifeStats.combo, performance.now()) : undefined;

  const modDashGetter = (room as unknown as { mod?: GameMod }).mod?.getDashState;
  const dashState = modDashGetter ? modDashGetter.call((room as unknown as { mod: GameMod }).mod, world, playerId) : undefined;

  const selfFields: {
    accelerationPerSec2?: number;
    combo?: { level: number };
    pieces?: Array<{ id: string; vx: number; vy: number }>;
    dash?: { charges: number; maxCharges: number; canDash: boolean; rechargeProgress: number };
  } = {};
  if (accelerationPerSec2 !== undefined) selfFields.accelerationPerSec2 = accelerationPerSec2;
  if (comboLevel !== undefined) selfFields.combo = { level: comboLevel };
  if (dashState) selfFields.dash = dashState;
  // Vélocité autoritaire de chaque morceau (voir protocol.ts `self.pieces`) — `ownPieces` est déjà
  // intégrée pour CE tick par `Room.tick()` avant que `buildStateMessage` ne soit appelé, jamais
  // une valeur périmée.
  if (ownPieces.length > 0) {
    selfFields.pieces = ownPieces.map((p) => ({ id: p.id, vx: p.velocity.x, vy: p.velocity.y }));
  }
  const self = Object.keys(selfFields).length > 0 ? selfFields : undefined;

  // Classement identique pour tout le monde (voir net/ws/broadcast.ts `sharedStatePrefix`, qui
  // sérialise `leaderboard` une seule fois par tick et le réutilise pour tous les joueurs) :
  // `playerId` par entrée plutôt qu'un `isSelf` calculé ici pour LE joueur `playerId` du paramètre
  // — sinon ce booléen se retrouve figé sur le premier joueur traité ce tick pour tous les autres.
  const leaderboard: LeaderboardEntry[] = topScores.map((entry, idx) => ({
    rank: idx + 1,
    nickname: entry.nickname,
    score: entry.score,
    playerId: entry.id,
  }));

  return {
    message: { type: 'state', tick, entities, leaderboard, self },
    totalMass,
  };
}

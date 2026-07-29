import type { Entity, PlayerId, PlayerInput } from './types.js';
import type { World } from './world.js';

/**
 * Contrat qu'un mode de jeu ("mod") doit implémenter pour s'exécuter sur le moteur (cahier des
 * charges §3.2). Le moteur (World + Room) ne prend aucune décision de gameplay lui-même : masse
 * de départ, conditions pour manger, split, fusion, decay... tout vient d'un mod. Le mode Vanilla
 * (mods/vanilla) est lui-même écrit comme un mod ordinaire, sans accès privilégié au moteur.
 *
 * Tous les hooks sont optionnels : un mod n'implémente que ce dont il a besoin.
 */
export interface GameMod {
  readonly id: string;

  /** Appelé une fois à la création de la room, avant le premier tick. */
  onRoomInit?(world: World): void;

  /** Appelé à chaque tick, avant l'intégration générique des positions (position += vitesse * dt). */
  onTick?(world: World, dt: number): void;

  /** Appelé juste après l'intégration des positions (ex : clamp aux bords de la carte). */
  onPostMove?(world: World, dt: number): void;

  /** Appelé pour chaque paire d'entités dont les cercles se chevauchent ce tick. `dt` (pas de
   * temps fixe du tick, voir Room.tick()) permet une résolution progressive dépendante du temps
   * (ex. absorption graduelle entre joueurs, voir mods/parametric/index.ts) plutôt qu'un seul
   * événement instantané par paire par tick. */
  onCollision?(world: World, a: Entity, b: Entity, dt: number): void;

  /** Un client vient de rejoindre la room ; c'est au mod de faire apparaître ses morceaux. */
  onPlayerJoin?(world: World, playerId: PlayerId): void;

  onPlayerLeave?(world: World, playerId: PlayerId): void;

  /** Reçoit l'input brut d'un joueur (direction + demande de split) pour ce tick. */
  onPlayerInput?(world: World, playerId: PlayerId, input: PlayerInput): void;

  /** Appelé quand un joueur passe de "a au moins un morceau" à "n'en a plus aucun". */
  onPlayerDeath?(world: World, playerId: PlayerId): void;

  /** Taux d'accélération courant (uc/s²) pour une masse donnée — utilisé par le réseau pour
   * renseigner le panneau de stats du client (Pseudo/Guilde/Masse/Vitesse/Accélération) sans
   * dupliquer la formule du mod côté client (voir `WorldStateMessage.self`, protocol.ts).
   * Optionnel : si absent, le champ n'est pas renseigné côté client. */
  getAccelerationForMass?(mass: number): number;

  /** Mod-specific Dash state (mode Hardcore) for client HUD rendering. */
  getDashState?(
    world: World,
    playerId: PlayerId,
  ): { charges: number; maxCharges: number; canDash: boolean; rechargeProgress: number };

  /** Lot 4 (mode Hardcore, cahier des charges §3.4 #2 : "perte totale de la progression XP de
   * la partie en cas de mort") — appelé juste avant l'écriture des stats en base (Lot 3.5, à
   * la mort ou à la déconnexion) avec la masse maximale atteinte pendant cette vie (`rawScore`,
   * crédité à `player_best_scores`) et l'XP accumulée pendant cette même vie (`rawXp`, voir
   * `engine/xp.ts` — combo déjà appliqué) ; les valeurs renvoyées sont ce qui est effectivement
   * crédité au compte. Optionnel : un mod qui ne l'implémente pas (Vanilla) laisse les
   * deux valeurs brutes inchangées (identité). */
  transformScoreForAccount?(rawScore: number, rawXp: number): { score: number; xp: number };
}

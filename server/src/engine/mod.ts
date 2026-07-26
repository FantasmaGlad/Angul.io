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

  /** Appelé pour chaque paire d'entités dont les cercles se chevauchent ce tick. */
  onCollision?(world: World, a: Entity, b: Entity): void;

  /** Un client vient de rejoindre la room ; c'est au mod de faire apparaître ses morceaux. */
  onPlayerJoin?(world: World, playerId: PlayerId): void;

  onPlayerLeave?(world: World, playerId: PlayerId): void;

  /** Reçoit l'input brut d'un joueur (direction + demande de split) pour ce tick. */
  onPlayerInput?(world: World, playerId: PlayerId, input: PlayerInput): void;

  /** Appelé quand un joueur passe de "a au moins un morceau" à "n'en a plus aucun". */
  onPlayerDeath?(world: World, playerId: PlayerId): void;
}

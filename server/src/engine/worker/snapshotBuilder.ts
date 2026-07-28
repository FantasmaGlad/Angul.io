import {
  distance,
  type EntitySnapshot,
  type LeaderboardEntry,
  type ServerMessage,
} from '@angulio/shared';
import type { Room } from '../room.js';
import type { SpatialHash } from '../spatialHash.js';
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
/** 1 pastille de nourriture sur `SPECTATOR_FOOD_SAMPLE_EVERY` est retenue — sélection stable par
 * id (pas aléatoire à chaque tick) pour qu'une pastille visible reste visible tant qu'elle existe,
 * au lieu de scintiller à chaque nouveau snapshot. Les ids d'entité sont des entiers croissants
 * (voir World.addEntity), donc un simple modulo suffit. */
export const SPECTATOR_FOOD_SAMPLE_EVERY = 4;

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
export function computeTopScores(world: World, players: PlayerState[]): TopScoreEntry[] {
  return players
    .map((p) => {
      let score = 0;
      for (const pieceId of p.pieceIds) {
        const piece = world.getEntity(pieceId);
        if (piece) score += piece.mass;
      }
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
  return {
    i: entity.id,
    k: entity.kind === 'particle' ? 'f' : 'c',
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

export interface BuildStateMessageParams {
  room: Room;
  playerId: PlayerId;
  isSpectator: boolean;
  tick: number;
  /** Entités du salon, calculées une seule fois par tick (voir wireRoom, broadcast.ts) — reconstruire
   * cette liste par socket coûterait O(P²) par tick sur un salon chargé. */
  allEntities: Entity[];
  topScores: TopScoreEntry[];
  /** Grille d'intérêt du salon, déjà reconstruite pour ce tick (voir wireRoom). */
  interestHash: SpatialHash;
  interestRadiusPx: number;
}

/** Construit le message `state` d'un seul destinataire (joueur ou spectateur) — logique
 * inchangée par rapport à l'ancienne boucle par-socket de `broadcast.ts` (`wireRoom`), seulement
 * extraite en fonction pure/testable et réutilisable telle quelle une fois la simulation du salon
 * hébergée dans un worker (voir plan_implementation, "worker_threads"). Retourne aussi `totalMass`
 * (nécessaire à l'appelant pour tenir `maxMassByPlayer` à jour, voir RoomRuntime). */
export function buildStateMessage(
  params: BuildStateMessageParams,
): { message: ServerMessage; totalMass: number } {
  const { room, playerId, isSpectator, tick, allEntities, topScores, interestHash, interestRadiusPx } =
    params;
  const world = room.world;

  const ownPieces = world.getPiecesByOwner(playerId);
  const center = centroidOf(ownPieces) ?? { x: world.mapSize / 2, y: world.mapSize / 2 };

  const visible = new Map<string, Entity>();
  for (const piece of ownPieces) visible.set(piece.id, piece);

  const ownMass = ownPieces.reduce((sum, p) => sum + p.mass, 0);
  // Plafonnée à `mapSize` : au-delà, le rayon "couvre" déjà toute la carte donc l'agrandir
  // encore n'ajoute aucune entité réellement visible — seulement plus de cellules de grille
  // interrogées et un payload réseau plus lourd pour rien (source des pics observés sur les
  // très grosses masses).
  const effectiveRadius =
    ownMass > 0
      ? Math.min(world.mapSize, Math.round(interestRadiusPx + Math.sqrt(ownMass) * 15))
      : interestRadiusPx;

  if (isSpectator) {
    for (const entity of allEntities) {
      if (isVisibleToSpectator(entity)) visible.set(entity.id, entity);
    }
  } else {
    for (const id of interestHash.queryNearby(center)) {
      const entity = world.getEntity(id);
      if (entity && distance(entity.position, center) <= effectiveRadius) {
        visible.set(entity.id, entity);
      }
    }
  }

  const entities: EntitySnapshot[] = [...visible.values()].map(toSnapshot);

  const totalMass = ownPieces.reduce((sum, piece) => sum + piece.mass, 0);
  const accelerationPerSec2 = totalMass > 0 ? room.getAccelerationForMass(totalMass) : undefined;

  const player = world.getPlayer(playerId);
  const comboLevel = player ? activeComboLevel(player.lifeStats.combo, performance.now()) : undefined;

  const selfFields: { accelerationPerSec2?: number; combo?: { level: number } } = {};
  if (accelerationPerSec2 !== undefined) selfFields.accelerationPerSec2 = accelerationPerSec2;
  if (comboLevel !== undefined) selfFields.combo = { level: comboLevel };
  const self = Object.keys(selfFields).length > 0 ? selfFields : undefined;

  const leaderboard: LeaderboardEntry[] = topScores.map((entry, idx) => ({
    rank: idx + 1,
    nickname: entry.nickname,
    score: entry.score,
    isSelf: entry.id === playerId,
  }));

  return {
    message: { type: 'state', tick, entities, leaderboard, self },
    totalMass,
  };
}

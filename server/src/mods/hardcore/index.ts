import { add, circleOverlapArea, clamp, distance, isBotId, PI, scale, type Vector2 } from '@angulio/shared';
import type { GameMod } from '../../engine/mod.js';
import { isGodPlayerId } from '../../engine/godmode.js';
import type { Entity, PlayerId, PlayerInput } from '../../engine/types.js';
import type { World } from '../../engine/world.js';
import { creditMassEatenXp, creditPlayerEatenXp } from '../../engine/xp.js';
import type { ParametricModConfig } from '../parametric/config.js';
import { applyRepulsion, createParametricMod } from '../parametric/index.js';
import { absorptionRatePerSec, velocityForMass } from '../parametric/physics.js';
import { pieceState } from '../parametric/pieceState.js';

/** Voir son homologue dans mods/parametric/index.ts. */
const ABSORPTION_REMOVE_FLOOR = 0.5;

export interface HardcoreModConfig {
  /** Multiplicateur appliqué à la masse gagnée en mangeant un **autre joueur** (cahier des
   * charges §3.4 #2 : "gains de masse multipliés x10 ou configurable") — la nourriture
   * ambiante n'est pas concernée : l'agressivité voulue vient de la prédation entre joueurs,
   * pas de la cueillette passive. */
  massGainMultiplier: number;
}

const DEFAULT_HARDCORE_CONFIG: HardcoreModConfig = { massGainMultiplier: 2 };

/**
 * Lot 4 — second mode aux mécaniques structurellement nouvelles (contrairement à Vanilla, qui
 * n'est qu'un jeu de valeurs sur le même schéma paramétrique, voir mods/parametric/config.ts). Valide que l'API de hooks (Lot 1.5) suffit à exprimer un mode qui
 * n'est PAS réductible à un fichier de config : un mod peut être écrit en **composant** un mod
 * existant plutôt qu'en dupliquant tout son mouvement/split/fusion/bords/decay (identiques ici
 * à Vanilla, cf. cahier des charges §3.4 #2 — rien à y changer) — ne réécrit que ce qui diffère
 * réellement : l'absorption entre joueurs (`onCollision`), la conséquence d'une mort
 * (`transformScoreForAccount`), et le split punitif du leader > 10x le second (`onTick`).
 */
export function createHardcoreMod(
  config: ParametricModConfig,
  hardcoreConfig: HardcoreModConfig = DEFAULT_HARDCORE_CONFIG,
): GameMod {
  const base = createParametricMod(config);

  /** Identique à `handleEatAttempt` du mod paramétrique (même condition d'avantage de masse,
   * même absorption PROGRESSIVE — voir son commentaire), sauf le montant gagné par l'attaquant
   * (`massGainMultiplier`, x10 par défaut) — c'est la seule différence de mécanique de ce mode
   * avec Vanilla. */
  function handleEatAttempt(world: World, attacker: Entity, target: Entity, dt: number): boolean {
    // Blob Dieu (§4.5 cahier_des_charges_admin.md) : jamais mangeable, mange toujours — même
    // exemption que le mod paramétrique sous-jacent (voir `hasMassAdvantage`), dupliquée ici car
    // Hardcore réimplémente sa propre condition d'avantage de masse (gain x10) plutôt que de
    // réutiliser celle du mod de base.
    if (isGodPlayerId(target.ownerId)) return false;
    const hasAdvantage =
      isGodPlayerId(attacker.ownerId) ||
      attacker.mass >= target.mass * (1 + config.eating.massAdvantage);
    if (!hasAdvantage) return false;

    const dist = distance(attacker.position, target.position);
    const overlap = circleOverlapArea(attacker.radius, target.radius, dist);
    if (overlap <= 0) return false;

    // Même convention d'aire que `circleOverlapArea` (voir shared/geometry.ts).
    const targetArea = PI * target.radius * target.radius;
    const overlapFraction = targetArea > 0 ? clamp(overlap / targetArea, 0, 1) : 1;
    const massLostByTarget =
      overlapFraction >= 0.35 || dist < attacker.radius
        ? target.mass
        : Math.min(target.mass, target.mass * absorptionRatePerSec(config) * overlapFraction * dt * 4);
    if (massLostByTarget <= 0) return false;

    const gainedMass = massLostByTarget * hardcoreConfig.massGainMultiplier;
    world.setMass(attacker, attacker.mass + gainedMass);
    // XP (engine/xp.ts) : la masse gagnée (déjà multipliée x10 par défaut) compte intégralement
    // pour "1 masse mangée = 1xp" — cohérent avec un mode à haut risque/haute récompense ; de
    // toute façon annulée à la mort/déconnexion par `transformScoreForAccount` ci-dessous.
    const now = performance.now();
    creditMassEatenXp(world, attacker.ownerId, gainedMass, now);

    const remainingMass = target.mass - massLostByTarget;
    if (remainingMass <= ABSORPTION_REMOVE_FLOOR) {
      if (attacker.ownerId && target.ownerId) {
        // Écran de mort personnalisé ("Éliminé par : X") — voir World.recordAttacker.
        world.recordAttacker(target.ownerId, attacker.ownerId);
      }
      world.removeEntity(target.id);
      if (attacker.ownerId) creditPlayerEatenXp(world, attacker.ownerId, now);
    } else {
      world.setMass(target, remainingMass);
    }
    return true;
  }

  function splitPlayerMaxRadially(world: World, playerId: PlayerId): void {
    let angleIndex = 0;
    let iterationGuard = 0;
    const MIN_PUNITIVE_SPLIT_MASS = 1;

    while (
      world.getPiecesByOwner(playerId).length < config.player.maxSplits &&
      iterationGuard < 10
    ) {
      iterationGuard++;
      const pieces = world.getPiecesByOwner(playerId);
      const eligible = pieces.filter((p) => p.mass >= MIN_PUNITIVE_SPLIT_MASS);
      if (eligible.length === 0) break;

      let splitOccurred = false;
      const count = eligible.length;
      for (let i = 0; i < count; i++) {
        if (world.getPiecesByOwner(playerId).length >= config.player.maxSplits) break;
        const piece = eligible[i]!;
        if (piece.mass < MIN_PUNITIVE_SPLIT_MASS) continue;

        // `2*Math.PI` (tour complet), pas `6` : l'approximation littérale laissait un secteur
        // d'environ 16° jamais couvert par aucune direction d'éjection.
        const angle = (angleIndex / 8) * (2 * Math.PI);
        angleIndex++;
        const dir: Vector2 = { x: Math.cos(angle), y: Math.sin(angle) };

        const half = piece.mass / 2;
        world.setMass(piece, half);
        const originState = pieceState(piece);
        originState.splitElapsedS = 0;
        originState.massAtSplit = half;

        const ejectedMass = half * config.split.ejectEfficiency;
        const ejectedPosition = add(piece.position, scale(dir, piece.radius * 2));
        const ejected = world.spawnPiece(playerId, ejectedPosition, ejectedMass);
        ejected.velocity = scale(
          dir,
          velocityForMass(ejectedMass, config) * config.split.ejectSpeedFactor,
        );

        const ejectedState = pieceState(ejected);
        ejectedState.inputTarget = { ...originState.inputTarget };
        ejectedState.inputIntensity = originState.inputIntensity;
        ejectedState.splitElapsedS = 0;
        ejectedState.massAtSplit = ejectedMass;

        splitOccurred = true;
      }

      if (!splitOccurred) break;
    }
  }

  interface DashState {
    charges: number;
    lastDashTimeMs: number;
    rechargeProgressMs: number;
  }

  const dashStates = new Map<PlayerId, DashState>();
  const lastPunitiveSplitByPlayer = new Map<PlayerId, number>();

  function getOrCreateDashState(playerId: PlayerId): DashState {
    let state = dashStates.get(playerId);
    if (!state) {
      state = { charges: 3, lastDashTimeMs: -10000, rechargeProgressMs: 0 };
      dashStates.set(playerId, state);
    }
    return state;
  }

  return {
    ...base,
    id: config.id,

    onPlayerJoin(world: World, playerId: PlayerId) {
      dashStates.set(playerId, { charges: 3, lastDashTimeMs: -10000, rechargeProgressMs: 0 });
      base.onPlayerJoin?.(world, playerId);
    },

    onPlayerLeave(world: World, playerId: PlayerId) {
      dashStates.delete(playerId);
      base.onPlayerLeave?.(world, playerId);
    },

    onPlayerDeath(world: World, playerId: PlayerId) {
      dashStates.delete(playerId);
      base.onPlayerDeath?.(world, playerId);
    },

    onPlayerInput(world: World, playerId: PlayerId, input: PlayerInput) {
      base.onPlayerInput?.(world, playerId, input);

      if (input.dash) {
        const pieces = world.getPiecesByOwner(playerId);
        if (pieces.length === 1) {
          const piece = pieces[0]!;
          const state = getOrCreateDashState(playerId);
          const now = performance.now();
          if (state.charges > 0 && now - state.lastDashTimeMs >= 1000) {
            state.charges -= 1;
            state.lastDashTimeMs = now;

            const dx = input.target.x - piece.position.x;
            const dy = input.target.y - piece.position.y;
            const len = Math.hypot(dx, dy);
            const dir: Vector2 = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
            const DASH_IMPULSE_SPEED = 2700;
            piece.velocity = add(piece.velocity, scale(dir, DASH_IMPULSE_SPEED));
          }
        }
      }
    },

    getDashState(world: World, playerId: PlayerId) {
      const pieces = world.getPiecesByOwner(playerId);
      const state = getOrCreateDashState(playerId);
      const now = performance.now();
      const canDash = pieces.length === 1 && state.charges > 0 && now - state.lastDashTimeMs >= 1000;
      const rechargeProgress = state.charges < 3 ? clamp(state.rechargeProgressMs / 4000, 0, 1) : 1;
      return {
        charges: state.charges,
        maxCharges: 3,
        canDash,
        rechargeProgress,
      };
    },

    onTick(world: World, dt: number) {
      base.onTick?.(world, dt);

      // Mise à jour de la recharge des dashs (4s par charge)
      for (const [playerId, state] of dashStates.entries()) {
        if (state.charges < 3) {
          state.rechargeProgressMs += dt * 1000;
          if (state.rechargeProgressMs >= 4000) {
            state.charges += 1;
            state.rechargeProgressMs = state.charges < 3 ? state.rechargeProgressMs - 4000 : 0;
          }
        }
      }
      // Intelligence Artificielle Hardcore : Les bots utilisent le Dash pour attaquer ou fuir
      const now = performance.now();
      for (const player of world.allPlayers()) {
        if (!isBotId(player.id)) continue;
        const pieces = world.getPiecesByOwner(player.id);
        if (pieces.length !== 1) continue;
        const piece = pieces[0]!;
        const dashState = getOrCreateDashState(player.id);
        if (dashState.charges <= 0 || now - dashState.lastDashTimeMs < 3000) continue;

        let dashTarget: Vector2 | undefined;
        for (const other of world.allEntities()) {
          if (!other.ownerId || other.ownerId === player.id) continue;
          const dist = distance(piece.position, other.position);
          if (dist > 500) continue;

          if (piece.mass >= other.mass * 1.25) {
            dashTarget = other.position; // Attaque
            break;
          } else if (other.mass >= piece.mass * 1.25) {
            const dx = piece.position.x - other.position.x;
            const dy = piece.position.y - other.position.y;
            const len = Math.hypot(dx, dy);
            if (len > 0) {
              dashTarget = { x: piece.position.x + (dx / len) * 500, y: piece.position.y + (dy / len) * 500 }; // Fuite
            }
            break;
          }
        }

        if (dashTarget) {
          dashState.charges -= 1;
          dashState.lastDashTimeMs = now;
          const dx = dashTarget.x - piece.position.x;
          const dy = dashTarget.y - piece.position.y;
          const len = Math.hypot(dx, dy);
          const dir: Vector2 = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
          const DASH_IMPULSE_SPEED = 2700;
          piece.velocity = add(piece.velocity, scale(dir, DASH_IMPULSE_SPEED));
        }
      }

      const playerTotals: Array<{ playerId: PlayerId; totalMass: number }> = [];
      for (const player of world.allPlayers()) {
        const pieces = world.getPiecesByOwner(player.id);
        if (pieces.length === 0) continue;
        const totalMass = pieces.reduce((sum, p) => sum + p.mass, 0);
        if (totalMass > 0) {
          playerTotals.push({ playerId: player.id, totalMass });
        }
      }

      if (playerTotals.length >= 1) {
        playerTotals.sort((a, b) => b.totalMass - a.totalMass);
        const leader = playerTotals[0]!;
        const runnerUp = playerTotals[1] ?? { playerId: '', totalMass: config.player.startMass };
        // Règle Hardcore : Si le 1er joueur a au moins 200 de masse et qu'il fait plus de 2x la masse du N-1,
        // déclencher l'explosion punitive radiale (au maximum une fois toutes les 10s pour éviter la boucle 20Hz créatrice de lag).
        const lastSplitMs = lastPunitiveSplitByPlayer.get(leader.playerId) ?? -10000;
        const nowMs = performance.now();
        if (leader.totalMass >= 200 && leader.totalMass > runnerUp.totalMass * 2 && nowMs - lastSplitMs >= 10000) {
          lastPunitiveSplitByPlayer.set(leader.playerId, nowMs);
          splitPlayerMaxRadially(world, leader.playerId);
        }
      }
    },

    onCollision(world: World, a: Entity, b: Entity, dt: number) {
      if (a.kind === 'particle' && b.kind === 'particle') return;

      // Nourriture et fusion/collision dure entre morceaux du même joueur : comportement
      // inchangé, délégué tel quel au mod paramétrique sous-jacent.
      if (
        a.kind === 'particle' ||
        b.kind === 'particle' ||
        (a.ownerId && a.ownerId === b.ownerId)
      ) {
        base.onCollision?.(world, a, b, dt);
        return;
      }

      // Deux morceaux de joueurs différents : absorption s'il y a un avantage de masse,
      // ou répulsion si aucune entité n'a l'avantage (masses équivalentes).
      const hasAdvA =
        isGodPlayerId(a.ownerId) ||
        (!isGodPlayerId(b.ownerId) && a.mass >= b.mass * (1 + config.eating.massAdvantage));
      const hasAdvB =
        isGodPlayerId(b.ownerId) ||
        (!isGodPlayerId(a.ownerId) && b.mass >= a.mass * (1 + config.eating.massAdvantage));

      if (hasAdvA || hasAdvB) {
        if (hasAdvA) handleEatAttempt(world, a, b, dt);
        else handleEatAttempt(world, b, a, dt);
        return;
      }

      applyRepulsion(a, b);
    },

    transformScoreForAccount() {
      // "Perte totale de la progression XP de la partie en cas de mort" (§3.4 #2) : contrairement
      // aux autres modes, une vie qui se termine (mort ou déconnexion, Lot 3.5) ne crédite ni
      // score ni XP — comme si la vie n'avait pas eu lieu.
      return { score: 0, xp: 0 };
    },
  };
}

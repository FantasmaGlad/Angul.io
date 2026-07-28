import { add, scale, type Vector2 } from '@angulio/shared';
import type { GameMod } from '../../engine/mod.js';
import type { Entity, PlayerId } from '../../engine/types.js';
import type { World } from '../../engine/world.js';
import { creditMassEatenXp, creditPlayerEatenXp } from '../../engine/xp.js';
import type { ParametricModConfig } from '../parametric/config.js';
import { createParametricMod } from '../parametric/index.js';
import { velocityForMass } from '../parametric/physics.js';
import { pieceState } from '../parametric/pieceState.js';

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

  /** Identique à `handleEatAttempt` du mod paramétrique (même condition d'avantage de masse),
   * sauf le montant gagné — c'est la seule différence de mécanique de ce mode avec Vanilla. */
  function handleEatAttempt(world: World, attacker: Entity, target: Entity): boolean {
    if (attacker.mass >= target.mass * (1 + config.eating.massAdvantage)) {
      const gainedMass = target.mass * hardcoreConfig.massGainMultiplier;
      if (attacker.ownerId && target.ownerId) {
        // Écran de mort personnalisé ("Éliminé par : X") — voir World.recordAttacker.
        world.recordAttacker(target.ownerId, attacker.ownerId);
      }
      world.setMass(attacker, attacker.mass + gainedMass);
      world.removeEntity(target.id);
      // XP (engine/xp.ts) : la masse gagnée (déjà multipliée x10 par défaut) compte intégralement
      // pour "1 masse mangée = 1xp" — cohérent avec un mode à haut risque/haute récompense ; de
      // toute façon annulée à la mort/déconnexion par `transformScoreForAccount` ci-dessous.
      const now = performance.now();
      creditMassEatenXp(world, attacker.ownerId, gainedMass, now);
      creditPlayerEatenXp(world, attacker.ownerId, now);
      return true;
    }
    return false;
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

        const angle = (angleIndex / 8) * 6;
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

  return {
    ...base,
    id: config.id,

    onTick(world: World, dt: number) {
      base.onTick?.(world, dt);

      // Règle Hardcore : Si un joueur devient trop gros (> 10x la taille du deuxième),
      // le diviser au maximum possible dans toutes les directions.
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
        // déclencher l'explosion punitive radiale.
        if (leader.totalMass >= 200 && leader.totalMass > runnerUp.totalMass * 2) {
          splitPlayerMaxRadially(world, leader.playerId);
        }
      }
    },

    onCollision(world: World, a: Entity, b: Entity) {
      if (a.kind === 'particle' && b.kind === 'particle') return;

      // Nourriture et fusion entre morceaux du même joueur : comportement inchangé, délégué
      // tel quel au mod paramétrique sous-jacent.
      if (
        a.kind === 'particle' ||
        b.kind === 'particle' ||
        (a.ownerId && a.ownerId === b.ownerId)
      ) {
        base.onCollision?.(world, a, b);
        return;
      }

      // Deux morceaux de joueurs différents : seule l'absorption change (multiplicateur) ; la
      // répulsion (aucun des deux n'a l'avantage) reste celle du mod paramétrique.
      if (!handleEatAttempt(world, a, b) && !handleEatAttempt(world, b, a)) {
        base.onCollision?.(world, a, b);
      }
    },

    transformScoreForAccount() {
      // "Perte totale de la progression XP de la partie en cas de mort" (§3.4 #2) : contrairement
      // aux autres modes, une vie qui se termine (mort ou déconnexion, Lot 3.5) ne crédite ni
      // score ni XP — comme si la vie n'avait pas eu lieu.
      return { score: 0, xp: 0 };
    },
  };
}

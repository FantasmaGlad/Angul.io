import type { GameMod } from '../../engine/mod.js';
import type { Entity } from '../../engine/types.js';
import type { World } from '../../engine/world.js';
import { creditMassEatenXp, creditPlayerEatenXp } from '../../engine/xp.js';
import type { ParametricModConfig } from '../parametric/config.js';
import { createParametricMod } from '../parametric/index.js';

export interface HardcoreModConfig {
  /** Multiplicateur appliqué à la masse gagnée en mangeant un **autre joueur** (cahier des
   * charges §3.4 #2 : "gains de masse multipliés x10 ou configurable") — la nourriture
   * ambiante n'est pas concernée : l'agressivité voulue vient de la prédation entre joueurs,
   * pas de la cueillette passive. */
  massGainMultiplier: number;
}

const DEFAULT_HARDCORE_CONFIG: HardcoreModConfig = { massGainMultiplier: 10 };

/**
 * Lot 4 — second mode aux mécaniques structurellement nouvelles (contrairement à Folie, qui
 * n'est qu'un jeu de valeurs différentes sur le même schéma paramétrique, voir
 * mods/parametric/config.ts). Valide que l'API de hooks (Lot 1.5) suffit à exprimer un mode qui
 * n'est PAS réductible à un fichier de config : un mod peut être écrit en **composant** un mod
 * existant plutôt qu'en dupliquant tout son mouvement/split/fusion/bords/decay (identiques ici
 * à Vanilla, cf. cahier des charges §3.4 #2 — rien à y changer) — ne réécrit que ce qui diffère
 * réellement : l'absorption entre joueurs (`onCollision`) et la conséquence d'une mort
 * (`transformScoreForAccount`, nouveau hook ajouté pour ce mode, voir engine/mod.ts §4.5).
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

  return {
    ...base,
    id: config.id,

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

/**
 * Schéma de configuration du COMPORTEMENT des robots (IA de pilotage — botEvaluator.ts),
 * lisible depuis un fichier JSON externe (voir server/configs/bots/*.json) — même principe que
 * `ParametricModConfig` (mods/parametric/config.ts) pour les modes de jeu : un fichier JSON par
 * "profil de comportement", sélectionné par id (`BotConfig.behaviorId`, mods/parametric/config.ts)
 * plutôt que des constantes codées en dur qu'il fallait modifier/recompiler pour ajuster (demande
 * utilisateur : "même système que les salons... un dossier dédié au comportement des robots, avec
 * en master des .json qui régissent les robots et leurs customisations de comportements").
 *
 * Ne couvre que le PILOTAGE d'un bot déjà décidé à jouer une action (fuite/chasse/vagabondage/
 * split) — la POPULATION de bots (combien, quand, quelle pyramide Challenger) reste du ressort de
 * `BotConfig` (mods/parametric/config.ts), un souci différent et déjà paramétrique.
 */
export interface BotBehaviorConfig {
  /** Rayon (px) de la requête broad-phase des entités environnantes (spatialHash), partagé par
   * tous les profils — au-delà, une entité n'est simplement jamais considérée comme prédateur/
   * proie/nourriture ce tick. */
  neighborQueryRadiusPx: number;
  /** Ratio de masse au-delà duquel une entité voisine est traitée comme un PRÉDATEUR
   * (masse_voisin >= masse_bot * ratio). */
  predatorMassRatio: number;
  /** Ratio de masse en-deçà duquel une entité voisine est traitée comme une PROIE
   * (masse_voisin <= masse_bot * ratio). */
  preyMassRatio: number;
  /** Distance (px) projetée devant le bot pour construire sa cible monde (`target` de l'input) —
   * doit rester assez grande pour que tous les morceaux du bot gardent le même cap. */
  targetProjectionDistancePx: number;
  /** Lissage de direction (EMA, 0-1) appliqué entre deux évaluations consécutives — évite les
   * changements de cap instantanés/saccadés d'une évaluation à l'autre. */
  directionSmoothing: number;

  fuis: {
    /** Rayon (px) en-deçà duquel un prédateur déclenche la fuite. */
    predatorRadiusPx: number;
    fleeIntensity: number;
    foodSeekIntensity: number;
    wanderIntensity: number;
  };

  neutre: {
    /** Rayon (px) en-deçà duquel un prédateur déclenche la prudence (recul, pas fuite pure). */
    predatorRadiusPx: number;
    cautionIntensity: number;
    foodSeekIntensity: number;
    wanderIntensity: number;
  };

  agressif: {
    /** Rayon (px) en-deçà duquel un prédateur menaçant déclenche la fuite (même un bot agressif
     * fuit un plus gros que lui). */
    threatRadiusPx: number;
    fleeIntensity: number;
    /** Anticipation (s) de la position future de la proie, à partir de sa vélocité connue. */
    preyPredictionSeconds: number;
    chaseIntensity: number;
    foodSeekIntensity: number;
    wanderIntensity: number;
    /** Cooldown (ms) entre deux splits létaux. */
    splitCooldownMs: number;
    /** Seuil : split déclenché seulement si (masse_bot / 2) >= masse_proie * ce multiplicateur. */
    splitMassMultiplier: number;
  };

  fou: {
    /** Probabilité (0-1) de pause complète (intensité nulle) à chaque évaluation. */
    pauseChance: number;
    /** Intensité minimale hors pause (l'intensité effective est `intensityMin + random()*intensityRange`). */
    intensityMin: number;
    intensityRange: number;
    /** Déviation angulaire maximale du vagabondage (voir `getWanderDir`). */
    wanderMaxDeviation: number;
    /** Cooldown (ms) entre deux splits aléatoires. */
    splitCooldownMs: number;
    /** Masse minimale pour tenter un split aléatoire. */
    splitMinMass: number;
    /** Probabilité (0-1) de split aléatoire à chaque évaluation, une fois `splitMinMass` atteinte. */
    splitChance: number;
  };

  wallAvoidance: {
    /** Distance (px) au bord à partir de laquelle le bot commence à s'en écarter (voir le calcul
     * de `wallFactor` dans botEvaluator.ts — la priorité de cette force sur le cap du profil
     * augmente ensuite progressivement jusqu'au bord lui-même). */
    marginPx: number;
  };
}

/** Valeurs par défaut — copie exacte des constantes historiquement codées en dur dans
 * botEvaluator.ts (comportement STRICTEMENT inchangé par ce refactor tant que
 * `server/configs/bots/default.json` n'est pas modifié). Utilisée comme repli si le fichier JSON
 * est absent/invalide, et comme valeur par défaut du paramètre `behavior` de `computeBotInput`
 * (pour les tests/appels directs qui n'en fournissent pas). */
export const DEFAULT_BOT_BEHAVIOR_CONFIG: BotBehaviorConfig = {
  neighborQueryRadiusPx: 500,
  predatorMassRatio: 1.05,
  preyMassRatio: 0.8,
  targetProjectionDistancePx: 10000,
  directionSmoothing: 0.25,
  fuis: {
    predatorRadiusPx: 350,
    fleeIntensity: 1.0,
    foodSeekIntensity: 0.5,
    wanderIntensity: 0.5,
  },
  neutre: {
    predatorRadiusPx: 150,
    cautionIntensity: 0.8,
    foodSeekIntensity: 0.7,
    wanderIntensity: 0.6,
  },
  agressif: {
    threatRadiusPx: 200,
    fleeIntensity: 1.0,
    preyPredictionSeconds: 0.3,
    chaseIntensity: 1.0,
    foodSeekIntensity: 0.9,
    wanderIntensity: 0.9,
    splitCooldownMs: 15000,
    splitMassMultiplier: 1.35,
  },
  fou: {
    pauseChance: 0.1,
    intensityMin: 0.2,
    intensityRange: 0.8,
    wanderMaxDeviation: 0.8,
    splitCooldownMs: 20000,
    splitMinMass: 300,
    splitChance: 0.002,
  },
  wallAvoidance: {
    marginPx: 300,
  },
};

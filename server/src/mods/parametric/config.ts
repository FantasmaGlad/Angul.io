/**
 * Schéma de configuration d'un mod "paramétrique" : un mode de jeu défini uniquement par des
 * valeurs numériques (pas de nouvelle logique de jeu), lisible depuis un fichier JSON externe
 * (voir server/configs/*.json). Vanilla et Folie sont deux instances de ce même schéma —
 * ajouter un troisième mode de ce type ne demande qu'un nouveau fichier JSON, aucun code.
 *
 * Un mode aux mécaniques structurellement différentes (ex. un mode "zombie" avec une IA
 * d'entité non-joueur) reste un `GameMod` écrit à la main (voir l'API de hooks, engine/mod.ts)
 * — ce schéma ne couvre que le réglage de valeurs, pas l'ajout de règles nouvelles.
 *
 * Origine des valeurs : "Angul.io - Master Sheet Engine & Documentation Technique.xlsx"
 * (dictionnaire des variables + matrice de configuration des mods), complété par les points
 * que la feuille ne couvre pas encore (decay passif, avantage de masse pour manger, overlap de
 * fusion, constante masse→aire) — repris tels quels de la spécification initiale
 * (cahier_des_charges.md §3.5 / metriques.md v0.1).
 */
export interface ParametricModConfig {
  id: string;

  player: {
    /** M0 — masse attribuée au spawn/respawn. */
    startMass: number;
    /** Smax — nombre maximal de morceaux simultanés par joueur. */
    maxSplits: number;
    /** Masse minimale pour avoir le droit de split — absent de la feuille Excel (qui ne liste
     * pas ce paramètre), repris de metriques.md §3.5 (100 = 2×M0 pour Vanilla) et généralisé
     * en valeur absolue configurable plutôt qu'un facteur implicite. */
    minSplitMass: number;
  };

  physics: {
    /** V0 (px/s) — vitesse nominale pour un morceau de masse M0. */
    v0: number;
    /** kv — multiplicateur de vitesse global du mode. */
    speedMultiplier: number;
    /** gamma — exposant d'atténuation : v(m) = MAX(Vfloor, V0*kv*(M0/m)^gamma). */
    speedMassExponent: number;
    /** Vfloor (px/s) — vitesse plancher, jamais nulle même pour une masse énorme. */
    velocityFloor: number;
    /** A0 (px/s²) — accélération (taux de rapprochement vers la vitesse cible) pour M0. */
    accelerationBase: number;
    /** alpha — exposant d'atténuation : a(m) = A0*(M0/m)^alpha. */
    accelerationMassExponent: number;
  };

  split: {
    /** eta_W — ratio masse gagnée par le morceau éjecté / masse perdue par le joueur.
     * 1.0 = conservation stricte (Vanilla) ; > 1 crée de la masse (Folie). */
    ejectEfficiency: number;
    /** Facteur (× v(m) du morceau éjecté) de la vitesse initiale d'éjection — absent de la
     * feuille Excel, nécessaire à l'implémentation ; décroît ensuite via le modèle
     * d'accélération générique (pas de minuteur de "boost" séparé). */
    ejectSpeedFactor: number;
  };

  merge: {
    /** Tbase (s) — durée minimale avant qu'un morceau puisse fusionner avec un autre. */
    baseTimeSec: number;
    /** gamma_rec — allonge le cooldown avec la masse : T(m) = Tbase + gamma_rec*m. */
    massFactor: number;
    /** Fraction minimale de la surface totale des deux morceaux qui doit se chevaucher
     * pour fusionner — absent de la feuille, repris de metriques.md §10 (1/3). */
    overlapMinFraction: number;
  };

  eating: {
    /** Avantage de masse requis pour manger un autre joueur — absent de la feuille, repris
     * de metriques.md §7 (5%). */
    massAdvantage: number;
    /** Masse minimale pour pouvoir manger une particule — absent de la feuille, repris de
     * metriques.md §6 (2). */
    minMassToEatFood: number;
  };

  /** Perte de masse passive — Mm (`floor`) et Ml (les taux/seuil) de la feuille Excel,
   * §1 du dictionnaire. Le seuil (`threshold`) n'est plus lié à `player.startMass` (v0.1) :
   * c'est une valeur absolue propre au mode. */
  decay: {
    /** Ml — masse en-dessous de laquelle le taux de perte passe de `rateAboveThreshold` à
     * `rateBelowThreshold`. Vanilla : 100 (= son propre `minSplitMass`). */
    threshold: number;
    rateAboveThreshold: number;
    intervalAboveThresholdSec: number;
    rateBelowThreshold: number;
    intervalBelowThresholdSec: number;
    /** Mm — masse minimale que la perte passive ne peut jamais franchir. */
    floor: number;
  };

  arena: {
    width: number;
    height: number;
    borderType: 'STRICT_WALL' | 'ELASTIC_BOUNCE' | 'TOROIDAL' | 'TOXIC_ZONE';
    /** Requis seulement pour ELASTIC_BOUNCE (fraction de vitesse restituée au rebond). */
    bounceRestitution?: number;
  };

  food: {
    /** D_food — pellets moyens par bloc de 1000×1000 px² (densité, pas un total fixe :
     * s'adapte automatiquement à la taille de la carte). */
    density: number;
    /** R_food — pellets réapparaissant par seconde sur toute la carte. */
    respawnRatePerSecond: number;
    massMin: number;
    massMax: number;
    /** > 1 favorise les petites masses dans [massMin, massMax] ("plus de petits que de
     * gros" — Folie). 1 = distribution uniforme. Absent de la feuille (qui ne donne que la
     * description qualitative), interprétation assumée ici. */
    massSkewExponent: number;
  };

  /** K_AREA — constante masse→aire (Rayon = √(K_AREA·masse/π)), absente de la feuille,
   * reprise de metriques.md §2 (π, donc Rayon = √masse). */
  areaConstant: number;
}

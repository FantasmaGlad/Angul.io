import type { RoomResetSchedule } from '../../engine/resetSchedule.js';

/**
 * Schéma de configuration d'un mod "paramétrique" : un mode de jeu défini uniquement par des
 * valeurs numériques (pas de nouvelle logique de jeu), lisible depuis un fichier JSON externe
 * (voir server/configs/*.json). Vanilla est une instance de ce schéma — ajouter un autre
 * mode de ce type ne demande qu'un nouveau fichier JSON, aucun code.
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

/** Un type de pellet de nourriture (voir `ParametricModConfig['food']['pelletTypes']`). */
export interface FoodPelletType {
  /** Purement informatif (lisibilité des fichiers de config/journal) — jamais transmis au
   * client. */
  color: string;
  mass: number;
  weight: number;
}

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
     * 1.0 = conservation stricte (Vanilla) ; > 1 crée de la masse. */
    ejectEfficiency: number;
    /** Facteur (× v(m) du morceau éjecté) de la vitesse initiale d'éjection — absent de la
     * feuille Excel, nécessaire à l'implémentation ; décroît ensuite via le modèle
     * d'accélération générique (pas de minuteur de "boost" séparé). */
    ejectSpeedFactor: number;
  };

  /** Éjection de masse (demande utilisateur, touche configurable — pas dans la feuille Excel
   * d'origine) : recrache une particule de masse fixe, mangeable par n'importe qui (y compris un
   * adversaire), dans la direction visée. */
  eject: {
    /** Masse (fixe, pas un %) envoyée par éjection — 5 en Vanilla, 20 en Hardcore (valeurs
     * fournies par l'utilisateur). */
    amount: number;
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
    /** Multiplicateur de masse gagnée par la nourriture (1.5 = +50% de grossissement). */
    foodEfficiency?: number;
    /** Fraction (0-1) de la surface de la cible qui doit être recouverte pour que l'absorption se
     * déclenche (voir `handleEatAttempt`, mods/parametric/index.ts et mods/hardcore/index.ts) —
     * en-dessous, les deux morceaux peuvent se chevaucher librement (aucune répulsion, aucun
     * effet), exactement comme un vrai agar.io. Absent = repli sur `DEFAULT_EAT_OVERLAP_FRACTION`
     * (physics.ts). */
    eatOverlapFraction?: number;
    /** Durée (s) de l'absorption une fois `eatOverlapFraction` franchi — la masse de la cible est
     * transférée à l'attaquant PROGRESSIVEMENT sur cette durée (la cible rétrécit visiblement)
     * plutôt qu'en un seul tick de simulation, pour que la victime comprenne ce qui lui arrive
     * (voir `beginConsumption`/`advanceConsumptions`, mods/parametric/index.ts) — une fois ce
     * seuil franchi, l'issue est scellée : le morceau ne peut plus s'en sortir même s'il se dégage
     * du chevauchement entre-temps. Absent = repli sur `DEFAULT_ABSORPTION_DURATION_SEC`
     * (physics.ts). */
    absorptionDurationSec?: number;
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
    /** Types de pellets (couleur/masse/poids de spawn) — remplace l'ancien modèle de
     * distribution continue (`massMin`/`massMax`/`massSkewExponent`) par une palette de valeurs
     * discrètes propre à chaque mode (demande utilisateur : Vert/Bleu/Jaune/Violet/Rouge/
     * Orange/Rose/Multicolor). `weight` est un poids relatif de spawn — pas nécessairement
     * normalisé à 100, `randomFoodMass` (physics.ts) pondère proportionnellement à la somme des
     * poids de la liste. `color` est purement informatif (jamais transmis au client, qui déduit
     * la couleur d'affichage directement de la masse reçue — voir client/src/render.ts, aucun
     * champ supplémentaire sur le protocole réseau). */
    pelletTypes: FoodPelletType[];
  };

  /** K_AREA — constante masse→aire (Rayon = √(K_AREA·masse/π)), absente de la feuille,
   * reprise de metriques.md §2 (π, donc Rayon = √masse). */
  areaConstant: number;

  bots?: BotConfig;

  /** Punition du Top 5 (mécanique commune à tout mode paramétrique, voir
   * mods/parametric/index.ts `onTick`) : force un split sur le morceau le plus lourd d'un joueur
   * en tête si son avance sur le suivant devient trop confortable — évite qu'un seul joueur ne
   * devienne intouchable en fin de partie. Absent = repli sur les valeurs par défaut ci-dessous
   * (`DEFAULT_LEADER_PUNISHMENT`, index.ts), identiques au comportement d'origine. */
  leaderPunishment?: {
    /** `false` désactive entièrement la mécanique pour ce mode. */
    enabled: boolean;
    /** Nombre de joueurs les mieux classés examinés à chaque vérification (5 = "Top 5"). */
    topN: number;
    /** Masse totale minimale du joueur en tête avant que la mécanique ne puisse se déclencher. */
    minMassThreshold: number;
    /** Ratio d'avance (masse du joueur / masse du suivant) au-delà duquel le split est déclenché. */
    leadRatio: number;
    /** Délai minimal (ms) entre deux déclenchements pour un même joueur. */
    cooldownMs: number;
    /** Fréquence de vérification, en nombre de ticks du mod (pas de tick serveur) entre deux
     * passages — 20 = une fois toutes les 20 exécutions de `onTick`. */
    checkIntervalTicks: number;
  };

  /** Réglages de salon par défaut pour ce mode — utilisés par `server/src/index.ts` pour les
   * salons de base créés au démarrage ; un salon créé depuis le lobby peut les redéfinir
   * individuellement (voir `CreateRoomOptions`, engine/roomManager.ts). Absents = repli sur les
   * valeurs par défaut historiques (voir `server/src/index.ts`). */
  room?: {
    /** Nombre maximal de joueurs simultanés pour un salon de base de ce mode. */
    maxPlayers?: number;
    /** Planification du reset automatique — même format que `RoomOptions.resetSchedule`
     * (engine/resetSchedule.ts) : `{ type: 'dailyAt', hour, minute, timeZone }`,
     * `{ type: 'everyNMinutes', minutes, timeZone }`, `{ type: 'interval', intervalMs }`, ou
     * `null` pour désactiver tout reset automatique. */
    resetSchedule?: RoomResetSchedule | null;
  };
}

export interface BotConfig {
  enabled: boolean;
  /** Absent : laisse `BotManager.updateFluctuatingRatio` piloter le ratio (10-20%) plutôt qu'une
   * valeur fixe — voir server/configs/*.json, qui n'en définissent volontairement pas. */
  targetRatio?: number;
  /** Nombre de bots maintenus en mode ambiance à 0 joueur humain connecté (défaut : 6). */
  ambientTargetCount?: number;
  updateFrequencyHz: number;
  proportions: {
    fuis: number;
    neutre: number;
    agressif: number;
    fou: number;
  };
}

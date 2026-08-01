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

/** Un palier de perte de masse passive (voir `ParametricModConfig['decay']['tiers']` et
 * `decayLambda`, physics.ts) : à partir de `minMass`, un morceau perd `rate` (fraction, ex. 0.01 =
 * 1%) de sa masse toutes les `intervalSec` secondes tant qu'il reste dans ce palier. */
export interface DecayTier {
  minMass: number;
  rate: number;
  intervalSec: number;
}

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
    /** `false` désactive entièrement le split pour ce mode (demande utilisateur : Hardcore ne
     * garde que le Dash) — absent = activé, voir `splitEnabled()` (physics.ts). */
    splitEnabled?: boolean;
    /** `false` désactive entièrement l'éjection de masse (touche configurable, défaut `W`) pour
     * ce mode (demande utilisateur : Hardcore ne garde que le Dash, pas de nourrissage volontaire
     * d'un allié) — absent = activée, voir `ejectEnabled()` (physics.ts). */
    ejectEnabled?: boolean;
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
    /** alpha — exposant d'atténuation : a(m) = A0*(M0/m)^alpha. Régit la MISE EN MOUVEMENT
     * uniquement — voir `decelerationMassExponent` pour le freinage. */
    accelerationMassExponent: number;
    /** delta — exposant d'atténuation dédié au FREINAGE (relâchement de l'input) — voir
     * `MovementConfig.decelerationMassExponent` (shared/src/movement.ts) pour le détail. Absent =
     * repli sur `accelerationMassExponent` (un seul exposant partagé, comportement historique). */
    decelerationMassExponent?: number;
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
    /** Masse (fixe, pas un %) envoyée par éjection. */
    amount: number;
    /** Masse de la particule créée (valeur éjectée W). Si absente, vaut `amount`. */
    value?: number;
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

  /** Perte de masse passive — Mm (`floor`) de la feuille Excel §1 du dictionnaire, `tiers`
   * remplaçant les paliers Ml d'origine par un système à N paliers arbitraires (voir
   * `decayLambda`, physics.ts) — nécessaire pour que la sévérité de la décroissance passive
   * diffère réellement d'un mode à l'autre (cahier des charges §4d : douce en Vanilla, punitive en
   * Hardcore), ce que l'ancien schéma à 2 paliers fixes ne permettait pas correctement. */
  decay: {
    /** Paliers de perte, PAS nécessairement triés (le palier retenu est celui de `minMass` le
     * plus élevé restant <= la masse courante) — voir `DecayTier`. Un premier palier
     * `{ minMass: 0, rate: 0, ... }` désactive explicitement toute perte en-dessous du premier
     * vrai seuil punitif. */
    tiers: DecayTier[];
    /** Délai (s) depuis la dernière prise de masse en-dessous duquel la perte passive ne
     * s'applique jamais, quel que soit le palier — laisse un joueur qui vient de manger
     * tranquille un court instant plutôt que de le pénaliser en continu. Un mode plus punitif
     * (Hardcore) utilise une valeur plus courte. */
    graceSec: number;
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
  /** Id du profil de comportement de robots à utiliser (nom de fichier sans extension sous
   * `server/configs/bots/`, voir `engine/bots/loadBehaviorConfig.ts`/`behaviorConfig.ts`) — même
   * principe que `modId` pour `server/configs/*.json` (demande utilisateur : "même système que les
   * salons"). Gouverne le PILOTAGE des bots (fuite/chasse/vagabondage/split, botEvaluator.ts) ;
   * n'a aucun effet sur leur POPULATION (ambientTargetCount/challengers ci-dessous, un souci
   * différent). Absent = `'default'` (comportement historique, voir `DEFAULT_BOT_BEHAVIOR_CONFIG`). */
  behaviorId?: string;
  /** Absent : laisse `BotManager.updateFluctuatingRatio` piloter le ratio (10-20%) plutôt qu'une
   * valeur fixe — voir server/configs/*.json, qui n'en définissent volontairement pas. */
  targetRatio?: number;
  /** Nombre de bots maintenus en mode ambiance à 0 joueur humain connecté (défaut : 6). */
  ambientTargetCount?: number;
  /** Plafond dur absolu du nombre de bots ACTIFS SIMULTANÉMENT dans ce salon, Challengers ET bots
   * normaux confondus (demande utilisateur : "au-delà de X robots, plus d'apparition possible") —
   * appliqué en plus (jamais à la place) de la réservation "au moins 1 place pour un humain" déjà
   * garantie par `maxRoomCapacity` (voir `BotManager.adjustPopulation`). Absent = aucun plafond
   * dédié (seule la capacité du salon borne la population de bots, comportement d'origine). */
  maxTotal?: number;
  updateFrequencyHz: number;
  proportions: {
    fuis: number;
    neutre: number;
    agressif: number;
  };
  /** Bots "Challenger" (pyramide de robots forts identifiés par rang, voir
   * engine/bots/botManager.ts/botTypes.ts) — population et paliers de masse distincts des bots
   * normaux ci-dessus (`proportions`/`ambientTargetCount`). Depuis la connexion du premier humain,
   * c'est ce mécanisme SEUL qui peuple le salon (demande utilisateur, §15) : les profils normaux
   * ci-dessus ne servent plus qu'au peuplement ambiant à 0 humain. Absent = repli sur
   * `DEFAULT_CHALLENGER_CONFIG` (botTypes.ts). */
  challengers?: {
    /** `false` désactive entièrement les Challengers pour ce mode (aucun, même avec un humain
     * connecté) — indépendant de `BotConfig.enabled` (qui coupe TOUS les bots, y compris les
     * bots normaux ci-dessus). */
    enabled: boolean;
    /** Nombre de Challengers maintenus en PERMANENCE, même sans aucun joueur humain connecté
     * (demande utilisateur — auparavant 0 tant qu'aucun humain n'était présent). */
    baselineCount: number;
    /** Population de Challengers dès qu'UN SEUL joueur humain vient de se connecter (démarrage de
     * la décroissance ci-dessous, voir `minWithHumans`/`rampHumans`). */
    maxWithHumans: number;
    /** Plancher vers lequel `maxWithHumans` décroît linéairement à mesure que le nombre de joueurs
     * humains augmente (demande utilisateur, §15 : "plus il y a de joueurs humains, plus le nombre
     * de robots diminue") — atteint et maintenu à partir de `rampHumans` joueurs humains. */
    minWithHumans: number;
    /** Nombre de joueurs humains à partir duquel la décroissance linéaire entre `maxWithHumans` (à
     * 1 humain) et `minWithHumans` atteint son plancher — voir `rampedChallengerTarget`,
     * botTypes.ts. */
    rampHumans: number;
    /** Multiplicateur de masse de spawn par rang (index 0 = rang 1, le plus fort) — longueur
     * attendue >= `maxWithHumans` (un rang au-delà de la longueur du tableau retombe sur la
     * dernière valeur, voir `challengerMassMultiplierForRank`, botTypes.ts). Sert aussi de valeur
     * pour un Challenger qui réapparaît après avoir été mangé : toujours au dernier palier actif
     * (le plus faible), jamais au palier du rang mangé — voir `BotManager.onPlayerDeath`. */
    massMultipliers: number[];
  };
  /** Désactivation automatique de TOUS les bots (normaux ET Challengers) si aucun joueur humain
   * n'est connecté au salon depuis `afterMinutes` minutes d'affilée — économise le CPU d'un salon
   * durablement vide (voir engine/bots/botManager.ts `updateIdleDespawn`). Le peuplement normal
   * reprend automatiquement dès qu'un humain rejoint. Absent = jamais de despawn automatique
   * (comportement d'origine, bots toujours actifs même dans un salon vide). */
  idleDespawn?: {
    /** `false` désactive entièrement ce mécanisme pour ce mode. */
    enabled: boolean;
    /** Minutes consécutives sans aucun joueur humain avant le despawn de tous les bots. */
    afterMinutes: number;
  };
}

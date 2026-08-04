# Angul.io

Jeu multijoueur temps réel façon Agar.io. Serveur autoritaire Node.js/TypeScript, client Canvas2D
+ React, système de modes de jeu ("mods") conçu pour être étendu sans toucher au moteur.

Ce document est écrit pour quelqu'un qui veut **modifier ou ajouter un mode de jeu** : il décrit
l'architecture réellement en place (pas une intention), le contrat que doit respecter un mod, et
ce qui est mutualisé entre tous les salons pour que rien ne soit dupliqué ni par mod ni par salon.
Pour une cartographie fichier-par-fichier, voir [structure.md](structure.md).

---

## Sommaire

1. [Stack et démarrage](#1-stack-et-démarrage)
2. [Architecture générale](#2-architecture-générale)
3. [Le moteur générique (`engine/`)](#3-le-moteur-générique-engine)
4. [Système de mods](#4-système-de-mods)
5. [Référence complète du schéma JSON](#5-référence-complète-du-schéma-json)
6. [Scalabilité serveur (worker_threads)](#6-scalabilité-serveur-worker_threads)
7. [Architecture réseau](#7-architecture-réseau)
8. [Mutualisation client (rendu/caméra/prédiction)](#8-mutualisation-client-renducaméraprédiction)
9. [Tests](#9-tests)
10. [Licence](#10-licence)

---

## 1. Stack et démarrage

- Node.js ≥ 20, TypeScript strict partout, npm workspaces (4 paquets : `shared`, `server`,
  `client`, `admin` — voir [structure.md](structure.md#1-vue-densemble-du-monorepo)).
- Serveur : Node natif (`node:http`, `ws`), PostgreSQL optionnel (comptes joueurs/admin — sans
  `DATABASE_URL`, le serveur tourne en parties anonymes uniquement).
- Client : React + Vite, rendu de jeu en Canvas2D (pas de WebGL, pas de moteur tiers).
- Admin : React + Vite, UI en glassmorphisme blanc (cahier_des_charges_admin.md §14) ; le canva
  temps réel (Studio de contrôle/POV) est rendu en PixiJS (WebGL), seule exception au reste du
  monorepo qui reste Canvas2D — voir §10.2 du même document pour le pourquoi.

```bash
npm install
npm run build      # shared → server → client → admin, dans cet ordre
npm test           # vitest, tous workspaces
npm run lint
```

Démarrage serveur (après build) :

```bash
node server/dist/index.js
```

Variables d'environnement server pertinentes pour le développement d'un mod :

| Variable | Défaut | Effet |
|---|---|---|
| `TICK_RATE_HZ` | `20` (v6.0) | Cadence de simulation, identique pour **tous** les salons du process — la physique intègre à pas fixe dérivé de cette valeur (`dt = 1/TICK_RATE_HZ`, jamais le temps réel écoulé), donc ce taux ne change pas le comportement de la simulation, seulement sa granularité temporelle et le coût CPU/réseau |
| `ROOM_WORKERS` | nb de cœurs CPU | Nombre de `worker_threads` hébergeant les salons ; `0` = mono-thread (utile pour déboguer un mod avec un débogueur synchrone) |
| `PORT` | `8080` | Port HTTP/WebSocket |
| `DATABASE_URL` | absent | Active comptes joueurs + persistance des scores |
| `ADMIN_PASSWORD_HASH` | absent | Active l'interface admin (mot de passe unique, argon2) |

**Outillage IA** : un serveur MCP local (`.claude/mcp/server.mjs`, enregistré par `.mcp.json` à la
racine) expose une cartographie interrogeable du dépôt (`.claude/project-structure.json`) — voir
[structure.md §1bis](structure.md#1bis-outillage-ia-serveur-mcp-local-coordination-multi-plateformes)
pour le détail et la règle de coordination si d'autres outils IA (Gemini, Cursor, Windsurf…)
viennent un jour s'ajouter à ce dépôt.

---

## 2. Architecture générale

```
┌─────────────┐  WebSocket (JSON)  ┌──────────────────────────────────────┐
│   client/   │◄──────────────────►│              server/                │
│ (React+2D)  │                    │  net/  →  engine/  →  mods/          │
└─────────────┘                    │  (HTTP+WS)  (Room/World)  (GameMod)  │
                                    └──────────────────────────────────────┘
       ▲                                          │
       │ HTTP (comptes, lobby, stats)             │ node-pg-migrate
       ▼                                          ▼
┌─────────────┐                           ┌──────────────┐
│   admin/    │◄── WebSocket `?admin=1` ──│  PostgreSQL  │ (optionnel)
│ (React+2D)  │        (spectateur+actions)└──────────────┘
└─────────────┘
```

Trois couches côté serveur, dans l'ordre de dépendance :

1. **`engine/`** — moteur générique : entités, grille spatiale, boucle de tick à pas fixe,
   hébergement des salons (mono-thread ou `worker_threads`). **Ne connaît aucune règle de jeu.**
2. **`mods/`** — implémentations de `GameMod` (l'unique interface que `engine/` connaît).
   `mods/parametric/` est un mod générique piloté par un fichier JSON ; `mods/hardcore/` est un
   mod qui **compose** `mods/parametric/` pour n'en changer que certains aspects.
3. **`net/`** — HTTP + WebSocket, ne connaît que `RoomManager`/`RoomHandle` (jamais `Room`/`World`
   directement, pour rester valable qu'un salon vive dans le process principal ou dans un
   worker — voir §6).

Un salon (`Room`) = une instance de `World` + un `GameMod` + une boucle de tick. Tous les salons
d'un déploiement tournent à la **même** `TICK_RATE_HZ` ; rien n'empêche un mod de faire évoluer sa
propre notion de temps interne (compteurs, cooldowns) à un rythme différent en comptant ses
propres ticks.

---

## 3. Le moteur générique (`engine/`)

Fichiers clés : `engine/world.ts`, `engine/room.ts`, `engine/mod.ts`, `engine/types.ts`.

`World` gère les entités (`Entity` : `kind: 'piece' | 'particle'`, position, vélocité, masse,
rayon, `ownerId`) et une grille spatiale (`spatialHash.ts`) pour le broad-phase de collision
(évite un test O(n²) entre toutes les paires d'entités). `World` ne sait ni manger, ni diviser,
ni fusionner — ces règles n'existent que dans un `GameMod`.

`Room.tick()` (appelée à cadence fixe, `tickIntervalMs = 1000 / tickRateHz`) exécute, dans cet
ordre, pour **tout** mod sans exception :

```
mod.onTick(world, dt)          // le mod avance sa logique (mouvement, décroissance, spawn...)
botManager.update(dt)          // IA des bots (générique, indépendante du mod)
intégration position += vélocité * dt   // UNIQUE, jamais réimplémentée par un mod
mod.onPostMove(world, dt)      // ex: clamp aux bords de carte
rebuildSpatialHash()
pour chaque paire d'entités qui se chevauchent :
    mod.onCollision(world, a, b, dt)
détection des morts (joueur avec 0 morceau) → mod.onPlayerDeath(...)
```

`dt` est **toujours** `1 / tickRateHz`, jamais le temps réel écoulé ("fix your timestep") — un
retard d'event loop se traduit par un ralentissement de la simulation (visible dans
`tickMetrics()`/`/api/admin/health`), jamais par du bruit dans la physique elle-même.

### L'interface `GameMod` (`engine/mod.ts`)

C'est le **seul** point de contact entre `engine/` et un mod. Tous les hooks sont optionnels :

| Hook | Appelé | Rôle typique |
|---|---|---|
| `onRoomInit(world)` | une fois, à la création du salon | initialisation (rien pour Vanilla/Hardcore) |
| `onTick(world, dt)` | chaque tick, avant l'intégration | mouvement, décroissance passive, spawn de nourriture |
| `onPostMove(world, dt)` | chaque tick, après l'intégration | bords de carte |
| `onCollision(world, a, b, dt)` | pour chaque paire d'entités qui se chevauchent | manger, fusionner, repousser |
| `onPlayerJoin(world, playerId)` | connexion ou respawn | faire apparaître les morceaux du joueur |
| `onPlayerLeave(world, playerId)` | déconnexion | nettoyage d'état spécifique au mod |
| `onPlayerInput(world, playerId, input)` | à réception d'un message `input` | direction/intensité, split, dash, éjection |
| `onPlayerDeath(world, playerId)` | transition "a des morceaux" → "n'en a plus" | nettoyage d'état spécifique au mod |
| `getAccelerationForMass(mass)` | à la demande (réseau) | alimente le panneau de stats client |
| `getDashState(world, playerId)` | à la demande (réseau) | HUD dash (Hardcore uniquement) |
| `transformScoreForAccount(rawScore, rawXp)` | à la mort/déconnexion, avant écriture en base | transforme le score/XP brut de la vie avant crédit au compte (identité par défaut, voir `Room.transformScoreForAccount`) — aucun mode actuel ne le surcharge |

Un mod n'implémente que ce dont il a besoin — `engine/room.ts` appelle chaque hook avec `?.()`.

---

## 4. Système de mods

Deux façons d'écrire un mod, à choisir selon ce qui change réellement :

### 4.1 Mod "paramétrique" — un fichier JSON, zéro code

C'est le cas de **Vanilla**. Si ton mode ne fait que régler des valeurs (vitesse, masse de
départ, taux de perte passive, densité de nourriture, forme de la carte…) sans introduire de
règle de jeu nouvelle, tu n'écris **aucun TypeScript** :

1. Crée `server/configs/<tonModId>.json` en suivant le schéma de la §5 (copie `vanilla.json` et
   ajuste les valeurs).
2. C'est tout — `modRegistry.ts` détecte automatiquement tout fichier de `server/configs/*.json`
   comme un mode disponible (`listAvailableModIds()`), et `resolveMod(id)` construit le `GameMod`
   correspondant via `createParametricMod(config)`.
3. Redémarre le serveur ; le nouveau mode apparaît dans le lobby (`GET /api/modes`).

`createParametricMod` (`mods/parametric/index.ts`) implémente **toute** la logique de jeu
générique à partir de `config` : mouvement (`shared/src/movement.ts`), split, fusion, absorption à
seuil, éjection de masse, décroissance passive, bords de carte, spawn de nourriture. Rien de tout
cela n'a besoin d'être réécrit pour un nouveau mode paramétrique.

### 4.2 Mod avec logique propre — composer ou écrire un `GameMod`

Si ton mode change une **mécanique** (pas juste une valeur), écris un `GameMod`. Deux stratégies :

**Composer un mod existant** (recommandé si la nouveauté est localisée) — c'est ce que fait
**Hardcore** (`mods/hardcore/index.ts`) :

```ts
export function createHardcoreMod(config: ParametricModConfig): GameMod {
  const base = createParametricMod(config); // hérite mouvement/split/fusion/bords/decay tels quels

  return {
    ...base,                    // tout ce qui n'est pas réécrit ci-dessous vient du mod de base
    id: config.id,

    onCollision(world, a, b, dt) {
      // ... ne réécrit QUE l'absorption entre joueurs (gain de masse x massGainMultiplier) ...
      // délègue au mod de base pour tout le reste (nourriture, fusion des propres morceaux)
    },

    onPlayerInput(world, playerId, input) {
      base.onPlayerInput?.(world, playerId, input); // le mouvement de base s'applique TOUJOURS
      // ... ajoute la logique du Dash, absente de Vanilla ...
    },
  };
}
```

Règle à retenir : **ne réécris que ce qui diffère réellement**, délègue le reste via
`base.hook?.(...)`. Un hook non réécrit dans l'objet retourné (grâce à `...base`) reste exactement
celui du mod composé — c'est ainsi que le mouvement/decay/nourriture (`onTick`, vivant dans le mod
paramétrique de BASE) s'appliquent **aussi** à Hardcore sans qu'aucune ligne de Hardcore n'y touche.

**Écrire un `GameMod` isolé** (si rien à réutiliser, ex. un mode avec une IA d'entité non-joueur) :
implémente `GameMod` directement (voir `engine/mod.ts`), sans passer par
`mods/parametric/config.ts`. Un tel mod reste libre de définir son propre format de configuration
(ou aucun) — `modRegistry.ts` n'impose le schéma JSON qu'aux mods qui passent par
`createParametricMod`.

### 4.3 Où un mod s'enregistre

`engine/modRegistry.ts` :

```ts
const NON_PARAMETRIC_MOD_FACTORIES: Record<string, (config: ParametricModConfig) => GameMod> = {
  hardcore: createHardcoreMod,
};

export const resolveMod: ModResolver = (modId) => {
  const config = loadModConfig(modId);                              // server/configs/<modId>.json
  const factory = NON_PARAMETRIC_MOD_FACTORIES[modId] ?? createParametricMod;
  return { mod: factory(config), mapSize: ..., movement: ..., room: config.room, ... };
};
```

Un mod dont la logique est composée/écrite à la main (comme Hardcore) a **quand même** un fichier
`server/configs/<modId>.json` — il fournit la config paramétrique sous-jacente (mouvement, split,
carte…) que le mod compose. Pour ajouter un mod de ce type : (1) écris son `GameMod` dans
`mods/<tonMod>/index.ts`, (2) ajoute une entrée dans `NON_PARAMETRIC_MOD_FACTORIES`, (3) crée son
`server/configs/<modId>.json`.

**Important — `resolveMod` doit rester sans état.** Un `WorkerRoomHost` (§6) appelle `resolveMod`
séparément dans **chaque** worker_thread pour reconstruire le même `GameMod` (les fonctions ne
sont pas clonables via `postMessage`). Si ton mod garde un état, il doit vivre dans les closures
retournées par `create<Mod>Mod(config)` (comme `dashStates` dans Hardcore), jamais dans une
variable de module partagée entre plusieurs salons — deux salons du même mod dans le même worker
partageraient sinon cet état par erreur.

---

## 5. Référence complète du schéma JSON

Fichier : `server/configs/<modId>.json`, typé par `ParametricModConfig`
(`server/src/mods/parametric/config.ts`). **Aucune validation de schéma au chargement** —
`loadConfig.ts` fait un `JSON.parse` direct : un champ requis manquant produit une erreur
TypeScript à la compilation du serveur si tu passes par les types, mais une valeur `undefined`
silencieuse à l'exécution si tu éditais le JSON à la main sans relancer le serveur. Vérifie tes
fichiers en démarrant le serveur en local avant de déployer.

| Section | Champ | Type | Sens |
|---|---|---|---|
| `player` | `startMass` | number | Masse au spawn/respawn (M0) |
| | `maxSplits` | number | Nombre maximal de morceaux simultanés par joueur |
| | `minSplitMass` | number | Masse minimale requise pour avoir le droit de split |
| | `splitEnabled?` | boolean | `false` désactive entièrement le split pour ce mode (ex. Hardcore : Dash uniquement) — défaut activé |
| `physics` | `v0` | number | Vitesse nominale (px/s) à la masse M0 |
| | `speedMultiplier` | number | Multiplicateur de vitesse global du mode |
| | `speedMassExponent` | number | Exposant d'atténuation de la vitesse avec la masse |
| | `velocityFloor` | number | Vitesse plancher, jamais nulle même à masse énorme |
| | `accelerationBase` | number | Accélération/décélération (px/s²) à la masse M0 |
| | `accelerationMassExponent` | number | Exposant d'atténuation de la MISE EN MOUVEMENT (vitesse cible > vitesse actuelle) avec la masse |
| | `decelerationMassExponent?` | number | Exposant d'atténuation DÉDIÉ au FREINAGE (vitesse cible < vitesse actuelle, relâchement de l'input) — v5.8 : un exposant plus grand ici fait perdre plus de puissance de freinage à mesure que la masse grandit, donc un gros blob garde son élan plus longtemps sans pénaliser sa réactivité au pilotage (voir `decelerationForMass`, `shared/src/movement.ts`). Absent = repli sur `accelerationMassExponent` (comportement historique, un seul exposant partagé) |
| `split` | `ejectEfficiency` | number | Ratio masse gagnée par le morceau éjecté / masse perdue (1.0 = conservation stricte) |
| | `ejectSpeedFactor` | number | Facteur (× vitesse du morceau) de la vitesse d'éjection au split |
| `eject` | `amount` | number | Masse envoyée par éjection de masse (touche dédiée, pas le split) |
| `merge` | `baseTimeSec` | number | Durée minimale avant qu'un morceau puisse refusionner |
| | `massFactor` | number | Allonge le cooldown de fusion avec la masse (`0` = cooldown fixe) |
| | `overlapMinFraction` | number | Fraction minimale de surface à chevaucher pour fusionner |
| `eating` | `massAdvantage` | number | Avantage de masse requis pour manger un autre joueur (ex. `0.05` = 5%) |
| | `minMassToEatFood` | number | Masse minimale pour manger une particule de nourriture |
| | `foodEfficiency?` | number | Multiplicateur de masse gagnée par la nourriture |
| | `eatOverlapFraction?` | number | Fraction (0-1) de recouvrement au-delà de laquelle l'absorption se déclenche — défaut `0.7`. En-dessous, chevauchement libre, aucun effet (comme un vrai agar.io) |
| `absorptionDurationSec?` | number | Durée (s) de l'absorption une fois le seuil franchi — la cible rétrécit PROGRESSIVEMENT sur cette durée plutôt que de disparaître en un seul tick (pour que la victime comprenne ce qui lui arrive) — défaut `0.3`. Une fois déclenchée, l'issue est scellée : la cible ne peut plus s'en sortir même si elle se dégage du chevauchement entre-temps |
| `decay` | `tiers` | `{minMass, rate, intervalSec}[]` | Paliers de perte de masse passive (v5.8, cahier des charges §4d) — le palier retenu est celui de `minMass` le plus élevé restant <= la masse courante ; `rate` = fraction perdue par `intervalSec`. Propre à chaque mode : Vanilla reste peu punitif, Hardcore nettement plus (voir `server/configs/*.json`, `decayLambda` dans `physics.ts`) |
| | `graceSec` | number | Délai (s) depuis la dernière prise de masse en-dessous duquel aucune perte passive ne s'applique |
| | `floor` | number | Masse plancher que la perte passive ne peut jamais franchir |
| `arena` | `width`/`height` | number | Taille de la carte (px) |
| | `borderType` | `'STRICT_WALL'\|'ELASTIC_BOUNCE'\|'TOROIDAL'\|'TOXIC_ZONE'` | Comportement aux bords — **`TOXIC_ZONE` lève une exception à l'exécution, pas encore implémenté** |
| | `bounceRestitution?` | number | Fraction de vitesse restituée au rebond (`ELASTIC_BOUNCE` uniquement) |
| `food` | `density` | number | Pellets moyens par bloc de 1000×1000 px² (s'adapte à la taille de carte) |
| | `respawnRatePerSecond` | number | Pellets réapparaissant par seconde sur toute la carte |
| | `pelletTypes` | `{color, mass, weight}[]` | Types de pellets ; `weight` = poids de tirage relatif (pas nécessairement normalisé à 100) ; `color` est purement informatif, **jamais transmis au client** |
| `virus?` | `enabled` | boolean | Active les virus pour ce mode |
| | `type` | `1\|2\|3` | **Vert** (mange/explose en 16 morceaux au-dessus du seuil, se **duplique** en étant nourri de 200 de masse) / **Rouge** (carnivore : absorbe tout morceau de masse inférieure, explose en 32 pour les attaquants assez gros) / **Bleu** (comme Vert mais réaction en chaîne 4×4=16 sur 2 ticks) — voir §5bis-virus ci-dessous pour la mécanique de croissance/duplication et ses plafonds |
| | `densityPer5k?` | number | Population VISÉE par bloc de 5000×5000 px² (`targetVirusCount()`, mods/parametric/index.ts) — défaut selon `type` : 8 (Vert) / 4 (Rouge) / 2 (Bleu). ⚠️ **`densityPer10k?` existe aussi sur ce type mais n'est lu nulle part dans le code** (`targetVirusCount()` ne lit que `densityPer5k`) — un champ mort dans les 4 configs actuelles (`vanilla.json`, `hardcore.json`, `infini.json`, `mega-split.json` définissent toutes `densityPer10k`, silencieusement ignoré ; la densité réellement appliquée est donc TOUJOURS le défaut ci-dessus, jamais la valeur du JSON). Bug connu, non corrigé (choix d'équilibrage à trancher avant de le corriger, pas un simple renommage — changerait la densité affichée sur les 4 modes) |
| `areaConstant` | — | number | Constante masse→aire (Rayon = √(areaConstant·masse/π)) |
| `bots?` | `enabled` | boolean | Active les bots normaux ET les Challengers pour ce mode |
| | `behaviorId?` | string | Id d'un fichier `server/configs/bots/<id>.json` (voir plus bas) qui gouverne le PILOTAGE des bots (fuite/chasse/vagabondage/split) — distinct des réglages de POPULATION ci-dessous. Absent = `'default'` |
| | `targetRatio?` | number | Absent = ratio fluctuant automatique (10-20%) piloté par `BotManager` |
| | `ambientTargetCount?` | number | Bots NORMAUX maintenus en mode ambiance à 0 joueur humain (défaut 6) — dès qu'un humain est connecté, seuls les Challengers ci-dessous peuplent (les bots normaux tombent à 0) |
| | `maxTotal?` | number | Plafond dur du nombre de bots actifs simultanément, Challengers ET normaux confondus — absent = aucun plafond dédié (seule la capacité du salon borne) |
| | `updateFrequencyHz` | number | Cadence de décision de l'IA des bots |
| | `proportions` | `{fuis, neutre, agressif}` | Répartition des profils de bot normaux (poids relatifs 30/30/40 par défaut), utilisés uniquement à 0 joueur humain |
| | `challengers?` | `enabled` | boolean | `false` désactive les Challengers spécifiquement (indépendant du `enabled` ci-dessus) — défaut activé |
| | | `baselineCount` | number | Challengers maintenus EN PERMANENCE, même à 0 joueur humain |
| | | `maxWithHumans` | number | Population de Challengers dès qu'UN SEUL humain vient de se connecter (point de départ de la décroissance ci-dessous) |
| | | `minWithHumans` | number | Plancher vers lequel `maxWithHumans` décroît linéairement à mesure que le nombre d'humains augmente (atteint à `rampHumans` humains) |
| | | `rampHumans` | number | Nombre d'humains à partir duquel la décroissance linéaire atteint `minWithHumans` |
| | | `massMultipliers` | number[] | Multiplicateur de masse de spawn par rang (index 0 = rang 1, le plus fort) — un Challenger mangé réapparaît toujours au DERNIER palier actif (le plus faible), jamais à son rang d'origine, voir `BotManager.respawnChallengerAtWeakestTier` |
| | `idleDespawn?` | `enabled` | boolean | Despawn de TOUS les bots (normaux + Challengers) si 0 humain depuis `afterMinutes` — défaut désactivé |
| | | `afterMinutes` | number | Minutes consécutives sans humain avant despawn ; repeuplement automatique dès le retour d'un humain |
| `room?` | `maxPlayers?` | number | Capacité par défaut d'un salon de base de ce mode (voir `server/src/index.ts`) |
| | `resetSchedule?` | objet \| `null` | Cadence de reset auto — `{type:'dailyAt',hour,minute,timeZone}`, `{type:'everyNMinutes',minutes,timeZone}`, `{type:'interval',intervalMs}`, ou `null` (aucun reset auto) |

Valeurs intentionnellement **non** exposées en JSON (règles fixes du moteur, pas des réglages de
mode) : le multiplicateur minimal de masse pour éjecter (`EJECT_MIN_MASS_MULTIPLIER`, ×4, anti-
abus), le cooldown anti-spam d'éjection (`EJECT_COOLDOWN_SECONDS`), la vitesse/le frottement de la
particule éjectée (`EJECT_LAUNCH_SPEED_PX_PER_S`/`EJECT_FRICTION_PER_SEC`) — voir les constantes en
tête de `mods/parametric/index.ts` si un mod a réellement besoin d'y toucher (nécessite alors du
code, pas seulement du JSON).

### 5bis-virus. Mécanique des virus (croissance, duplication, plafonds anti-emballement)

Les trois types de virus (`config.virus.type`) suivent des mécaniques de croissance
**structurellement différentes**, chacune avec son propre garde-fou contre un emballement — les
deux garde-fous ci-dessous existent suite à un incident de production (Hardcore, 2026-08-04, voir
l'historique git de `mods/parametric/index.ts` autour du commit "lag exponentiel Hardcore").

- **Virus Rouge (type 2, carnivore)** — grandit en MASSE à chaque morceau plus petit absorbé ou
  particule reçue (`onCollision`), **sans aucun plafond** : il peut légitimement devenir immense
  (design voulu), la mécanique de dégonflement passif (30 masse/s au-dessus de 300, régurgitation
  en pellets de nourriture, voir `onTick`) le fait fondre progressivement. Le garde-fou n'est **pas**
  un plafond de masse mais un plafond de RAYON : son rayon suit exactement la même courbe
  géométrique qu'un morceau de joueur (`massToRadius`/`blobGrowthFactor`,
  [shared/src/geometry.ts](shared/src/geometry.ts)) — plate à haute masse (exposant 0.38 au-delà de
  10× la masse de spawn) — au lieu d'une formule dédiée. Avant ce correctif, le code réécrivait
  `virus.radius` avec `150 * sqrt(masse/300)` juste après chaque changement de masse, une courbe
  bien plus raide ; passé le seuil "grande entité" de la grille spatiale
  (`SpatialHash`/`World.findOverlappingPairs`), le coût de collision par tick d'UN SEUL virus croît
  en O(rayon²) — et comme un virus plus gros mange plus de monde, sa croissance s'auto-alimentait
  (plus gros → mange plus → encore plus gros → coût de tick qui explose). Mesuré en prod : p95 des
  ticks du salon Hardcore passé de 38ms à >210ms en moins de 20 minutes après un reset, CPU du
  process à 80% en continu. **Ne jamais réintroduire un calcul de rayon dédié au virus** — laisser
  `World.setMass()` s'en charger, exactement comme pour n'importe quelle autre entité.

- **Virus Vert/Bleu (types 1/3)** — ne grandissent JAMAIS en taille (rayon fixe depuis le spawn) ;
  nourris à 200 de masse cumulée (particules reçues), ils se **DUPLIQUENT** à la place (nouvel
  exemplaire de même masse/rayon, propulsé dans la direction de la dernière particule reçue). Le
  risque n'est donc pas un rayon qui explose mais un NOMBRE D'ENTITÉS qui explose : un duplicata
  hérite d'une vélocité de tir (600px/s) qui le fait traverser le champ de nourriture en mouvement,
  l'engraissant vite et le faisant potentiellement redupliquer à son tour, en chaîne — la
  maintenance de population ambiante (`targetVirusCount()`) ne fait qu'AJOUTER jusqu'à sa cible,
  jamais retirer un surplus causé par la duplication. Plafonné à `targetVirusCount() * 3`
  (`VIRUS_DUPLICATION_HEADROOM`, `mods/parametric/index.ts`) : au-delà, nourrir un virus reste
  gratifiant (le compteur `fedMass` se consomme normalement) mais n'engendre plus de nouvel
  exemplaire.

Voir `server/src/mods/parametric/virus.test.ts` pour les tests de régression correspondants
(masse illimitée + rayon aligné sur `massToRadius` pour le Rouge ; plafond de population pour
Vert/Bleu).

### 5ter. Comportement des robots (`server/configs/bots/*.json`)

Même principe que `server/configs/*.json` pour les modes, mais pour le PILOTAGE des bots
(`server/src/engine/bots/botEvaluator.ts`) plutôt que leur population : un fichier JSON par profil
de comportement, sélectionné par `BotConfig.behaviorId` (ci-dessus, ex: `default_vanilla`, `default_hardcore`, `default_infini`, `default_mega_split`) — ajouter/ajuster un profil ne
demande qu'un nouveau fichier, aucun code. `server/configs/bots/default.json` est le profil de repli
(comportement par défaut, voir `DEFAULT_BOT_BEHAVIOR_CONFIG` dans `behaviorConfig.ts`).

| Clé | Type | Rôle |
|---|---|---|
| `neighborQueryRadiusPx` | number | Rayon (px) de la requête broad-phase des entités environnantes |
| `predatorMassRatio` / `preyMassRatio` | number | Ratios de masse au-delà/en-deçà desquels une entité voisine est traitée comme prédateur/proie |
| `targetProjectionDistancePx` | number | Distance (px) projetée devant le bot pour construire sa cible monde |
| `directionSmoothing` | number | Lissage de direction (EMA, 0-1) entre deux évaluations consécutives |
| `fuis` / `neutre` / `agressif` | objet | Réglages propres à chaque profil (rayons de détection, intensités, cooldowns/seuils de split — voir `behaviorConfig.ts` pour le détail champ par champ) |
| `wallAvoidance.marginPx` | number | Distance (px) au bord à partir de laquelle un bot commence activement à s'en écarter |

Un fichier JSON ne redéfinissant qu'un sous-ensemble de ces champs est fusionné PAR SECTION avec le
défaut (`loadBehaviorConfig.ts`) — jamais un remplacement total, pour ne pas perdre silencieusement
le reste des réglages d'un profil en n'en changeant qu'un seul champ.

### 5quater. Personnalisation d'un salon privé (lobby)

Un salon créé depuis le lobby (`CreateRoomPanel.tsx`, réservé aux comptes Premium) peut redéfinir,
en plus des réglages déjà existants (capacité, durée, bots on/off) :

| Champ | Bornes | Rôle |
|---|---|---|
| `mapSize` | 1000 - 50000 | Taille de carte (carrée, px) — remplace `arena.width/height` du mode pour CE salon uniquement |
| `botCount` | `{min, max}`, chacun 0-50 | Population de bots — `min === max` pour une population FIXE, `min < max` reproduit la même pyramide Challenger que le comportement par défaut (décroissance de `max` à `min` bots à mesure que des humains rejoignent), seulement bornée différemment |

Validés côté serveur (`net/http/routes/lobby.ts`), transmis via `RoomSpec.mapSize`/`botCount`
(`engine/worker/protocol.ts`) et appliqués par `RoomInstance` (`engine/worker/roomInstance.ts`,
`applyRoomBotCountOverride`).

---

## 6. Scalabilité serveur (worker_threads)

`RoomManager` ne connaît jamais `Room` directement — il passe par l'interface `RoomHost`
(`engine/worker/roomHost.ts`), avec deux implémentations :

- **`LocalRoomHost`** — tous les salons dans le thread principal (mono-thread Node). Utilisé
  quand `ROOM_WORKERS=0`, et par la majorité des tests (accès synchrone à `Room`/`World`).
- **`WorkerRoomHost`** (défaut en production) — répartit les salons sur `ROOM_WORKERS`
  `worker_threads` séparés, un salon étant épinglé à vie au worker le moins chargé au moment de
  sa création (pas de rééquilibrage à chaud). Un salon synchrone lent (bug ou boucle coûteuse
  dans un mod) ne peut donc retarder que les **autres salons de son propre worker**, jamais ceux
  des autres workers — c'est la seule garantie d'isolation CPU du projet (voir
  `engine/roomIsolation.test.ts`, qui mesure cette absence d'isolation *à l'intérieur* d'un même
  thread, exactement le cas que `WorkerRoomHost` distribue).

Conséquence pour un mod : `resolveMod(modId)` est appelée séparément dans le thread principal
(pour connaître `mapSize`/`movement`/`room` de façon synchrone, message `welcome`) **et** dans
chaque worker (pour la simulation réelle) — voir l'avertissement de statelessness en §4.3. Le
reste (réseau, comptes, admin) tourne toujours dans le thread principal ; seule la simulation
(`Room.tick()`) est déportée.

---

## 7. Architecture réseau

Protocole défini dans `shared/src/protocol.ts`, JSON texte sur WebSocket (pas de binaire).

**Client → serveur** (`ClientMessage`) : `join` (pseudo), `input` (target monde + intensité +
split/dash/eject), `ping` (mesure de latence), `latency` (RTT mesuré, pour l'admin).

**Serveur → client** (`ServerMessage`) : `welcome` (une fois par connexion — id joueur, taille de
carte, `tickRateHz`, `movement`, `modId`, `nextResetAtMs` pour le décompte HUD "Reset serveur",
`buildVersion` pour le rechargement forcé, voir plus bas), `player` (pseudo/couleur d'un joueur,
une fois par joueur), `state` (à chaque tick — `EntitySnapshot[]` + leaderboard + valeurs privées
au destinataire), `died`, `pong`, `announcement`, `forceRoomChange`.

**Rechargement forcé du client après un déploiement** (`buildVersion`) : figé une fois au démarrage
du process serveur (`server/src/index.ts`, `Date.now()` au boot — un déploiement redémarre
toujours ce process). Le client (GameView.tsx/SpectatorBackground.tsx) mémorise la valeur de son
tout premier `welcome`, puis compare à chaque `welcome` ULTÉRIEUR (reconnexion auto après coupure,
respawn) : une valeur différente signifie que la reconnexion a atterri sur un nouveau déploiement,
et déclenche `window.location.reload()`. S'appuie sur la reconnexion automatique déjà existante
(`GameConnection`, net.ts) plutôt qu'un mécanisme de polling séparé — un déploiement coupe de toute
façon toutes les connexions WebSocket actives (process qui redémarre), donc chaque client
reconnecte naturellement et détecte le changement à ce moment-là.

`EntitySnapshot` utilise des clés à une lettre (`i,k,x,y,r,m,p`) — mesuré : la diffusion d'état
complet à 50 joueurs avec des clés explicites coûtait ~387 Mbit/s d'upload serveur.

**Filtrage par intérêt + delta nourriture** (v5.7, `cahier_des_charges_perf_reseau_grande_carte.md`) :
un joueur en partie ne reçoit plus le salon entier — `roomInstance.ts` calcule PAR JOUEUR un rayon
d'intérêt dérivé de sa masse (`interestRadiusForMass`, `shared/src/camera.ts`, IDENTIQUE à la
formule de zoom réelle du client, `computeCamera`/`render.ts`, pour ne jamais désynchroniser "ce
qui est visible" et "ce qui est envoyé"). Les morceaux (joueurs/bots) dans ce rayon sont envoyés en
entier à chaque tick ; la nourriture (immobile après spawn) est envoyée en **delta** — seuls les ids
nouvellement entrés dans l'intérêt sont retransmis, avec une resynchronisation complète périodique
(toutes les 5s, étalée par joueur) en filet de sécurité (`WorldStateMessage.entitiesFull`,
`interestFilter.ts`). Les propres morceaux du joueur restent toujours inclus, même hors rayon. Le
spectateur/la vue admin (POV salon, modération) continuent de recevoir le salon entier, jamais
filtrés. La grille de collision (`World.spatialHash`, cellSize=50) n'est PAS réutilisée telle
quelle pour ces requêtes à grand rayon (coût prohibitif) : un index grossier dédié à la nourriture
(cellSize=1000) est reconstruit une fois par tick dans `interestFilter.ts`.

**Correctif "pastille mangée qui réapparaît"** (v5.8) : `RenderEngine.knownFood` (client) est un
cache PERSISTANT de la nourriture en delta (voir ci-dessus) — une pastille mangée n'y était jamais
explicitement retirée, seule masquée pour LA FRAME COURANTE par l'astuce de disparition instantanée
(`render.ts`, chevauchement avec une créature) : dès que le blob s'en éloignait, elle réapparaissait
jusqu'à la prochaine resynchronisation périodique (jusqu'à ~5s). `renderFrame` retourne désormais les
ids détectés "mangés" ce cadre (`RenderFrameResult.eatenFoodIds`), purgés définitivement de
`knownFood` via `RenderEngine.forgetFood` (`GameView.tsx`).

**Fluidité du fond spectateur** (v5.8) : `SPECTATOR_TICK_DIVISOR` (`snapshotBuilder.ts`) abaissé de
4 à 2 (10Hz réels à `TICK_RATE_HZ=20`, contre 7.5Hz avant même la baisse de tick rate) — demande
utilisateur, rendu du lobby jugé pas assez fluide. Sans coût réseau significatif : la nourriture,
seule composante volumineuse, reste sous-échantillonnée indépendamment de cette cadence
(`SPECTATOR_FOOD_SAMPLE_EVERY`).

Exception client-only, orthogonale à ce qui précède : le fond spectateur de l'accueil
(`SpectatorBackground.tsx`, caméra dézoomée sur toute la carte — rien à culler géométriquement)
sous-échantillonne la nourriture à ~10 % dans `renderEngine.ts` (`subsampleForSpectator`), jamais
les créatures (joueurs/bots, toujours affichées intégralement) — un simple décor d'arrière-plan n'a
pas besoin de chaque pastille individuelle. Le sous-échantillon est indexé par le hash **FNV-1a** de
l'id d'entité (PAS un hash polynomial simple `hash*31+char` : mesuré, ce dernier reste
quasi-monotone sur les id entiers séquentiels courts que génère le serveur
(`String(nextEntityId++)`, voir `World.spawnEntity`), donc pas du tout dispersé par rapport au
seuil de coupure — soit ~0 %, soit ~100 % de rétention selon la plage d'id, jamais réellement 10 %).

### Pipeline de simulation → réseau → rendu

```
Room.tick() (dt fixe)
  → roomInstance.ts : filtrage par intérêt + delta nourriture PAR JOUEUR (interestFilter.ts) ;
    salon entier inchangé pour spectateur/vue admin
  → snapshotBuilder.ts construit EntitySnapshot[] (par destinataire)
  → broadcast.ts diffuse `state` à chaque viewer du salon (20/s par défaut)
  → net.ts (client) : GameConnection, reconnexion auto sur coupure transitoire (backoff court)
  → renderEngine.ts : file de snapshots ancrée sur le NUMÉRO DE TICK (pas l'heure d'arrivée
    réseau) — une rafale après un micro-décrochage réseau ne casse pas le rythme de lecture ;
    accumule aussi la nourriture reçue en delta (`entitiesFull`, absence ≠ disparition)
  → interpolation entre 2 snapshots + lissage exponentiel compensé en dt → render.ts (Canvas2D)
```

### Le blob du joueur local : prédiction + réconciliation (pas de l'interpolation)

Tout le reste (robots, autres joueurs) est de la **pure interpolation réseau** — jamais simulé
côté client. Le blob du joueur, lui, doit réagir à la souris **sans attendre l'aller-retour
réseau** : `client/src/prediction.ts` rejoue localement, à chaque frame, exactement la même
formule de mouvement que le serveur (`shared/src/movement.ts`), à un pas de temps **fixe**
indépendant du framerate réel (`FIXED_STEP_SECONDS = 1/240`, accumulateur classique
"fix your timestep").

À chaque `state` reçu, `reconcile()` ancre la position prédite sur la position autoritaire puis
**rejoue** l'historique d'inputs local depuis l'instant estimé de cette capture serveur, plutôt que
de corriger la position par un blend/snap naïf — un blend proportionnel à l'écart tirerait
visiblement le blob en arrière à chaque paquet reçu dès que la latence devient significative. Cet
instant (`sinceMs`) est dérivé de `renderEngine.serverTimeMsForTick(tick)` (voir
`client/src/reconcileLatency.ts` `estimatedLatencyMsFromAnchor`, v10.2) — la même horloge ancrée sur
le numéro de tick que celle du pipeline ci-dessus (résolution ~20Hz, insensible à la gigue par
paquet), **pas** un simple ping RTT/2 lissé à 1Hz (`smoothedLatencyMs` ne sert plus que de repli
avant le tout premier `state` de la session) : une estimation imprécise ici décale le point de départ
du rejeu d'une fraction de tick, ce qui peut faire basculer un bloc entier de rejeu dedans/dehors
(`chunkHistoryForReplay` regroupe par tick) — la cause dominante d'un ancien symptôme "mini rollback"
visible même en ligne droite, à vitesse de croisière. Le résidu de rejeu **en-dessous** d'un seuil
dynamique (`accélération_effective × dt_tick² / 2`, voir `RECONCILE_IGNORE_*`) est traité comme du
bruit de discrétisation et ignoré ; au-dessus (répulsion, croissance...) il est absorbé dans un
`visualOffset` séparé, résorbé à vitesse plafonnée (jamais dans la position simulée, qui doit rester
exacte pour la physique). Toute nouvelle formule de mouvement doit rester **identique** entre
`shared/src/movement.ts` (utilisé par les deux côtés) sous peine de réintroduire des corrections
perpétuelles visibles à chaque tick réseau.

`chunkHistoryForReplay` regroupe TOUJOURS en un seul bloc par tick (cible = dernier échantillon),
**même pendant un virage** (v10.2) — une variante testait un rejeu fin échantillon-par-échantillon
pendant un virage détecté (v10.1), mais cette détection comparait des `target` en coordonnées MONDE
ABSOLUES qui dérivent avec la caméra (laquelle suit le blob, `input.ts` `getTarget`), donc se
déclenchait quasi en permanence dès que le blob bougeait — et surtout, ce rejeu fin comparait alors
`predicted.position` à une trajectoire que le serveur (qui n'applique jamais qu'UNE cible par tick)
n'a physiquement jamais calculée, réintroduisant le biais que le regroupement par tick est censé
éliminer. Le petit saut géométrique d'un virage mergé en un seul pas reste dans la bande lissée par
`visualOffset` — c'est ce lissage qui absorbe ce cas, pas une raison de sacrifier le matching serveur.

Si tu ajoutes une mécanique qui déplace un morceau du joueur en dehors de `step()`/`integrate()`
(un nouveau type d'impulsion, par ex.), regarde comment `applyDash` journalise son impulsion dans
`pendingDashes` pour que `reconcile()` puisse la rejouer — sans ça, un `state` reçu APRÈS
l'impulsion mais reflétant un état serveur ANTÉRIEUR à sa réception (le serveur ne l'a pas encore
traitée) écrase la vélocité boostée sans la restituer, un rollback visible dès le début de
l'impulsion. La réapplication doit avoir lieu dans TOUS les cas (que la vélocité autoritaire du
`state` soit connue ou non), filtrée par timestamp (`pendingDash.atMs >= sinceMs`) pour ne jamais
compter deux fois une impulsion déjà intégrée par le serveur.

Le dash lui-même est envoyé au réseau **immédiatement** au moment de la pression (dans le
gestionnaire d'input de `GameView.tsx`), pas au prochain tick programmé de `scheduleInput` (jusqu'à
un tick serveur complet de délai en plus) : le serveur traite `handleInput` dès réception, donc
tout délai d'envoi côté client se traduit directement en délai de traitement côté serveur — et
donc en fenêtre d'incertitude supplémentaire pour la réconciliation ci-dessus. `input.consumeDash()`
est appelé dans ce même envoi immédiat pour que le tick programmé suivant ne le retransmette pas.

---

## 8. Mutualisation client (rendu/caméra/prédiction)

**Il n'existe qu'un seul pipeline de rendu, de caméra et de prédiction — jamais un par mod ni un
par salon.** `GameView.tsx` est le seul composant qui monte un `<canvas>` de jeu ; il instancie
une unique `RenderEngine` et une unique `LocalPrediction` par session de jeu, quel que soit
`modId`. `render.ts` (caméra, dessin), `renderEngine.ts` (interpolation réseau) et
`prediction.ts` (prédiction/réconciliation) ne contiennent **aucune branche `if (modId === ...)`**
— tout ce qui varie d'un mode à l'autre est de la **donnée**, jamais du code :

- la formule de mouvement (`MovementConfig`, transmise une fois dans `welcome.movement`) ;
- le multiplicateur de zoom caméra (dérivé uniquement de la masse totale du joueur,
  `computeCamera`, identique pour tous les modes) ;
- les deux branches `currentModId === 'hardcore'` de `GameView.tsx` (déclenchement du punch de
  zoom caméra au Dash, et l'envoi ou non de l'input `dash` au serveur) modulent une **valeur**
  (`dashZoomBonus`, un multiplicateur qui reste à 0 pour tout autre mode) à l'intérieur du même
  calcul de caméra/rendu unique — elles ne bifurquent jamais vers un pipeline de rendu ou de
  caméra différent.

Si tu ajoutes un mod avec un rendu visuel réellement différent (un effet propre à ton mode), la
bonne approche est d'étendre `render.ts`/`renderEngine.ts` avec un paramètre de données (comme
`movement`/`modId` existants), jamais de dupliquer `GameView.tsx` ou le pipeline de rendu pour un
mode particulier — ça casserait la garantie "un seul pipeline pour tous les salons" et
dupliquerait tous les correctifs de fluidité déjà en place (interpolation, anti-tremblement,
gigue réseau) pour ce nouveau chemin de code.

Le serveur suit la même discipline : `Room.tick()` (§3) est unique et ignore tout ce qu'un mod
fait en interne. Un mod ne devrait jamais avoir besoin de modifier `engine/`.

**Formules de croissance/zoom/freinage/dash révisées** (v5.8) : `blobGrowthFactor`
(`shared/src/geometry.ts`) remplace l'ancienne courbe auto-similaire (rayon ∝ √masse à tout niveau
d'échelle) par deux régimes continus en valeur — croissance rapide (exposant 0.62) jusqu'à 10× la
masse de spawn, puis plate (exposant 0.38) au-delà, sans jamais plafonner. `computeScaleForMass`
(`camera.ts`) est désormais l'inverse EXACT de cette même courbe (au lieu d'une racine carrée
indépendante qui n'y coïncidait que par coïncidence), plus un rezoom global ×1.5 (`BASE_SCALE`) —
la taille apparente à l'écran du blob reste ainsi cohérente quel que soit le régime de croissance
actif. Côté mouvement, `accelerationForMass`/`decelerationForMass` (`shared/src/movement.ts`) sont
désormais deux taux distincts (un seul exposant partagé auparavant) : un gros blob reste aussi
réactif qu'avant pour accélérer, mais conserve nettement plus son élan en relâchant l'input — configs
via `physics.decelerationMassExponent` (repli sur `accelerationMassExponent` si absent). Le Dash
Hardcore (`dashSpeedForMass`) perd en puissance avec la masse (plancher 40% de `DASH_BASE_SPEED`),
même formule partagée serveur (`mods/hardcore/index.ts`) et prédiction locale (`prediction.ts`).

---

## 9. Tests

```bash
npm test                 # tous les workspaces (vitest)
```

Chaque module de mod a ses propres tests (`mods/parametric/*.test.ts`, `mods/hardcore/*.test.ts`)
qui exercent `GameMod` directement (pas de serveur HTTP/WS réel). `roomManager.test.ts`/
`server.test.ts` couvrent le cycle de vie des salons et le réseau. `roomIsolation.test.ts` mesure
(ne suppose pas) l'isolation CPU inter-salons — voir §6. Les tests de comptes/admin nécessitant
PostgreSQL sont ignorés si `DATABASE_URL` n'est pas définie en CI.

---

## 10. Licence

GNU Affero General Public License v3.0 ou ultérieure (AGPL-3.0-or-later) — voir
[LICENSE](LICENSE). Toute réutilisation, y compris commerciale, est autorisée à condition de
rester open source sous la même licence et de citer l'origine de ce projet.

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
- Client/admin : React + Vite, rendu de jeu en Canvas2D (pas de WebGL, pas de moteur tiers).

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
| `TICK_RATE_HZ` | `30` | Cadence de simulation, identique pour **tous** les salons du process |
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
| `transformScoreForAccount(rawScore, rawXp)` | à la mort/déconnexion, avant écriture en base | ex. Hardcore renvoie `{0, 0}` : aucune progression persistée |

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

    transformScoreForAccount() {
      return { score: 0, xp: 0 }; // "mort = perte totale de la progression de la partie"
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
| | `accelerationBase` | number | Accélération (px/s²) à la masse M0 |
| | `accelerationMassExponent` | number | Exposant d'atténuation de l'accélération avec la masse |
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
| `decay` | `threshold` | number | Masse en-dessous de laquelle le taux de perte passive change |
| | `rateAboveThreshold`/`rateBelowThreshold` | number | Taux de perte (fraction) par intervalle, au-dessus/en-dessous du seuil |
| | `intervalAboveThresholdSec`/`intervalBelowThresholdSec` | number | Période (s) de chaque taux |
| | `floor` | number | Masse plancher que la perte passive ne peut jamais franchir |
| `arena` | `width`/`height` | number | Taille de la carte (px) |
| | `borderType` | `'STRICT_WALL'\|'ELASTIC_BOUNCE'\|'TOROIDAL'\|'TOXIC_ZONE'` | Comportement aux bords — **`TOXIC_ZONE` lève une exception à l'exécution, pas encore implémenté** |
| | `bounceRestitution?` | number | Fraction de vitesse restituée au rebond (`ELASTIC_BOUNCE` uniquement) |
| `food` | `density` | number | Pellets moyens par bloc de 1000×1000 px² (s'adapte à la taille de carte) |
| | `respawnRatePerSecond` | number | Pellets réapparaissant par seconde sur toute la carte |
| | `pelletTypes` | `{color, mass, weight}[]` | Types de pellets ; `weight` = poids de tirage relatif (pas nécessairement normalisé à 100) ; `color` est purement informatif, **jamais transmis au client** |
| `areaConstant` | — | number | Constante masse→aire (Rayon = √(areaConstant·masse/π)) |
| `bots?` | `enabled` | boolean | Active les bots normaux ET les Challengers pour ce mode |
| | `targetRatio?` | number | Absent = ratio fluctuant automatique (10-20%) piloté par `BotManager` |
| | `ambientTargetCount?` | number | Bots NORMAUX maintenus en mode ambiance à 0 joueur humain (défaut 6) — dès qu'un humain est connecté, seuls les Challengers ci-dessous peuplent (les bots normaux tombent à 0) |
| | `maxTotal?` | number | Plafond dur du nombre de bots actifs simultanément, Challengers ET normaux confondus — absent = aucun plafond dédié (seule la capacité du salon borne) |
| | `updateFrequencyHz` | number | Cadence de décision de l'IA des bots |
| | `proportions` | `{fuis, neutre, agressif, fou}` | Répartition des profils de bot normaux (poids relatifs), utilisés uniquement à 0 joueur humain |
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
complet à 50 joueurs avec des clés explicites coûtait ~387 Mbit/s d'upload serveur. Pas de delta
compression ni d'interest management serveur par défaut au-delà du culling viewport côté client
(le joueur en partie reçoit toujours le salon entier). Exception client-only : le fond spectateur
de l'accueil (`SpectatorBackground.tsx`, caméra dézoomée sur toute la carte — rien à culler
géométriquement) sous-échantillonne la nourriture à ~10 % dans `renderEngine.ts`
(`subsampleForSpectator`), jamais les créatures (joueurs/bots, toujours affichées intégralement) —
un simple décor d'arrière-plan n'a pas besoin de chaque pastille individuelle. Le sous-échantillon
est indexé par le hash **FNV-1a** de l'id d'entité (PAS un hash polynomial simple `hash*31+char` :
mesuré, ce dernier reste quasi-monotone sur les id entiers séquentiels courts que génère le serveur
(`String(nextEntityId++)`, voir `World.spawnEntity`), donc pas du tout dispersé par rapport au
seuil de coupure — soit ~0 %, soit ~100 % de rétention selon la plage d'id, jamais réellement 10 %).

### Pipeline de simulation → réseau → rendu

```
Room.tick() (dt fixe)
  → snapshotBuilder.ts construit EntitySnapshot[]
  → broadcast.ts diffuse `state` à chaque viewer du salon (30/s par défaut)
  → net.ts (client) : GameConnection, reconnexion auto sur coupure transitoire (backoff court)
  → renderEngine.ts : file de snapshots ancrée sur le NUMÉRO DE TICK (pas l'heure d'arrivée
    réseau) — une rafale après un micro-décrochage réseau ne casse pas le rythme de lecture
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
**rejoue** l'historique d'inputs local depuis l'instant estimé de cette capture serveur (RTT/2),
plutôt que de corriger la position par un blend/snap naïf — un blend proportionnel à l'écart
tirerait visiblement le blob en arrière à chaque paquet reçu dès que la latence devient
significative. Le résidu de rejeu **en-dessous** d'un seuil dynamique (`accélération_effective ×
dt_tick² / 2`, voir `RECONCILE_IGNORE_*`) est traité comme du bruit de discrétisation et ignoré ;
au-dessus (répulsion, croissance...) il est absorbé dans un `visualOffset` séparé, résorbé à
vitesse plafonnée (jamais dans la position simulée, qui doit rester exacte pour la physique).
Toute nouvelle formule de mouvement doit rester **identique** entre `shared/src/movement.ts`
(utilisé par les deux côtés) sous peine de réintroduire des corrections perpétuelles visibles à
chaque tick réseau.

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

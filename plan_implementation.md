# Plan d'implémentation — Angul.io

**Document vivant.** Ce plan découpe le développement en **Lots** (grandes étapes livrables)
et **Sous-Lots** (tâches concrètes). Il doit être tenu à jour à chaque avancée pour que
n'importe qui (y compris toi dans six mois) puisse savoir en un coup d'œil ce qui est fait,
en cours, ou pas commencé — sans avoir à relire tout l'historique du projet.

Référence : voir [cahier_des_charges.md](cahier_des_charges.md) pour le détail fonctionnel
et les justifications d'architecture, et [metriques.md](metriques.md) pour les formules
mathématiques exactes (masse, vitesse, split, fusion, decay…) mod par mod. Les sections
`§X` citées ci-dessous renvoient à ces documents.

---

## Comment utiliser ce document

- **Statut de chaque sous-lot** : ⬜ À faire · 🔶 En cours · ✅ Fait · ⏸️ Différé/bloqué
- Avant de commencer un sous-lot, passe son statut à 🔶 et note la date de début.
- Une fois un sous-lot terminé, passe-le à ✅, ajoute la date, et ajoute une ligne au
  **Journal des décisions et avancées** (§ tout en bas) si un choix technique a été fait
  en cours de route (formule d'équilibrage tranchée, librairie choisie, etc.) — c'est ce
  journal qui évite de perdre le fil des raisons derrière chaque décision.
- Un sous-lot ne doit être marqué ✅ que si ses **critères d'acceptation** sont remplis.
- Si l'ordre des Lots doit changer (ex. besoin de commencer les salons avant la fin du
  socle technique), mets à jour la section **Dépendances** correspondante plutôt que de
  déplacer silencieusement les sections.
- Ne supprime jamais un sous-lot terminé : l'historique de ce qui a été fait a de la valeur.
  Si un sous-lot devient obsolète avant d'être fait, marque-le ⏸️ avec la raison plutôt que
  de l'effacer.

---

## Vue d'ensemble — statut global des Lots

| Lot | Nom | Phase | Statut global |
|---|---|---|---|
| [0](#lot-0--cadrage--fondations-du-projet) | Cadrage & fondations du projet | Transverse | ✅ Fait |
| [1](#lot-1--socle-technique-moteur-de-jeu) | Socle technique moteur de jeu | MVP | ✅ Fait — ⚠️ voir 1.8 (bande passante) |
| [2](#lot-2--salons-rooms) | Salons (rooms) | MVP | ✅ Fait — ⚠️ voir 2.5 (isolation CPU non garantie, mono-thread) |
| [3](#lot-3--comptes-joueurs--persistance) | Comptes joueurs & persistance | MVP | ✅ Fait |
| [4](#lot-4--deuxième-mode-de-jeu-validation-de-lapi-de-modding) | Deuxième mode de jeu (validation API) | MVP | ✅ Fait |
| [5](#lot-5--interface-dadministration) | Interface d'administration | MVP | ✅ Fait — ⚠️ 5.5 différé (Phase 2) |
| [6](#lot-6--statut-premium--dons) | Statut Premium & dons | MVP | ✅ Fait — ⚠️ voir 6.1 (compte Ko-fi réel pas encore créé), 6.5 différé |
| [7](#lot-7--client-mobile-pwa) | Client mobile (PWA) | MVP | 🔶 En cours — 7.1/7.2 faits, 7.3 (validation sur un vrai appareil Android) reste à faire |
| [8](#lot-8--infrastructure--déploiement) | Infrastructure & déploiement | MVP | 🔶 En cours — install.sh écrit (8.3/8.4/8.5/8.6), pas encore exécuté sur le Wyse réel |
| [9](#lot-9--documentation--ouverture-communautaire-de-lapi-de-modding) | Documentation & ouverture communautaire | Phase 2 | ⬜ À faire |
| [10](#lot-10--scaling-multi-wyse) | Scaling multi-Wyse | Phase 2 | ⬜ À faire |
| [11](#lot-11--optimisation-bas-niveau-cpugpu-spéculatif) | Optimisation bas niveau CPU/GPU | Phase 3 (spéculatif) | ⏸️ Non commencé — options listées, aucun besoin mesuré à ce jour |

**Ordre conseillé pour le MVP : Lot 0 → 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8**, avec le Lot 5
(admin) qui peut avancer en parallèle du Lot 3 dès que le modèle de compte existe, puisqu'il
en dépend directement. Les Lots 9 et 10 ne démarrent qu'une fois le MVP jouable et stable.

---

## Lot 0 — Cadrage & fondations du projet

Objectif : poser les décisions et l'outillage qui conditionnent tout le reste, avant d'écrire
la première ligne de moteur de jeu.

### 0.1 — Rédaction du cahier des charges
- **Statut :** ✅ Fait (2026-07-26)
- **Livrable :** [cahier_des_charges.md](cahier_des_charges.md)
- **Critère d'acceptation :** document couvrant vision, périmètre, architecture, comptes,
  licence, infra, backlog de décisions — validé comme base de référence du projet.

### 0.2 — Décisions bloquantes restantes avant code (§8.1)
- **Statut :** ✅ Fait (2026-07-26)
  - ✅ Formule de décroissance de la vélocité selon la masse — **tranchée par défaut**,
    voir [metriques.md §3](metriques.md#3-vitesse-en-fonction-de-la-masse)
    (`v(m) = V_REF * √(M_START/m)`, ajustable en playtest sans changement d'architecture).
  - ✅ Moteur de rendu client : **Canvas 2D natif** — tranché lors du Lot 1.7, validé en
    conditions réelles dans un navigateur.
- **Contenu :** trancher, ou décider de trancher par playtest en cours de Lot 1 :
  - Formule de décroissance de la vélocité selon la masse.
  - Moteur de rendu client : Canvas 2D natif vs. PixiJS.
- **Dépendances :** aucune, mais bloque le début du Lot 1.7 (rendu client) si non tranché.
- **Critère d'acceptation :** les deux points ont une réponse (même provisoire, ajustable)
  actée dans le Journal des décisions.

### 0.3 — Initialisation du dépôt et structure du monorepo
- **Statut :** ✅ Fait (2026-07-26) — dépôt Git local initialisé, `.gitignore` en place,
  remote GitHub configuré en SSH, push effectué sur
  [github.com/FantasmaGlad/Angul.io](https://github.com/FantasmaGlad/Angul.io) (branche `main`),
  structure `shared/`, `server/`, `client/`, `admin/` créée avec un placeholder buildable et
  testé dans chacun, README initial en place.
- **Contenu :** `git init`, structure de dossiers (`server/`, `client/`, `admin/`, `shared/`),
  `.gitignore`, README initial avec description courte + lien vers le cahier des charges.
- **Critère d'acceptation :** dépôt Git initialisé, structure de dossiers en place, premier
  commit poussé sur GitHub (dépôt créé en public ou privé selon préférence à ce stade).

### 0.4 — Outillage de développement
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** npm workspaces (pnpm non installé sur la machine de dev, npm suffit à
  cette échelle), TypeScript 5.7 en mode composite (`tsconfig.base.json` + un
  `tsconfig.json` par package avec `references`), ESLint 9 (flat config) +
  `typescript-eslint` + `eslint-config-prettier`, Prettier, Vitest.
- **Critère d'acceptation :** `npm install` + `npm run lint` + `npm test` +
  `npm run build` + `npm run format:check` fonctionnent tous sans erreur à la racine —
  **validé**.

### 0.5 — Licence du projet
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** texte officiel AGPL-3.0 récupéré depuis gnu.org, ajouté en `LICENSE` à la
  racine ; mention de la licence et de l'origine du projet dans le README.
- **Dépendances :** 0.3.
- **Critère d'acceptation :** fichier LICENSE présent à la racine, mention cohérente dans
  le README — **validé**.

### 0.6 — Intégration continue basique (optionnel mais recommandé)
- **Statut :** ✅ Fait (2026-07-26), **étendu le 2026-07-27**
- **Contenu :** GitHub Actions (`.github/workflows/ci.yml`) lançant format:check, lint,
  tests et build à chaque push/PR sur `main`. **Extension (2026-07-27, referme un gap noté
  depuis la clôture du Lot 3)** : le job démarre désormais un vrai service PostgreSQL
  (`postgres:18`, identifiants et `DATABASE_URL` en variable d'environnement du job — pas de
  fichier `server/.env`, vérifié manuellement que `node-pg-migrate`/vitest lisent tous deux
  directement `process.env.DATABASE_URL` sans en avoir besoin), joue les migrations
  (`npm run migrate:up --workspace=server`) avant `npm test` — les tests
  `describe.skipIf(!DATABASE_URL)` (accountsRepository, service, net/server "avec comptes
  joueurs", plusieurs dizaines de tests au total) s'exécutent donc réellement en CI au lieu
  d'être silencieusement ignorés.
- **Dépendances :** 0.3, 0.4.
- **Critère d'acceptation :** un push avec une erreur de lint ou un test cassé fait échouer
  la CI visiblement sur GitHub. **Le service Postgres ajouté n'a pas encore tourné en
  conditions réelles sur GitHub** (repose sur le pattern standard "services: postgres" de
  GitHub Actions + une vérification manuelle locale du flux `DATABASE_URL` sans fichier
  `.env`, Docker non disponible dans cet environnement pour une simulation complète) — à
  confirmer visuellement au prochain push.

---

## Lot 1 — Socle technique moteur de jeu

Objectif : avoir un salon unique jouable de bout en bout (client ↔ serveur), avec le mode
Vanilla codé comme un mod — validation de l'architecture de modding décrite en §3.2.

### 1.1 — Modèle de données du monde (types partagés)
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `shared/src/vector.ts` (Vector2 + maths), `shared/src/geometry.ts`
  (masse↔rayon, aire d'intersection de cercles — implémente metriques.md §2/§10),
  `shared/src/protocol.ts` (messages réseau, voir 1.4).
- **Dépendances :** Lot 0.
- **Critère d'acceptation :** types compilables, importables des deux côtés — **validé**,
  utilisés par `server/`. 8 tests unitaires (`vector.test.ts`, `geometry.test.ts`).

### 1.2 — Boucle de jeu à tick fixe + partitionnement spatial
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/engine/world.ts` (entités génériques, aucune règle de jeu),
  `server/src/engine/spatialHash.ts` (grille uniforme, broad-phase), `server/src/engine/room.ts`
  (boucle de tick avec `dt` réel mesuré via `performance.now()`, pas un dt fixe supposé).
- **Dépendances :** 1.1.
- **Critère d'acceptation :** `World.findOverlappingPairs()` détecte correctement les
  chevauchements (testé), le tick loop mesure un dt réel plutôt qu'un pas fixe supposé.
  Le test de charge à 500+ entités (mentionné dans le critère d'origine) est repoussé au
  1.8 (validation empirique), une fois le réseau (1.3/1.4) branché.

### 1.3 — Serveur WebSocket
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/net/server.ts` — `startGameServer(room, options)` sur `ws` +
  `http` natif (sert aussi les fichiers statiques du client, 1.7). Gère join → welcome,
  input, close → `removePlayer`, ignore silencieusement un message malformé (pas de crash
  serveur). `Room.onPlayerDeath` ajouté (indépendant du mod) pour notifier le réseau.
- **Dépendances :** 1.2.
- **Critère d'acceptation :** validé par 5 tests d'intégration (`net/server.test.ts`,
  vrais sockets WebSocket sur port éphémère) **et** par un test manuel de bout en bout
  (serveur compilé réellement démarré + client `ws` : join/welcome/state/input/split tous
  fonctionnels, densité de nourriture correcte). La reconnexion automatique **côté client**
  reste à faire en 1.7 (c'est un comportement du client, pas du serveur).
- **Note technique :** ce Node (v22.22.1, ce poste de dev) est compilé **sans** le support
  `--experimental-strip-types` (`process.features.typescript === false`). Le serveur doit
  donc tourner sur le **JS compilé** (`npm run build` puis `node dist/index.js`), jamais
  sur `src/index.ts` directement — `server/package.json`'s `start` script a été ajusté en
  conséquence. À vérifier sur le Wyse de prod (Lot 8) avant d'en dépendre.

### 1.4 — Protocole réseau (sérialisation des messages)
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `shared/src/protocol.ts` — `join`/`input` (client→serveur), `welcome`/
  `state`/`died` (serveur→client). État complet par tick, sans delta compression ni
  interest management (conforme à la décision prise pour le MVP).
- **Dépendances :** 1.1, 1.3.
- **Critère d'acceptation :** validé — un client de test reçoit l'état du monde en continu
  et voit sa propre entité bouger selon son input (confirmé par test automatisé et test
  manuel).

### 1.5 — API de hooks/événements du moteur (cœur de l'architecture de modding)
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** interface `GameMod` (`server/src/engine/mod.ts`) : `onRoomInit`, `onTick`,
  `onPostMove`, `onCollision`, `onPlayerJoin`, `onPlayerLeave`, `onPlayerInput`,
  `onPlayerDeath`. Tous optionnels. Dispatch assuré par `Room` (1.2) : le moteur ne prend
  aucune décision de gameplay (pas de masse de départ, pas de decay, pas de condition de
  manger codées dans `World`/`Room`) — tout vient du mod chargé.
- **Dépendances :** 1.2.
- **Critère d'acceptation :** validé par `room.test.ts` (ordre `onTick → onPostMove →
  onCollision`, dispatch de `onPlayerDeath` sur transition vivant→mort, transmission des
  inputs) et confirmé a posteriori par le 1.6 : le mode Vanilla entier est écrit sans
  toucher une seule ligne de `engine/`.
- **Décisions actées (§3.3) :** mods écrits dans le même langage que le serveur
  (TypeScript, pas de langage embarqué type Lua pour le MVP) ; granularité "réagir à des
  événements avec accès direct à `World`" plutôt que redéfinir la physique bas niveau ;
  les mods n'ajoutent pas d'assets pour le MVP (logique uniquement).

### 1.6 — Mode Vanilla implémenté comme mod
- **Statut :** ✅ Fait, puis **refactoré en profondeur le 2026-07-26** en moteur paramétrique
- **Contenu (v1, initial) :** `server/src/mods/vanilla/` — implémentation Vanilla codée en
  dur (constantes TS, vitesse instantanée + boost de split ad hoc). Validée par 26 tests,
  fonctionnelle de bout en bout.
- **Refactor (v2, suite à l'analyse d'un fichier Excel fourni par l'utilisateur —
  "Angul.io - Master Sheet Engine & Documentation Technique.xlsx") :** `mods/vanilla/`
  **supprimé**, remplacé par `server/src/mods/parametric/` : un moteur générique
  (`createParametricMod(config)`) piloté par un fichier JSON par mode
  (`server/configs/vanilla.json`, `server/configs/folie.json`). Voir
  [metriques.md](metriques.md) (réécrit en v0.2) pour le détail des formules.
  - Modèle vitesse **et** accélération (inertie générique remplaçant le boost de split
    ad hoc de la v1) — voir metriques.md §4-5.
  - Split généralisé par `ejectEfficiency` (conservation ou création de masse selon le
    mode), fusion à cooldown mass-dépendant (`baseTimeSec + massFactor*masse`).
  - Bords de carte génériques : `STRICT_WALL`, `ELASTIC_BOUNCE`, `TOROIDAL` implémentés
    (`TOXIC_ZONE` documenté mais non implémenté, paramètres non spécifiés).
  - Nourriture à densité par surface de carte (`pellets/1000px²`) plutôt qu'un total fixe.
  - **Folie** est livré comme second mode dès maintenant (juste un second JSON) — voir
    Lot 4, qui en profite directement.
- **Dépendances :** 1.5, [metriques.md](metriques.md).
- **Critère d'acceptation :** **validé** — 30 tests dédiés (`physics.test.ts`,
  `border.test.ts`, `loadConfig.test.ts`, `index.test.ts`) sur le moteur paramétrique,
  plus les tests de régression confirmant que le bug de la cellule Excel corrompue
  (date au lieu de `2.5`) reste corrigé. Testé manuellement en conditions réelles
  (serveur compilé + navigateur, Vanilla **et** Folie démarrent et tournent).
- **Points tranchés/assumés lors du refactor (détaillés en metriques.md §13) :**
  `minSplitMass` de Folie (400, extrapolé), distribution de masse de nourriture de Folie
  (biais quadratique, notre interprétation), `decay`/`eating` de Folie repris identiques
  à Vanilla (non couverts par la feuille).
- **⚠️ Effet de bord mesuré (bande passante) :** la densité de nourriture de la feuille
  (15-30 pellets/1000px² sur des cartes 15000-20000px) donne ~3375 à ~12 000 particules
  ambiantes — bien plus que le total fixe de 300 choisi arbitrairement en 1.8. Un
  nouveau test de charge (20 bots) mesure **~198 Mbit/s**, contre ~222 Mbit/s pour 50
  bots avec l'ancien modèle. Renforce encore la conclusion du 1.8 : interest management
  nécessaire avant le Lot 8. Voir aussi metriques.md §7.
- **Mise à jour 2026-07-27 (demande utilisateur) — types de pellets et densité doublée :**
  `food.massMin`/`massMax`/`massSkewExponent` remplacés par `food.pelletTypes` (8 types —
  Vert/Bleu/Jaune/Violet/Rouge/Orange/Rose/Multicolor, masses 1 à 7 puis 12 — avec un poids
  de spawn par mode, voir metriques.md v0.5 §7) ; densité doublée pour Vanilla (15→30) et
  Folie (30→60). La masse d'une particule reste le seul champ transmis sur le réseau (aucun
  champ "couleur" ajouté au protocole) : le client déduit la couleur d'affichage directement
  de la masse reçue (`client/src/render.ts`, `foodColorForMass`, nourriture toujours dessinée
  en chemins groupés par couleur — le pellet Multicolor, rare, est le seul dessiné
  individuellement, avec un dégradé). `hardcore.json` mis à jour à l'identique de
  `vanilla.json` (nourriture inchangée par rapport à Vanilla, cahier des charges §3.6).
  5 tests remplacés/ajoutés (`physics.test.ts` : tirage pondéré, y compris une vérification
  statistique du respect du poids relatif ; `render.test.ts` : couleurs distinctes par masse).
  **Validé en conditions réelles** : un bot WebSocket connecté à un vrai salon Vanilla et un
  vrai salon Folie confirme que les 8 masses configurées sont bien spawnées, dans le bon
  ordre de fréquence (Vanilla : 11970 > 9576 > 6954 > 5358 > 4161 > 2280 > 1311 > 627 pour
  masses 1,2,3,4,5,6,7,12 — ordre exactement conforme aux poids 28/22/18/13/10/5/3/1) ; densité
  doublée confirmée (jusqu'à 741 particules de nourriture visibles simultanément par un client
  en Vanilla, contre quelques centaines avant ce changement).

### 1.7 — Client de rendu basique
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `client/public/index.html` (canvas + formulaire de pseudo), `client/src/net.ts`
  (connexion WebSocket), `client/src/input.ts` (direction souris depuis le centre de
  l'écran, split sur barre espace), `client/src/render.ts` (caméra centrée sur le
  barycentre pondéré des morceaux du joueur, zoom qui diminue avec la masse totale,
  couleur déterministe par joueur). Bundlé avec **esbuild** (`client/package.json`
  script `bundle`), servi directement par le serveur de jeu (`server/src/net/server.ts`
  sert `client/public/` en statique — un seul process pour tout le MVP).
- **Dépendances :** 0.2, 1.4.
- **Critère d'acceptation :** **validé manuellement dans un vrai navigateur** (Lot 1.7
  exige un test réel, pas seulement des tests unitaires) : serveur compilé démarré,
  page chargée, join envoyé, le HUD passe de "0" à "1 morceau(x) en jeu", le morceau du
  joueur s'affiche avec sa couleur et son pseudo, la nourriture ambiante est visible,
  aucune erreur console, split sans crash (correctement ignoré sous le seuil de masse).
  5 tests unitaires sur `computeCamera`. **Interpolation d'affichage non implémentée**
  (repoussée : le test manuel en local n'a montré aucun besoin visible à ce stade —
  à réévaluer en 1.8/Lot 8 avec une vraie latence réseau).
- **Décision (§0.2, moteur de rendu) :** **Canvas 2D natif**, pas PixiJS — suffisant à
  cette échelle (10-50 joueurs, cahier des charges §4.1), zéro dépendance
  supplémentaire. Résout le dernier point ouvert du Lot 0.
- **Ajouts du 2026-07-26 (suite à retour utilisateur) :** fond blanc + grille façon papier
  millimétré (repère de déplacement/échelle, `render.ts` `drawGrid`) ; contrôle par
  **intensité du curseur** — `client/src/input.ts` envoie un vecteur dont la norme
  (∈ [0,1], pas seulement la direction) code l'intensité, cf. metriques.md §5bis.

### 1.8 — Validation empirique de charge
- **Statut :** ✅ Fait (2026-07-26) — résultat important, optimisation déjà appliquée en partie
- **Contenu :** `server/scripts/loadtest.mjs` — démarre le serveur compilé, connecte N bots
  WebSocket (mouvement + split périodique), mesure la stabilité du tick perçue côté client
  et la bande passante agrégée. `npm run loadtest --workspace=server -- <bots> <secondes>`.
- **Dépendances :** 1.6, 1.7.
- **Mesure initiale (JSON verbeux : UUID + `ownerNickname` répété à chaque entité/tick) :**

  | Joueurs simulés | Entités | Stabilité du tick | Bande passante montante serveur estimée |
  |---|---|---|---|
  | 10 | 310 | moy 50.1 ms, p99 52.2 ms (cible 50 ms à 20 Hz) | **~59.8 Mbit/s** |
  | 50 | 350 | moy 50.1 ms, p99 54.2 ms | **~386.7 Mbit/s** |

- **Ce qui était déjà validé :** la boucle de tick elle-même est **très stable** (quasi
  aucune dérive même à 50 joueurs + 350 entités) — le moteur (1.2/1.5/1.6) n'est pas le
  goulot d'étranglement, uniquement le format des messages.
- **Décision (avec l'utilisateur) :** appliquer immédiatement les gains rapides identifiés,
  plutôt que de différer au Lot 8 comme prévu initialement en §1.4 — le besoin était
  confirmé, pas hypothétique.
- **Optimisations appliquées (toujours sans delta compression ni interest management,
  uniquement une sérialisation moins verbeuse) :**
  - `World` génère des identifiants courts incrémentaux (`"1"`, `"2"`, …) au lieu d'UUID
    (`server/src/engine/world.ts`) ; idem côté serveur réseau pour les identifiants de
    joueur (`server/src/net/server.ts`).
  - Le pseudo n'est plus répété sur chaque entité à chaque tick : nouveau message
    `player` (`shared/src/protocol.ts`), envoyé une fois par joueur (à sa connexion,
    et rétroactivement aux joueurs déjà connectés pour tout nouvel arrivant), que le
    client mappe localement `playerId → pseudo`.
  - Clés JSON du snapshot raccourcies (`i`/`k`/`x`/`y`/`r`/`m`/`p`).
- **Mesure après optimisation :**

  | Joueurs simulés | Bande passante montante serveur | Réduction |
  |---|---|---|
  | 10 | **~35.2 Mbit/s** | ~41 % |
  | 50 | **~222.1 Mbit/s** | ~43 % |

- **Deuxième vague d'optimisations (2026-07-26, décision utilisateur : traiter l'interest
  management maintenant plutôt qu'au Lot 8) :**
  - **Compression WebSocket** (`perMessageDeflate: true`, `net/server.ts`) — quasi gratuite,
    très efficace sur du JSON répétitif.
  - **Arrondi différencié** : position/rayon à 1 décimale (nécessaire à la fluidité visuelle
    au zoom max ×2 du client), masse à l'entier (jamais utilisée pixel par pixel côté
    client — seul `r`, déjà arrondi, sert au rendu).
  - **Interest management** (chunks) : chaque client ne reçoit que les entités dans un rayon
    de 3000px autour du barycentre de ses propres morceaux (+ ses morceaux, toujours inclus
    quelle que soit leur position), via une grille spatiale dédiée (`SpatialHash`, maille =
    rayon d'intérêt) — réutilise la même classe que la détection de collision, avec une
    maille différente. Rayon fixe et généreux plutôt que calé sur le zoom réel du client
    (qui dépend de sa taille d'écran, inconnue du serveur) : approximation volontaire,
    raffinable plus tard si le client transmet ses dimensions de viewport.
- **Mesure finale (toutes optimisations cumulées) :**

  | Joueurs simulés | Bande passante montante serveur | Réduction vs. mesure initiale |
  |---|---|---|
  | 10 | **~7.8 Mbit/s** | ~87 % |
  | 50 | **~51.5 Mbit/s** | ~87 % |

  (Mesure conservatrice : `raw.length` côté client reflète la taille décompressée par `ws`,
  pas les octets réellement transmis sur le réseau — la compression apporte donc un gain
  supplémentaire non visible dans ces chiffres.)
- **Conclusion :** la combinaison des trois optimisations ramène la bande passante à un
  niveau tout à fait raisonnable pour une ligne domestique, y compris à 50 joueurs. Le
  chiffre à 50 joueurs reste à **revalider avec un vrai test de charge sur le Wyse derrière
  la box réelle (Lot 8)** — ces mesures localhost ne capturent que le coût serveur, pas la
  latence ni la topologie réseau réelles. Delta compression et protocole binaire restent
  des optimisations possibles si jamais insuffisant, mais ne semblent plus prioritaires
  après ce résultat.

---

## Lot 2 — Salons (rooms)

Objectif : passer d'un salon unique codé en dur à un système de salons multiples,
créables, configurables, publics ou privés.

### 2.1 — Modèle de salon
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/engine/roomManager.ts` — `RoomManager` : registre en mémoire de
  salons (`ManagedRoom` = id court incrémental + nom + `modId` + `visibility` +
  une `Room` (Lot 1.2) indépendante, avec sa propre boucle de tick). `RoomManager` reste
  décorrélé du mécanisme concret de chargement des mods via un `ModResolver` injecté
  (`(modId) => { mod, mapSize, kArea }`) — en prod, résolu vers
  `createParametricMod(loadModConfig(modId))` (index.ts) ; en test, un mod/mapSize
  arbitraire. `onRoomCreated(listener)` notifie la création de chaque salon (branché par
  net/server.ts, voir 2.2). La **configuration de reset** mentionnée dans l'énoncé d'origine
  de ce sous-lot est reportée au 2.4 (pas de champ mort en attendant que le 2.4 l'utilise
  réellement).
- **Dépendances :** Lot 1.
- **Critère d'acceptation :** **validé** par `roomManager.test.ts` (7 tests) — plusieurs
  salons existent en mémoire simultanément, chacun avec sa propre `World`/simulation
  totalement indépendante (aucun état partagé, `playerCount` par salon exact).

### 2.2 — Lobby : liste et création de salons publics
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** API HTTP ajoutée au serveur existant (`server/src/net/server.ts`, même
  process que le jeu, pas de nouveau service) : `GET /api/rooms` (salons publics +
  `playerCount` en direct), `POST /api/rooms` (création, `{name, modId}`, visibilité
  publique par défaut — la création de salon privé est 2.3), `GET /api/modes` (modes
  disponibles, fournis par index.ts via `listAvailableModIds()` pour ne pas coupler le
  réseau au mécanisme de chargement des mods). Connexion WebSocket désormais routée par
  salon via `?roomId=` dans l'URL (plus de salon unique implicite : une connexion sans
  `roomId` valide est fermée avec le code `4004`). Côté client : `client/src/lobby.ts`
  (client de cette API) et un écran de lobby dans `index.html`/`index.ts` — liste des
  salons publics avec bouton "Rejoindre", formulaire de création (nom + `<select>` des
  modes) avec bouton "Créer et rejoindre". Le salon "Salon principal" est toujours créé
  par défaut au démarrage (`index.ts`, compatibilité avec le comportement du Lot 1).
- **Bug corrigé au passage (régression introduite par ce sous-lot) :** `GameConnection`
  (`client/src/net.ts`) abandonnait silencieusement tout message envoyé avant l'ouverture
  effective du WebSocket (`readyState !== OPEN` ⇒ `send()` ne faisait rien). Invisible tant
  que la connexion se faisait au chargement de la page (largement le temps de s'ouvrir avant
  le clic sur "Jouer") ; devenu bloquant dès que `enterGame()` crée la connexion **et**
  envoie le `join` dans le même geste (lobby). Corrigé par une file d'attente qui vide les
  messages envoyés trop tôt à l'événement `open` — voir 3 tests dédiés (`net.test.ts`, avec
  un faux WebSocket).
- **Dépendances :** 2.1.
- **Critère d'acceptation :** **validé** — 15 tests d'intégration réseau (dont 2 nouveaux :
  isolation de deux salons simultanés, fermeture sur salon inexistant) + tests unitaires
  du bug ci-dessus, **et** test manuel réel dans un navigateur (via le Browser pane) :
  lobby chargé, salon par défaut listé, création d'un second salon public depuis un second
  onglet, un joueur par salon, chaque client ne voit que son propre salon (capture d'écran
  + `GET /api/rooms` confirmant `playerCount: 1` pour chacun des deux salons).

### 2.3 — Salons privés sur invitation
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `RoomManager.createRoom` génère un `inviteCode` (`randomUUID()`) pour tout
  salon `visibility: 'private'`, renvoyé uniquement dans la réponse de création (jamais par
  `listPublicRooms`, qui ignore de toute façon les salons privés). **Faille corrigée au
  passage** : un salon privé n'était protégé que par l'absence de listing — son id court et
  séquentiel (`"1"`, `"2"`…) restait devinable et suffisait à le rejoindre. `getManagedRoom`
  refuse désormais explicitement de résoudre un salon privé par son id brut ; seul le code
  d'invitation y donne accès (le lien d'invitation transporte le code, pas l'id interne).
  Côté client : case à cocher "Privé" à la création, champ "Rejoindre via code" dans le
  lobby, code affiché dans le HUD pendant la partie (le lobby disparaît dès l'entrée en jeu,
  donc le montrer une seule fois avant n'aurait pas suffi pour le partager).
- **Dépendances :** 2.1.
- **Critère d'acceptation :** **validé** — 6 tests dédiés (`roomManager.test.ts`) + 2 tests
  réseau (`server.test.ts`, dont un confirmant explicitement le refus par id brut / acceptation
  par code) + test manuel réel dans le navigateur (salon privé créé, id brut testé en Node
  direct — fermeture confirmée avec le code `4004` — puis rejoint avec succès via son code).

### 2.4 — Reset automatique des salons
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/engine/resetSchedule.ts` — `RoomResetSchedule` à deux formes :
  `dailyAt` (heure murale dans un fuseau, défaut `{ hour: 10, minute: 0, timeZone:
  'Europe/Paris' }` — `DEFAULT_RESET_SCHEDULE`) pour la prod, `interval` (délai fixe court)
  pour les tests, conformément au critère d'acceptation d'origine. `delayUntilNextReset`
  calcule le prochain déclenchement via `Intl.DateTimeFormat` (pas de dépendance de fuseau
  horaire supplémentaire) et recalcule à chaque déclenchement plutôt que d'ajouter
  bêtement 24h — reste correct malgré les changements d'heure. `Room.reset()` (nouveau)
  vide entièrement le monde (morceaux ET nourriture, qui repousse ensuite via la logique
  habituelle du mod) et fait respawner chaque joueur encore connecté comme s'il venait de
  rejoindre (même hook `onPlayerJoin`) — les joueurs restent connectés, pseudo compris.
  `onReset` notifie le réseau (`net/server.ts`), qui réutilise le message `died` existant
  pour chaque client du salon plutôt qu'un nouveau type de message (la sensation "je viens
  de mourir, je respawn" est exactement ce qui se passe). Planification pilotée par
  `Room.start()`/`stop()` (même cycle de vie que le tick), configurable par salon via
  `RoomManager.createRoom({..., resetSchedule})` (pas encore de contrôle dans le lobby
  client pour le personnaliser à la création — modèle de données prêt, UI non faite).
- **Dépendances :** 2.1.
- **Critère d'acceptation :** **validé** — 5 tests (`resetSchedule.test.ts`, dont
  vérification explicite des décalages été/hiver UTC+2/UTC+1), 5 tests (`room.test.ts`,
  reset manuel + planification automatique en mode `interval`), 1 test réseau
  (`server.test.ts`, diffusion `died` lors d'un reset), **et** test manuel réel (serveur
  réel + navigateur, intervalle de 5s : reset confirmé toutes les ~5s dans les logs
  serveur, HUD du joueur repassant bien par "Vous êtes mort — respawn en cours…" puis "1
  morceau(x) en jeu").

### 2.5 — Isolation multi-salons sur un même serveur
- **Statut :** ✅ Fait (2026-07-26) — **avec une limite documentée, pas glissée sous le tapis**.
- **Contenu :** `server/src/engine/roomIsolation.test.ts` mesure réellement plutôt que de
  supposer. **Isolation d'état : totale** — chaque salon a son propre `World`/`Room`, aucune
  donnée partagée, confirmé par les tests dédiés de 2.1/2.2 (salons simultanés avec joueurs
  différents, aucune fuite d'un salon à l'autre). **Isolation CPU/timing : non garantie**,
  et le test le démontre plutôt que de le contourner : Node est mono-thread pour le JS, donc
  toutes les `Room` d'un même process se partagent le même thread — un tick synchrone coûteux
  dans un salon (mod lent ou buggé) retarde mesurablement le tick d'un autre salon qui tombe
  pendant son exécution. Mesuré : sous un intervalle nominal de 50ms (20Hz), un tick coûtant
  30ms ne cause aucun retard mesurable (tient dans la même fenêtre), mais un tick coûtant 80ms
  fait chuter le rythme de l'autre salon à ~80ms/tick au lieu de 50ms. Rejoint la discussion
  du **Lot 11.1** (`worker_threads`) : c'est le levier identifié si cette limite devient un
  jour un vrai problème (plusieurs salons chargés simultanément) — non nécessaire à l'échelle
  actuelle (10-50 joueurs, §4.1 du cahier des charges), donc non implémenté maintenant.
- **Dépendances :** 2.1, Lot 1.8.
- **Critère d'acceptation :** **partiellement révisé** — l'énoncé d'origine ("sans
  interférence observée entre elles") visait probablement l'isolation d'état, largement
  acquise ; l'isolation CPU sous charge élevée, elle, n'est structurellement pas garantie sur
  un process mono-thread, et aucune quantité de test ne changera ce fait sans changer
  l'architecture (Lot 11.1). Le sous-lot est marqué fait sur la base de : l'isolation d'état
  est acquise et testée, la limite CPU/timing est désormais connue, mesurée, documentée, et
  un levier de correction est identifié pour le jour où le besoin sera réel — plutôt que
  fait sur la base d'une promesse d'isolation totale qui ne serait pas honnête.

---

## Lot 3 — Comptes joueurs & persistance

Objectif : remplacer les sessions anonymes par des comptes persistants (PostgreSQL),
support de l'authentification et des statistiques.

### 3.1 — Setup PostgreSQL et migrations
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** PostgreSQL 18 installé localement par l'utilisateur (paquets `postgresql`/
  `postgresql-client` Ubuntu, service `postgresql.service` actif, écoute sur
  `localhost:5432`). Rôle applicatif dédié `angulio` (login/mot de passe, pas de droit
  superutilisateur) et base `angulio_dev` créés (pas de connexion sous `postgres`
  directement — accès uniquement via ce rôle, cohérent avec le futur déploiement Wyse).
  Outil de migration choisi : **node-pg-migrate** (+ `pg` comme driver) — SQL-first,
  fichiers de migration versionnés dans `server/migrations/`, pas d'ORM/mapping objet
  imposé, cohérent avec le reste du projet (dépendances minimales, `ws`+`http` natifs,
  Canvas 2D natif). `server/.env` (gitignored) porte `DATABASE_URL` ; `server/.env.example`
  versionné documente le format attendu. Scripts npm : `migrate:up`/`migrate:down`/
  `migrate:create` (`server/package.json`, `--envPath ./.env`). Schéma initial minimal :
  table `players` (`id`, `pseudo` unique, `created_at`) — juste de quoi valider le pipeline
  de bout en bout ; les colonnes du compte joueur complet (3.4) et l'authentification (3.2)
  arriveront dans leurs migrations respectives plutôt que d'être anticipées ici.
- **Dépendances :** Lot 0.
- **Critère d'acceptation :** **validé** — cycle `migrate:up`/`migrate:down`/`migrate:up`
  exécuté en conditions réelles contre `angulio_dev` (table `players` créée puis
  supprimée puis recréée sans erreur, `\d players` confirmant le schéma attendu), migration
  versionnée dans le repo (`server/migrations/1785090813268_init.cjs`).

### 3.2 — Authentification (inscription/connexion)
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/accounts/passwords.ts` (hachage/vérification **argon2**, options par
  défaut — testé viable sur cette machine avant adoption, cf. §5.1 "argon2 recommandé"),
  `server/migrations/*_add-password-hash.cjs` (colonne `password_hash` sur `players`),
  `server/src/accounts/accountsRepository.ts` (`createAccount`/`findByPseudo`/`findById`,
  `PseudoTakenError` levée sur violation de la contrainte unique PostgreSQL plutôt qu'un
  pré-check applicatif racy). Endpoints HTTP `POST /api/auth/register` et `POST /api/auth/login`
  (`net/server.ts`), portés par `server/src/accounts/service.ts` (`AccountsService`, point
  d'entrée unique — `net/server.ts` ne connaît jamais le repository directement, même principe
  d'indirection que `RoomManager`). Validation pseudo (3-20 caractères) et mot de passe (8
  caractères minimum) ; message de connexion identique que le pseudo existe ou non (ne révèle
  pas les pseudos pris via l'erreur de login).
- **Dépendances :** 3.1.
- **Critère d'acceptation :** **validé** — 4 tests `passwords.test.ts`, 4 tests
  `accountsRepository.test.ts` (Postgres réel), 6 tests `service.test.ts` (Postgres réel,
  `describe.skipIf(!DATABASE_URL)` pour rester silencieux sans base configurée). Mot de passe
  jamais loggé (`logEvent('account_registered', { pseudo })`, jamais le mot de passe) ni stocké
  en clair (colonne `password_hash` uniquement). Testé manuellement de bout en bout dans le
  navigateur (inscription réelle, `$argon2...` confirmé en base via `psql`).

### 3.3 — Sessions/tokens
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/src/accounts/sessionStore.ts` — tokens opaques en mémoire
  (`crypto.randomBytes(32).toString('hex')` → id de compte), pas de JWT ni de dépendance
  supplémentaire (cohérent avec le reste du projet : `RoomManager` est lui aussi un registre en
  mémoire). Pas d'expiration (aucun besoin mesuré à ce jour). Le token est renvoyé par
  `register`/`login`, stocké côté client dans `localStorage` (`client/src/auth.ts`,
  `saveSession`/`loadSession` — survit à un F5), et transmis à la connexion WebSocket via
  `?token=` dans l'URL (les navigateurs ne permettent pas d'en-têtes personnalisés sur
  `WebSocket`) : `net/server.ts` le résout en id de compte à la connexion, absent/invalide ⇒
  partie en invité (jamais une erreur, voir 4.4/Lot 2).
- **Dépendances :** 3.2.
- **Critère d'acceptation :** **validé** — 4 tests `sessionStore.test.ts` (création/résolution/
  révocation/unicité), et bout en bout manuellement : inscription dans le lobby → jointure d'un
  salon avec le token → `GET /api/account/me` avec ce même token après un F5 (session persistée
  via `localStorage`).

### 3.4 — Modèle de compte joueur complet
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `server/migrations/*_full-account-model.cjs` — colonnes `level`/`xp`/`premium`/
  `cosmetics` (`text[]`, contenu détaillé différé, §8.2) sur `players`, table
  `player_best_scores` (`player_id`, `mode_id` texte libre — les modes sont des configs
  chargées dynamiquement, pas une énumération figée — `best_score`, clé primaire composite).
  Formule niveau/XP **volontairement provisoire** (§5.2 : "à définir en phase de
  développement") : `server/src/accounts/levels.ts`, courbe en racine carrée
  (`level = 1 + floor(sqrt(xp/100))`), XP gagné = masse maximale atteinte pendant la partie
  (aucun autre système de score n'existe à ce jour) — ajustable sans migration, ne vit que dans
  le code applicatif.
- **Dépendances :** 3.1.
- **Critère d'acceptation :** **validé** — schéma confirmé via `psql \d`, 6 tests
  `levels.test.ts`, lecture/écriture couvertes par les tests de 3.2/3.5.

### 3.5 — Écriture des stats en fin de partie
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `net/server.ts` — `RoomRuntime` gagne `accountIdByPlayer`/`maxMassByPlayer` (par
  connexion, uniquement pour les joueurs authentifiés). La masse totale maximale atteinte est
  mise à jour à chaque tick (dans la boucle `onState` déjà existante, aucun coût réseau
  supplémentaire), remise à 0 à chaque respawn (pas seulement à la connexion). Écriture
  best-effort et asynchrone (`recordAccountStats`, erreur seulement loggée — ne doit jamais
  bloquer la diffusion réseau) déclenchée à la fois sur `onPlayerDeath` **et** sur la
  déconnexion du socket (`close`) : une perte de connexion est aussi une "fin de partie" pour ce
  joueur, pas seulement une mort en jeu. `AccountsService.recordGameResult` fait l'upsert du
  meilleur score (`GREATEST`) et l'ajout d'XP/recalcul de niveau en une seule transaction SQL.
- **Dépendances :** 3.4, Lot 1.6.
- **Critère d'acceptation :** **validé** — 1 test dédié dans `accountsRepository.test.ts`
  (accumulation d'XP + `GREATEST` sur le meilleur score), et **validé manuellement en
  conditions réelles** : partie jouée dans le navigateur (compte `FantaTest`), déconnexion,
  confirmé en base via `psql` (`xp: 50`, `player_best_scores: {vanilla, 50}`), puis ré-affiché
  correctement dans l'écran de profil après reconnexion.

### 3.6 — Écran de profil joueur
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** `client/src/auth.ts` (client de l'API : `register`/`login`/`fetchProfile`,
  persistance de session `localStorage`). Lobby (`index.html`/`index.ts`) : section "Compte"
  (bascule inscription/connexion, ou "Connecté(e) : X" + boutons Profil/Déconnexion une fois
  authentifié — une partie en invité reste possible à tout moment via le champ "Pseudo",
  inchangé). Panneau de profil dédié (`#profileOverlay`) : pseudo, niveau, XP, statut Premium,
  cosmétiques, liste des meilleurs scores par mode — récupéré via `GET /api/account/me`
  (`Authorization: Bearer <token>`).
- **Dépendances :** 3.4, 3.5.
- **Critère d'acceptation :** **validé manuellement de bout en bout dans le navigateur** :
  inscription → panneau "Profil" affichant niveau 1/XP 0 → partie jouée → déconnexion →
  reconnexion (session persistée) → panneau "Profil" affichant XP 50 et le meilleur score
  vanilla à jour.

**Lot 3 clos.** Points non traités à l'époque, **tous deux refermés depuis** (voir Journal,
2026-07-27) : le service PostgreSQL dans `install.sh` (Lot 8.4) et le service Postgres en CI
GitHub Actions (`.github/workflows/ci.yml`, Lot 0.6) — les tests Postgres
(`describe.skipIf(!DATABASE_URL)`) tournaient jusque-là silencieusement ignorés en CI faute de
base disponible ; ils s'exécutent désormais réellement à chaque push/PR.

---

## Lot 4 — Deuxième mode de jeu (validation de l'API de modding)

Objectif : prouver que l'API de hooks du Lot 1.5 permet d'écrire un mode différent du
Vanilla **sans modifier le moteur central** — jalon de validation architecturale avant
d'envisager l'ouverture communautaire (Phase 2).

> **Mise à jour (2026-07-26) :** le refactor du Lot 1.6 a fait naître **Folie**, un
> second mode déjà fonctionnel (`server/configs/folie.json`) — mais c'est un mode
> **paramétrique** (mêmes hooks/mécaniques que Vanilla, valeurs différentes), pas un mode
> aux mécaniques structurellement nouvelles. Il valide donc la couche "config JSON", pas
> l'extensibilité de l'API de hooks elle-même. L'objectif d'origine de ce Lot (4.1-4.3)
> reste pertinent : choisir un mode qui a *vraiment* besoin de nouveaux hooks/logique
> (ex. Classes avec compétences actives, ou tout mode du §3.4 non réductible à un simple
> réglage de valeurs) pour prouver que l'architecture de hooks elle-même est suffisante.

### 4.1 — Choix du mode à développer en second
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** **Hardcore** (#2) retenu, conformément à la recommandation du plan.
  Précision/Sniper (#8, l'autre option recommandée) a été écarté après relecture : tel que
  décrit (§3.4), il se réduit entièrement à `food.density → ~0`, donc purement paramétrique
  (comme Folie) — il n'aurait rien prouvé de plus sur l'API de hooks elle-même. Hardcore, lui,
  introduit deux mécaniques non réductibles à un réglage de valeurs (voir 4.2).
- **Dépendances :** Lot 1.6.
- **Critère d'acceptation :** **validé** — choix acté ci-dessus et dans le Journal des décisions.

### 4.2 — Spécification chiffrée du mode choisi
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** mouvement/split/fusion/bords/nourriture identiques à Vanilla (aucune raison de
  les changer, cf. cahier des charges §3.4 #2) — seuls deux paramètres sont propres à Hardcore :
  multiplicateur de masse gagnée en mangeant un **autre joueur** (×10 par défaut, configurable),
  et conséquence d'une mort sur le compte (perte totale, 0 crédité, au lieu de la masse maximale
  atteinte pour les autres modes).
- **Dépendances :** 4.1.
- **Critère d'acceptation :** **validé** — tableau de valeurs ajouté au cahier des charges
  ([§3.6](cahier_des_charges.md)), section formules ajoutée dans
  [metriques.md §14.1](metriques.md#141-hardcore-lot-4--mode-aux-mécaniques-structurellement-nouvelles).

### 4.3 — Implémentation du mode comme mod indépendant
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `server/src/mods/hardcore/index.ts` (`createHardcoreMod`) — **composé** au-dessus
  de `createParametricMod` plutôt que dupliqué : délègue tel quel `onTick`/`onPostMove`/
  `onPlayerJoin`/`onPlayerInput`/`onPlayerDeath`/`getAccelerationForMass` (mouvement identique à
  Vanilla), ne réécrit que `onCollision` (multiplicateur d'absorption entre joueurs, nourriture
  et fusion inchangées) et `transformScoreForAccount` (nouveau hook, voir 4.5). Config
  `server/configs/hardcore.json` (mêmes valeurs que `vanilla.json`, schéma paramétrique standard
  réutilisé pour la partie mouvement). `server/src/index.ts` gagne un petit registre
  (`NON_PARAMETRIC_MOD_FACTORIES`) pour que `resolveMod` sache quels `modId` utilisent un mod
  écrit à la main plutôt que `createParametricMod` — aucune ligne d'`engine/` modifiée hors
  l'ajout documenté du hook (voir 4.5).
- **Dépendances :** 4.2.
- **Critère d'acceptation :** **validé** — 8 tests dédiés (`mods/hardcore/index.test.ts` :
  multiplicateur par défaut et personnalisé, refus sans avantage de masse suffisant délégué à la
  répulsion, nourriture/fusion inchangées, `transformScoreForAccount` toujours 0, délégation
  vérifiée pour `onPlayerJoin`/`getAccelerationForMass`). **Validé manuellement en conditions
  réelles** : salon Hardcore créé et rejoint dans le navigateur, joueur authentifié qui se
  déconnecte après avoir atteint 45-50 de masse → confirmé en base (`psql`) que `xp`/
  `player_best_scores` restent inchangés (0 crédité), alors qu'un même scénario en Vanilla
  crédite bien 50 XP (non-régression confirmée).

### 4.4 — Sélecteur de mode à la création de salon
- **Statut :** ✅ Fait (2026-07-27) — **déjà acquis, aucun changement nécessaire**
- **Contenu :** le lobby (Lot 2.2) et `listAvailableModIds()` (scan de `server/configs/*.json`)
  étaient déjà entièrement génériques : `hardcore.json` suffit à faire apparaître le mode dans
  `GET /api/modes` et le `<select>` du lobby, sans toucher au client. Confirme que le découplage
  décidé au Lot 2 (réseau jamais couplé au mécanisme concret de chargement des mods) tient sa
  promesse pour un troisième mode, y compris non-paramétrique.
- **Dépendances :** 4.3, Lot 2.2.
- **Critère d'acceptation :** **validé** — `GET /api/modes` renvoie
  `["folie","hardcore","vanilla"]`, salon Hardcore créé via `POST /api/rooms` et rejoint depuis
  le lobby (navigateur).

### 4.5 — Bilan de l'API de hooks
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** **un seul ajustement nécessaire** — un nouveau hook optionnel,
  `GameMod.transformScoreForAccount?(rawScore): number` (`engine/mod.ts`), délégué par
  `Room.transformScoreForAccount` (identité si le mod ne l'implémente pas) et appelé par
  `net/server.ts` juste avant l'écriture des stats (Lot 3.5). Nécessaire parce que le Lot 3.5 a
  été conçu *avant* le Lot 4, sans notion de mode pouvant modifier la conséquence d'une mort sur
  le compte — plutôt que de coder un cas particulier `if (modId === 'hardcore')` dans
  `net/server.ts` (coupling direct réseau ↔ mod, exactement ce que l'architecture évite
  partout ailleurs), l'ajout d'un hook générique garde `net/server.ts` agnostique du mode, comme
  pour `getAccelerationForMass` (Lot 3.5) avant lui. **Tout le reste a suffi sans modification** :
  `onCollision` s'est révélé assez générique pour exprimer un multiplicateur d'absorption
  arbitraire, et la **composition** (un mod qui enveloppe `createParametricMod` et ne réécrit que
  2 des 7 hooks utilisés) s'est avérée un patron naturel et peu coûteux pour un mode qui ne
  change qu'une fraction des mécaniques d'un mode existant — pattern qui n'avait pas été
  anticipé/documenté avant ce Lot et vaut la peine d'être gardé en tête pour de futurs mods
  communautaires (Lot 9).
- **Dépendances :** 4.3.
- **Décision :** l'unique ajustement (hook `transformScoreForAccount`) est déjà traité
  maintenant (pas reporté en Phase 2) — coût marginal (une ligne d'interface + une ligne de
  délégation dans `Room`), et bloquant pour que 4.3 fonctionne correctement.

---

## Lot 5 — Interface d'administration

Objectif : donner un outil de gestion du jeu, séparé du client joueur (§5.4).

### 5.1 — Authentification admin
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `server/src/admin/adminAuth.ts` (`AdminAuth`) — compte admin **unique** pour le
  MVP (cahier des charges §5.4), entièrement séparé de `AccountsService` : pas de ligne en base,
  un seul mot de passe haché (argon2, réutilise `accounts/passwords.ts`) fourni via la variable
  d'environnement `ADMIN_PASSWORD_HASH` (`server/.env`, absente du dépôt), généré par le nouveau
  script `server/scripts/hashPassword.mjs` (`npm run hash-password --workspace=server -- <mdp>`).
  Sessions en mémoire par token opaque, même magasin que les comptes joueurs
  (`sessionStore.ts`), un seul id conceptuel constant côté admin. `POST /api/admin/login`
  (`net/server.ts`) renvoie 503 si `ADMIN_PASSWORD_HASH` n'est pas configuré (comportement
  optionnel, même philosophie que `accounts`), 401 si le mot de passe est incorrect, 200 +
  token sinon. Toutes les routes `/api/admin/*` passent par `requireAdmin()` (Bearer token).
- **Dépendances :** Lot 3.2.
- **Critère d'acceptation :** **validé** — 4 tests `adminAuth.test.ts`, tests réseau dédiés
  (`server.test.ts`, "avec comptes joueurs") couvrant 503/401/200 et le rejet des routes
  `/api/admin/players/*` sans token valide. **Validé manuellement en conditions réelles** :
  connexion réussie dans le navigateur avec le mot de passe configuré en local, refusée avec un
  mauvais mot de passe.

### 5.2 — Gestion des comptes joueurs
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `AccountsRepository.searchByPseudo` (`ILIKE`, insensible à la casse) et
  `adminUpdateAccount` (patch dynamique, un seul aller-retour SQL) ; `AccountsService`
  expose `searchAccountsForAdmin`/`getAccountForAdmin`/`updateAccountForAdmin` (jamais
  `passwordHash` exposé). Bannissement : nouvelle colonne `banned` sur `players`
  (migration `1785135367447_add-banned-flag.cjs`) ; `AccountsService.login` la vérifie **après**
  le mot de passe (ne fuit rien à qui ne connaît pas déjà le mot de passe, cohérent avec le
  message générique existant) ; bannir révoque immédiatement les sessions actives du compte
  (`SessionStore.revokeSessionsForAccount`, nouveau) — sans ça, un token déjà émis resterait
  valable jusqu'à la prochaine reconnexion. Routes `GET /api/admin/players?q=`,
  `GET /api/admin/players/:id`, `PATCH /api/admin/players/:id` (`net/server.ts`).
- **Dépendances :** 5.1, Lot 3.4.
- **Critère d'acceptation :** **validé** — tests dédiés (`accountsRepository.test.ts`,
  `service.test.ts`, `server.test.ts`) couvrant recherche par sous-chaîne, patch partiel,
  révocation de session au bannissement, refus de connexion (401, message dédié) après
  bannissement. **Validé manuellement en conditions réelles** (navigateur + interface admin) :
  compte recherché par pseudo, consulté, banni depuis l'interface — tentative de connexion du
  compte banni ensuite refusée (confirmé via `curl`, 401).

### 5.3 — Gestion manuelle XP/niveau
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** même route `PATCH /api/admin/players/:id` que 5.2/5.4 (patch unique pour les
  quatre types de correction manuelle, `AdminAccountPatch`) — `level`/`xp` acceptés
  indépendamment l'un de l'autre (pas de recalcul automatique de l'un à partir de l'autre,
  contrairement à `recordGameResult`/Lot 3.5 : ici l'admin corrige explicitement, y compris pour
  un cas où la formule XP→niveau aurait changé entre-temps). Validation basique côté service
  (entiers positifs) plutôt qu'une vraie règle métier.
- **Dépendances :** 5.2.
- **Critère d'acceptation :** **validé** — `service.test.ts` (rejet niveau/XP invalide),
  **validé manuellement en conditions réelles** : XP modifié à 250 depuis l'interface admin,
  confirmé en base (`psql`) et par un nouvel appel `GET /api/admin/players/:id`.

### 5.4 — Gestion manuelle des cosmétiques et activation Premium
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `admin/` devient une vraie app (placeholder du Lot 0 remplacé) : `admin/src/
  adminApi.ts` (client HTTP), `admin/src/index.ts` (login, recherche, panneau de détail/édition
  — niveau, XP, cases Premium/Banni, cosmétiques en texte séparé par virgules, meilleurs
  scores en lecture seule), `admin/public/index.html` (même langage visuel "labo premium"
  glassmorphism que le client joueur). Bundlée avec esbuild comme `client/`, servie par le même
  process de jeu sous `/admin/*` (`net/server.ts`, `adminStaticDir` — répertoire distinct de
  `staticDir`, "séparée du client joueur" au sens du cahier des charges). **Bug détecté et
  corrigé en testant manuellement** : `/admin` (sans slash final) plus un script chargé via un
  chemin *relatif* (`./bundle.js`) résolvait vers `/bundle.js` — le bundle du **client joueur**,
  pas celui de l'admin (résolution d'URL relative standard : `admin` sans `/` final est traité
  comme un fichier, pas un répertoire). Corrigé par un chemin absolu (`/admin/bundle.js`).
- **Dépendances :** 5.2, Lot 3.4.
- **Critère d'acceptation :** **validé manuellement de bout en bout dans le navigateur** (Browser
  pane) : connexion admin, recherche d'un compte de test, activation Premium + édition
  cosmétiques + XP en un seul enregistrement, confirmé en base (`psql`) — puis vérifié que le
  compte élevé au statut Premium débloque immédiatement la création de salon côté client
  (Lot 6.4, testé dans la foulée).

### 5.5 — Gestion des salons actifs & modération des mods (Phase 2, différé)
- **Statut :** ⏸️ Différé (Phase 2)
- **Dépendances :** Lot 9.
- **Critère d'acceptation :** défini au moment de l'attaque du Lot 9.

---

## Lot 6 — Statut Premium & dons

Objectif : mettre en place le circuit don → statut Premium (§5.3).

### 6.1 — Choix de la plateforme de don
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** **Ko-fi retenu** — 0% de commission plateforme (formule gratuite, seuls les
  frais du processeur de paiement s'appliquent), aucune création de société requise, don
  ponctuel libre sans palier (conforme à "1€ ou 10€ donnent le même statut", cahier des charges
  §5.3), disponible depuis la France. Écarté : Liberapay (orienté dons récurrents, moins connu
  du grand public), PayPal.Me (frais PayPal plus élevés, pas de page dédiée expliquant le
  statut Premium), GitHub Sponsors (processus d'éligibilité/vérification avant le premier don
  possible, plus lent à mettre en place pour un MVP). Décision et constante `DONATION_URL`
  documentées dans `client/src/support.ts`.
- **Dépendances :** aucune.
- **Critère d'acceptation :** **validé** — plateforme choisie et actée ci-dessus et dans le
  Journal des décisions. **Point non automatisable par un agent, à faire manuellement par
  l'utilisateur avant mise en production** : le compte Ko-fi réel n'existe pas encore
  (création de compte tiers hors de portée d'un agent, cf. règles de sécurité de session) —
  `DONATION_URL` (`client/src/support.ts`) pointe vers un espace réservé
  (`https://ko-fi.com/angulio`) à remplacer par l'URL réelle une fois le compte créé.

### 6.2 — Page dédiée don/soutien
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `client/src/support.ts` (`DONATION_URL`, `SUPPORT_BODY`) + panneau
  `#supportOverlay` (`client/public/index.html`, même glassmorphism que `#profileOverlay`) —
  explique le don libre, le statut Premium et son avantage MVP (création de salon), et
  l'activation manuelle (indiquer son pseudo dans le message de don). Accessible depuis un
  bouton "Soutenir" dans la section Compte du lobby (visible à tout moment, connecté ou non) et
  depuis le message "Réservé aux comptes Premium" qui remplace le formulaire de création de
  salon pour un compte non-Premium (voir 6.4).
- **Dépendances :** 6.1.
- **Critère d'acceptation :** **validé manuellement dans le navigateur** — panneau accessible
  depuis le lobby (bouton "Soutenir"), contenu et lien de don corrects, bouton "Fermer"
  fonctionnel.

### 6.3 — Activation manuelle du statut Premium (MVP)
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** couvert par l'interface admin (Lot 5.4) — case à cocher "Premium" dans le
  panneau de détail d'un compte, un seul appel `PATCH /api/admin/players/:id` pour l'activer
  (avec, si besoin au même moment, XP/niveau/cosmétiques). Le circuit complet reste manuel de
  bout en bout comme prévu pour le MVP : don Ko-fi → l'utilisateur voit le pseudo indiqué par
  le donateur dans le message de don (6.2) → active Premium dans l'admin.
- **Dépendances :** Lot 5.4.
- **Critère d'acceptation :** **validé manuellement en conditions réelles** — compte de test
  recherché puis élevé au statut Premium en un seul enregistrement depuis l'interface admin
  (quelques clics), confirmé en base (`psql`) et effectif immédiatement côté client (6.4).

### 6.4 — Fonctionnalité rattachée : création de salon réservée Premium
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `net/server.ts`, `handleCreateRoom` — avec `accounts` configuré, résout le
  Bearer token en compte puis vérifie `AccountsService.isPremium` avant tout traitement de la
  requête ; refuse (403, message pointant vers la page Soutien) un invité ou un compte
  standard. **Décision de dégradation gracieuse** : sans `accounts` configuré (DB absente, ex.
  dev/CI sans Postgres), la création reste ouverte à tous comme avant ce Lot — le concept même
  de compte/Premium n'existe pas dans cet environnement, cohérent avec le reste de
  `GameServerOptions.accounts` (optionnel partout ailleurs). Côté client : `lobby.ts`
  `createRoom` transmet le token (`Authorization: Bearer`) ; `index.ts` charge le statut
  Premium du compte connecté après connexion/inscription (`fetchProfile`) et bascule
  `#createRoomForm`/`#createRoomLocked` en conséquence — évite de montrer un formulaire voué à
  échouer plutôt que de compter uniquement sur l'erreur serveur.
- **Dépendances :** Lot 3.4, Lot 2.2.
- **Critère d'acceptation :** **validé** — tests réseau dédiés (`server.test.ts`, "avec comptes
  joueurs") : 403 sans token, 403 avec un compte non-Premium, 201 après activation Premium.
  **Validé manuellement de bout en bout dans le navigateur** : compte standard/invité voit le
  message "Réservé aux comptes Premium" à la place du formulaire ; compte élevé au statut
  Premium (via l'admin) voit le formulaire se débloquer après reconnexion et crée effectivement
  un salon, rejoint immédiatement.

### 6.5 — Automatisation du lien don → activation (différé)
- **Statut :** ⏸️ Différé
- **Contenu :** webhook de la plateforme de don relié à l'activation automatique.
- **Dépendances :** 6.1, 6.3.
- **Critère d'acceptation :** à définir si le volume de dons rend le processus manuel
  trop lourd.

---

## Lot 7 — Client mobile (PWA)

Objectif : rendre le client web installable comme application mobile, sans second
développement natif (§4.6).

### 7.1 — Manifest et icônes
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `client/public/manifest.json` (nom, couleurs, `display: standalone`, 3 icônes)
  + `client/public/icons/` (`icon-192.png`, `icon-512.png` purpose `any`, `icon-maskable-512.png`
  purpose `maskable` avec zone de sécurité ~68% pour ne pas être rogné par un masque adaptatif
  Android). **Icônes générées par un canvas dans le navigateur** (deux cercles qui se
  chevauchent, évoquant directement le gameplay — absorption de cellules) plutôt qu'un ajout de
  dépendance de traitement d'image côté projet (`sharp`/`canvas` npm), cohérent avec la
  préférence du projet pour des dépendances minimales ; place-holder de branding, remplaçable
  plus tard sans changement de structure. `index.html` gagne `<link rel="manifest">`,
  `<meta name="theme-color">`, `<link rel="icon">` et `<link rel="apple-touch-icon">` (couvre
  l'ajout à l'écran d'accueil iOS, sans valider le comportement PWA complet — voir 7.5).
- **Dépendances :** Lot 1.7.
- **Critère d'acceptation :** **validé par les critères d'installabilité vérifiés dans le
  navigateur** (Browser pane) : `manifest.json` accessible et valide (3 icônes), service worker
  actif (voir 7.2) — les deux conditions que Chrome vérifie pour proposer l'installation. **Non
  vérifié avec le bandeau d'installation Chrome lui-même ni sur un appareil Android réel** (voir
  7.3, qui reste ⬜).

### 7.2 — Service worker
- **Statut :** ✅ Fait (2026-07-27)
- **Contenu :** `client/public/service-worker.js` — JS brut (pas TypeScript : fichier autonome
  sans import, pas besoin de la chaîne tsc+esbuild du reste du client). Précache uniquement la
  "coquille" statique (`/`, `/index.html`, `/bundle.js`, `/manifest.json`, les 3 icônes) —
  **jamais** `/api/*` ni le WebSocket du jeu (le `fetch` handler ignore toute requête dont le
  chemin n'est pas dans la liste précachée, laissant passer le reste directement au réseau) :
  une liste de salons périmée ou une partie qui semblerait tourner hors ligne serait pire que
  l'absence de cache. Cache versionné (`angulio-shell-v1`), les anciennes versions purgées à
  l'activation. Enregistré depuis `client/src/pwa.ts` (`registerServiceWorker`, appelé dans
  `index.ts`) en best-effort — un navigateur incompatible ou un échec d'enregistrement
  n'empêche jamais le jeu de fonctionner normalement, même principe que le reste du projet
  (comptes/auth additifs, jamais bloquants).
- **Dépendances :** 7.1.
- **Critère d'acceptation :** **validé manuellement dans le navigateur** (Browser pane) :
  service worker enregistré et `activated`, les 7 fichiers de la coquille confirmés présents
  dans le cache (`caches.open('angulio-shell-v1').keys()`), `caches.match('/index.html')` et
  `caches.match('/bundle.js')` renvoient tous deux une réponse `ok`. Un test hors-ligne "réel"
  (bascule réseau du navigateur) n'a pas pu être déclenché avec les outils disponibles dans
  cette session — la vérification par le contenu du cache est la preuve indirecte que le
  scénario hors-ligne fonctionnerait (c'est exactement ce que `fetch` sert en priorité).

### 7.3 — Validation d'installation sur Android
- **Statut :** ⬜ À faire — **nécessite un appareil Android réel, indisponible dans cet
  environnement** (même limite que le Lot 8.1, qui attend le Wyse physique).
- **Contenu :** test réel sur un appareil Android (Chrome) : installation, lancement plein
  écran, absence de barre de navigateur.
- **Dépendances :** 7.1, 7.2.
- **Critère d'acceptation :** l'app installée se comporte visuellement comme une app native. Les
  deux prérequis techniques (manifeste valide, service worker actif) sont déjà validés (7.1/7.2)
  — reste seulement la confirmation visuelle sur un vrai téléphone.

### 7.4 — Wrapper Play Store (TWA/Bubblewrap) — différé
- **Statut :** ⏸️ Différé
- **Contenu :** publication sur le Play Store si une présence sur le store est souhaitée.
- **Dépendances :** 7.3.
- **Critère d'acceptation :** à définir si la décision de publier sur le store est prise.

### 7.5 — Validation des limitations iOS Safari — différé
- **Statut :** ⏸️ Différé
- **Contenu :** vérifier le comportement PWA sur iOS si le support iOS devient prioritaire.
- **Dépendances :** 7.3.
- **Critère d'acceptation :** à définir si le support iOS devient une priorité affichée.

---

## Lot 8 — Infrastructure & déploiement

Objectif : passer du développement local à un serveur de production accessible depuis
Internet (§7).

### 8.1 — Mise en service du Wyse 5070
- **Statut :** ⬜ À faire
- **Contenu :** confirmer la référence exacte du modèle (§8.2), installation de l'OS,
  accès SSH.
- **Dépendances :** aucune (peut avancer en parallèle du développement).
- **Critère d'acceptation :** machine accessible en SSH depuis le réseau local.

### 8.2 — Configuration réseau (NAT/PAT)
- **Statut :** ⬜ À faire
- **Contenu :** redirection de port sur la box Bouygue vers le Wyse, IP fixe côté box.
- **Dépendances :** 8.1.
- **Critère d'acceptation :** un port ouvert sur le Wyse est joignable depuis l'extérieur
  du réseau domestique (test depuis une connexion 4G par exemple).

### 8.3 — DuckDNS
- **Statut :** 🔶 En cours (2026-07-26) — script écrit, reste à créer le compte/sous-domaine
  DuckDNS et à exécuter sur le Wyse réel pour valider.
- **Contenu :** `install.sh` (voir 8.4) écrit un service + timer systemd
  (`duckdns-update.service`/`.timer`) qui appelle l'API DuckDNS toutes les 5 minutes — filet
  de sécurité si l'IP publique change, même si elle est censée être fixe côté box.
  L'enregistrement du sous-domaine lui-même (compte DuckDNS, choix du nom) reste une action
  manuelle sur duckdns.org, à renseigner ensuite dans les variables `DUCKDNS_SUBDOMAIN`/
  `DUCKDNS_TOKEN` en tête d'`install.sh`.
- **Dépendances :** 8.2.
- **Critère d'acceptation :** ⬜ pas encore validé en conditions réelles — le nom de domaine
  DuckDNS doit résoudre vers l'IP publique actuelle et le timer doit tourner sur le Wyse.

### 8.4 — Script install.sh
- **Statut :** 🔶 En cours (mis à jour 2026-07-27) — script étendu (PostgreSQL, voir
  ci-dessous), re-vérifié syntaxiquement (`bash -n`), **toujours jamais exécuté sur une
  machine réelle** (nécessite le Wyse physique, 8.1).
- **Contenu :** [`install.sh`](install.sh) à la racine du dépôt — bootstrap complet et
  idempotent (relançable pour déployer une mise à jour) : dépendances système (`apt`),
  Node.js 20.x (dépôt NodeSource), clonage/mise à jour du code + `npm ci && npm run build`,
  utilisateur système dédié (pas de privilèges superflus), service systemd
  `angulio.service` (`Restart=on-failure`, activé au boot), pare-feu `ufw` (SSH + 80/443
  uniquement — le port du serveur de jeu n'est **jamais** exposé directement, tout passe par
  le reverse proxy), Caddy en reverse proxy + HTTPS automatique (voir 8.5), timer DuckDNS
  (voir 8.3).
- **Extension du 2026-07-27 (PostgreSQL, Lot 3 étant désormais fait) :** installe le paquet
  `postgresql`, crée le rôle applicatif et la base (`angulio`/`angulio_prod`, mot de passe
  généré via `openssl rand -hex 24` — uniquement au **premier** déploiement, jamais régénéré
  sur un run suivant pour ne pas casser une config existante : `server/.env` sert de marqueur
  "déjà configuré"), génère `server/.env` (`DATABASE_URL` + `ADMIN_PASSWORD_HASH`, ce dernier
  haché via le script `server/scripts/hashPassword.mjs` du Lot 5.1 à partir d'une variable
  `ADMIN_PASSWORD` renseignée en tête de script comme `DUCKDNS_TOKEN`), puis joue les
  migrations (`npm run migrate:up`) à **chaque** déploiement (idempotent côté
  node-pg-migrate, contrairement à la création du rôle/de la base). Referme ainsi l'écart
  explicitement noté au Lot 3 ("pas encore de service PostgreSQL dans install.sh").
- **Dépendances :** 8.1.
- **Critère d'acceptation :** ⬜ pas encore validé — exécuter `install.sh` sur une machine
  Ubuntu fraîche doit amener à un serveur fonctionnel (comptes joueurs et interface admin
  compris) sans étape manuelle supplémentaire (hors configuration réseau §8.2, hors
  renseignement des identifiants DuckDNS/du mot de passe admin en tête du script). À
  confirmer sur le Wyse réel, une fois 8.1 fait.

### 8.5 — Reverse proxy / TLS
- **Statut :** 🔶 En cours (2026-07-26) — configuré dans `install.sh` (8.4), pas encore
  validé en conditions réelles.
- **Contenu :** Caddy (choisi plutôt que Nginx : HTTPS automatique via Let's Encrypt sans
  configuration manuelle de certificat, `reverse_proxy` gère nativement l'upgrade
  WebSocket vers le serveur de jeu — aucune directive spéciale requise pour le WSS).
- **Dépendances :** 8.3, 8.4.
- **Critère d'acceptation :** ⬜ pas encore validé — le jeu doit être accessible en
  HTTPS/WSS depuis un navigateur externe, certificat valide, une fois déployé sur le Wyse
  réel avec le NAT (8.2) et le sous-domaine DuckDNS (8.3) en place.

### 8.6 — Monitoring basique
- **Statut :** 🔶 En cours (2026-07-27) — script écrit et vérifié syntaxiquement, **jamais
  exécuté sur une machine réelle** (même limite que le reste du Lot 8, 8.1).
- **Contenu :** logs applicatifs déjà persistés via `journalctl` une fois déployé (rien à
  ajouter : `logEvent` écrit sur stdout depuis le Lot "logs structurés serveur", capturé tel
  quel par systemd — voir Journal du 2026-07-26). **Alerte** (`install.sh`) : plateforme
  choisie **ntfy.sh** — service de notification push public, **aucun compte requis** (juste un
  nom de sujet secret, `ALERT_NTFY_TOPIC`), cohérent avec la contrainte de ne pas créer de
  compte tiers à la place de l'utilisateur (comme pour Ko-fi, Lot 6.1) ; alternative à un vrai
  MTA (`postfix`/SMTP), plus lourd à configurer et nécessitant des identifiants que je n'ai
  pas. Optionnel : `ALERT_NTFY_TOPIC` vide désactive proprement l'alerte (le reste du script
  fonctionne pareil), cohérent avec le reste des fonctionnalités additives du projet
  (comptes, admin — jamais bloquantes si non configurées). Mécanisme : `OnFailure=` (dans
  `[Unit]` de `angulio.service`) déclenché seulement quand systemd renonce à redémarrer après
  plusieurs échecs rapprochés (`StartLimitIntervalSec=60`/`StartLimitBurst=5`) — un redémarrage
  isolé, déjà absorbé par `Restart=on-failure`, ne déclenche donc pas d'alerte ; un vrai
  crash-loop, si.
- **Dépendances :** 8.4.
- **Critère d'acceptation :** ⬜ pas encore validé en conditions réelles — nécessite de
  déclencher un vrai échec du service sur une machine réelle pour confirmer la réception de la
  notification (bloqué sur le Wyse physique, 8.1, comme le reste du Lot 8). La logique de
  génération des fichiers systemd (avec/sans `OnFailure=`) a été vérifiée par un test isolé du
  bloc de substitution de variables (rendu correct dans les deux cas), en plus de `bash -n` sur
  le script complet.

---

## Lot 9 — Documentation & ouverture communautaire de l'API de modding

**Phase 2** — ne démarre qu'une fois le MVP stable et le Lot 4 (validation API) concluant.

### 9.1 — Documentation publique de l'API de modding
- **Statut :** ⬜ À faire
- **Contenu :** guide développeur, référence des hooks, exemples (dont le mode Vanilla et
  le second mode comme cas d'école).
- **Dépendances :** Lot 4.5.

### 9.2 — Politique de licence des mods tiers
- **Statut :** ⬜ À faire
- **Contenu :** trancher AGPL obligatoire vs. libre pour les mods communautaires (§6,
  §8.2).
- **Dépendances :** aucune, mais doit précéder 9.3.

### 9.3 — Politique de review/validation des mods soumis
- **Statut :** ⬜ À faire
- **Contenu :** processus de revue manuelle avant activation d'un mod tiers (§3.2).
- **Dépendances :** 9.2.

### 9.4 — Processus de soumission communautaire
- **Statut :** ⬜ À faire
- **Contenu :** dépôt de mod via PR GitHub, ou upload via l'interface admin étendue (Lot 5.5).
- **Dépendances :** 9.3.

### 9.5 — Sandboxing des mods tiers
- **Statut :** ⬜ À faire
- **Contenu :** isolation mémoire/CPU du code non fiable (Workers séparés ou conteneurs
  légers, §3.2) — nécessaire dès que des mods non revus par toi tournent en production.
- **Dépendances :** 9.4.
- **Critère d'acceptation :** un mod malveillant ou buggé (boucle infinie, fuite mémoire)
  ne peut pas affecter le reste du serveur (autres salons, process principal).

---

## Lot 10 — Scaling multi-Wyse

**Phase 2** — ne démarre qu'en cas de besoin réel de capacité supplémentaire.

### 10.1 — Service de lobby/matchmaking centralisé
- **Statut :** ⬜ À faire
- **Contenu :** service léger sur le Wyse master redirigeant chaque joueur vers le Wyse
  hébergeant le salon choisi (§4.5).
- **Dépendances :** Lot 2, Lot 8.

### 10.2 — Connexion des Wyse secondaires à la base PostgreSQL du master
- **Statut :** ⬜ À faire
- **Contenu :** les nœuds secondaires se connectent à la base du master en tant que
  clients réseau (pas de synchronisation bidirectionnelle, §4.5).
- **Dépendances :** 10.1.

### 10.3 — Répartition des salons entre machines
- **Statut :** ⬜ À faire
- **Contenu :** logique d'affectation d'un nouveau salon à une machine disponible.
- **Dépendances :** 10.1.

### 10.4 — Extension du script install.sh pour nœud secondaire
- **Statut :** ⬜ À faire
- **Contenu :** variante du Lot 8.4 sans installation de PostgreSQL local (connexion au
  master à la place).
- **Dépendances :** Lot 8.4, 10.2.

### 10.5 — Tests de charge multi-nœuds
- **Statut :** ⬜ À faire
- **Contenu :** validation qu'ajouter un Wyse ajoute bien de la capacité sans dégrader
  l'existant.
- **Dépendances :** 10.1 à 10.4.

---

## Lot 11 — Optimisation bas niveau CPU/GPU (spéculatif)

**Phase 3 — ne démarre que si un besoin réel et mesuré l'exige.** Ajouté à la demande de
l'utilisateur (2026-07-26, suite à une question sur la gestion CPU/GPU des salons) pour garder
trace des options disponibles *avant* d'en avoir besoin, pas pour les implémenter maintenant.
**Aucune de ces pistes n'est justifiée à l'échelle actuelle** : le test de charge du Lot 1.8
montrait une boucle de tick très stable même à 350 entités/50 joueurs sur un seul thread Node,
et le vrai goulot d'étranglement mesuré jusqu'ici a toujours été le réseau (bande passante),
pas le CPU/GPU. Chaque option ci-dessous est une alternative indépendante à évaluer *le jour où
un goulot d'étranglement CPU/GPU réel est mesuré*, pas une suite de sous-lots à dérouler dans
l'ordre — le choix dépendra de la nature précise du goulot constaté à ce moment-là.

### 11.1 — Parallélisme CPU entre salons (`worker_threads`)
- **Statut :** ⬜ Non commencé (spéculatif)
- **Contenu :** aujourd'hui, toutes les `Room` d'un même process tournent sur le thread
  principal Node (mono-thread pour le JS) — plusieurs salons partagent donc le même cœur CPU
  au lieu d'être parallélisés. Faire tourner chaque `Room` (ou un groupe de salons) dans son
  propre `worker_thread` Node permettrait un vrai parallélisme CPU entre salons sur les cœurs
  disponibles de la machine.
- **Compromis :** complexité du passage de messages entre threads (les `Entity`/`World` ne
  peuvent pas être partagés par référence entre threads ; il faut sérialiser l'état à chaque
  tick ou utiliser `SharedArrayBuffer` pour les données chaudes) ; rejoint la réflexion déjà
  amorcée au Lot 2.5 (isolation) et nécessaire de toute façon pour le Lot 9.5 (sandboxing des
  mods tiers non fiables, Phase 2).
- **Dépendances :** un besoin mesuré (plusieurs salons chargés simultanément saturant un cœur).

### 11.2 — Cœur de simulation réécrit en langage natif (Rust/C++)
- **Contenu :** si la boucle de tick JS elle-même devenait le goulot (pas juste son
  parallélisme), réécrire le cœur de simulation (partitionnement spatial, détection de
  collision, intégration des positions) en Rust ou C++, exposé à Node via un addon natif
  (`napi-rs` pour Rust, N-API pour C++) ou compilé en WebAssembly.
- **Compromis :** gain réel sur du calcul intensif pur, mais alourdit largement la chaîne de
  build/déploiement (toolchain Rust/C++ sur le Wyse ou binaires précompilés par
  architecture) et casse la promesse actuelle "un mod = du TypeScript" (Lot 1.5/3.3) si le
  cœur du moteur cesse d'être lisible/modifiable en JS par un contributeur du Lot 9.
- **Dépendances :** un besoin mesuré, et probablement 11.1 déjà insuffisant seul.

### 11.3 — Calcul massivement parallèle sur GPU (serveur)
- **Contenu :** pour un nombre d'entités bien plus grand qu'aujourd'hui (dizaines de milliers),
  des opérations comme le broad-phase de collision pourraient théoriquement être parallélisées
  sur GPU (CUDA/OpenCL via un addon C++, ou compute shaders WebGPU côté Node).
- **Compromis :** complexité très élevée pour un gain qui ne se justifie qu'à une échelle très
  supérieure à celle visée par ce projet (§4.1 du cahier des charges : 10-50 joueurs) ; demande
  aussi un GPU dédié sur le Wyse, absent du matériel prévu (§8.2). **Piste la moins probable
  d'être un jour nécessaire**, listée uniquement parce que l'utilisateur a explicitement
  demandé si c'était possible.
- **Dépendances :** un changement d'échelle radical du projet, pas seulement une optimisation.

### 11.4 — Rendu client bas niveau (WebGL/WebGPU au lieu de Canvas 2D)
- **Contenu :** remplacer le rendu Canvas 2D (Lot 1.7) par WebGL/WebGPU donnerait un contrôle
  explicite du pipeline GPU côté client (rendu instancié de milliers de cercles en un seul
  appel de dessin, shaders personnalisés) plutôt que de dépendre de l'accélération matérielle
  interne que le navigateur applique déjà de lui-même à Canvas 2D.
- **Compromis :** les points chauds identifiés et corrigés en pratique (voir journal du
  2026-07-26, "Interpolation d'affichage côté client") étaient algorithmiques (nombre d'appels
  de dessin, absence d'interpolation), pas liés à Canvas 2D lui-même — un passage à WebGL ne
  se justifierait qu'avec un nombre de particules visibles bien plus élevé qu'aujourd'hui.
- **Dépendances :** un nombre de particules visibles simultanément mesuré comme problématique
  malgré l'interest management (Lot 1.8) et le dessin groupé (voir journal).

---

## Journal des décisions et avancées

*Ajoute une ligne datée à chaque décision technique prise en cours de route, ou à chaque
Lot/Sous-Lot significatif terminé. Les entrées les plus récentes en haut.*

| Date | Entrée |
|---|---|
| 2026-07-27 | **Nouveau système de types de pellets, densité doublée (Lot 1.6, demande utilisateur).** `food.massMin`/`massMax`/`massSkewExponent` (distribution continue, v0.2) remplacés par `food.pelletTypes` : 8 types nommés (Vert=1, Bleu=2, Jaune=3, Violet=4, Rouge=5, Orange=6, Rose=7, Multicolor=12) avec un poids de spawn propre à Vanilla (28/22/18/13/10/5/3/1, concentré sur les petites masses) et à Folie (10/10/10/10/15/15/15/15, plus généreux sur les grosses masses) ; `hardcore.json` aligné sur `vanilla.json` (nourriture toujours identique à Vanilla). Densité doublée : Vanilla 15→30/1000px² (~6750 particules cible sur sa carte), Folie 30→60/1000px² (~24000). **Aucun changement de protocole réseau** : la masse déjà transmise encode le type, le client déduit la couleur (`client/src/render.ts`, nouvelle fonction pure `foodColorForMass`, testée unitairement) — nourriture toujours dessinée en chemins groupés par couleur (jusqu'à 7 couleurs pleines + le pellet Multicolor, rare, dessiné à part avec un dégradé radial). `randomFoodMass` (physics.ts) passe d'un tirage continu biaisé à un tirage pondéré discret parmi `pelletTypes`. 5 tests remplacés/ajoutés côté serveur (dont une vérification statistique du respect du poids relatif) et 3 côté client. **Validé en conditions réelles** avec un bot WebSocket direct (pas seulement des tests unitaires) : les 8 masses configurées sont bien spawnées dans les deux modes, dans l'ordre de fréquence exact attendu par les poids configurés, et la densité doublée est confirmée (jusqu'à 741 particules de nourriture visibles simultanément par un client en Vanilla). metriques.md passe en v0.5. |
| 2026-07-27 | **Gap CI refermé (Lot 0.6) : PostgreSQL en CI GitHub Actions.** Noté sans être traité depuis la clôture du Lot 3 ("pas encore de service Postgres en CI, tests skip silencieusement") — devenu plus significatif après les Lots 5/6 (beaucoup plus de tests contre Postgres qu'à l'époque). `.github/workflows/ci.yml` gagne un service `postgres:18` (identifiants + `DATABASE_URL` en variable d'environnement du job, aucun fichier `server/.env`) et une étape `npm run migrate:up --workspace=server` avant `npm test`. **Vérifié manuellement en local avant d'ajouter le service** (sans Docker disponible dans cet environnement pour une simulation complète) : `server/.env` renommé temporairement, `DATABASE_URL` réexporté à la main, `migrate:up` fonctionne identiquement (lit `process.env.DATABASE_URL` directement, ne plante pas sur le fichier `--envPath` manquant) — reste à confirmer visuellement sur un vrai run GitHub Actions au prochain push. |
| 2026-07-27 | **Lot 8.6 (monitoring basique) attaqué : alerte ntfy.sh optionnelle.** Logs déjà couverts sans rien ajouter (`journalctl`, acquis depuis les logs structurés du Lot 1.8/2). Pour l'alerte, plateforme choisie **ntfy.sh** — même contrainte que Ko-fi (Lot 6.1) : pas de création de compte tiers à ma place, donc un service qui fonctionne par simple nom de sujet plutôt qu'un MTA/SMTP nécessitant des identifiants inexistants. `ALERT_NTFY_TOPIC` optionnel dans `install.sh` : vide, aucune alerte configurée (dégradation gracieuse, comme `accounts`/`admin`) ; renseigné, écrit un service `angulio-alert.service` (oneshot, `curl` vers `ntfy.sh/<sujet>`) déclenché via `OnFailure=` sur `angulio.service`, lui-même limité par `StartLimitIntervalSec=60`/`StartLimitBurst=5` pour ne pas alerter sur un simple redémarrage isolé (déjà absorbé par `Restart=on-failure`), seulement sur un vrai crash-loop. Logique de génération des deux variantes du fichier systemd (avec/sans `OnFailure=`) vérifiée par un test isolé du bloc de substitution, en plus de `bash -n` sur le script complet — toujours pas exécuté sur une machine réelle (Wyse physique, 8.1, indisponible). |
| 2026-07-27 | **Lot 8.4 étendu : `install.sh` intègre désormais PostgreSQL.** Point resté ouvert depuis la clôture du Lot 3 ("pas encore de service PostgreSQL dans install.sh") — traité maintenant que les Lots 5/6/7 sont faits et que le script est de toute façon en train d'être retouché. Ajouts : paquet `postgresql`, création idempotente du rôle/de la base applicatifs (mot de passe généré une seule fois, au premier déploiement — `server/.env` sert de marqueur pour ne jamais régénérer les identifiants d'un déploiement existant), génération de `server/.env` (`DATABASE_URL` + `ADMIN_PASSWORD_HASH`, ce dernier haché via `hashPassword.mjs` du Lot 5.1 à partir d'une nouvelle variable `ADMIN_PASSWORD` en tête de script, même convention que `DUCKDNS_TOKEN`), puis `npm run migrate:up` à chaque déploiement. Toujours seulement vérifié par `bash -n` (`shellcheck` non disponible sur cette machine) — l'exécution réelle reste bloquée sur le Wyse physique (8.1), comme le reste du Lot 8. |
| 2026-07-27 | **Lot 7.1/7.2 faits (PWA) : manifeste, icônes, service worker.** `manifest.json` + 3 icônes PNG (192/512/512 maskable) générées via un `<canvas>` dans le navigateur plutôt que d'ajouter une dépendance de traitement d'image au projet (`sharp`/`canvas` npm) — deux cercles qui se chevauchent, évoquant le gameplay (absorption de cellules), place-holder de branding assumé. Service worker (`client/public/service-worker.js`, JS brut sans build) précache uniquement la coquille statique (page, bundle, manifeste, icônes) — **jamais** `/api/*` ni le WebSocket du jeu, pour ne jamais servir une liste de salons ou une partie périmées hors ligne. **Validé dans le navigateur** (Browser pane) : manifeste valide avec 3 icônes, service worker `activated`, les 7 fichiers de la coquille confirmés en cache. **7.3 (validation sur un vrai appareil Android) reste ⬜** : nécessite un appareil physique, indisponible dans cet environnement — même limite que le Lot 8.1 (Wyse physique). 7.4/7.5 restent différés comme prévu. |
| 2026-07-27 | **Lots 5 et 6 clos : interface d'administration et statut Premium/dons.** `admin/` devient une vraie app (le placeholder du Lot 0 est remplacé) : login par mot de passe unique haché (`ADMIN_PASSWORD_HASH`, argon2, script `hashPassword.mjs` pour le générer), recherche/consultation/édition de compte (niveau, XP, cosmétiques, Premium, bannissement) via un patch unique `PATCH /api/admin/players/:id`, servie sous `/admin/*` par le même process de jeu (répertoire statique distinct du client joueur). **Bug trouvé et corrigé en testant manuellement dans le navigateur** (pas seulement en tests automatisés) : `/admin` sans slash final + un script chargé en chemin relatif (`./bundle.js`) résolvait vers le bundle du **client joueur** au lieu de celui de l'admin (résolution d'URL relative standard) — corrigé par un chemin absolu. Bannissement : nouvelle colonne `banned`, vérifiée après le mot de passe à la connexion (ne fuit rien à qui ne le connaît pas), et révocation immédiate des sessions actives du compte banni (nouveau `SessionStore.revokeSessionsForAccount`) plutôt que d'attendre une expiration qui n'existe pas. **Lot 6** : plateforme de don choisie (**Ko-fi**, 0% commission, pas de société requise, don libre sans palier) — le compte réel reste à créer manuellement par l'utilisateur (hors de portée d'un agent), `DONATION_URL` est un espace réservé documenté dans `client/src/support.ts`. Page Soutien ajoutée au lobby (panneau glassmorphism, même style que le profil). Création de salon restreinte aux comptes Premium (`isPremium`, cahier des charges §5.3) : 403 côté serveur pour un invité/compte standard, formulaire remplacé côté client par un message explicatif tant que le compte connu n'est pas Premium — avec dégradation gracieuse existante (sans base de données configurée, la restriction ne s'applique pas, comme le reste de `GameServerOptions.accounts`). 15 nouveaux tests serveur (dont un bloc entier de tests réseau "avec comptes joueurs" contre un vrai PostgreSQL), 189 tests passants au total. **Validé manuellement de bout en bout dans le navigateur** (Browser pane) pour l'ensemble du circuit : connexion admin → recherche → activation Premium d'un compte de test → reconnexion côté client → formulaire de création de salon débloqué → salon créé et rejoint ; bannissement testé séparément (connexion refusée ensuite, 401). |
| 2026-07-27 | **Lot 4 clos : mode Hardcore, second mode aux mécaniques structurellement nouvelles.** Choisi plutôt que Précision/Sniper (l'autre recommandation) après avoir remarqué que ce dernier, tel que décrit, se réduit à `food.density → ~0` — purement paramétrique, n'aurait rien prouvé de plus qu'un troisième Folie. Hardcore introduit : (1) un multiplicateur de masse gagnée en mangeant un autre joueur (×10 par défaut), (2) la perte totale de la progression du compte à la mort. Implémenté par **composition** plutôt que duplication : `createHardcoreMod` enveloppe `createParametricMod` et ne réécrit que `onCollision` et un nouveau hook — un patron de mod non anticipé avant ce Lot, à garder en tête pour la Phase 2 (modding communautaire, Lot 9). **Seul ajustement à l'API de hooks** : `GameMod.transformScoreForAccount?` (voir 4.5) — tout le reste (onCollision générique, découplage réseau/mod déjà acquis au Lot 2) a suffi sans toucher à `engine/`. 8 nouveaux tests + 1 test existant mis à jour (`listAvailableModIds` liste désormais 3 modes). Validé manuellement : salon Hardcore créé/rejoint depuis le lobby (aucun changement client nécessaire), joueur authentifié confirmé en base (`psql`) recevant 0 crédit après une vie à 45-50 de masse, contre 50 XP pour le même scénario en Vanilla (non-régression). |
| 2026-07-27 | **Flake de test pré-existant repéré, non lié aux changements de la session** : `server/src/net/server.test.ts` ("diffuse l'état du monde... avec le morceau du joueur") a échoué une fois sur une exécution complète (`entities.some(e => e.x===0 && e.y===0)` côté "son propre morceau"), puis est repassé au vert de façon reproductible sur toutes les exécutions suivantes. Cause probable : le `RoomManager` de test démarre un vrai timer de tick (20Hz) dès la création du salon, qui peut broadcaster un premier `state` juste avant que le test n'ait fini d'attacher ses assertions sur le message capturé — timing non déterministe entre un vrai timer et l'event loop du test, pas un bug fonctionnel du code de production. Non traité dans l'immédiat (rare, non reproductible à la demande) ; à stabiliser si ça devient gênant en CI (ex. `vi.useFakeTimers()` sur ce test précis, ou une assertion moins sensible à l'ordre des messages `state` reçus). |
| 2026-07-26 | **Refonte du lobby** (demande utilisateur : tenir sans scroller, thème clair fixe façon "labo premium", vraie glassmorphism, arène transparente). Thème sombre adaptatif (`prefers-color-scheme: dark`) **retiré** du lobby — clair fixe, décision délibérée, pas une régression. `#lobbyOverlay` passe d'un fond opaque à un voile translucide (`rgba(238,238,240,0.4)`, sans flou propre, déjà porté par `#lobbyPanel`) : laisse apparaître l'arène (grille) derrière le verre, vraie glassmorphism plutôt qu'un fond plein. Fond "labo premium" (dégradés + grille de points) déplacé du seul `#lobbyOverlay` vers `html`/`body`, partagé par toute l'appli. **Arène transparente** (`render.ts`) : `ctx.clearRect` remplace le `fillRect` blanc opaque ; couleur de grille recalibrée en hairline translucide (`rgba(17,17,19,0.1)`) pour rester visible sur le nouveau fond clair. **Bug trouvé en cours de route** : `#statsPanel`/`#hud` (`#gameOverlay`) étaient toujours présents dans le DOM même hors partie (juste masqués visuellement par l'ancien fond opaque du lobby) — devenus visibles par transparence une fois le lobby translucide. Corrigé : `#gameOverlay` masqué par défaut, affiché seulement à l'entrée en partie (`index.ts`, `enterGame`/`onClose`). **Mise en page** : lobby restructuré en deux colonnes (`.lobby-columns`, panneau élargi à 720px, repli une colonne sous 640px) et espacements resserrés — tient désormais dans un viewport standard (~720px de haut) sans avoir à scroller, alors que l'ancienne colonne unique le nécessitait. **Bug rapporté séparément et corrigé au passage** : le champ "Nom du salon" (`<input>` brut, sans le wrapper `.field`/`.field-row` qui porte la marge ailleurs) touchait directement la ligne mode/Privé juste en dessous — marge dédiée ajoutée. |
| 2026-07-26 | **Lot 3 clos (3.2-3.6) : comptes joueurs, sessions, modèle complet, stats, profil.** Argon2 retenu (§5.1, testé viable sur cette machine avant adoption) pour le hachage, sessions en mémoire par token opaque (pas de JWT, cohérent avec le reste du projet), transmises à la connexion WebSocket via `?token=` (les navigateurs n'autorisent pas d'en-têtes personnalisés sur `WebSocket`). **Une partie en invité reste possible à tout moment** — l'authentification est une couche additive, jamais un prérequis pour jouer. Niveau/XP volontairement provisoires (§5.2 ne tranche pas la formule) : XP = masse maximale atteinte pendant la partie, niveau en racine carrée de l'XP total (`levels.ts`) — le seul système de score disponible à ce jour. Stats écrites à la mort **et** à la déconnexion (une coupure réseau est aussi une "fin de partie"), en best-effort asynchrone pour ne jamais bloquer la diffusion réseau. 24 nouveaux tests (dont 16 contre un vrai PostgreSQL local, `describe.skipIf(!DATABASE_URL)` pour rester silencieux sans base configurée — **pas encore de service Postgres en CI**, à ajouter si ce garde-fou devient limitant). **Validé manuellement de bout en bout** dans le navigateur : inscription → jointure de salon avec token → partie jouée → déconnexion → XP/meilleur score confirmés en base (`psql`) et ré-affichés dans l'écran de profil après reconnexion. |
| 2026-07-26 | **Zoom recalibré, unités d'affichage m/s(²), retrait du compteur de morceaux** (demandes utilisateur). **Zoom** (`render.ts`) : `BASE_SCALE` passe de 1 à **1.8** (`MAX_SCALE` 2→2.2 en conséquence) — le joueur démarre désormais visuellement zoomé par rapport à la taille "réelle" de son morceau (meilleur contrôle en début de partie), la sensation de dézoom progressif à mesure que la masse grossit reste la même courbe (`√(masse/référence)`), juste recalibrée à un niveau de zoom de départ plus élevé. 2 tests (`render.test.ts`) mis à jour pour référencer `BASE_SCALE` exporté plutôt qu'une valeur `1` en dur. **Unités** (`index.ts`) : Vitesse/Accélération affichées en `m/s`/`m/s²` (facteur cosmétique `MAP_UNITS_TO_METERS = 0.01`, affichage uniquement — la simulation ne modélise aucune unité SI, non représentatif tel que demandé, juste un repère plus parlant que l'unité de carte abstraite). **HUD** : retrait du texte `"X morceau(x) en jeu"` ; ne restent que le message mort/respawn et, le cas échéant, le code d'invitation. |
| 2026-07-26 | **Bug rapporté "l'accélération ne s'affiche pas" — diagnostiqué comme un problème de cache navigateur, pas un bug de code.** Investigation : un client `ws` de test direct confirme que le serveur envoie bien `self.accelerationPerSec2` à chaque tick (`net/server.ts`), et un `console.log` temporaire dans `index.ts` confirme que le client le reçoit et l'affiche correctement après un chargement de page réellement frais. Cause la plus probable : `server/src/net/server.ts` (`serveStatic`) ne posait **aucun** en-tête de cache sur les fichiers statiques (`bundle.js` compris) — un simple rechargement (pas un hard-refresh) peut donc resservir une version en cache du bundle client, y compris une version antérieure à un correctif, donnant l'impression qu'"il ne marche pas" alors que le code est correct. **Correctif** : `Cache-Control: no-cache` ajouté à toutes les réponses statiques (revalidation systématique, pas de `max-age` puisque les fichiers ne sont pas versionnés par hash de contenu dans l'URL). Point de vigilance pour la suite : envisager un nom de fichier hashé par contenu (Lot 8, si ce type de rapport se reproduit malgré le correctif). |
| 2026-07-26 | **Lot 3.1 fait : PostgreSQL + migrations.** PostgreSQL 18 installé par l'utilisateur (service actif, `localhost:5432`) ; rôle applicatif dédié `angulio` + base `angulio_dev` créés (pas d'usage du rôle `postgres` par l'app). Outil retenu : **node-pg-migrate** (SQL-first, pas d'ORM) + `pg` comme driver — cohérent avec la préférence du projet pour des dépendances minimales plutôt que des frameworks lourds. Schéma initial volontairement minimal (table `players` : `id`/`pseudo` unique/`created_at`) — juste de quoi prouver le pipeline ; le détail du compte joueur (3.4) et l'authentification (3.2) viendront dans leurs propres migrations. Cycle `migrate:up`/`down`/`up` validé en conditions réelles contre la base de dev. `server/.env` (gitignored, `DATABASE_URL`) + `server/.env.example` versionné. |
| 2026-07-26 | **Vérification visuelle du panneau de stats + écran F3** (repoussée depuis l'entrée précédente, page de test alors hors du champ de vision de l'utilisateur). Confirmé dans un vrai navigateur : panneau en haut à gauche (Pseudo/Guilde/Masse/Vitesse/Accélération) et écran F3 (FPS, ping, GPU, système, réseau) tous deux fonctionnels avec des valeurs live correctes. **Correctif appliqué au passage** : le panneau de stats utilisait les variables CSS partagées avec le lobby (`--glass`/`--ink`), qui basculent en sombre via `prefers-color-scheme` — or la demande explicite était un panneau **blanc** en toute circonstance (façon Apple), pas adaptatif. `#statsPanel` a désormais ses propres valeurs fixes (blanc translucide), indépendantes du thème système ; le lobby et l'écran F3 gardent leur comportement adaptatif existant, non concernés par la demande. |
| 2026-07-26 | **Panneau de stats en jeu + écran de debug F3** (demande utilisateur, hors roadmap initiale). Panneau glassmorphism en haut à gauche (Pseudo/Guilde/Masse/Vitesse/Accélération) — **"Guilde" est un espace réservé statique ("—")** : aucun système de guilde n'existe dans le projet à ce jour, affiché tel quel plutôt qu'omis, en attendant qu'une vraie fonctionnalité soit conçue. "Vitesse" dérivée du déplacement réel entre deux snapshots bruts (`client/src/stats.ts`, `speedBetween`) plutôt que dupliquer les formules du mod (qui dépendent de l'intensité d'input courante, pas seulement de la masse). "Accélération" en revanche vient du serveur via un nouveau hook `GameMod.getAccelerationForMass` (délégué par `Room`) et un nouveau champ `WorldStateMessage.self`, réservé au destinataire du message (jamais partagé avec les autres clients) — garde la formule dans le mod plutôt que de la dupliquer côté client. Écran F3 (`client/src/debugOverlay.ts`) : FPS (moyenne glissante), latence réseau réelle (nouveau `ping`/`pong` dans le protocole), infos GPU (`WEBGL_debug_renderer_info`), système (cœurs CPU, mémoire si exposée par le navigateur, résolution), réseau (Network Information API si disponible) — tout en dégradation gracieuse (tiret plutôt que plantage) pour les API non standard absentes de certains navigateurs. 22 tests ajoutés (stats/debugOverlay/mod/room/server), protocole réseau vérifié de bout en bout avec un client `ws` réel (`self.accelerationPerSec2` correct, `pong` renvoie bien le `t` du `ping`). **Non vérifié visuellement dans un vrai rendu de frame** : la page de test tournait hors du champ de vision de l'utilisateur dans cette session, donc `requestAnimationFrame` restait en pause (comportement standard des navigateurs pour un document caché) — à confirmer visuellement par l'utilisateur. |
| 2026-07-26 | **Lot 2 clos** (2.4 reset automatique, 2.5 isolation). **2.4** : `resetSchedule.ts` (deux formes, `dailyAt`/`interval`), `Room.reset()` vide le monde et respawn chaque joueur connecté, `onReset` réutilise le message `died` côté réseau plutôt qu'un nouveau type de message. Validé aussi manuellement (serveur réel, intervalle 5s, HUD confirmant le cycle mort→respawn). **2.5** : plutôt que de supposer l'isolation, un test dédié (`roomIsolation.test.ts`) la mesure réellement — isolation d'état totale (confirmée), isolation CPU/timing **non garantie** (Node mono-thread : un tick à 80ms dans un salon fait chuter le rythme d'un autre salon de 50ms à ~80ms/tick). Sous-lot marqué fait sur la base d'une limite connue et documentée, avec le levier de correction identifié (Lot 11.1, `worker_threads`) plutôt que sur une promesse d'isolation totale non honnête. 126 tests passants. |
| 2026-07-26 | **Lot 11 ajouté** (optimisation bas niveau CPU/GPU, spéculatif Phase 3) suite à une question de l'utilisateur sur la gestion CPU/GPU des salons et la pertinence de descendre plus bas niveau (Rust/C++/GPU). Réponse actée : pas justifié aujourd'hui (boucle de tick très stable même à 350 entités/50 joueurs sur un seul thread, goulot mesuré jusqu'ici = réseau, pas CPU/GPU), mais options documentées pour plus tard : `worker_threads` par salon (parallélisme CPU réel, rejoint le besoin d'isolation du 2.5 et de sandboxing du 9.5), cœur de simulation réécrit en Rust/C++ (addon natif ou WASM, casse la promesse "un mod = du TypeScript"), calcul GPU serveur (CUDA/OpenCL/WebGPU, échelle bien supérieure à celle visée, la moins probable), rendu client WebGL/WebGPU (les points chauds réels identifiés ce jour étaient algorithmiques, pas liés à Canvas 2D). Aucune dépendance déclenchante autre qu'un besoin mesuré. |
| 2026-07-26 | **Logs structurés serveur** (`server/src/log.ts`, `logEvent`) à la demande de l'utilisateur, pour rendre le serveur facilement debuggable avant de continuer sur les lots suivants. Une ligne JSON par événement (`ts`, `event`, champs libres) sur stdout — capturée telle quelle par systemd/journalctl une fois déployé (`install.sh`, Lot 8.4), sans dépendance de logging ni fichier à gérer. Instrumenté : cycle de vie des salons (`room_created`, `room_removed`) dans `RoomManager`, et actions joueurs dans `net/server.ts` (`player_join`, `player_leave`, `player_died`, `player_split_requested` — un seul log par pression de la barre espace, pas un flot continu comme le seraient les `input` bruts à 20/s/joueur — `join_rejected`, `malformed_message`, `room_create_rejected`). 3 nouveaux tests (`log.test.ts`), validé manuellement (serveur réel + client `ws`, logs conformes sur stdout). |
| 2026-07-26 | **Interpolation d'affichage côté client** (repoussée depuis le 1.7, confirmée nécessaire par un retour utilisateur de lag perçu). Diagnostic : le serveur diffuse à 20 Hz fixe (`TICK_RATE_HZ`) alors que le rendu client tourne sans plafond sur `requestAnimationFrame` (60/120 Hz selon l'écran) — sans interpolation, chaque frame réaffichait la même position figée pendant ~50 ms puis sautait d'un coup, perçu comme du lag quel que soit le framerate d'affichage réel. `render.ts` gagne `interpolateEntities(previous, latest, t)` (fonction pure, 5 tests dédiés) ; `index.ts` conserve désormais les deux derniers snapshots reçus (au lieu du seul dernier) et interpole en fonction du temps réel écoulé depuis leur réception, caméra comprise (calculée sur les positions interpolées, pas les brutes, pour rester en phase avec le monde affiché). **Optimisation de dessin associée** : la nourriture (toutes de la même couleur) est désormais dessinée en un seul `Path2D`/`fill()` groupé au lieu d'un appel par particule — réduit fortement le coût CPU par frame sur une carte dense (jusqu'à quelques centaines de particules visibles même après l'interest management du Lot 1.8). Validé par 110 tests + test manuel réel dans le navigateur (mouvement, nourriture, aucune erreur console). |
| 2026-07-26 | **Refonte UI/UX du lobby** (demande utilisateur : rendre les tests agréables tout du long) : style "labo" neutre noir/blanc avec glassmorphism (fond flouté translucide, bordures fines, ombres diffuses), variables CSS thème clair/sombre (`prefers-color-scheme`). Portée volontairement limitée à l'écran de lobby (`client/public/index.html`) — l'interface de jeu (canvas + HUD) reste inchangée, sobre et fonctionnelle, comme demandé explicitement. |
| 2026-07-26 | **Durcissement de `RoomManager` avant exposition publique** (point signalé par l'utilisateur juste avant l'écriture d'`install.sh`) : `maxRooms` (défaut 100, `createRoom` lève une erreur au-delà) et suppression automatique des salons non permanents restés vides plus de `emptyRoomGraceMs` (défaut 10 min, vérifié toutes les 30s par un timer interne, invocable manuellement via `pruneEmptyRooms()` pour les tests). Le salon par défaut créé par `index.ts` est marqué `permanent: true` pour ne jamais être supprimé. **Lot 2.3 (salons privés) fait dans la foulée** : `inviteCode` (`randomUUID()`) généré à la création d'un salon privé, renvoyé uniquement au créateur. **Faille corrigée au passage** : un salon privé n'était protégé que par l'absence de listing — son id court et séquentiel restait devinable et suffisait à le rejoindre (`?roomId=1`, `2`…). `getManagedRoom` refuse désormais explicitement de résoudre un salon privé par son id brut, seul le code d'invitation y donne accès. Côté client : case "Privé" à la création, champ "Rejoindre via code", code affiché dans le HUD pendant la partie (le lobby où il est montré à la création disparaît dès l'entrée en jeu). Gestion ajoutée de la fermeture de connexion (`GameConnection.onClose`) pour ramener au lobby avec un message d'erreur au lieu de laisser le joueur bloqué sur un écran de jeu mort, en cas de code/salon invalide — nécessaire dès qu'un code se tape à la main (typo réaliste, contrairement au choix depuis une liste). 24 nouveaux tests (roomManager/server/net), validé manuellement dans le navigateur (salon privé créé et rejoint via code, id brut testé en Node direct — rejeté avec le code `4004` — code invalide affichant bien l'erreur). |
| 2026-07-26 | **`install.sh` écrit (Lot 8.3/8.4/8.5, anticipé avant le Lot 3)**, à la demande de l'utilisateur qui prévoit de déployer sur le Wyse maintenant plutôt que d'attendre le MVP complet. Bootstrap idempotent : dépendances système + Node.js 20.x, clonage/mise à jour du code + build, utilisateur système dédié, service systemd `angulio.service` (auto-démarrage), pare-feu `ufw` (SSH + 80/443 seulement — le port du jeu n'est jamais exposé directement), Caddy en reverse proxy avec HTTPS automatique (Let's Encrypt) sur le sous-domaine DuckDNS choisi par l'utilisateur, timer systemd de mise à jour DuckDNS. **Décision : PostgreSQL volontairement exclu** de ce script malgré l'énoncé d'origine du 8.4 — le Lot 3 (comptes joueurs) n'a pas encore commencé, rien dans le code ne l'utilise ; l'ajouter maintenant serait un service qui tourne pour rien. À étendre quand le Lot 3 démarrera. **Non exécuté sur le Wyse réel** (8.1, mise en service physique de la machine, pas encore fait) — seule une vérification de syntaxe (`bash -n`) a été faite sur la machine de dev ; les critères d'acceptation 8.3/8.4/8.5 restent donc ⬜ jusqu'à validation en conditions réelles. **Point signalé à l'utilisateur, non traité ici** : la création de salon (`POST /api/rooms`, Lot 2.2) n'a encore aucune limite ni nettoyage automatique — un salon créé reste en mémoire indéfiniment et l'endpoint n'est protégé par rien ; à traiter avant une exposition large sur DuckDNS (rejoint le 2.4/2.5 restants du Lot 2). |
| 2026-07-26 | **Lot 2.1/2.2 faits** : le salon unique codé en dur du Lot 1 devient un `RoomManager` (`server/src/engine/roomManager.ts`) gérant plusieurs salons en mémoire, chacun avec sa propre `Room`/simulation totalement indépendante — décorrélé du chargement concret des mods via un `ModResolver` injecté (même principe que `GameMod` pour `Room`). Réseau (`net/server.ts`) refactoré pour router chaque connexion WebSocket vers le salon demandé (`?roomId=`, plus de salon implicite) et exposer une API HTTP de lobby (`GET/POST /api/rooms`, `GET /api/modes`) sur le même process. Client : écran de lobby (liste + création de salon) avant d'entrer en jeu. **Bug trouvé et corrigé en testant manuellement en conditions réelles** (pas seulement en tests automatisés) : `GameConnection` perdait silencieusement le message `join` envoyé avant l'ouverture effective du WebSocket — invisible avec l'ancien flux (connexion ouverte bien avant le clic "Jouer"), bloquant avec le nouveau (connexion + `join` dans le même geste depuis le lobby). Corrigé par une file d'attente vidée à l'ouverture. 92 tests passants. Restent 2.3 (salons privés sur invitation), 2.4 (reset automatique) et 2.5 (isolation sous charge, test dédié) avant de clore le Lot 2. |
| 2026-07-26 | **Correction du modèle de decay** (metriques.md v0.4 §6) : l'utilisateur a identifié deux paramètres manqués lors de la première lecture de la feuille Excel (`Mm`/`minimumMass`=2 = notre `floor` déjà correct ; `Ml`/`massLoose` = taux 2%/5s au-dessus de 100, 1%/5s en-dessous — remplace notre ancien modèle 1%/5s-10s calé sur `M0`). Fichier Excel mis à jour (2 nouvelles lignes du dictionnaire §1), config renommée `decay.threshold`/`rateAboveThreshold`/etc (n'est plus lié à `player.startMass`). **Point non tranché signalé à l'utilisateur** : le seuil (100) est repris littéralement pour Folie aussi, qui démarre pourtant à 200 — donc Folie décroît toujours au taux rapide, jamais au taux réduit ; à confirmer si voulu. 74 tests passants. |
| 2026-07-26 | **Contrôle par intensité du curseur** (metriques.md §5.1, proposition utilisateur) : la distance du curseur au centre de l'écran module désormais une intensité ∈[0,1] qui réduit proportionnellement vitesse cible ET taux d'accélération — contrôle analogique plutôt que tout-ou-rien. Encodé dans la norme du vecteur `dir` du protocole (pas de nouveau champ). **Rendu client** : fond blanc + grille façon papier millimétré (repère visuel), texte des pseudos recontrasté (contour blanc + fond sombre) pour rester lisible sur fond clair. **Bande passante** : compression WebSocket (`perMessageDeflate`), arrondi différencié (position/rayon à 1 décimale, masse à l'entier — jamais utilisée pixel par pixel côté client), et **interest management** (chaque client ne reçoit que les entités dans un rayon de 3000px autour de ses propres morceaux, via une grille spatiale dédiée réutilisant `SpatialHash`). Résultat cumulé : **~387→52 Mbit/s à 50 joueurs, ~60→8 Mbit/s à 10 joueurs (~87% de réduction)** — mesure conservatrice (ne capture pas le gain de la compression elle-même). 73 tests passants. À revalider sur le Wyse réel (Lot 8). |
| 2026-07-26 | **Refactor majeur du Lot 1.6** suite à l'analyse d'un fichier Excel fourni par l'utilisateur ("Angul.io - Master Sheet Engine & Documentation Technique.xlsx"). `mods/vanilla/` remplacé par un moteur paramétrique générique (`mods/parametric/`, `createParametricMod(config)`) piloté par des fichiers JSON (`server/configs/vanilla.json`, `folie.json`). Nouveau modèle vitesse+accélération (metriques.md v0.2 §4-5, remplace le boost de split ad hoc), split/fusion généralisés (eta_W, cooldown mass-dépendant), bords de carte génériques (STRICT_WALL/ELASTIC_BOUNCE/TOROIDAL), nourriture à densité par surface. Folie livré comme second mode dès maintenant (voir note Lot 4). Bug corrigé dans le fichier Excel source (cellule Folie/speedMultiplier corrompue en date, corrigée à 2.5). 70 tests passants. Effet de bord mesuré : la densité de nourriture de la feuille donne ~3375-12000 particules ambiantes (bien plus que les 300 fixes précédents), bande passante à 20 joueurs déjà ~198 Mbit/s — renforce le besoin d'interest management avant le Lot 8. |
| 2026-07-26 | Gains rapides de bande passante appliqués suite au 1.8 (décision utilisateur : traiter maintenant plutôt qu'au Lot 8) : identifiants courts au lieu d'UUID (`World`, `net/server.ts`), pseudo envoyé une fois par joueur via un nouveau message `player` plutôt que répété à chaque entité/tick, clés JSON raccourcies dans `EntitySnapshot`. Mesure : ~387→222 Mbit/s à 50 joueurs, ~60→35 Mbit/s à 10 joueurs (~42% de réduction). **Reste insuffisant à 50 joueurs** — l'interest management reste nécessaire avant le Lot 8 si l'objectif est le haut de la fourchette. |
| 2026-07-26 | **Lot 1 terminé.** 1.8 (validation de charge, `server/scripts/loadtest.mjs`) : tick très stable même à 50 joueurs/350 entités, MAIS bande passante montante serveur estimée à ~387 Mbit/s à 50 joueurs (~60 Mbit/s à 10) avec l'état complet JSON verbeux actuel — bien plus que prévu. **Le besoin de delta compression/interest management (initialement différé après le MVP en §1.4) est maintenant confirmé avant le Lot 8**, pas après. Décision de priorisation (gains rapides vs. interest management complet) à prendre avec l'utilisateur avant le Lot 8. |
| 2026-07-26 | Lot 1.7 fait : client Canvas 2D (choix tranché, résout le dernier point ouvert du Lot 0.2), bundlé avec esbuild, servi par le serveur de jeu lui-même. **Validé manuellement dans un vrai navigateur** (via le Browser pane) : join, rendu du morceau + nourriture, HUD, split sans crash. Le Lot 0 est maintenant entièrement terminé. Reste sur le Lot 1 : 1.8 (validation de charge). |
| 2026-07-26 | Lot 1.3/1.4 faits : serveur WebSocket (`ws` + `http` natif) branché sur `Room`, protocole complet (join/input/welcome/state/died). Validé par 5 tests d'intégration + un test manuel de bout en bout avec le serveur réellement compilé et démarré. **Point technique important** : `shared/package.json` pointe désormais vers `dist/index.js`/`dist/index.d.ts` (pas `src/`) — nécessaire pour que `node dist/index.js` du serveur puisse réellement résoudre `@angulio/shared` à l'exécution (Node ne peut pas exécuter du `.ts` directement sur cette machine, voir note du 1.3). `vitest.config.ts` alias `@angulio/shared` vers `shared/src/index.ts` pour que les tests utilisent toujours la source à jour sans dépendre d'un build préalable. Ordre de build implicite requis : `shared` avant les autres (déjà l'ordre du tableau `workspaces` racine — ne pas le réordonner sans y repenser). |
| 2026-07-26 | Lot 1.1/1.2/1.5/1.6 faits : moteur générique (`World`/`Room`/`SpatialHash`) sans aucune règle de jeu codée en dur, API de hooks `GameMod` validée, mode Vanilla entièrement implémenté comme mod (53 tests passants au total). Densité de spawn de nourriture et devenir de la masse perdue tranchés par défaut (voir metriques.md §13). Reste : réseau (1.3/1.4), client (1.7), validation de charge (1.8). |
| 2026-07-26 | Lot 0 quasi complet : structure du monorepo (`shared/`, `server/`, `client/`, `admin/`) avec placeholders buildables/testés, outillage (npm workspaces, TS composite, ESLint 9 flat config, Prettier, Vitest) validé de bout en bout (`lint`, `test`, `build`, `format:check`), licence AGPL-3.0 officielle ajoutée (`LICENSE`, texte récupéré depuis gnu.org), CI GitHub Actions ajoutée. Seul point encore ouvert du Lot 0 : choix Canvas 2D vs PixiJS (0.2). |
| 2026-07-26 | Clé de déploiement ajoutée au dépôt GitHub (accès écriture), connexion SSH vérifiée, premier push effectué sur `main` — https://github.com/FantasmaGlad/Angul.io. |
| 2026-07-26 | Création de [metriques.md](metriques.md) : formules du mode Vanilla (masse↔rayon, vitesse, decay, split, fusion, collision). Formule de vitesse tranchée par défaut : `v(m) = V_REF * √(M_START/m)` avec `V_REF = 6 uc/s`, clampée ×0.25/×3 — résout la tâche 0.2, ajustable en playtest. Remote GitHub `origin` configuré en SSH (`git@github.com-angulio:...`) via une clé de déploiement dédiée `~/.ssh/angulio_deploy`. |
| 2026-07-26 | Dépôt Git local initialisé (branche `main`), `.gitignore` ajouté, premier commit avec le cahier des charges et ce plan. Convention actée : pas de mention de co-auteur IA dans les commits de ce projet. |
| 2026-07-26 | Rédaction du cahier des charges (v0.2) et de ce plan d'implémentation. Aucun code écrit à ce stade — le projet démarre au Lot 0.2. |

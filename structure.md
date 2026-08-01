# structure.md — Cartographie du dépôt Angul.io

Ce document explique **à quoi sert chaque fichier/dossier** du monorepo, pour qu'une future
mise à jour (par toi ou par un agent) sache immédiatement où intervenir sans devoir relire tout
le code.

Note sur les autres `.md` du dépôt : `*.md` est gitignored à la racine (voir `.gitignore`), à
l'exception de `README.md`. Les autres fichiers `.md` mentionnés dans des commentaires de code
(`cahier_des_charges.md`, `metriques.md`, `plan_performance_reseau.md`, `fix_vitesse_reseau.md`…)
sont des documents de travail **locaux et éphémères** : ils peuvent exister ou non selon la copie
du dépôt, ne sont jamais poussés, et ne doivent pas être considérés comme une source de vérité
fiable à long terme — contrairement à ce document et à `README.md`, qui SONT committés.

Règle de mise à jour : si tu ajoutes/déplaces/supprimes un fichier qui mériterait une ligne
ici (un nouveau module, un nouveau composant, un nouvel asset), mets ce document à jour dans le
même commit — sinon il devient trompeur plus vite qu'utile.

---

## 1. Vue d'ensemble du monorepo

npm workspaces, 4 paquets :

```
shared/   code TypeScript partagé (types, protocole réseau, formules géométriques/mouvement, identités de bots)
server/   serveur de jeu (moteur de simulation, mods, WebSocket, comptes, admin, rate-limiting)
client/   client web joueur (rendu Canvas + interface React, PWA)
admin/    interface d'administration (React)
```

`server` dépend de `shared`. `client` et `admin` dépendent de `shared`. `client` et `admin` sont
deux applications React **indépendantes** (bundles séparés, pas de dépendance entre elles),
servies par le même process Node (`server`) sous des chemins différents (`/` et `/admin/*`).

Aucune base de données ni fichier n'est partagé entre `client` et `admin` autrement que via
l'API HTTP/WebSocket exposée par `server`.

**Voir [README.md](README.md)** pour le système de mods en détail (interface `GameMod`, mods
paramétriques par JSON, mutualisation client/serveur) — ce document-ci ne fait que cartographier
les fichiers.

---

## 1bis. Outillage IA (serveur MCP local, coordination multi-plateformes)

Un serveur MCP local — enregistré auprès de Claude Code par `.mcp.json` à la racine, qui pointe
vers `.gemini/mcp/server.mjs` (PAS `.claude/mcp/server.mjs` : ce dernier existe aussi, avec une
implémentation quasi identique, mais `.mcp.json` lance bien la version `.gemini/`, qui sait en plus
retomber sur `.claude/project-structure.json` si `.gemini/project-structure.json` venait à manquer —
voir `getStructurePath()` dans ce fichier) — expose `.claude/project-structure.json` (lu via le
symlink `.gemini/project-structure.json`, voir plus bas) : une cartographie du dépôt
**interrogeable par un agent** (outils
`find_file`/`list_topics`/`get_topic_files`/`get_full_map`/`list_workspaces`) : retrouver "où se
trouve le code qui gère X" sans devoir grep tout le dépôt à l'aveugle à chaque nouvelle session.
`.mcp.json`, `.claude/mcp/**` (hors `node_modules/`) et `.claude/project-structure.json` sont
**volontairement COMMITÉS**, à rebours du reste du bloc "AI & Assistant files" du `.gitignore` : ce
n'est pas une préférence personnelle (contrairement à `.claude/settings.local.json`, permissions
locales, resté ignoré) mais un outil de projet partagé — n'importe quel contributeur ou agent, sur
n'importe quelle machine, doit pouvoir en bénéficier dès le clone, quelle que soit la plateforme IA
utilisée.

Ce dépôt utilise déjà **deux** plateformes IA avec leur propre répertoire de configuration/contexte
de projet : Claude Code (`.claude/`) et Gemini/Antigravity (`.gemini/`). Les deux servent la MÊME
cartographie — `.gemini/project-structure.json` est un **symlink** vers
`../.claude/project-structure.json` (pas une copie séparée à resynchroniser à la main : les deux
plateformes lisent toujours exactement le même contenu par construction), lu par un serveur MCP
équivalent (`.gemini/mcp/server.mjs`). `.gemini/` committe en plus `AGENTS.md` (consignes
d'architecture/méthodologie propres à cet agent, voir ce fichier) et
`skills/angulio-navigation/SKILL.md` (skill de navigation qui pointe vers cette même cartographie).
Sont donc **volontairement COMMITÉS** : `.gemini/mcp/**` (hors `node_modules/`),
`.gemini/project-structure.json` (le symlink lui-même), `.gemini/AGENTS.md` et `.gemini/skills/` —
même logique que `.claude/` ci-dessus, avec les mêmes exceptions au `.gitignore` (voir son bloc "AI
& Assistant files").

`.claude/launch.json` (config de lancement de l'aperçu navigateur + une section `_deployment`
documentant l'infra de production RÉELLE : hostname/IP LAN, accès sudo, procédure de déploiement)
reste volontairement **non commité** : contrairement à la cartographie ci-dessus, ce fichier
contient des détails d'infrastructure réels (pas seulement une aide à la navigation du code) —
à reconsidérer au cas par cas si le besoin de le partager entre plusieurs machines/agents se
présente, mais pas fait par défaut.

**Règle de coordination inter-plateformes** : si ce dépôt vient un jour à utiliser un TROISIÈME
outil IA avec son propre répertoire de configuration/contexte de projet (`.cursor/`, `.windsurf/`,
ou tout autre — voir le bloc "AI & Assistant files" du `.gitignore`), et que ce répertoire porte
lui aussi une cartographie ou un contexte de projet utile à *n'importe quel* agent (pas une
préférence purement locale à cet outil précis) — applique la même logique que `.claude/`/`.gemini/`
ci-dessus : committe la partie partageable, garde locale la partie vraiment
personnelle/spécifique à la machine (comme `.claude/settings.local.json`/`launch.json`), et mets à
jour ce document (§1bis) pour le documenter. Objectif : que la coordination entre plateformes
reste complète et permanente au fil du temps, pas seulement pour Claude Code.

**Règle de mise à jour** : comme pour ce fichier lui-même (voir l'en-tête), si tu ajoutes/déplaces/
renomme un fichier/module qui mériterait une entrée dans `.claude/project-structure.json` — mets-le
à jour dans le même commit (inutile de toucher `.gemini/project-structure.json` séparément, c'est
un symlink vers ce même fichier, voir plus haut) — le serveur MCP ne fait que servir ce fichier tel
quel, il devient trompeur aussi vite qu'une doc humaine non maintenue.

---

## 2. Arborescence complète

```
Angul.io/
├── README.md                          Vue d'ensemble technique + guide de modding (LE document de référence)
├── structure.md                       Ce fichier
├── LICENSE                            AGPL-3.0-or-later
├── scripts/install.sh                 Bootstrap d'un nœud de production (voir §8 cahier des charges)
├── eslint.config.js                   Config ESLint racine (couvre les 4 workspaces)
├── .prettierrc.json / .prettierignore Config formatage
├── .gitignore                         Note : *.md gitignored sauf README.md/structure.md/AGENTS.md
│                                       (voir §1) ; voir §1bis pour ce qui EST commité sous
│                                       .claude/ et .gemini/ malgré le nom du bloc
├── package.json / package-lock.json   Racine du monorepo (workspaces, scripts globaux)
├── tsconfig.json / tsconfig.base.json Config TypeScript partagée
├── vitest.config.ts / vitest.setup.ts Config des tests (tous workspaces)
├── .github/workflows/ci.yml           CI GitHub Actions (build/lint/format/test)
├── .mcp.json                           Enregistre .gemini/mcp/server.mjs auprès de Claude Code
│                                       (pas .claude/mcp/server.mjs, voir §1bis) — COMMITÉ
│                                       (contrairement au reste des fichiers d'assistants IA)
├── .claude/
│   ├── launch.json                    Config de lancement server+client pour l'aperçu navigateur
│                                       + section _deployment (infra de prod réelle) — NON commité,
│                                       volontairement (voir §1bis)
│   ├── settings.local.json            Permissions locales Claude Code — NON commité (personnel)
│   ├── project-structure.json         Cartographie machine-readable du dépôt, servie par le MCP
│                                       ci-dessous — voir §1bis, COMMITÉ
│   └── mcp/                           Serveur MCP local exposant cette cartographie aux agents —
│       ├── server.mjs                       voir §1bis, COMMITÉ (source, pas node_modules/)
│       └── package.json / package-lock.json
├── .gemini/                            Équivalent Gemini/Antigravity de .claude/ ci-dessus — voir §1bis
│   ├── AGENTS.md                      Consignes d'architecture/méthodologie pour Gemini/Antigravity — COMMITÉ
│   ├── project-structure.json         SYMLINK vers .claude/project-structure.json — COMMITÉ
│   ├── mcp/                           Serveur MCP local équivalent — COMMITÉ (source, pas node_modules/)
│   │   ├── server.mjs
│   │   └── package.json / package-lock.json
│   └── skills/angulio-navigation/SKILL.md   Skill de navigation (pointe vers cette cartographie) — COMMITÉ
├── assets/                            Sources d'assets graphiques/audio (voir §3)
│
├── shared/                            Code TypeScript partagé
│   ├── package.json / tsconfig.json
│   └── src/
│       ├── index.ts                   Point d'entrée (ré-exporte tout)
│       ├── vector.ts / vector.test.ts       Vecteurs 2D (add, sub, scale, distance, dot…)
│       ├── geometry.ts / geometry.test.ts   Formules masse↔aire↔rayon, aire de chevauchement de cercles
│       ├── camera.ts / camera.test.ts       Formule de zoom (masse→échelle) et rayon d'intérêt réseau — IDENTIQUE
│       │                               client (computeCamera, render.ts) et serveur (interestFilter.ts),
│       │                               voir cahier_des_charges_perf_reseau_grande_carte.md §2-3
│       ├── movement.ts                Modèle vitesse/accélération en fonction de la masse — IDENTIQUE
│       │                               client (prédiction) et serveur (autorité), voir README §Réseau
│       ├── protocol.ts                Types des messages WebSocket client↔serveur (voir README §Réseau)
│       ├── adminProtocol.ts           Types des messages du canal WebSocket admin dédié (`?admin=1`)
│       ├── botIdentities.ts           Dictionnaire des identités de bots (pseudo + couleur)
│       ├── botKillMessages.ts         Répliques affichées à l'écran de mort quand tué par un bot
│       ├── avatarPalette.ts           Palette de couleurs d'avatar (10 skins, roster remplacé en v5.5) + repli
│       │                               déterministe par pseudo
│       └── deathBanners.ts            Catalogue des bannières de l'écran de mort (déblocage par niveau)
│
├── server/                            Serveur de jeu
│   ├── package.json / tsconfig.json
│   ├── .env / .env.example            DATABASE_URL, ADMIN_PASSWORD_HASH (non commité)
│   ├── rooms.json                     Salons permanents de l'accueil (nom + mode) — voir src/roomsConfig.ts,
│   │                                   éditable via l'interface admin (§13 cahier_des_charges_admin.md),
│   │                                   volontairement HORS de configs/ (pas un mod)
│   ├── db/schema.sql                  Schéma PostgreSQL de référence (documentation)
│   ├── migrations/                    Migrations node-pg-migrate (source de vérité exécutable)
│   ├── configs/                       Configs JSON des mods paramétriques (voir README §Modding)
│   │   ├── vanilla.json                     Mode par défaut
│   │   ├── hardcore.json                    Absorption x2, Dash uniquement (split désactivé)
│   │   ├── infini.json                      Carte 5000x5000, pastilles de masse 2, bords toroïdaux (téléportation fluide)
│   │   ├── mega-split.json                  64 cellules max, refusion instantanée (0s)
│   │   └── bots/                            Profils de COMPORTEMENT de robots (même système que ci-dessus,
│   │       └── default.json                 mais pour le pilotage IA — voir engine/bots/behaviorConfig.ts/
│   │                                         loadBehaviorConfig.ts) : fuis/neutre/agressif/fou/wallAvoidance.
│   │                                         Sélectionné par `BotConfig.behaviorId` (mods/parametric/config.ts),
│   │                                         absent = 'default'. Distinct de la POPULATION de bots
│   │                                         (ambientTargetCount/challengers, restée dans server/configs/*.json).
│   ├── scripts/
│   │   ├── hashPassword.mjs                 Génère un hash argon2 pour ADMIN_PASSWORD_HASH
│   │   ├── loadtest.mjs                     Bots WebSocket pour valider la charge
│   │   └── loadtest_spectators.mjs          Charge de spectateurs (canal admin/POV)
│   └── src/
│       ├── index.ts                   Point d'entrée process (assemble tout, démarre le serveur)
│       ├── roomsConfig.ts / .test.ts  Lit/écrit server/rooms.json (salons permanents de l'accueil, §13)
│       ├── log.ts / log.test.ts       Journalisation structurée (JSON sur stdout)
│       ├── db/pool.ts                 Pool de connexions PostgreSQL (paresseux)
│       ├── engine/                    Moteur de jeu générique — IDENTIQUE pour tout mod (voir README)
│       │   ├── types.ts                     Entity, PlayerId, PlayerState…
│       │   ├── world.ts / world.test.ts     Monde de simulation (entités, grille spatiale)
│       │   ├── spatialHash.ts / .test.ts    Grille de collision broad-phase (évite le O(n²))
│       │   ├── mod.ts                       Interface GameMod — LE contrat de modding (voir README)
│       │   ├── modRegistry.ts               Résout un modId → { mod, mapSize, movement, room… }
│       │   ├── room.ts / room.test.ts       Un salon = une simulation indépendante (tick fixe)
│       │   ├── roomManager.ts / .test.ts    Registre des salons (créer/lister/rejoindre/expirer) — un salon
│       │   │                                 PRIVÉ n'est joignable QUE par son code d'invitation, jamais par
│       │   │                                 son id interne (voir CreateRoomOptions.mapSize/botCount pour la
│       │   │                                 personnalisation d'un salon privé : taille de carte 1000-50000,
│       │   │                                 population de bots 0-50 fixe ou min/max)
│       │   ├── roomIsolation.test.ts        Mesure l'isolation CPU entre salons (mono-thread Node)
│       │   ├── resetSchedule.ts             Planification du reset auto (quotidien/intervalle/calé horloge)
│       │   ├── godmode.ts                   Convention "Blob Dieu" (invincible, mange tout — outil admin)
│       │   ├── xp.ts / xp.test.ts           XP/combo (masse mangée, joueurs mangés, multiplicateur)
│       │   ├── worker/                      Hébergement des salons — scalabilité horizontale
│       │   │   ├── protocol.ts                    Messages échangés avec un worker_thread
│       │   │   ├── roomHost.ts                    Interface RoomHost + LocalRoomHost (mono-thread, tests)
│       │   │   ├── workerRoomHost.ts               RoomHost réparti sur N worker_threads (production) —
│       │   │   │                                    résout spec.mapSize ?? mapSize du mod pour
│       │   │   │                                    RoomHandle.mapSize (welcome.mapSize), en phase avec
│       │   │   │                                    la même résolution faite par RoomInstance ci-dessous
│       │   │   ├── roomInstance.ts / .test.ts      Une Room vivant DANS un worker — applique spec.mapSize
│       │   │   │                                    (taille de carte perso) et applyRoomBotCountOverride
│       │   │   │                                    (spec.botCount, réutilise la pyramide Challenger)
│       │   │   ├── roomWorker.ts                  Point d'entrée du worker_thread (boucle de messages)
│       │   │   ├── snapshotBuilder.ts / .test.ts  Construit l'EntitySnapshot[] envoyé au réseau
│       │   │   └── interestFilter.ts / .test.ts   Filtrage par intérêt réseau (v5.7) : index grossier
│       │   │                                        nourriture (cellSize=1000, distinct de la grille de
│       │   │                                        collision), resynchronisation périodique étalée par
│       │   │                                        joueur — voir cahier_des_charges_perf_reseau_grande_carte.md
│       │   └── bots/                        Système de robots (IA, régulation population)
│       │       ├── botTypes.ts                    Profils ('fuis', 'neutre'...) + pyramide Challenger
│       │       │                                   (ChallengerConfig/DEFAULT_CHALLENGER_CONFIG,
│       │       │                                   rampedChallengerTarget), voir BOT_IDENTITIES
│       │       ├── behaviorConfig.ts              Schéma BotBehaviorConfig (pilotage : rayons, intensités,
│       │       │                                   cooldowns de split, marge d'évitement des murs par profil)
│       │       │                                   + DEFAULT_BOT_BEHAVIOR_CONFIG (repli/valeurs historiques)
│       │       ├── loadBehaviorConfig.ts / .test.ts  Lit server/configs/bots/<id>.json (fusion par section
│       │       │                                   avec le défaut), listAvailableBotBehaviorIds()
│       │       ├── botEvaluator.ts / .test.ts     IA décisionnelle (utility evaluation) — pilotée par un
│       │       │                                   BotBehaviorConfig injecté (voir ci-dessus), plus aucune
│       │       │                                   constante codée en dur
│       │       └── botManager.ts / .test.ts       Population : bots normaux (spawn progressif à 0 humain
│       │                                           uniquement) + Challengers (permanents, population qui
│       │                                           décroît linéairement de maxWithHumans à minWithHumans
│       │                                           avec le nombre d'humains connectés) + despawn
│       │                                           d'inactivité (idleDespawn) + plafond dur (maxTotal).
│       │                                           Charge aussi le BotBehaviorConfig une fois à la
│       │                                           construction (loadBotBehaviorConfig(config.behaviorId))
│       ├── mods/                      Modes de jeu — voir README §Modding pour la philosophie
│       │   ├── parametric/                  Mod générique piloté à 100% par un JSON (server/configs/*.json)
│       │   │   ├── config.ts                      Schéma TypeScript complet de la config JSON
│       │   │   │                                    (BotConfig.behaviorId référence un fichier
│       │   │   │                                    server/configs/bots/<id>.json, absent = 'default')
│       │   │   ├── loadConfig.ts                  Lit/valide server/configs/<modId>.json
│       │   │   ├── physics.ts                     Formules dérivées de la config (vitesse/accel/décroissance…)
│       │   │   ├── pieceState.ts                  État par-morceau (cible, cooldowns) hors du World générique
│       │   │   ├── border.ts / .test.ts           4 types de bord de carte (mur/rebond/toroïdal/toxique)
│       │   │   └── index.ts                       createParametricMod() — implémente GameMod depuis la config
│       │   └── hardcore/
│       │       └── index.ts / .test.ts            createHardcoreMod() — COMPOSE parametric (voir README)
│       ├── accounts/                  Comptes joueurs
│       │   ├── accountsRepository.ts / .test.ts   Requêtes SQL (players, player_best_scores)
│       │   ├── passwords.ts / .test.ts            Hachage/vérification argon2
│       │   ├── levels.ts / .test.ts               Formule XP → niveau
│       │   ├── sessionStore.ts / .test.ts         Sessions en mémoire (token → session, TTL 24h)
│       │   ├── pendingScoreClaims.ts              Score/XP d'une vie d'invité en attente d'un compte
│       │   │                                       (createScoreClaim/consume, symétrique de sessionStore.ts)
│       │   └── service.ts / .test.ts              Logique métier (inscription/connexion/profil)
│       ├── admin/
│       │   ├── adminAuth.ts / .test.ts            Authentification admin (mot de passe unique ou comptes nommés)
│       │   └── adminUsersRepository.ts            Requêtes SQL (table admin_users)
│       └── net/                       Architecture réseau — voir README §Réseau pour le flux complet
│           ├── rateLimiter.ts               Rate limiter par fenêtre glissante
│           ├── server.ts / .test.ts         Point d'assemblage HTTP + WebSocket (startGameServer)
│           ├── metrics.ts                   Snapshot santé serveur (event loop, ticks) pour /api/admin/health
│           ├── botKillGif.ts                Résout le GIF affiché à l'écran de mort quand tué par un bot
│           ├── http/
│           │   ├── httpUtils.ts             Lecture JSON, extraction IP/token Bearer, réponses JSON
│           │   ├── staticServer.ts          Serveur de fichiers statiques (anti path-traversal)
│           │   ├── router.ts                Routage HTTP central déléguant aux handlers
│           │   └── routes/
│           │       ├── lobby.ts             GET/POST /api/rooms (mapSize/botCount pour un salon privé
│           │       │                          personnalisé), GET /api/modes, GET /api/stats
│           │       ├── auth.ts              POST /api/auth/register, /login, /logout, GET /api/account/me
│           │       ├── health.ts            GET /api/admin/health (métriques de charge par salon)
│           │       ├── admin.ts             POST /api/admin/login, /logout, GET/PATCH /api/admin/players
│           │       ├── adminRooms.ts        Actions admin par salon (kick/freeze/godmode/spawn food…),
│           │                                  GET/PUT /api/admin/base-rooms (server/rooms.json, §13)
│           │       └── adminMods.ts         GET/PUT /api/admin/mods/:id (édition de mod) & POST /api/admin/server/reload
│           └── ws/
│               ├── connectionHandler.ts     Connexions WS joueur/spectateur, validation stricte d'inputs
│               └── broadcast.ts            Boucle onTick → EntitySnapshot[] par salon (interest management)
│
├── client/                            Client joueur (React + Vite) — voir README §Réseau pour le pipeline
│   ├── package.json / tsconfig.json / vite.config.ts
│   ├── index.html                     Point d'entrée Vite (source — pas le build)
│   ├── static/                        Assets statiques SOURCE, copiés tels quels par le build
│   │   ├── manifest.json / service-worker.js / icons/   PWA
│   ├── public/                        ⚠️ GÉNÉRÉ par `vite build` — jamais édité à la main, gitignored
│   └── src/
│       ├── main.tsx                   Point d'entrée React (createRoot, <App/>)
│       ├── App.tsx                    État racine (accueil/jeu/sous-page selon l'URL, session, lobby)
│       ├── router.ts                  Routeur maison (pushState + popstate, pas de dépendance)
│       ├── styles.css                 Design tokens + toutes les classes CSS
│       ├── modes.ts                   Métadonnées d'affichage par mode (nom/description/couleur)
│       ├── keybinds.ts                Configuration des touches (split/dash/eject), persistée localStorage
│       ├── settings.ts                Préférences locales (Vsync, plafond FPS)
│       ├── audio.ts                   Gestionnaire de musique/sons (un seul flux actif à la fois)
│       ├── pwa.ts                     Enregistrement du service worker
│       ├── auth.ts                    Client API comptes (login/register/logout/profile/avatar)
│       ├── lobby.ts                   Client API salons (liste/création/modes/stats serveur, personnalisation
│       │                               mapSize/botCount d'un salon privé)
│       ├── support.ts                 Contenu de la page Soutenir (lien de don, texte)
│       ├── net.ts / net.test.ts       Connexion WebSocket au serveur de jeu (reconnexion auto)
│       ├── input.ts                   Capture souris/clavier/manette → cible + intensité + actions
│       ├── prediction.ts / .test.ts   PRÉDICTION LOCALE + réconciliation du blob du joueur (voir README)
│       ├── renderEngine.ts / .test.ts INTERPOLATION réseau des entités distantes (voir README)
│       ├── render.ts / render.test.ts Rendu Canvas 2D (caméra, dessin, culling viewport)
│       ├── stats.ts / stats.test.ts   Agrégation des morceaux du joueur (masse, barycentre, vitesse)
│       └── debugOverlay.ts / .test.ts Écran de diagnostic F3 (FPS, réseau, tick, gigue, système)
│   └── src/components/                Composants de jeu/accueil (voir §4.1)
│   └── src/pages/                     Sous-pages plein écran (voir §4.2)
│
└── admin/                             Interface d'administration (React + Vite)
    ├── package.json / tsconfig.json
    ├── vite.config.ts                 base: '/admin/' (préfixe d'URL), pas de publicDir
    ├── public/                        ⚠️ GÉNÉRÉ par `vite build` — jamais édité à la main, gitignored
    └── src/
        ├── main.tsx / App.tsx         Point d'entrée + état racine (login, vue active, 7 vues §4)
        ├── styles.css                 Design system "glassmorphisme blanc" (cahier_des_charges_admin.md §14)
        ├── adminApi.ts                Client API admin HTTP (comptes, salons, actions, modes)
        ├── adminSocket.ts             Canal WebSocket admin dédié (`?admin=1`) — POV + Studio de contrôle
        ├── entityCanvas.ts            Géométrie/interpolation PURES partagées POV/Studio (indépendantes du rendu)
        ├── pixiEntityRenderer.ts      Moteur de rendu GPU PixiJS du canva (§10.2, remplace l'ancien Canvas2D)
        └── components/
            ├── Sidebar.tsx                 Navigation latérale, 7 entrées (§4 : opérationnel/gouvernance)
            ├── ConnectionStatusDot.tsx      Indicateur connexion WS temps réel (§10.3, POV + Studio)
            ├── DashboardView.tsx            Tableau de bord (§6) : santé serveur, salons, activité récente
            ├── PlayersView.tsx              Recherche/édition de comptes joueurs (§7)
            ├── RoomsView.tsx                Salons & Écrans (§8 : carrousel, filtres/tri, kick motivé, POV)
            ├── CreativeView.tsx             Studio de contrôle (§9 : 3 zones contexte/observation/intervention)
            ├── ModerationView.tsx           Modération (§11) — v1 : liste des comptes bannis
            ├── EconomyView.tsx              Économie & Boosts (§12) — placeholder "Bientôt disponible"
            └── ConfigurationView.tsx        Configuration (§13) : salons permanents de l'accueil éditables
                                               (server/rooms.json), profils de mods en lecture seule
```

---

## 3. Où vivent les assets, styles et animations

| Type | Emplacement | Détail |
|---|---|---|
| **Sources d'assets** | `assets/` (racine) | Skins joueurs (PNG), logo, images de joystick, musiques — sources non transformées, référencées depuis `client/public/assets/*` au build |
| **Icônes PWA** | `client/static/icons/*.png` | 192px, 512px, 512px maskable |
| **Favicon** | `client/static/favicon.ico` | Multi-résolution (16/32/48px), référencé dans `client/index.html` |
| **Manifeste PWA** | `client/static/manifest.json` | Nom, couleurs, icônes déclarées à l'OS pour l'installation |
| **Service worker** | `client/static/service-worker.js` | Cache offline de la coquille statique |
| **Styles/design tokens** | `client/src/styles.css`, `admin/src/styles.css` | CSS pur, pas de préprocesseur |
| **Rendu du jeu (cellules, pastilles, grille)** | `client/src/render.ts` | Nourriture/grille procédurales (couleur dérivée de la masse) ; joueurs/bots utilisent un skin (image PNG, voir `SKIN_IMAGE_MAP`, `shared/src/avatarPalette.ts`) ou un repli couleur uni |
| **Police** | Aucune — pile système (`-apple-system, ... sans-serif`) | Pas de police web externe |

---

## 4. Composants React — qui affiche quoi

### 4.1 Client — accueil et jeu (`client/src/components/`)

| Composant | Rôle |
|---|---|
| `Home.tsx` | Composition racine de l'accueil : `TopNav` + 3 colonnes + `BottomBar` + `SpectatorBackground` |
| `TopNav.tsx` | Nav haute : marque, liens Classement/À Propos, cercle de compte |
| `ModeRoomList.tsx` | Colonne gauche : sélecteur de mode + classement des salons publics de ce mode |
| `PlayPanel.tsx` | Colonne centre : compteur de joueurs connectés, pseudo, bouton "Rejoindre" |
| `CreateRoomPanel.tsx` | Colonne droite : création de salon privé (Premium, nombre de robots fixe ou min/max et taille de carte personnalisables) + rejoindre par code — un salon PRIVÉ est rejoint via son CODE d'invitation, jamais son id interne |
| `BottomBar.tsx` | Pied de page : version, marque, lien Soutenir |
| `SpectatorBackground.tsx` | Fond animé : connexion WS lecture seule (`?spectate=1`), réutilise `render.ts` |
| `Minimap.tsx` | Mini-carte 3x3 (secteurs A1-C3) affichée en jeu |
| `AssetPreloader.tsx` | Précharge les images de skins avant affichage du jeu (évite un flash sans texture) |
| `ErrorBoundary.tsx` | Filet de sécurité React (évite un écran blanc total sur exception de rendu) |
| `AudioSettings.tsx` / `KeybindSettings.tsx` | Réglages son / remapping des touches (accessibles depuis Paramètres) |
| `GameView.tsx` | **Le seul composant qui touche au canvas en partie** — boucle de rendu (`requestAnimationFrame`), connexion WebSocket, HUD (stats/leaderboard/minimap/dash/écran de mort) — voir README §Réseau pour le détail de sa boucle. Écran de connexion initial limité à 500ms (`MIN_CONNECTING_SCREEN_MS`) ; `doRespawn()`/le bouton Rejouer forcent une reconnexion immédiate (`ensureConnected()`, `net.ts`) avant d'envoyer le `join` |

### 4.2 Client — sous-pages (`client/src/pages/`)

Chaque sous-page a sa propre URL (voir `router.ts`) et un bouton de retour, via la coquille
commune `PageLayout.tsx`.

| Page | Route | Rôle |
|---|---|---|
| `PageLayout.tsx` | — | Coquille commune (titre + bouton retour rond icône-seule, `.subpage-back` — plus de libellé texte depuis v5.5) |
| `AccountPage.tsx` | `/compte` | Connexion/inscription/déconnexion |
| `ProfilePage.tsx` | `/profil` | Niveau/XP/Premium/cosmétiques/scores + avatar (caroussel pleine largeur, aligné sur les autres cartes de la colonne) + personnalisation écran de mort. Badge NIVEAU en pastille blanche glassmorphism |
| `SettingsPage.tsx` | `/parametres` | Plafond FPS/Vsync, son, touches (réglages locaux à l'appareil) |
| `LeaderboardPage.tsx` | `/classement` | Classement global |
| `SupportPage.tsx` | `/soutenir` | Explication du don libre + lien de don |
| `AboutPage.tsx` | `/a-propos` | Nom du projet, licence (le numéro de version affiché aux joueurs vit dans `BottomBar.tsx`, pas ici) |

### 4.3 Routeur (`client/src/router.ts`)

Routeur maison minimal (pas de dépendance ajoutée) : `usePath()` (hook, état du pathname courant)
et `navigate(path)` (`history.pushState` + redéclenchement manuel de `popstate`).

### 4.4 Admin (`admin/src/components/`)

Voir §2 ci-dessus (`Sidebar`, `PlayersView`, `RoomsView`, `CreativeView`) — architecture détaillée
dans le cahier des charges admin local (non committé, voir §1).

---

## 5. Points d'entrée et scripts

| Commande (racine) | Effet |
|---|---|
| `npm install` | Installe les dépendances des 4 workspaces |
| `npm run build` | Build `shared` → `server` → `client` → `admin` (dans cet ordre) |
| `npm test` | Lance tous les `*.test.ts` (vitest), y compris les tests Postgres si `DATABASE_URL` est définie |
| `npm run lint` | ESLint sur tout le dépôt (y compris `.tsx`) |
| `npm run format` / `format:check` | Prettier (écrit / vérifie seulement) |

Serveur : `TICK_RATE_HZ` (défaut 20, v5.8 — était 30), `ROOM_WORKERS` (défaut = nombre de cœurs,
`0` = mono-thread sans worker_threads, utile en debug) — voir `server/src/index.ts` et README
§Réseau.

---

## 6. Base de données (PostgreSQL)

Voir [server/db/schema.sql](server/db/schema.sql) pour le détail des tables :
- **`players`** : compte joueur (pseudo, hash de mot de passe, niveau/XP, Premium, cosmétiques,
  `avatar_color`, `death_message`/`death_banner_id`, banni).
- **`player_best_scores`** : meilleur score par (joueur, mode de jeu).
- **`admin_users`** : comptes admin nommés (optionnel — repli sur `ADMIN_PASSWORD_HASH` unique).
- **Pas de table de sessions** : les tokens de connexion vivent en mémoire (`sessionStore.ts`,
  TTL 24h) — un redémarrage du serveur déconnecte tous les comptes.

---

## 7. Pour aller plus loin

- **Système de mods, mutualisation client/serveur, protocole réseau en détail** : [README.md](README.md).
- Les documents `cahier_des_charges*.md`/`metriques.md` peuvent exister localement (non commités,
  voir §1) avec le détail fonctionnel d'origine — absents, ce document et le README restent la
  source de vérité à jour.

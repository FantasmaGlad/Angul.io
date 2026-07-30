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

## 2. Arborescence complète

```
Angul.io/
├── README.md                          Vue d'ensemble technique + guide de modding (LE document de référence)
├── structure.md                       Ce fichier
├── LICENSE                            AGPL-3.0-or-later
├── install.sh                         Bootstrap d'un nœud de production
├── eslint.config.js                   Config ESLint racine (couvre les 4 workspaces)
├── .prettierrc.json / .prettierignore Config formatage
├── .gitignore                         Note : *.md gitignored sauf README.md (voir §1)
├── package.json / package-lock.json   Racine du monorepo (workspaces, scripts globaux)
├── tsconfig.json / tsconfig.base.json Config TypeScript partagée
├── vitest.config.ts / vitest.setup.ts Config des tests (tous workspaces)
├── .github/workflows/ci.yml           CI GitHub Actions (build/lint/format/test)
├── .claude/launch.json                Config de lancement server+client pour l'aperçu navigateur
├── assets/                            Sources d'assets graphiques/audio (voir §3)
│
├── shared/                            Code TypeScript partagé
│   ├── package.json / tsconfig.json
│   └── src/
│       ├── index.ts                   Point d'entrée (ré-exporte tout)
│       ├── vector.ts / vector.test.ts       Vecteurs 2D (add, sub, scale, distance, dot…)
│       ├── geometry.ts / geometry.test.ts   Formules masse↔aire↔rayon, aire de chevauchement de cercles
│       ├── movement.ts                Modèle vitesse/accélération en fonction de la masse — IDENTIQUE
│       │                               client (prédiction) et serveur (autorité), voir README §Réseau
│       ├── protocol.ts                Types des messages WebSocket client↔serveur (voir README §Réseau)
│       ├── adminProtocol.ts           Types des messages du canal WebSocket admin dédié (`?admin=1`)
│       ├── botIdentities.ts           Dictionnaire des identités de bots (pseudo + couleur)
│       ├── botKillMessages.ts         Répliques affichées à l'écran de mort quand tué par un bot
│       ├── avatarPalette.ts           Palette de couleurs d'avatar + repli déterministe par pseudo
│       └── deathBanners.ts            Catalogue des bannières de l'écran de mort (déblocage par niveau)
│
├── server/                            Serveur de jeu
│   ├── package.json / tsconfig.json
│   ├── .env / .env.example            DATABASE_URL, ADMIN_PASSWORD_HASH (non commité)
│   ├── db/schema.sql                  Schéma PostgreSQL de référence (documentation)
│   ├── migrations/                    Migrations node-pg-migrate (source de vérité exécutable)
│   ├── configs/                       Configs JSON des mods paramétriques (voir README §Modding)
│   │   ├── vanilla.json                     Mode par défaut
│   │   └── hardcore.json                    Absorption x2, Dash, perte totale de score à la mort
│   ├── scripts/
│   │   ├── hashPassword.mjs                 Génère un hash argon2 pour ADMIN_PASSWORD_HASH
│   │   ├── loadtest.mjs                     Bots WebSocket pour valider la charge
│   │   └── loadtest_spectators.mjs          Charge de spectateurs (canal admin/POV)
│   └── src/
│       ├── index.ts                   Point d'entrée process (assemble tout, démarre le serveur)
│       ├── log.ts / log.test.ts       Journalisation structurée (JSON sur stdout)
│       ├── db/pool.ts                 Pool de connexions PostgreSQL (paresseux)
│       ├── engine/                    Moteur de jeu générique — IDENTIQUE pour tout mod (voir README)
│       │   ├── types.ts                     Entity, PlayerId, PlayerState…
│       │   ├── world.ts / world.test.ts     Monde de simulation (entités, grille spatiale)
│       │   ├── spatialHash.ts / .test.ts    Grille de collision broad-phase (évite le O(n²))
│       │   ├── mod.ts                       Interface GameMod — LE contrat de modding (voir README)
│       │   ├── modRegistry.ts               Résout un modId → { mod, mapSize, movement, room… }
│       │   ├── room.ts / room.test.ts       Un salon = une simulation indépendante (tick fixe)
│       │   ├── roomManager.ts / .test.ts    Registre des salons (créer/lister/rejoindre/expirer)
│       │   ├── roomIsolation.test.ts        Mesure l'isolation CPU entre salons (mono-thread Node)
│       │   ├── resetSchedule.ts             Planification du reset auto (quotidien/intervalle/calé horloge)
│       │   ├── godmode.ts                   Convention "Blob Dieu" (invincible, mange tout — outil admin)
│       │   ├── xp.ts / xp.test.ts           XP/combo (masse mangée, joueurs mangés, multiplicateur)
│       │   ├── worker/                      Hébergement des salons — scalabilité horizontale
│       │   │   ├── protocol.ts                    Messages échangés avec un worker_thread
│       │   │   ├── roomHost.ts                    Interface RoomHost + LocalRoomHost (mono-thread, tests)
│       │   │   ├── workerRoomHost.ts               RoomHost réparti sur N worker_threads (production)
│       │   │   ├── roomInstance.ts                Une Room vivant DANS un worker
│       │   │   ├── roomWorker.ts                  Point d'entrée du worker_thread (boucle de messages)
│       │   │   └── snapshotBuilder.ts / .test.ts  Construit l'EntitySnapshot[] envoyé au réseau
│       │   └── bots/                        Système de robots (IA, régulation population)
│       │       ├── botTypes.ts                    Profils ('fuis', 'neutre'...), voir BOT_IDENTITIES
│       │       ├── botEvaluator.ts / .test.ts     IA décisionnelle (utility evaluation)
│       │       └── botManager.ts / .test.ts       Population (spawn progressif, ratio fluctuant)
│       ├── mods/                      Modes de jeu — voir README §Modding pour la philosophie
│       │   ├── parametric/                  Mod générique piloté à 100% par un JSON (server/configs/*.json)
│       │   │   ├── config.ts                      Schéma TypeScript complet de la config JSON
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
│           │       ├── lobby.ts             GET/POST /api/rooms, GET /api/modes, GET /api/stats
│           │       ├── auth.ts              POST /api/auth/register, /login, /logout, GET /api/account/me
│           │       ├── health.ts            GET /api/admin/health (métriques de charge par salon)
│           │       ├── admin.ts             POST /api/admin/login, /logout, GET/PATCH /api/admin/players
│           │       └── adminRooms.ts        Actions admin par salon (kick/freeze/godmode/spawn food…)
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
│       ├── lobby.ts                   Client API salons (liste/création/modes/stats serveur)
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
        ├── main.tsx / App.tsx         Point d'entrée + état racine (login, vue active)
        ├── styles.css                 Design tokens (dupliqués de client/src/styles.css)
        ├── adminApi.ts                Client API admin HTTP (comptes, salons, actions)
        ├── adminSocket.ts             Canal WebSocket admin dédié (`?admin=1`) — POV + Espace Créatif
        ├── entityCanvas.ts            Rendu Canvas partagé POV/Espace Créatif (60 FPS, interpolation)
        └── components/
            ├── Sidebar.tsx                 Navigation latérale entre les vues
            ├── PlayersView.tsx             Recherche/édition de comptes joueurs
            ├── RoomsView.tsx               Salons & Écrans (POV spectateur par salon, kick/transfert)
            └── CreativeView.tsx            Espace Créatif (freeze/godmode/spawn food/masse par joueur…)
```

---

## 3. Où vivent les assets, styles et animations

| Type | Emplacement | Détail |
|---|---|---|
| **Sources d'assets** | `assets/` (racine) | Skins joueurs (PNG), logo, images de joystick, musiques — sources non transformées, référencées depuis `client/public/assets/*` au build |
| **Icônes PWA** | `client/static/icons/*.png` | 192px, 512px, 512px maskable |
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
| `TopNav.tsx` | Nav haute : marque, liens Classement/Wiki/À Propos, cercle de compte |
| `ModeRoomList.tsx` | Colonne gauche : sélecteur de mode + classement des salons publics de ce mode |
| `PlayPanel.tsx` | Colonne centre : compteur de joueurs connectés, pseudo, bouton "Rejoindre" |
| `CreateRoomPanel.tsx` | Colonne droite : création de salon privé (Premium) + rejoindre par code |
| `BottomBar.tsx` | Pied de page : version, marque, lien Soutenir |
| `SpectatorBackground.tsx` | Fond animé : connexion WS lecture seule (`?spectate=1`), réutilise `render.ts` |
| `Minimap.tsx` | Mini-carte 3x3 (secteurs A1-C3) affichée en jeu |
| `AssetPreloader.tsx` | Précharge les images de skins avant affichage du jeu (évite un flash sans texture) |
| `ErrorBoundary.tsx` | Filet de sécurité React (évite un écran blanc total sur exception de rendu) |
| `AudioSettings.tsx` / `KeybindSettings.tsx` | Réglages son / remapping des touches (accessibles depuis Paramètres) |
| `WikiPage.tsx` | Wiki joueur plein écran (route `/wiki`) — modes/monde/adversaires/bestiaire |
| `GameView.tsx` | **Le seul composant qui touche au canvas en partie** — boucle de rendu (`requestAnimationFrame`), connexion WebSocket, HUD (stats/leaderboard/minimap/dash/écran de mort) — voir README §Réseau pour le détail de sa boucle |

### 4.2 Client — sous-pages (`client/src/pages/`)

Chaque sous-page a sa propre URL (voir `router.ts`) et un bouton de retour, via la coquille
commune `PageLayout.tsx`.

| Page | Route | Rôle |
|---|---|---|
| `PageLayout.tsx` | — | Coquille commune (titre + bouton retour accueil) |
| `AccountPage.tsx` | `/compte` | Connexion/inscription/déconnexion |
| `ProfilePage.tsx` | `/profil` | Niveau/XP/Premium/cosmétiques/scores + avatar + personnalisation écran de mort |
| `SettingsPage.tsx` | `/parametres` | Plafond FPS/Vsync, son, touches (réglages locaux à l'appareil) |
| `LeaderboardPage.tsx` | `/classement` | Classement global |
| `SupportPage.tsx` | `/soutenir` | Explication du don libre + lien de don |
| `AboutPage.tsx` | `/a-propos` | Nom du projet, version, licence |

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

Serveur : `TICK_RATE_HZ` (défaut 30), `ROOM_WORKERS` (défaut = nombre de cœurs, `0` = mono-thread
sans worker_threads, utile en debug) — voir `server/src/index.ts` et README §Réseau.

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

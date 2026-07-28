# structure.md — Cartographie du dépôt Angul.io

Ce document explique **à quoi sert chaque fichier/dossier** du monorepo, pour qu'une future
mise à jour (par toi ou par un agent) sache immédiatement où intervenir sans devoir relire tout
le code. Il complète les autres documents de référence plutôt que de les remplacer :

| Document | Sert à |
|---|---|
| [cahier_des_charges.md](cahier_des_charges.md) | Spécification produit/architecture du moteur de jeu (gameplay, réseau, comptes, licence, ce qu'il reste à faire) |
| **structure.md** (ce fichier) | Rôle de chaque fichier, arborescence, où vivent les assets |
| [server/db/schema.sql](server/db/schema.sql) | Schéma PostgreSQL de référence, lisible sans relire les migrations |

Règle de mise à jour : si tu ajoutes/déplaces/supprimes un fichier qui mériterait une ligne
ici (un nouveau module, un nouveau composant, un nouvel asset), mets ce document à jour dans le
même commit — sinon il devient trompeur plus vite qu'utile.

---

## 1. Vue d'ensemble du monorepo

npm workspaces, 4 paquets :

```
shared/   code TypeScript partagé (types, constantes, formules géométriques, identités de bots)
server/   serveur de jeu (boucle de simulation, WebSocket, comptes, admin, mods, rate-limiting)
client/   client web joueur (rendu Canvas + interface React, PWA)
admin/    interface d'administration (React)
```

`server` dépend de `shared`. `client` et `admin` dépendent de `shared`. `client` et `admin` sont
deux applications React **indépendantes** (bundles séparés, pas de dépendance entre elles),
servies par le même process Node (`server`) sous des chemins différents (`/` et `/admin/*`).

Aucune base de données ni fichier n'est partagé entre `client` et `admin` autrement que via
l'API HTTP/WebSocket exposée par `server`.

---

## 2. Arborescence complète

```
Angul.io/
├── cahier_des_charges.md              Spéc produit/moteur de jeu
├── structure.md                       Ce fichier
├── README.md                          Vue d'ensemble + démarrage rapide
├── LICENSE                            AGPL-3.0-or-later
├── install.sh                         Bootstrap d'un nœud de production (Wyse)
├── eslint.config.js                   Config ESLint racine (couvre les 4 workspaces)
├── .prettierrc.json / .prettierignore Config formatage
├── .gitignore
├── package.json / package-lock.json   Racine du monorepo (workspaces, scripts globaux)
├── tsconfig.json / tsconfig.base.json Config TypeScript partagée
├── vitest.config.ts / vitest.setup.ts Config des tests (tous workspaces)
├── .github/workflows/ci.yml           CI GitHub Actions (build/lint/format/test)
├── .claude/launch.json                Config de lancement du serveur pour l'aperçu navigateur
│
├── shared/                            Code TypeScript partagé
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts                   Point d'entrée (ré-exporte tout)
│       ├── vector.ts / vector.test.ts       Vecteurs 2D (add, sub, scale, distance…)
│       ├── geometry.ts / geometry.test.ts   Formules masse↔aire↔rayon (metriques.md §2)
│       ├── protocol.ts                Types des messages WebSocket client↔serveur
│       ├── botIdentities.ts           Dictionnaire officiel des 108 robots et leurs couleurs (#HEX)
│       └── avatarPalette.ts           Palette de couleurs d'avatar choisissables + repli déterministe par pseudo
│
├── server/                            Serveur de jeu
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env / .env.example            DATABASE_URL, ADMIN_PASSWORD_HASH (non commité)
│   ├── db/
│   │   └── schema.sql                 Schéma PostgreSQL de référence (documentation)
│   ├── migrations/                    Migrations node-pg-migrate (source de vérité exécutable)
│   │   ├── ..._init.cjs                     Table players (squelette)
│   │   ├── ..._add-password-hash.cjs        + password_hash
│   │   ├── ..._full-account-model.cjs       + level/xp/premium/cosmetics, player_best_scores
│   │   ├── ..._add-banned-flag.cjs          + banned
│   │   ├── ..._seed-fanta-premium.cjs       UPDATE de données : premium=TRUE pour "Fanta"
│   │   └── ..._add-avatar-color.cjs         + avatar_color (avatar procédural, refonte UI/UX)
│   ├── configs/                       Configs des modes de jeu "paramétriques" (JSON)
│   │   ├── vanilla.json
│   │   ├── hardcore.json
│   │   └── folie.json
│   ├── scripts/
│   │   ├── hashPassword.mjs           Génère un hash argon2 pour ADMIN_PASSWORD_HASH
│   │   └── loadtest.mjs               Bots WebSocket pour valider la charge (Lot 1.8)
│   └── src/
│       ├── index.ts                   Point d'entrée process (assemble tout, démarre le serveur)
│       ├── log.ts / log.test.ts       Journalisation structurée (JSON sur stdout)
│       ├── db/
│       │   └── pool.ts                Pool de connexions PostgreSQL (paresseux)
│       ├── engine/                    Moteur de jeu générique (indépendant de tout mode)
│       │   ├── types.ts                     Entity, PlayerId, PlayerState…
│       │   ├── world.ts / world.test.ts     Monde de simulation (entités, tick)
│       │   ├── spatialHash.ts / .test.ts    Grille de collision broad-phase (évite le O(n²))
│       │   ├── mod.ts                       Interface GameMod (contrat des hooks de modding)
│       │   ├── room.ts / room.test.ts       Un salon = une simulation indépendante
│       │   ├── roomManager.ts / .test.ts    Registre des salons (créer/lister/rejoindre)
│       │   ├── roomIsolation.test.ts        Vérifie l'étanchéité entre salons
│       │   ├── resetSchedule.ts             Planification du reset auto (quotidien ou intervalle)
│       │   ├── xp.ts / xp.test.ts           XP/combo (masse mangée, joueurs mangés, multiplicateur)
│       │   └── bots/                        Système de robots (IA, régulation population)
│       │       ├── botTypes.ts              Profils ('fuis', 'neutre'...), nomenclature via BOT_IDENTITIES
│       │       ├── botEvaluator.ts          IA décisionnelle 2 Hz (utility evaluation)
│       │       └── botManager.ts            Gestion de la population (spawn progressif, IA étalée)
│       ├── accounts/                  Comptes joueurs (Lot 3)
│       │   ├── accountsRepository.ts        Requêtes SQL (table players, player_best_scores)
│       │   ├── passwords.ts                 Hachage/vérification argon2
│       │   ├── levels.ts                    Formule XP → niveau
│       │   ├── sessionStore.ts              Sessions en mémoire (token → session, TTL 24h, déconnexion)
│       │   └── service.ts                   Logique métier (inscription/connexion/déconnexion/profil)
│       ├── admin/
│       │   └── adminAuth.ts           Authentification admin (mot de passe unique, TTL, déconnexion)
│       └── net/                       Architecture réseau modulaire (HTTP + WebSockets)
│           ├── rateLimiter.ts               Rate limiter par fenêtre glissante (limitation IP 3 essais/min)
│           ├── server.ts                    Point d'assemblage léger HTTP + WebSocket (startGameServer)
│           ├── server.test.ts               Tests d'intégration réseau, sécurité et rate limiting
│           ├── http/
│           │   ├── httpUtils.ts             Lecture JSON, extraction IP/token Bearer, réponses JSON
│           │   ├── staticServer.ts          Serveur de fichiers statiques (anti path-traversal)
│           │   ├── router.ts                Routage HTTP central déléguant aux handlers
│           │   └── routes/
│           │       ├── lobby.ts             GET/POST /api/rooms, GET /api/modes, GET /api/stats
│           │       ├── auth.ts              POST /api/auth/register, /login, /logout, GET /api/account/me
│           │       └── admin.ts             POST /api/admin/login, /logout, GET/PATCH /api/admin/players
│           └── ws/
│               ├── connectionHandler.ts     Gestion des connexions WS, spectateurs, validation stricte d'inputs
│               └── broadcast.ts            Boucle onState (interest management, snapshots, combo, leaderboard)
│
├── client/                            Client joueur (React + Vite)
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts                 outDir → public/, publicDir → static/
│   ├── index.html                     Point d'entrée Vite (source — pas le build)
│   ├── static/                        Assets statiques SOURCE, copiés tels quels par le build
│   │   ├── manifest.json                    Manifeste PWA (nom, icônes, couleurs)
│   │   ├── service-worker.js                Cache offline de la coquille (Lot 7.2)
│   │   └── icons/                           Icônes PWA (192/512/maskable)
│   ├── public/                        ⚠️ GÉNÉRÉ par `vite build` — jamais édité à la main, gitignored
│   └── src/
│       ├── main.tsx                   Point d'entrée React (createRoot, <App/>)
│       ├── App.tsx                    État racine (accueil/jeu/sous-page selon l'URL, session, lobby, stats)
│       ├── router.ts                  Routeur maison (pushState + popstate, pas de dépendance) — voir §4.3
│       ├── styles.css                 Design tokens (palette "Onyx") + toutes les classes CSS
│       ├── modes.ts                   Métadonnées d'affichage par mode (nom/description/couleur)
│       ├── components/                Composants de jeu/accueil (voir §4.1)
│       ├── pages/                     Sous-pages plein écran (Compte/Profil/Paramètres/… — voir §4.2)
│       ├── auth.ts                    Client API comptes (login/register/logout/profile/avatar)
│       ├── lobby.ts                   Client API salons (liste/création/modes/stats serveur)
│       ├── support.ts                 Contenu de la page Soutenir (lien de don, texte)
│       ├── net.ts / net.test.ts       Connexion WebSocket au serveur de jeu (GameConnection)
│       ├── input.ts                   Capture souris/clavier → vecteur de direction + split
│       ├── render.ts / render.test.ts Rendu Canvas 2D (caméra, interpolation, couleur bot/joueur)
│       ├── stats.ts / stats.test.ts   Agrégation des morceaux du joueur (masse, barycentre)
│       └── debugOverlay.ts / .test.ts Écran de diagnostic F3 (FPS, GPU, réseau, système)
│
└── admin/                             Interface d'administration (React + Vite)
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts                 base: '/admin/' (préfixe d'URL), pas de publicDir
    ├── index.html                     Point d'entrée Vite (source)
    ├── public/                        ⚠️ GÉNÉRÉ par `vite build` — jamais édité à la main, gitignored
    └── src/
        ├── main.tsx                   Point d'entrée React
        ├── App.tsx                    État racine (login, vue active)
        ├── styles.css                 Design tokens (dupliqués de client/src/styles.css)
        ├── adminApi.ts                Client API admin (login/logout/recherche/édition de comptes)
        └── components/                Sidebar, AccountsView, PremiumView, PlaceholderView
```

---

## 3. Où vivent les assets, styles et animations

Le projet n'a **aucun asset graphique produit à la main** (pas de sprites, pas de sons, pas de
vidéos) — tout le rendu du jeu est **procédural**, dessiné directement sur le `<canvas>` par
`client/src/render.ts` (cercles/couleurs calculés, pas d'images chargées).

| Type | Emplacement | Détail |
|---|---|---|
| **Icônes PWA** | `client/static/icons/*.png` | 192px, 512px, 512px maskable — seuls fichiers image du dépôt |
| **Manifeste PWA** | `client/static/manifest.json` | Nom, couleurs, icônes déclarées à l'OS pour l'installation |
| **Service worker** | `client/static/service-worker.js` | Cache offline de la coquille statique uniquement |
| **Styles/design tokens** | `client/src/styles.css`, `admin/src/styles.css` | CSS pur, pas de préprocesseur ; palette "Onyx" (fond clair, encre/accent Onyx) en `:root` |
| **Animations d'interface** | Déclarées en CSS dans `styles.css` (`transition`, `@media (prefers-reduced-motion)`) | Pas de librairie d'animation (Framer Motion, etc.) |
| **Rendu du jeu (cellules, pastilles, grille, robots)** | `client/src/render.ts` | 100% procédural — couleurs calculées (`BOT_COLORS` pour les robots, avatar choisi ou déterministe par pseudo pour les joueurs, voir `shared/src/avatarPalette.ts`) |
| **Police** | Aucune — pile système uniquement (`-apple-system, ... sans-serif`) | Pas de police web externe |

---

## 4. Composants React — qui affiche quoi

### 4.1 Client — accueil et jeu (`client/src/components/`)

Refonte UI/UX (2026-07) : accueil en 3 colonnes toujours visibles (`ModeRoomList.tsx`/
`PlayPanel.tsx`/`CreateRoomPanel.tsx`), sous-pages avec URL propre pour tout le reste (§4.2) au
lieu de modales superposées.

| Composant | Rôle |
|---|---|
| `Home.tsx` | Composition racine de l'accueil : `TopNav` + 3 colonnes + `BottomBar` + `SpectatorBackground` |
| `TopNav.tsx` | Nav haute : marque (retour accueil), liens Classement/Modes de Jeux (wiki, nouvel onglet)/À Propos, cercle de compte (pseudo/avatar/niveau) — navigue via `router.ts`, pas de callback `onOpenPanel` |
| `ModeRoomList.tsx` | Colonne gauche : sélecteur de mode + classement des salons publics de ce mode |
| `PlayPanel.tsx` | Colonne centre : compteur de joueurs connectés, pseudo du blob, bouton "Rejoindre", classement global des salons |
| `CreateRoomPanel.tsx` | Colonne droite : création de salon privé (Premium — nom, mode, capacité, durée, public/privé) + rejoindre par code (tous) |
| `BottomBar.tsx` | Pied de page : version, marque, lien Soutenir |
| `SpectatorBackground.tsx` | Fond animé : connexion WebSocket en lecture seule (`?spectate=1`) au salon permanent, caméra fixe, réutilise `render.ts` |
| `Minimap.tsx` | Mini-carte 3x3 (secteurs A1-C3) affichée en jeu, position du joueur sur `mapSize` |
| `WikiPage.tsx` | Wiki joueur plein écran (route `/wiki`, nouvel onglet) — modes/monde/adversaires (dont un Bestiaire basé sur `BOT_IDENTITIES`)/à venir ; contenu pensé pour un joueur, pas une doc d'ingénierie |
| `GameView.tsx` | **Le seul composant qui touche au canvas en partie** — monte `<canvas>`, ouvre la connexion WebSocket, lance la boucle de rendu, HUD (stats/leaderboard live/minimap/bouton Quitter/écran de mort) |

### 4.2 Client — sous-pages (`client/src/pages/`)

Remplacent les anciennes modales superposées (`Panel.tsx`, `ProfileModal.tsx`, etc., supprimés) :
chaque sous-page a sa propre URL (voir `router.ts`, §4.3) et un bouton de retour, via la coquille
commune `PageLayout.tsx`.

| Page | Route | Rôle |
|---|---|---|
| `PageLayout.tsx` | — | Coquille commune (titre + bouton retour accueil), pas de backdrop/z-index empilés |
| `AccountPage.tsx` | `/compte` | Connexion/inscription/déconnexion (Profil et Paramètres sont des pages séparées, plus des boutons internes) |
| `ProfilePage.tsx` | `/profil` | Niveau/XP/Premium/cosmétiques/meilleurs scores **+ sélecteur de couleur d'avatar** (`AVATAR_PALETTE`, `PATCH /api/account/me`) |
| `SettingsPage.tsx` | `/parametres` | Plafond FPS (réglage local à l'appareil) |
| `LeaderboardPage.tsx` | `/classement` | Placeholder "bientôt disponible" |
| `SupportPage.tsx` | `/soutenir` | Explication du don libre + lien de don |
| `AboutPage.tsx` | `/a-propos` | Nom du projet, version, licence |

### 4.3 Routeur (`client/src/router.ts`)

Routeur maison minimal (pas de dépendance ajoutée) : `usePath()` (hook, état du pathname courant)
et `navigate(path)` (`history.pushState` + redéclenchement manuel de `popstate` pour que
`usePath` se resynchronise dans le même onglet). `App.tsx` fait le rendu selon `path` — session de
jeu active en priorité, puis `/wiki` (géré séparément, nouvel onglet), puis les sous-pages
connues (§4.2), puis l'accueil par défaut.

### 4.4 Admin (`admin/src/components/`)

| Composant | Rôle |
|---|---|
| `Sidebar.tsx` | Navigation latérale entre les 5 vues |
| `AccountsView.tsx` | Recherche/édition de comptes joueurs |
| `PremiumView.tsx` | Recherche + activation rapide du statut Premium |
| `PlaceholderView.tsx` | Composant générique réutilisé par Dashboard/Modération/Classements |

---

## 5. Points d'entrée et scripts

| Commande (racine) | Effet |
|---|---|
| `npm install` | Installe les dépendances des 4 workspaces |
| `npm run build` | Build `shared` → `server` → `client` → `admin` (dans cet ordre) |
| `npm test` | Lance tous les `*.test.ts` (vitest), y compris les tests Postgres si `DATABASE_URL` est définie |
| `npm run lint` | ESLint sur tout le dépôt (y compris `.tsx`) |
| `npm run format` / `format:check` | Prettier (écrit / vérifie seulement) |

---

## 6. Base de données (PostgreSQL)

Voir [server/db/schema.sql](server/db/schema.sql) pour le détail des tables :
- **`players`** : compte joueur (pseudo, hash de mot de passe, niveau/XP, Premium, cosmétiques,
  `avatar_color` — couleur d'avatar procédurale choisie par le joueur, nullable, voir
  `shared/src/avatarPalette.ts` — banni).
- **`player_best_scores`** : meilleur score par (joueur, mode de jeu).
- **Pas de table de sessions** : les tokens de connexion vivent en mémoire (`sessionStore.ts`) avec expiration TTL 24h.

---

## 7. Pour aller plus loin

- **Spécifications fonctionnelles & architecture backend / ce qu'il reste à faire** : voir [cahier_des_charges.md](cahier_des_charges.md).

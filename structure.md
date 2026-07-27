# structure.md — Cartographie du dépôt Angul.io

Ce document explique **à quoi sert chaque fichier/dossier** du monorepo, pour qu'une future
mise à jour (par toi ou par un agent) sache immédiatement où intervenir sans devoir relire tout
le code. Il complète les autres documents de référence plutôt que de les remplacer :

| Document | Sert à |
|---|---|
| [cahier_des_charges.md](cahier_des_charges.md) | Spécification produit/architecture du moteur de jeu (gameplay, réseau, comptes, licence) |
| [cahier_des_charges_ui_ux.md](cahier_des_charges_ui_ux.md) | Spécification de l'interface (design, composants, décisions UI/UX) |
| [metriques.md](metriques.md) | Formules de jeu (masse, vitesse, split, fusion…) |
| [plan_implementation.md](plan_implementation.md) | Suivi Lots/Sous-Lots, statut d'avancement |
| **structure.md** (ce fichier) | Rôle de chaque fichier, arborescence, où vivent les assets |
| [server/db/schema.sql](server/db/schema.sql) | Schéma PostgreSQL de référence, lisible sans relire les migrations |

Règle de mise à jour : si tu ajoutes/déplaces/supprimes un fichier qui mériterait une ligne
ici (un nouveau module, un nouveau composant, un nouvel asset), mets ce document à jour dans le
même commit — sinon il devient trompeur plus vite qu'utile.

---

## 1. Vue d'ensemble du monorepo

npm workspaces, 4 paquets :

```
shared/   code TypeScript partagé (types, constantes, formules géométriques)
server/   serveur de jeu (boucle de simulation, WebSocket, comptes, admin, mods)
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
├── cahier_des_charges_ui_ux.md        Spéc interface (design, composants)
├── metriques.md                       Formules de jeu
├── plan_implementation.md             Suivi Lots/Sous-Lots
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
│       └── protocol.ts                Types des messages WebSocket client↔serveur
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
│   │   └── ..._add-banned-flag.cjs          + banned
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
│       │   └── resetSchedule.ts             Planification du reset auto (quotidien ou intervalle)
│       ├── mods/                      Modes de jeu (implémentations de GameMod)
│       │   ├── parametric/                  Modes définis uniquement par des valeurs (JSON)
│       │   │   ├── config.ts                Schéma de config (ParametricModConfig)
│       │   │   ├── loadConfig.ts            Charge server/configs/*.json
│       │   │   ├── physics.ts               Formules vitesse/accélération selon la masse
│       │   │   ├── border.ts                Comportement aux bords de carte
│       │   │   ├── pieceState.ts            État par morceau (input, cooldowns)
│       │   │   ├── testConfig.ts            Config de test en dur (indépendante du disque)
│       │   │   └── index.ts                 Assemble tout en un GameMod (mode Vanilla/Folie)
│       │   └── hardcore/
│       │       └── index.ts                 Mode Hardcore (étend le paramétrique, mécaniques neuves)
│       ├── accounts/                  Comptes joueurs (Lot 3)
│       │   ├── accountsRepository.ts        Requêtes SQL (table players, player_best_scores)
│       │   ├── passwords.ts                 Hachage/vérification argon2
│       │   ├── levels.ts                    Formule XP → niveau
│       │   ├── sessionStore.ts              Sessions en mémoire (token → id de compte)
│       │   └── service.ts                   Logique métier (inscription/connexion/profil)
│       ├── admin/
│       │   └── adminAuth.ts           Authentification admin (mot de passe unique, réutilise sessionStore)
│       └── net/
│           └── server.ts              Serveur HTTP+WebSocket, toutes les routes /api/*, fichiers statiques
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
│       ├── App.tsx                    État racine (accueil/jeu, session, panneaux ouverts, lobby)
│       ├── styles.css                 Design tokens + toutes les classes CSS (source unique de style)
│       ├── modes.ts                   Métadonnées d'affichage par mode (nom/description/couleur)
│       ├── components/                Composants React (voir §4)
│       ├── auth.ts                    Client API comptes (login/register/profile)
│       ├── lobby.ts                   Client API salons (liste/création/modes)
│       ├── support.ts                 Contenu de la page Soutenir (lien de don, texte)
│       ├── net.ts / net.test.ts       Connexion WebSocket au serveur de jeu (GameConnection)
│       ├── input.ts                   Capture souris/clavier → vecteur de direction + split
│       ├── render.ts / render.test.ts Rendu Canvas 2D (caméra, interpolation, dessin des entités)
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
        ├── styles.css                 Design tokens (dupliqués de client/src/styles.css, §3.3 du doc UI/UX)
        ├── adminApi.ts                Client API admin (login/recherche/édition de comptes)
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
| **Service worker** | `client/static/service-worker.js` | Cache offline de la coquille statique uniquement (jamais l'API/WebSocket) |
| **Styles/design tokens** | `client/src/styles.css`, `admin/src/styles.css` | CSS pur, pas de préprocesseur ; palette/rayons/ombres en `:root` |
| **Animations d'interface** | Déclarées en CSS dans `styles.css` (`transition`, `@media (prefers-reduced-motion)`) | Pas de librairie d'animation (Framer Motion, etc.) — volontairement, voir §2.5 cahier_des_charges_ui_ux.md |
| **Rendu du jeu (cellules, pastilles, grille)** | `client/src/render.ts` | 100% procédural — couleurs/formes calculées, aucun fichier image |
| **Police** | Aucune — pile système uniquement (`-apple-system, ... sans-serif`), voir §1.3 cahier_des_charges_ui_ux.md | Pas de police web externe (poids, vie privée) |

**`client/public/` et `admin/public/` ne sont PAS des dossiers d'assets** : ce sont les dossiers
de sortie du build Vite (HTML/JS/CSS compilés), entièrement regénérés à chaque `vite build` et
exclus de git (`.gitignore`). Le dossier source des assets statiques du client s'appelle
`client/static/` — c'est lui qu'il faut éditer pour changer une icône ou le manifeste.

---

## 4. Composants React — qui affiche quoi

### 4.1 Client (`client/src/components/`)

| Composant | Rôle |
|---|---|
| `Home.tsx` | Écran d'accueil minimal : pseudo, bouton "Jouer", barre de navigation vers les panneaux |
| `Panel.tsx` | Coquille commune à tous les sous-panneaux (titre + bouton fermer) |
| `AccountPanel.tsx` | Connexion/inscription, ou état connecté + accès au profil |
| `RoomsPanel.tsx` | Liste des salons publics, création (Premium), rejoindre par code |
| `ModesPanel.tsx` | Cartes des modes de jeu (nom/description/couleur, via `modes.ts`) |
| `LeaderboardPanel.tsx` | Placeholder "bientôt disponible" (endpoint backend manquant, §10 doc UI/UX) |
| `SupportPanel.tsx` | Explication du don libre + lien Ko-fi |
| `ProfileModal.tsx` | Niveau/XP/Premium/cosmétiques/meilleurs scores du compte connecté |
| `GameView.tsx` | **Le seul composant qui touche au canvas** — monte `<canvas>`, ouvre la connexion WebSocket, lance la boucle de rendu ; tout est impératif à l'intérieur (pas de state React par frame), voir §2.5 du doc UI/UX |

`App.tsx` est le composant racine : bascule entre `Home`+panneaux et `GameView`, détient
l'état de session (auth, salons, modes, panneau ouvert).

### 4.2 Admin (`admin/src/components/`)

| Composant | Rôle |
|---|---|
| `Sidebar.tsx` | Navigation latérale entre les 5 vues |
| `AccountsView.tsx` | Recherche/édition de comptes joueurs (seule vue connectée à des données réelles autres que Premium) |
| `PremiumView.tsx` | Recherche + activation rapide du statut Premium (raccourci sur une action déjà existante) |
| `PlaceholderView.tsx` | Composant générique réutilisé par Dashboard/Modération/Classements (backend manquant) |

`App.tsx` gère le login (mot de passe unique) et la vue active.

---

## 5. Points d'entrée et scripts (pour s'y retrouver dans package.json)

| Commande (racine) | Effet |
|---|---|
| `npm install` | Installe les dépendances des 4 workspaces |
| `npm run build` | Build `shared` → `server` → `client` → `admin` (dans cet ordre, chacun dépend du précédent) |
| `npm test` | Lance tous les `*.test.ts` (vitest), y compris les tests Postgres si `DATABASE_URL` est définie |
| `npm run lint` | ESLint sur tout le dépôt (y compris les `.tsx`, règles React Hooks incluses) |
| `npm run format` / `format:check` | Prettier (écrit / vérifie seulement) |

| Commande (par workspace) | Effet |
|---|---|
| `npm run dev --workspace=client` (ou `admin`) | Serveur de développement Vite (HMR) |
| `npm run build --workspace=client` (ou `admin`) | `tsc --noEmit` (vérif de types) puis `vite build` |
| `npm run start --workspace=server` | Démarre `server/dist/index.js` (nécessite `npm run build` avant) |
| `npm run migrate:up --workspace=server` | Applique les migrations PostgreSQL en attente |
| `npm run hash-password --workspace=server` | Génère un hash pour `ADMIN_PASSWORD_HASH` |
| `npm run loadtest --workspace=server` | Bots WebSocket, validation de charge |

**Comment le serveur sert les deux apps** (`server/src/index.ts` → `server/src/net/server.ts`) :
- `client/public/` (build Vite du client) est servi à la racine (`/`).
- `admin/public/` (build Vite de l'admin) est servi sous `/admin/*` — d'où `base: '/admin/'`
  dans `admin/vite.config.ts` (sinon les assets buildés pointeraient vers `/bundle.js`, qui
  résoudrait vers le bundle du client, pas celui de l'admin).
- Aucun des deux serveurs de dev Vite (`npm run dev`) n'est utilisé en production : c'est
  toujours `server` (Node brut) qui sert les fichiers statiques déjà construits.

---

## 6. Base de données (PostgreSQL)

Voir [server/db/schema.sql](server/db/schema.sql) pour le détail commenté des tables. Résumé :

- **`players`** : un compte joueur (pseudo, hash de mot de passe, niveau/XP, Premium,
  cosmétiques, banni).
- **`player_best_scores`** : meilleur score par (joueur, mode de jeu).
- **Pas de table de sessions** : les tokens de connexion (joueur ET admin) vivent uniquement en
  mémoire serveur (`server/src/accounts/sessionStore.ts`), perdus au redémarrage.
- **Pas de table "modes"** : les modes de jeu sont des fichiers de config (`server/configs/*.json`)
  chargés dynamiquement, pas des lignes en base.

La source de vérité **exécutable** reste `server/migrations/` (node-pg-migrate) —
`server/db/schema.sql` est une photographie de documentation, à maintenir à la main en même
temps qu'une migration.

---

## 7. Pour aller plus loin

- Une question sur **pourquoi** une décision a été prise (pas juste ce qui existe) : voir
  [cahier_des_charges.md](cahier_des_charges.md) (moteur/backend) ou
  [cahier_des_charges_ui_ux.md](cahier_des_charges_ui_ux.md) (interface).
- Une question sur **ce qui reste à faire** : voir [plan_implementation.md](plan_implementation.md)
  (suivi par Lots) et le §10/§12 de cahier_des_charges_ui_ux.md (impacts backend et décisions
  encore ouvertes côté interface).
- Une question sur **une formule de jeu précise** (masse, vitesse, split…) : voir
  [metriques.md](metriques.md).

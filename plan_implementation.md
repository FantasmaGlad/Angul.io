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
| [2](#lot-2--salons-rooms) | Salons (rooms) | MVP | ⬜ À faire |
| [3](#lot-3--comptes-joueurs--persistance) | Comptes joueurs & persistance | MVP | ⬜ À faire |
| [4](#lot-4--deuxième-mode-de-jeu-validation-de-lapi-de-modding) | Deuxième mode de jeu (validation API) | MVP | ⬜ À faire |
| [5](#lot-5--interface-dadministration) | Interface d'administration | MVP | ⬜ À faire |
| [6](#lot-6--statut-premium--dons) | Statut Premium & dons | MVP | ⬜ À faire |
| [7](#lot-7--client-mobile-pwa) | Client mobile (PWA) | MVP | ⬜ À faire |
| [8](#lot-8--infrastructure--déploiement) | Infrastructure & déploiement | MVP | ⬜ À faire |
| [9](#lot-9--documentation--ouverture-communautaire-de-lapi-de-modding) | Documentation & ouverture communautaire | Phase 2 | ⬜ À faire |
| [10](#lot-10--scaling-multi-wyse) | Scaling multi-Wyse | Phase 2 | ⬜ À faire |

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
- **Statut :** ✅ Fait (2026-07-26)
- **Contenu :** GitHub Actions (`.github/workflows/ci.yml`) lançant format:check, lint,
  tests et build à chaque push/PR sur `main`.
- **Dépendances :** 0.3, 0.4.
- **Critère d'acceptation :** un push avec une erreur de lint ou un test cassé fait échouer
  la CI visiblement sur GitHub — à confirmer visuellement après le premier push de ce Lot
  (le workflow n'a pas encore tourné en conditions réelles sur GitHub).

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

- **Conclusion :** un gain réel et significatif (~42 %) obtenu par de la sérialisation plus
  compacte, sans toucher à l'architecture réseau (toujours un état complet par tick, pas de
  delta compression, pas d'interest management). **Ce n'est pas suffisant à 50 joueurs**
  (222 Mbit/s reste très probablement au-dessus de ce qu'une box Bouygue résidentielle
  peut fournir en continu) — à 10 joueurs (35 Mbit/s), c'est plus raisonnable mais encore
  significatif pour une ligne domestique partagée. **Le besoin d'interest management
  (n'envoyer à chaque client que les entités visibles autour de sa caméra) reste réel et
  devra être traité avant le Lot 8**, en particulier si l'objectif est de tenir le haut de
  la fourchette (50 joueurs). À revalider avec un vrai test de charge sur le Wyse derrière
  la box réelle (Lot 8), le résultat localhost ne mesurant que le coût serveur, pas la
  latence réseau réelle.

---

## Lot 2 — Salons (rooms)

Objectif : passer d'un salon unique codé en dur à un système de salons multiples,
créables, configurables, publics ou privés.

### 2.1 — Modèle de salon
- **Statut :** ⬜ À faire
- **Contenu :** structure de données d'un salon (mode de jeu associé, visibilité
  publique/privée, configuration de reset).
- **Dépendances :** Lot 1.
- **Critère d'acceptation :** plusieurs salons peuvent exister en mémoire simultanément,
  chacun avec sa propre simulation indépendante (§4.3).

### 2.2 — Lobby : liste et création de salons publics
- **Statut :** ⬜ À faire
- **Contenu :** écran client listant les salons publics actifs, avec création d'un salon
  (mode de jeu, nom).
- **Dépendances :** 2.1.
- **Critère d'acceptation :** un joueur peut voir la liste des salons publics et en
  rejoindre un depuis le client.

### 2.3 — Salons privés sur invitation
- **Statut :** ⬜ À faire
- **Contenu :** génération d'un lien ou code d'invitation pour rejoindre un salon non listé
  publiquement.
- **Dépendances :** 2.1.
- **Critère d'acceptation :** un salon marqué privé n'apparaît pas dans le lobby public,
  mais est rejoignable via son code/lien.

### 2.4 — Reset automatique des salons
- **Statut :** ⬜ À faire
- **Contenu :** planification configurable par salon, valeur par défaut 1x/24h à 10h
  (heure de Paris).
- **Dépendances :** 2.1.
- **Critère d'acceptation :** un salon se réinitialise automatiquement à l'heure prévue
  (testable avec une configuration de test à intervalle court).

### 2.5 — Isolation multi-salons sur un même serveur
- **Statut :** ⬜ À faire
- **Contenu :** vérifier qu'un bug ou une charge élevée dans un salon n'affecte pas les
  autres (isolation des boucles de simulation, éventuellement un Worker par salon).
- **Dépendances :** 2.1, Lot 1.8.
- **Critère d'acceptation :** test avec plusieurs salons actifs simultanément, chacun avec
  des joueurs, sans interférence observée entre eux.

---

## Lot 3 — Comptes joueurs & persistance

Objectif : remplacer les sessions anonymes par des comptes persistants (PostgreSQL),
support de l'authentification et des statistiques.

### 3.1 — Setup PostgreSQL et migrations
- **Statut :** ⬜ À faire
- **Contenu :** installation locale (dev) de PostgreSQL, outil de migration (ex.
  Prisma/Drizzle/node-pg-migrate — à choisir), schéma initial.
- **Dépendances :** Lot 0.
- **Critère d'acceptation :** migrations exécutables en local, schéma versionné dans le repo.

### 3.2 — Authentification (inscription/connexion)
- **Statut :** ⬜ À faire
- **Contenu :** pseudo + mot de passe, hachage argon2 (§5.1), validation d'unicité du pseudo.
- **Dépendances :** 3.1.
- **Critère d'acceptation :** création de compte et connexion fonctionnelles ; mots de
  passe jamais stockés ni loggés en clair (vérifié par relecture du code de stockage).

### 3.3 — Sessions/tokens
- **Statut :** ⬜ À faire
- **Contenu :** mécanisme de session (JWT ou cookie de session) pour maintenir un joueur
  connecté entre le lobby et une partie.
- **Dépendances :** 3.2.
- **Critère d'acceptation :** un joueur reste identifié entre la connexion HTTP (lobby) et
  la connexion WebSocket (partie), sans avoir à se réauthentifier.

### 3.4 — Modèle de compte joueur complet
- **Statut :** ⬜ À faire
- **Contenu :** niveau/XP, meilleur score par mode de jeu, statut Premium (booléen),
  cosmétiques débloqués (§5.2).
- **Dépendances :** 3.1.
- **Critère d'acceptation :** schéma en base couvrant tous les champs du tableau §5.2,
  lisible/modifiable via des requêtes de test.

### 3.5 — Écriture des stats en fin de partie
- **Statut :** ⬜ À faire
- **Contenu :** à la fin d'une partie (ou à la mort d'un joueur), écrire en base le score,
  mise à jour éventuelle du meilleur score et de l'XP — pas d'écriture à chaque tick (§4.4).
- **Dépendances :** 3.4, Lot 1.6.
- **Critère d'acceptation :** une partie jouée met à jour les stats du compte en base,
  visible après reconnexion.

### 3.6 — Écran de profil joueur
- **Statut :** ⬜ À faire
- **Contenu :** page client affichant pseudo, niveau, meilleurs scores par mode, statut
  Premium, cosmétiques.
- **Dépendances :** 3.4, 3.5.
- **Critère d'acceptation :** un joueur connecté peut consulter son profil à jour.

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
- **Statut :** ⬜ À faire
- **Contenu :** trancher parmi la liste du §3.4 — **un mode non paramétrique**, qui
  demande une logique nouvelle (Folie ne compte pas, voir note ci-dessus). Recommandation
  inchangée : privilégier **Hardcore** (#2) ou **Précision/Sniper** (#8), plus simples que
  Classes (#5) ou Battle Royale (#6).
- **Dépendances :** Lot 1.6.
- **Critère d'acceptation :** mode choisi et acté dans le Journal des décisions.

### 4.2 — Spécification chiffrée du mode choisi
- **Statut :** ⬜ À faire
- **Contenu :** figer les valeurs (multiplicateurs, pénalités, densité de spawn, etc.),
  sur le modèle du tableau §3.5 pour Vanilla, et ajouter une nouvelle section formules
  dans [metriques.md](metriques.md) (§14) sur le modèle de la section Vanilla.
- **Dépendances :** 4.1.
- **Critère d'acceptation :** tableau de valeurs ajouté au cahier des charges, et section
  correspondante ajoutée dans metriques.md.

### 4.3 — Implémentation du mode comme mod indépendant
- **Statut :** ⬜ À faire
- **Contenu :** développement sans aucune modification du moteur central (Lot 1.2/1.3).
- **Dépendances :** 4.2.
- **Critère d'acceptation :** le mode tourne dans un salon dédié ; aucune ligne du moteur
  central (hors ajout d'un hook manquant, à documenter si nécessaire) n'a été modifiée.

### 4.4 — Sélecteur de mode à la création de salon
- **Statut :** ⬜ À faire
- **Contenu :** extension du lobby (Lot 2.2) pour choisir le mode de jeu à la création d'un
  salon.
- **Dépendances :** 4.3, Lot 2.2.
- **Critère d'acceptation :** un salon peut être créé en mode Vanilla ou dans le second
  mode, depuis l'interface.

### 4.5 — Bilan de l'API de hooks
- **Statut :** ⬜ À faire
- **Contenu :** revue des limites rencontrées pendant 4.3 (hooks manquants, granularité
  insuffisante, etc.) avant de considérer l'API comme stable pour la Phase 2 (Lot 9).
- **Dépendances :** 4.3.
- **Critère d'acceptation :** liste des ajustements nécessaires (s'il y en a) consignée
  dans le Journal des décisions, avec décision de les traiter maintenant ou en Phase 2.

---

## Lot 5 — Interface d'administration

Objectif : donner un outil de gestion du jeu, séparé du client joueur (§5.4).

### 5.1 — Authentification admin
- **Statut :** ⬜ À faire
- **Contenu :** compte admin unique pour le MVP, authentification séparée du compte joueur.
- **Dépendances :** Lot 3.2.
- **Critère d'acceptation :** l'interface admin n'est accessible qu'après authentification
  admin dédiée.

### 5.2 — Gestion des comptes joueurs
- **Statut :** ⬜ À faire
- **Contenu :** recherche, consultation, modification, bannissement d'un compte.
- **Dépendances :** 5.1, Lot 3.4.
- **Critère d'acceptation :** un compte peut être recherché par pseudo, consulté, banni,
  et un compte banni ne peut plus se connecter.

### 5.3 — Gestion manuelle XP/niveau
- **Statut :** ⬜ À faire
- **Contenu :** correction manuelle en cas de bug ou de litige.
- **Dépendances :** 5.2.
- **Critère d'acceptation :** l'admin peut modifier le niveau/XP d'un compte et voir le
  changement reflété côté joueur.

### 5.4 — Gestion manuelle des cosmétiques et activation Premium
- **Statut :** ⬜ À faire
- **Contenu :** attribution manuelle de cosmétiques, activation du statut Premium (lien
  avec Lot 6.3, tant que l'automatisation n'existe pas).
- **Dépendances :** 5.2, Lot 3.4.
- **Critère d'acceptation :** l'admin peut activer le statut Premium d'un compte, qui
  débloque immédiatement la création de salon côté joueur (Lot 6.4).

### 5.5 — Gestion des salons actifs & modération des mods (Phase 2, différé)
- **Statut :** ⏸️ Différé (Phase 2)
- **Dépendances :** Lot 9.
- **Critère d'acceptation :** défini au moment de l'attaque du Lot 9.

---

## Lot 6 — Statut Premium & dons

Objectif : mettre en place le circuit don → statut Premium (§5.3).

### 6.1 — Choix de la plateforme de don
- **Statut :** ⬜ À faire
- **Contenu :** comparer les options (Ko-fi, Liberapay, PayPal.Me, GitHub Sponsors...) selon
  frais, simplicité d'intégration, disponibilité en France.
- **Dépendances :** aucune.
- **Critère d'acceptation :** plateforme choisie et actée dans le Journal des décisions.

### 6.2 — Page dédiée don/soutien
- **Statut :** ⬜ À faire
- **Contenu :** page client expliquant le statut Premium et pointant vers le lien de don.
- **Dépendances :** 6.1.
- **Critère d'acceptation :** page accessible depuis le menu principal.

### 6.3 — Activation manuelle du statut Premium (MVP)
- **Statut :** ⬜ À faire
- **Contenu :** processus manuel : toi (admin) actives le statut via l'interface (Lot 5.4)
  après réception d'un don.
- **Dépendances :** Lot 5.4.
- **Critère d'acceptation :** un don reçu peut être suivi d'une activation Premium en moins
  de quelques clics dans l'admin.

### 6.4 — Fonctionnalité rattachée : création de salon réservée Premium
- **Statut :** ⬜ À faire
- **Contenu :** restriction de la création de salon (Lot 2.2) aux comptes Premium ; les
  comptes standards rejoignent les salons existants.
- **Dépendances :** Lot 3.4, Lot 2.2.
- **Critère d'acceptation :** un compte non-Premium ne voit pas/ne peut pas utiliser le
  bouton de création de salon ; un compte Premium le peut.

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
- **Statut :** ⬜ À faire
- **Contenu :** `manifest.json`, jeu d'icônes, couleur de thème.
- **Dépendances :** Lot 1.7.
- **Critère d'acceptation :** le navigateur propose l'installation ("Ajouter à l'écran
  d'accueil") sur Android/Chrome.

### 7.2 — Service worker
- **Statut :** ⬜ À faire
- **Contenu :** mise en cache des assets statiques, fonctionnement hors-ligne des écrans
  ne nécessitant pas de réseau (menu).
- **Dépendances :** 7.1.
- **Critère d'acceptation :** l'application se lance et affiche le menu même sans connexion
  réseau ; les parties elles-mêmes nécessitent bien une connexion (non concerné par le cache).

### 7.3 — Validation d'installation sur Android
- **Statut :** ⬜ À faire
- **Contenu :** test réel sur un appareil Android (Chrome) : installation, lancement plein
  écran, absence de barre de navigateur.
- **Dépendances :** 7.1, 7.2.
- **Critère d'acceptation :** l'app installée se comporte visuellement comme une app native.

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
- **Statut :** ⬜ À faire
- **Contenu :** enregistrement d'un sous-domaine DuckDNS, script de mise à jour automatique
  en filet de sécurité si l'IP publique change.
- **Dépendances :** 8.2.
- **Critère d'acceptation :** le nom de domaine DuckDNS résout vers l'IP publique actuelle ;
  le script de mise à jour tourne en tâche planifiée sur le Wyse.

### 8.4 — Script install.sh
- **Statut :** ⬜ À faire
- **Contenu :** bootstrap complet d'un nœud : dépendances système, service systemd pour le
  serveur de jeu, PostgreSQL, reverse proxy.
- **Dépendances :** 8.1, Lot 3.1.
- **Critère d'acceptation :** exécuter `install.sh` sur une machine Ubuntu fraîche amène à
  un serveur fonctionnel sans étape manuelle supplémentaire (hors configuration réseau §8.2).

### 8.5 — Reverse proxy / TLS
- **Statut :** ⬜ À faire
- **Contenu :** Caddy ou Nginx + Let's Encrypt pour servir le client en HTTPS et le
  WebSocket en WSS.
- **Dépendances :** 8.3, 8.4.
- **Critère d'acceptation :** le jeu est accessible en HTTPS/WSS depuis un navigateur
  externe, certificat valide.

### 8.6 — Monitoring basique
- **Statut :** ⬜ À faire
- **Contenu :** logs applicatifs persistés, alerte simple (mail/notification) si le
  service tombe.
- **Dépendances :** 8.4.
- **Critère d'acceptation :** un arrêt du service génère une alerte reçue par toi.

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

## Journal des décisions et avancées

*Ajoute une ligne datée à chaque décision technique prise en cours de route, ou à chaque
Lot/Sous-Lot significatif terminé. Les entrées les plus récentes en haut.*

| Date | Entrée |
|---|---|
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

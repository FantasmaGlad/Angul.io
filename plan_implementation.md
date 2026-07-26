# Plan d'implémentation — Angul.io

**Document vivant.** Ce plan découpe le développement en **Lots** (grandes étapes livrables)
et **Sous-Lots** (tâches concrètes). Il doit être tenu à jour à chaque avancée pour que
n'importe qui (y compris toi dans six mois) puisse savoir en un coup d'œil ce qui est fait,
en cours, ou pas commencé — sans avoir à relire tout l'historique du projet.

Référence : voir [cahier_des_charges.md](cahier_des_charges.md) pour le détail fonctionnel
et les justifications d'architecture. Les sections `§X` citées ci-dessous renvoient à ce document.

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
| [0](#lot-0--cadrage--fondations-du-projet) | Cadrage & fondations du projet | Transverse | 🔶 En cours |
| [1](#lot-1--socle-technique-moteur-de-jeu) | Socle technique moteur de jeu | MVP | ⬜ À faire |
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
- **Statut :** ⬜ À faire
- **Contenu :** trancher, ou décider de trancher par playtest en cours de Lot 1 :
  - Formule de décroissance de la vélocité selon la masse.
  - Moteur de rendu client : Canvas 2D natif vs. PixiJS.
- **Dépendances :** aucune, mais bloque le début du Lot 1.7 (rendu client) si non tranché.
- **Critère d'acceptation :** les deux points ont une réponse (même provisoire, ajustable)
  actée dans le Journal des décisions.

### 0.3 — Initialisation du dépôt et structure du monorepo
- **Statut :** 🔶 En cours (2026-07-26) — dépôt Git local initialisé, `.gitignore` en place.
  Restant : structure de dossiers (`server/`, `client/`, `admin/`, `shared/`), README initial,
  et premier push sur GitHub (le dépôt reste local pour l'instant).
- **Contenu :** `git init`, structure de dossiers (`server/`, `client/`, `admin/`, `shared/`),
  `.gitignore`, README initial avec description courte + lien vers le cahier des charges.
- **Critère d'acceptation :** dépôt Git initialisé, structure de dossiers en place, premier
  commit poussé sur GitHub (dépôt créé en public ou privé selon préférence à ce stade).

### 0.4 — Outillage de développement
- **Statut :** ⬜ À faire
- **Contenu :** choix du gestionnaire de paquets (npm/pnpm), configuration TypeScript
  partagée, linter/formatter (ESLint + Prettier), framework de tests (Vitest ou Jest).
- **Critère d'acceptation :** `npm install` + `npm run lint` + `npm test` fonctionnent à
  la racine du monorepo sans erreur sur un projet vide.

### 0.5 — Licence du projet
- **Statut :** ⬜ À faire
- **Contenu :** ajout du fichier `LICENSE` (AGPLv3, §6), mention de la licence et de
  l'origine du projet dans le README.
- **Dépendances :** 0.3.
- **Critère d'acceptation :** fichier LICENSE présent à la racine, en-tête ou mention de
  licence cohérente dans le README.

### 0.6 — Intégration continue basique (optionnel mais recommandé)
- **Statut :** ⬜ À faire
- **Contenu :** GitHub Actions (ou équivalent) lançant lint + tests à chaque push.
- **Dépendances :** 0.3, 0.4.
- **Critère d'acceptation :** un push avec une erreur de lint ou un test cassé fait échouer
  la CI visiblement sur GitHub.

---

## Lot 1 — Socle technique moteur de jeu

Objectif : avoir un salon unique jouable de bout en bout (client ↔ serveur), avec le mode
Vanilla codé comme un mod — validation de l'architecture de modding décrite en §3.2.

### 1.1 — Modèle de données du monde (types partagés)
- **Statut :** ⬜ À faire
- **Contenu :** types TypeScript partagés client/serveur pour entités (joueur, morceau,
  particule), monde, salon — dans `shared/`.
- **Dépendances :** Lot 0.
- **Critère d'acceptation :** types compilables, importables des deux côtés (`server/` et
  `client/`) sans duplication.

### 1.2 — Boucle de jeu à tick fixe + partitionnement spatial
- **Statut :** ⬜ À faire
- **Contenu :** boucle de simulation serveur (20-30 Hz, §4.3), grille ou quadtree pour les
  collisions (éviter le O(n²)).
- **Dépendances :** 1.1.
- **Critère d'acceptation :** simulation tournant en continu à fréquence stable (mesurée),
  détection de collision fonctionnelle testée avec un nombre croissant d'entités (ex. 500+
  particules) sans dégradation notable du tick.

### 1.3 — Serveur WebSocket
- **Statut :** ⬜ À faire
- **Contenu :** connexion/déconnexion, ping/pong, gestion de la reconnexion côté client
  (§4.2).
- **Dépendances :** 1.2.
- **Critère d'acceptation :** un client peut se connecter, être déconnecté proprement,
  et se reconnecter sans redémarrer le serveur.

### 1.4 — Protocole réseau (sérialisation des messages)
- **Statut :** ⬜ À faire
- **Contenu :** format des messages client→serveur (input joueur) et serveur→client (état
  du monde). Pour le MVP, un envoi d'état complet par tick est acceptable ; delta
  compression et interest management (§4.2) sont des **optimisations à ajouter après un
  premier prototype fonctionnel**, une fois le besoin confirmé empiriquement (Lot 1.8).
- **Dépendances :** 1.1, 1.3.
- **Critère d'acceptation :** un client affiche l'état du monde reçu du serveur en continu.

### 1.5 — API de hooks/événements du moteur (cœur de l'architecture de modding)
- **Statut :** ⬜ À faire
- **Contenu :** définition et implémentation des hooks listés en §3.2/§3.4 :
  `onPlayerSpawn`, `onTick`, `onIntervalTick`, `onCollision`, `onPlayerEat`,
  `onPlayerSplit`, `onPlayerMerge`, `onPlayerDeath`. Mécanisme d'enregistrement d'un mod
  (module isolé qui s'abonne aux hooks) sans toucher au moteur central.
- **Dépendances :** 1.2.
- **Critère d'acceptation :** un mod "vide" (aucune règle) peut être chargé par le moteur
  sans erreur ; les hooks sont bien déclenchés dans le bon ordre (vérifiable par logs/tests).
- **Note :** c'est le sous-lot le plus structurant du projet — les questions ouvertes du
  §3.3 (langage des mods, granularité de l'API, mods pouvant ajouter des assets) doivent
  être au moins provisoirement tranchées ici, et actées dans le Journal des décisions.

### 1.6 — Mode Vanilla implémenté comme mod
- **Statut :** ⬜ À faire
- **Contenu :** implémentation intégrale des règles chiffrées du §3.5 (masse de départ,
  split 50/50, cooldown de fusion 30s, seuils de masse, perte passive, mur bloquant aux
  bords, etc.) en tant que module utilisant uniquement l'API de hooks du 1.5.
- **Dépendances :** 1.5.
- **Critère d'acceptation :** toutes les valeurs du tableau §3.5 sont respectées et
  testées (tests unitaires sur les règles de masse/split/fusion/collision) ; le mode est
  jouable de bout en bout.

### 1.7 — Client de rendu basique
- **Statut :** ⬜ À faire
- **Contenu :** rendu Canvas 2D (ou PixiJS selon 0.2), connexion WebSocket, contrôle
  souris/clavier (déplacement, split), interpolation d'affichage pour lisser la latence
  (§4.2).
- **Dépendances :** 0.2, 1.4.
- **Critère d'acceptation :** un joueur peut se déplacer, manger des particules, grossir,
  splitter, et voir les autres joueurs connectés au même salon, avec un rendu fluide.

### 1.8 — Validation empirique de charge
- **Statut :** ⬜ À faire
- **Contenu :** test avec bots ou clients simulés pour valider la fréquence de tick, la
  bande passante montante réelle sur la ligne Bouygue, et décider si delta
  compression/interest management (1.4) doivent être implémentés avant la mise en prod.
- **Dépendances :** 1.6, 1.7.
- **Critère d'acceptation :** mesures de bande passante et de stabilité du tick consignées
  dans le Journal des décisions, avec une décision explicite sur le besoin d'optimisation
  réseau immédiat ou différé.

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

### 4.1 — Choix du mode à développer en second
- **Statut :** ⬜ À faire
- **Contenu :** trancher parmi la liste du §3.4. Recommandation : privilégier **Hardcore**
  (#2) ou **Précision/Sniper** (#8), plus simples que Classes (#5) ou Battle Royale (#6),
  pour un premier test d'API rapide à livrer.
- **Dépendances :** Lot 1.6.
- **Critère d'acceptation :** mode choisi et acté dans le Journal des décisions.

### 4.2 — Spécification chiffrée du mode choisi
- **Statut :** ⬜ À faire
- **Contenu :** figer les valeurs (multiplicateurs, pénalités, densité de spawn, etc.),
  sur le modèle du tableau §3.5 pour Vanilla.
- **Dépendances :** 4.1.
- **Critère d'acceptation :** tableau de valeurs ajouté au cahier des charges ou en annexe.

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
| 2026-07-26 | Dépôt Git local initialisé (branche `main`), `.gitignore` ajouté, premier commit avec le cahier des charges et ce plan. Convention actée : pas de mention de co-auteur IA dans les commits de ce projet. |
| 2026-07-26 | Rédaction du cahier des charges (v0.2) et de ce plan d'implémentation. Aucun code écrit à ce stade — le projet démarre au Lot 0.2. |

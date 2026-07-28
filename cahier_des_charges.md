# Cahier des charges — Angul.io

**Version :** 0.3 — Document de référence mis à jour  
**Date :** 27 juillet 2026  
**Auteur :** Fanta  

---

## 1. Vision du projet

**Nom du projet : Angul.io** — de *angulus*, "angle" en latin. Référence à la géométrie et
aux formes qui s'assemblent et se divisent, cohérente avec la mécanique de split au cœur du
jeu, dans les codes de nommage courts et abstraits du genre .io (Agar.io, Slither.io, Diep.io).

Créer une **plateforme de jeu multijoueur en temps réel inspirée d'Agar.io**, dont la valeur
différenciante n'est pas le gameplay de base (bien connu, simple à répliquer) mais :

1. Un **système de salons** configurables (publics de base + privés sur invitation).
2. Un **système de modes de jeu ("mods")** permettant de proposer des variantes de règles
   (vanilla, "hardcore", "folie", etc.).
3. À terme, une **API de modding ouverte à la communauté**, avec documentation, pour que
   des tiers puissent développer et soumettre leurs propres modes.

Le projet est scindé en deux phases distinctes :

- **Phase 1 (MVP - Réalisée)** : jouer entre amis, un serveur physique, modes paramétriques,
  comptes joueurs persistants, sécurité & rate-limiting, système de bots à 108 identités.
- **Phase 2 (Extension & Scaling)** : isolation multi-threads des salons, scaling horizontal multi-machines,
  API de mods communautaires documentée et sandboxée.

---

## 2. Périmètre fonctionnel

### 2.1 MVP (Phase 1 — Réalisée)

| Fonctionnalité | État | Détail |
|---|---|---|
| Gameplay de base | ✅ Fait | Grossir en absorbant des particules et d'autres joueurs (mécanique Agar.io) |
| Salons | ✅ Fait | Salons publics par défaut + création de salons privés par code à 6 chiffres |
| Reset des salons | ✅ Fait | Configurable par salon ; par défaut quotidien ou à intervalle fixe |
| Comptes joueurs | ✅ Fait | Compte persistant : pseudo, mot de passe argon2, stats, XP/niveaux, cosmétiques |
| Interface Admin | ✅ Fait | Authentification admin, recherche et modération/édition des comptes, statut Premium |
| Sécurité & Réseau | ✅ Fait | Rate limiting (3 essais/min par IP), validation stricte des inputs WS (anti NaN / anti speed-hack), sessions avec expiration 24h & endpoints `/logout` |
| Système de Robots | ✅ Fait | 108 identités/couleurs uniques, IA lissée à 2 Hz et étalée sur les ticks, spawn progressif |
| Modes de jeu | ✅ Fait | Mode Vanilla + modes Hardcore et Folie basés sur l'architecture de hooks `GameMod` |
| Client & PWA | ✅ Fait | Application web React + Canvas 2D procédural, PWA installable avec service worker offline |

### 2.2 Extension & Scaling (Phase 2 — À venir)

- **Isolation multi-threads des salons (`worker_threads`)**.
- **Scaling horizontal multi-machines (multi-Wyse)**.
- **API de mods publique et documentée** avec sandboxing du code tiers.
- **Matchmaking inter-serveurs** et intégrations de paiements automatiques pour le statut Premium.

---

## 3. Système de modes de jeu (Modding)

### 3.1 Architecture

Chaque salon tourne avec un **mode de jeu** (`GameMod`) :
- Le moteur de jeu exposant des hooks : `onPlayerSpawn`, `onPlayerEat`, `onTick`, `onCollision`, `onPlayerDeath`, `transformScoreForAccount`.
- Les modes paramétriques (`server/src/mods/parametric/`) permettent d'ajuster les règles via des fichiers JSON (`configs/*.json`).
- Le mode Vanilla est écrit comme un mod, garantissant que l'architecture est générique.

---

## 4. Ce qu'il reste à faire (Roadmap des Lots Futurs)

### 4.1 Multi-Threading par Salon (`worker_threads`) — Échéance Court/Moyen Terme
- **Constat actuel** : La simulation de tous les salons s'exécute sur le thread principal Node.js. Bien que les bots aient été optimisés (IA étalée et spawn progressif), un pic de charge sur un salon très peuplé partage l'event-loop avec les autres salons.
- **Objectif** : Isolateur chaque salon dans son propre `worker_thread` Node.js.
- **Architecture ciblée** :
  - Le **thread principal** gère les sockets WebSocket, l'API HTTP, l'authentification et le routage des messages.
  - Chaque **Worker Thread** fait tourner le tick physique (20 Hz), les collisions (`SpatialHash`) et l'IA des bots d'un salon.
  - La communication inter-threads transmet uniquement les snapshots compacts à diffuser au réseau.

### 4.2 Scaling Horizontal Multi-Nœuds (Multi-Wyse / Infrastructure Multi-Serveurs)
- **Constat actuel** : Le serveur fonctionne sur une seule machine physique (Wyse 5070).
- **Objectif** : Répartir la charge sur plusieurs serveurs physiques tout en offrant une entrée unique pour les joueurs.
- **Architecture ciblée** :
  - **Coordinateur / Load Balancer** : Proxy Nginx/HAProxy ou service central orientant le client vers le nœud hébergeant le salon demandé.
  - **Session Store Partagé** : Migration du `sessionStore` mémoire vers **Redis** pour qu'un token de connexion soit valide quel que soit le nœud serveur contacté.
  - **Registre de Salons Distribué** : Publication des métadonnées des salons actifs dans Redis Pub/Sub.

### 4.3 Ouverture de l'API de Modding Communautaire & Sandboxing
- **Documentation et SDK** : Publier une documentation claire du contrat `GameMod` et des hooks disponibles.
- **Sandboxing du code tiers** : Pour autoriser l'exécution de mods soumis par la communauté sans risque pour le serveur, isoler l'exécution du code JS tiers dans un contexte sécurisé (ex: `isolated-vm` ou Worker avec privilèges restreints) afin de limiter la mémoire et le temps CPU.

### 4.4 Améliorations UI/UX & Fonctionnalités Backend Réduites
- **Leaderboard Global** : Implémenter l'endpoint backend et la vue client pour le classement général des joueurs (meilleurs scores cumulés).
- **Intégration Paiement Premium** : Connecter l'activation du statut Premium à un Webhook automatique (ex: Stripe ou Ko-fi) en remplacement de la gestion manuelle via l'admin.

---

## 5. Sécurité, Rétention & Règle d'Architecture

- **Validation des entrées WebSocket** : Le serveur rejette/sanitise les coordonnées `target` invalides (`NaN`, `Infinity`), borne `intensity` dans `[0.0, 1.0]` et valide `split`.
- **Protection Rate-Limiting** : Fenêtre glissante de 60s autorisant un maximum de **3 tentatives par minute par IP** sur le login joueur, le login admin et l'ouverture de connexion WebSocket.
- **Rétention des Sessions** : Expiration automatique des jetons de session après 24 heures (TTL) et révocation explicite sur les endpoints `POST /api/auth/logout` et `POST /api/admin/logout`.

---

## 6. Licence

**GNU Affero General Public License v3 (AGPLv3)**.
Le code source est libre et toute modification exécutée en tant que service réseau (SaaS) doit être redistribuée sous la même licence.

---

## 7. Infrastructure et Déploiement

- **Production** : Wyse 5070, Debian/Ubuntu LTS, Node.js >= 20, PostgreSQL.
- **Développement** : Ubuntu 26.04 LTS, Workspaces npm, Vitest, TypeScript.
- **Amorçage** : Script `install.sh` automatisé.

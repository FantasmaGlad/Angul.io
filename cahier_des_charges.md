# Cahier des charges — Angul.io

**Version :** 0.2 — Document de travail
**Date :** 26 juillet 2026
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
   (vanilla, "ultra", "refusion instantanée", "wtf avec classes", etc.).
3. À terme, une **API de modding ouverte à la communauté**, avec documentation, pour que
   des tiers puissent développer et soumettre leurs propres modes (ex. un mode "zombie").

Le projet est volontairement scindé en deux phases distinctes :

- **Phase 1 (MVP)** : jouer entre amis, un seul serveur physique, un mode vanilla + 1-2 variantes,
  comptes joueurs persistants.
- **Phase 2 (Extension)** : API de mods stable et documentée, scaling multi-machines,
  ouverture communautaire.

Ce document couvre principalement la Phase 1, mais pose les fondations d'architecture pour
que la Phase 2 ne nécessite pas de réécriture complète.

---

## 2. Périmètre fonctionnel

### 2.1 MVP (Phase 1)

| Fonctionnalité | Détail |
|---|---|
| Gameplay de base | Grossir en absorbant des particules et d'autres joueurs (mécanique Agar.io) |
| Salons | Salons publics par défaut + création de salons privés sur invitation |
| Reset des salons | Configurable par salon ; par défaut 1 fois/24h à 10h (heure de Paris) |
| Comptes joueurs | Compte persistant : pseudo, stats, XP, cosmétiques déblocables |
| Modes de jeu | Mode "vanilla" + au moins 1 mode alternatif pour valider l'architecture de scripting |
| Client | Application web (navigateur), déclinée en PWA installable sur mobile (Android en priorité) — un seul code client, voir §4.6 |
| Capacité cible | 10 à 50 joueurs simultanés |
| Hébergement | Un boîtier Wyse 5070, connexion domestique (box Bouygue) en NAT/PAT |

### 2.2 Hors périmètre MVP (Phase 2+)

- API de mods publique, documentée, avec système de soumission/validation communautaire.
- Scaling horizontal multi-Wyse (plusieurs machines physiques).
- Sandboxing avancé des mods tiers.
- Matchmaking inter-serveurs, découverte automatique de nœuds.

---

## 3. Le "cœur" du gameplay : système de modes de jeu

C'est le point le plus structurant du projet et celui qui dicte l'essentiel des choix
d'architecture backend.

### 3.1 Principe

Chaque salon tourne avec un **mode de jeu** = un ensemble de règles pouvant modifier :
- Les conditions de spawn, de croissance, de mort, de split.
- Les objets ramassables et leurs effets (power-ups).
- Les classes de personnages et leurs capacités spéciales (mode "wtf classes").
- Le cycle de vie de la partie (mode "refusion instantanée" = pas de perte de masse en cas de mort,
  ou un autre comportement à définir précisément avec toi plus tard).

### 3.2 Implication technique majeure

Tu as demandé un **vrai système de scripting/plugins**, pas juste des paramètres. Cela signifie
concrètement :

- Le moteur de jeu ("core") doit exposer une **API de hooks/événements** claire :
  `onPlayerSpawn`, `onPlayerEat`, `onTick`, `onCollision`, `onPlayerDeath`, etc.
- Un mode de jeu = un module de code (probablement un fichier/dossier isolé) qui s'abonne
  à ces hooks et implémente sa propre logique, **sans avoir à toucher au moteur central**.
- Le mode "vanilla" doit lui-même être écrit **comme un mod**, pour valider que l'API
  de modding suffit à recréer le jeu de base (bon test de robustesse de l'architecture).
- La confiance modérée que tu as choisie (review manuelle avant activation, pas de
  sandboxing strict au MVP) est raisonnable **tant que c'est toi seul qui écris les mods**.
  Le sandboxing (isolation mémoire/CPU du code d'un mod tiers) devient nécessaire dès que
  des mods externes non revus par toi tournent sur ta machine — à traiter en Phase 2,
  mais à garder en tête dès la conception de l'API pour ne pas avoir à tout refaire.

### 3.3 Questions encore ouvertes (à trancher avant développement)

- Langage des mods : même langage que le serveur (le plus simple), ou langage de scripting
  embarqué (type Lua) pour isoler plus facilement le code tiers plus tard ?
- Granularité de l'API : un mod peut-il redéfinir la physique de collision entièrement, ou
  seulement réagir à des événements avec des règles prédéfinies ?
- Un mod peut-il ajouter des assets (sprites, sons) ou seulement de la logique ?

### 3.4 Proposition de modes de jeu (base de brainstorm, à retravailler)

Liste de départ pour valider la diversité de ce que l'API de mods doit pouvoir exprimer.

| # | Mode | Description | Hooks/mécaniques sollicités |
|---|---|---|---|
| 1 | **Vanilla** | Le Agar.io classique : grossir en mangeant particules et joueurs, split manuel avec perte de masse temporaire, pas de modificateur. Sert de mode de référence et de test de l'API (écrit lui-même comme un mod). | `onTick`, `onCollision`, `onPlayerSplit` |
| 2 | **Hardcore** | Gains de masse multipliés (x10 ou configurable), mais mort plus punitive (perte totale de la progression XP de la partie en cas de mort, pas seulement de la masse en jeu). Parties plus tendues, plus courtes. | `onPlayerEat` (multiplicateur), `onPlayerDeath` (pénalité) |
| 3 | **Rapid Split / Fusion Express** | Split rapide (cooldown réduit) et fusion accélérée des morceaux (recombinaison bien plus rapide que le vanilla, avec un cooldown court plutôt que nul, pour garder un minimum de décision tactique). | `onPlayerSplit`, `onPlayerMerge`, timers de cooldown |
| 4 | **Chaos** | Toutes les 30 secondes, un modificateur aléatoire s'applique à toute la partie et reste actif jusqu'au suivant. Pool de départ : vitesse x2, gravité inversée, zone de jeu qui rétrécit temporairement, friendly fire activé. | `onIntervalTick` (toutes les 30s), pool de modificateurs interchangeables, `onCollision` |
| 5 | **Classes / WTF** | Chaque joueur choisit une classe au spawn (ex. Tank : plus gros mais plus lent, Speedster : rapide mais fragile, Absorbeur : gagne plus en mangeant des joueurs). Chaque classe a une compétence active avec cooldown. | `onPlayerSpawn` (choix classe), `onAbilityUse`, stats modifiées par classe |
| 6 | **Battle Royale** | La zone jouable rétrécit progressivement et définitivement (pas de retour en arrière, contrairement au Chaos), forçant les joueurs à se regrouper. Dernier joueur/équipe en vie gagne. | `onIntervalTick` (rétrécissement progressif), `onZoneExit` (dégâts hors zone) |
| 7 | **Équipes** | Joueurs répartis en équipes (couleurs), impossible de manger un coéquipier, score cumulé par équipe plutôt qu'individuel. Base pour des variantes futures type capture de zone. | `onPlayerSpawn` (assignation équipe), `onCollision` (blocage friendly fire), scoring d'équipe |
| 8 | **Précision / Sniper** | Pas de nourriture ambiante ou très rare : la seule façon de grossir est de manger d'autres joueurs. Gameplay agressif dès le début, parties courtes et tendues. | Densité de spawn de nourriture, `onPlayerEat` |
| 9 | **Gravité / Physique modifiée** | La carte applique une force constante (vent, courant, attraction vers un point central) affectant tous les déplacements, fixe pour toute la partie (contrairement au Chaos). Teste la mécanique de force externe indépendamment du système de modificateurs aléatoires. | `onTick` (force constante appliquée au mouvement) |
| 10 | **Événements ponctuels / Boss** | Des entités spéciales non-joueurs apparaissent périodiquement (météorite traversant la carte, boss à affaiblir en équipe pour un gain massif). Teste la capacité de l'API à faire vivre des entités non-joueurs avec leur propre logique. | `onIntervalTick` (spawn d'entité spéciale), IA basique d'entité, `onEntityDeath` |

Ces dix modes couvrent volontairement des besoins d'API différents (modificateurs temporaires
globaux, classes avec compétences actives, entités non-joueurs, zones dynamiques, équipes) —
bon test de couverture avant de figer l'API de modding définitive.

**Points à retravailler ensemble** :
- Les valeurs précises (x10, 30 secondes, cooldowns) sont des exemples, pas des décisions.
- Les modes 5 (Classes) et 6 (Battle Royale) sont probablement les plus complexes à développer
  — à positionner plus tard dans la roadmap que les modes 1-4.
- Faut-il un système de tags par mode (solo / équipe / partie courte / partie longue) pour que
  l'interface de sélection de salon puisse filtrer/recommander des modes ?

### 3.5 Spécification du mode Vanilla (référence d'implémentation)

Ce mode sert de référence : il est le premier à développer et valide que l'API de modding
(§3.2-3.3) est suffisante pour exprimer un jeu complet. Toutes les valeurs ci-dessous sont
définitives pour le MVP (contrairement aux modes du §3.4, encore au stade brainstorm).

| Paramètre | Valeur |
|---|---|
| Masse de départ | 50 |
| Nombre maximum de morceaux sur le terrain (par joueur) | 16 |
| Masse minimum requise pour avoir le droit de split | 100 |
| Répartition de la masse au split | 50 / 50 entre le morceau d'origine et le morceau éjecté |
| Cooldown de fusion entre 2 morceaux du même joueur | 30 secondes après le split |
| Condition de fusion une fois le cooldown écoulé | Chevauchement d'au moins 1/3 de la surface totale des deux morceaux |
| Masse d'une particule de base (nourriture ambiante) | 1 |
| Masse minimale pour pouvoir manger une particule | 2 (donc un joueur ne peut jamais descendre sous ce seuil par la perte passive) |
| Condition pour manger un autre joueur | Avoir au moins 5% de masse en plus que le joueur/morceau ciblé |
| Perte de masse passive au-dessus de 50 de masse | 1% de la masse actuelle toutes les 5 secondes |
| Perte de masse passive en dessous de 50 de masse | 1% de la masse actuelle toutes les 10 secondes (deux fois plus lente) |
| Plancher de perte de masse passive | Aucune perte en dessous de 2 (seuil minimum jouable) |
| Vélocité | Décroissante avec la masse — plus un joueur/morceau est gros, plus il est lent (comportement Agar.io classique) |
| Bords de la carte | Mur bloquant infranchissable (pas de téléportation ni de rebond) |

**Points encore ouverts, à préciser avant le développement** (non bloquants pour démarrer, la
formule exacte peut être ajustée en cours de route sans changer l'architecture) :
- Formule exacte de décroissance de la vélocité en fonction de la masse (ex. `v = base / sqrt(masse)`
  ou autre courbe) — un point d'équilibrage à tester en jeu plutôt qu'à figer sur papier.
- Que devient la masse perdue passivement : disparaît-elle simplement, ou se transforme-t-elle
  en nouvelle particule de nourriture sur la carte (ce qui a un effet sur l'économie globale
  de la partie) ?
- Quand deux morceaux DE JOUEURS DIFFÉRENTS se chevauchent sans que la règle des 5% soit
  remplie par aucun des deux camps (masses proches) : ils se repoussent simplement, ou
  traversent-ils l'un l'autre sans effet ?

### 3.6 Spécification du mode Hardcore (Lot 4 — validation de l'API de hooks)

Choisi comme deuxième mode de développement (§3.4 #2) précisément parce qu'il n'est **pas**
réductible à un réglage de valeurs (contrairement à Folie) : il ajoute deux mécaniques que le
schéma de configuration paramétrique (metriques.md §1) ne peut pas exprimer.

| Paramètre | Valeur | Différence avec Vanilla |
|---|---|---|
| Mouvement, split, fusion, bords, nourriture | Identiques à Vanilla (§3.5) | Aucune |
| Multiplicateur de masse gagnée en mangeant un **autre joueur** | ×10 (configurable) | Vanilla : gain = masse de la cible ; Hardcore : gain = masse de la cible × 10 |
| Multiplicateur de masse gagnée en mangeant de la **nourriture ambiante** | ×1 (inchangé) | Aucune — l'agressivité voulue vient de la prédation entre joueurs |
| Condition pour avoir le droit de manger un autre joueur | 5 % d'avantage de masse (inchangé) | Aucune — seul le montant gagné change, pas qui a le droit de manger qui |
| Conséquence d'une mort sur la progression du compte (Lot 3.5) | Perte totale (0 crédité) | Vanilla : la masse maximale atteinte pendant la vie est créditée même après une mort ; Hardcore : aucun crédit, comme si la vie n'avait pas eu lieu |

Détail des formules : [metriques.md §14.1](metriques.md#141-hardcore-lot-4--mode-aux-mécaniques-structurellement-nouvelles).
Implémentation : [server/src/mods/hardcore/index.ts](server/src/mods/hardcore/index.ts).

---

## 4. Architecture technique

### 4.1 Recommandation de stack backend

Tu as laissé le choix ouvert. Voici l'analyse comparative :

| Critère | Node.js/TypeScript | Rust | C#/.NET |
|---|---|---|---|
| Perf brute (calcul de collisions, boucle de jeu) | Correcte | Excellente | Très bonne |
| Vitesse de développement solo | Très rapide | Lente (courbe d'apprentissage, borrow checker) | Rapide |
| WebSocket natif / écosystème temps réel | Excellent (natif à l'écosystème JS) | Bon mais plus de boilerplate | Bon (SignalR) |
| Facilité pour un système de mods scriptables | Excellente (JS/TS partout, hot-reload simple) | Difficile (compilation native, pas de "script" léger) | Bonne (mais mods = DLLs, plus lourd à distribuer) |
| Charge réaliste pour 10-50 joueurs sur un Wyse | Largement suffisant | Confortable, marge inutile au MVP | Largement suffisant |
| Portage mobile (client) | Un seul code client web réutilisable en webview/PWA | N/A côté client | Unity possible mais alourdit le projet |

**Recommandation : Node.js avec TypeScript** pour le serveur de jeu (boucle de simulation +
WebSocket), et TypeScript également pour le futur système de mods.

Justification :
- La charge (10-50 joueurs, physique 2D simple) est **très loin** des limites de Node.js sur
  un Ryzen 7 8840U (même sous-exploité par un Wyse 5070 équivalent en usage réel). Rust
  n'apporterait un bénéfice perceptible qu'à des centaines/milliers de joueurs simultanés
  sur une machine bien plus faible.
- Le système de mods communautaires est **l'objectif à long terme le plus structurant**.
  TypeScript permet des mods écrits dans le même langage que le core, rechargeables à chaud,
  avec un typage fort pour sécuriser l'API — un avantage déterminant que Rust ne permettrait
  pas d'obtenir aussi simplement (chaque mod en Rust nécessiterait une recompilation native).
- L'écosystème JS a des solutions matures d'isolation de code non fiable (`vm2` historiquement,
  ou plus robuste : exécuter les mods dans des **Workers séparés**, voire des conteneurs légers)
  pour adresser le sandboxing en Phase 2, sans changer de langage.

Si, après avoir vu ce comparatif, tu veux quand même explorer Rust ou C#, dis-le-moi et on
ajuste — mais l'argument principal (mods scriptables + charge très raisonnable) pointe assez
nettement vers Node/TypeScript.

### 4.2 Protocole de communication

**Recommandation : WebSocket**, et non TCP brut.

- Un jeu type Agar.io a besoin d'envoyer l'état du monde en continu (position, taille de
  toutes les entités visibles) plusieurs fois par seconde à chaque client.
- TCP brut fonctionne, mais WebSocket (qui repose sur TCP) est l'implémentation standard,
  compatible nativement navigateur/mobile, avec toute la gestion de handshake, ping/pong et
  reconnexion déjà normalisée — réinventer une couche TCP maison n'apporterait rien ici.
- **Sur le lag** : le vrai levier n'est pas le choix TCP vs UDP au niveau transport (WebSocket
  reste praticable pour ce type de jeu, contrairement à un FPS compétitif), mais :
  - **Fréquence de tick serveur** (ex. 20-30 Hz) et **fréquence d'envoi client → serveur**
    séparées de la fréquence de rendu client.
  - **Interpolation/extrapolation côté client** : afficher une position légèrement dans le
    passé, interpolée, pour lisser les mouvements malgré la latence réseau.
  - **Delta compression** : n'envoyer que ce qui a changé dans le monde depuis le dernier
    tick envoyé à ce client, pas l'état complet.
  - **Interest management** : n'envoyer à un client que les entités visibles dans/autour de
    sa zone de caméra, pas le monde entier (essentiel dès qu'il y a beaucoup d'entités).
  - **NAT/PAT** : la latence ajoutée par ta box Bouygue est négligeable une fois la redirection
    de port configurée correctement ; le vrai goulot sera la bande passante montante de ta
    ligne si beaucoup de joueurs se connectent en simultané (à vérifier empiriquement).

### 4.3 Boucle de jeu et calcul des règles

- Boucle de simulation serveur à tick fixe (ex. 20-30 Hz), découplée du taux de rafraîchissement
  d'affichage de chaque client.
- Calculs de collision optimisés via un **partitionnement spatial** (grille ou quadtree) plutôt
  que de tester chaque entité contre toutes les autres (complexité O(n²) à éviter dès que le
  nombre d'entités par salon grossit).
- Chaque salon = une simulation indépendante (une "room"), ce qui permet d'isoler les mods
  entre eux et de paralléliser plus tard (un salon = un Worker/process, par exemple).

### 4.4 Stockage des données

| Type de donnée | Solution | Justification |
|---|---|---|
| Comptes joueurs, stats, XP, cosmétiques | **PostgreSQL** | Données persistantes, relationnelles, besoin de fiabilité/transactions |
| État de partie en cours (positions, masses) | **En mémoire (RAM)** | Éphémère, doit être lu/écrit à très haute fréquence, aucun intérêt à persister à chaque tick |
| Snapshot de fin de partie (pour stats) | Écrit en base après la fin de partie uniquement | Évite d'écrire en base à 20-30 Hz |

Cette séparation (mémoire pour le "chaud", PostgreSQL pour le "froid") est le principe standard
des jeux temps réel et convient parfaitement à l'échelle visée.

### 4.5 Scaling multi-Wyse (Phase 2 — à ne pas implémenter au MVP)

Ta proposition initiale ("un Wyse master avec la base, les autres se synchronisent") contient
un piège : une base de données synchronisée entre plusieurs nœuds est un problème de
distributed systems non trivial (cohérence, conflits d'écriture, latence de synchronisation).
Pour un jeu où les salons sont indépendants les uns des autres, il y a plus simple :

- **Un salon = toujours géré par un seul serveur** (pas de partage d'état de partie entre machines).
- **Une seule base PostgreSQL "source de vérité"** pour les comptes/stats, hébergée sur le
  Wyse "master" — les autres Wyse s'y connectent **en tant que clients de cette base**
  (via le réseau), pas de synchronisation bidirectionnelle de bases séparées.
- Un service de **lobby/matchmaking léger** sur le master redirige chaque joueur vers le
  Wyse qui héberge le salon choisi.
- Ajouter un Wyse = ajouter de la capacité en salons supplémentaires, pas une réplication de
  données complexe.

Cette architecture est nettement plus simple à opérer et suffisante pour scaler "en branchant
un Wyse de plus", ce qui correspond à ton besoin exprimé.

### 4.6 Client web et mobile : un seul code, en PWA

Une piste envisagée était Jetpack Compose / Compose Multiplatform (Kotlin) pour partager le
client entre Android et le web. Elle a été écartée pour ce projet, pour deux raisons :

- Compose (Multiplatform ou non) est un framework **d'interface** (boutons, listes, formulaires
  qui se recomposent sur changement d'état) — pas un moteur de rendu de jeu temps réel. Le
  rendu d'un Agar-like (des dizaines/centaines d'entités animées à 30-60 images/seconde)
  passerait de toute façon par un canvas bas niveau, pas par les composants Compose eux-mêmes :
  Compose n'apporterait donc pas l'avantage habituellement recherché avec ce framework.
- Le support de la cible web est historiquement le moins abouti des trois cibles de Compose
  Multiplatform (Android/iOS/web) — or c'est justement le web qui est ta priorité. Utiliser
  cet outil reviendrait à optimiser le développement pour la plateforme la moins prioritaire.
- Un client Kotlin serait de toute façon un **second client** séparé du client
  Canvas/TypeScript déjà prévu pour le web (§4.1) : le serveur (Node/TypeScript, WebSocket)
  est indépendant du langage du client, donc "même API" n'implique pas "même code" — ça
  doublerait le travail de développement du client sans le mutualiser.

**Solution retenue : Progressive Web App (PWA)**. Le client web (Canvas/TypeScript) déjà prévu
est packagé pour être **installable comme une application** sur téléphone (icône sur l'écran
d'accueil, lancement en plein écran sans barre de navigateur, fonctionnement hors-ligne pour
les écrans qui n'ont pas besoin de réseau comme le menu). Concrètement :

- Un seul code client à maintenir, celui déjà prévu pour le web.
- Ajout d'un fichier de manifeste (`manifest.json`) et d'un service worker — un travail
  d'intégration mineur comparé à un second développement natif.
- Fonctionne sur Android nativement (installation depuis le navigateur, ou publiable sur le
  Play Store via un wrapper léger de type TWA/Bubblewrap si une présence sur le store est
  souhaitée plus tard).
- Compatible iOS également (avec quelques limitations connues des PWA sur Safari, à valider
  si le support iOS devient une priorité).

Cette approche est cohérente avec la priorité affichée au web et évite la duplication de
logique de rendu entre deux stacks technologiques différentes.

---

## 5. Comptes joueurs, statut Premium et administration

### 5.1 Authentification

- **Pseudo + mot de passe** pour le MVP, pas de fédération d'identité (OAuth/Google/Discord…)
  dans un premier temps — envisageable en Phase 2.
- **Exigence de sécurité non négociable, indépendante du choix ci-dessus** : les mots de passe
  ne doivent jamais être stockés en clair. Ils doivent être hachés côté serveur avec un
  algorithme dédié (bcrypt ou argon2 — argon2 est aujourd'hui recommandé par défaut pour un
  nouveau projet). C'est un standard de sécurité de base, quelle que soit la méthode
  d'authentification retenue.

### 5.2 Modèle de compte joueur (MVP)

| Donnée | Détail |
|---|---|
| Pseudo | Identifiant affiché, unique |
| Mot de passe | Haché (jamais en clair), voir §5.1 |
| Niveau | Progression globale du compte (formule XP à définir en Phase de développement) |
| Meilleur score par mode de jeu | Un score maximum enregistré séparément pour chaque mode (Vanilla, Chaos, etc. — cohérent avec le système de modes du §3) |
| Statut Premium/Supporter | Booléen, activé par un don (voir §5.3) |
| Cosmétiques débloqués | Liste des cosmétiques possédés par le compte (contenu détaillé différé, voir §8.2) |

Ce schéma est volontairement minimal pour le MVP : suffisant pour driver l'écran de profil et
le classement par mode, extensible plus tard sans migration lourde.

### 5.3 Statut Premium via don

- Le statut Premium/Supporter s'obtient par un **don libre** au projet — aucun palier minimum :
  1€ ou 10€ donnent le même statut. L'esprit est la reconnaissance du soutien, pas un système
  de paliers différenciés.
- Avantage concret rattaché au statut au MVP : **possibilité de créer ses propres salons**
  (par opposition aux comptes standards qui rejoignent les salons publics/existants).
- Implication technique : il faut un moyen de collecter les dons et de faire le lien avec le
  compte joueur (ex. un lien de don avec un identifiant unique renvoyé vers la plateforme, ou
  activation manuelle par toi au départ le temps que le volume reste faible — un processus
  entièrement automatisé peut attendre que le besoin se confirme).
- Point à trancher plus tard : le statut Premium est-il permanent (un don = un accès à vie) ou
  faut-il envisager une autre logique (renouvellement, paliers de fonctionnalités supplémentaires) ?
  Pour le MVP, on part sur **permanent**, le plus simple à annoncer et à implémenter.

### 5.4 Interface d'administration

Une interface web dédiée à la gestion du jeu, séparée du client joueur, permettant :

- La gestion des comptes (recherche, consultation, modification, bannissement si besoin).
- La gestion des niveaux/XP (correction manuelle en cas de bug ou de litige).
- La gestion des cosmétiques débloqués par compte (attribution manuelle, utile notamment pour
  activer le statut Premium tant que ce n'est pas automatisé, voir §5.3).
- À terme (Phase 2), la gestion des salons actifs et la modération des mods communautaires
  soumis (cohérent avec la politique de review du §8.2).

Accès réservé à toi dans un premier temps (compte admin unique) ; l'ouverture à des modérateurs
de confiance est une évolution naturelle mais non nécessaire pour le MVP.

---

## 6. Licence et ouverture du code source

Le code source sera publié sur GitHub. Les critères exprimés :
- Toute personne peut copier, modifier, et **commercialiser** le code.
- Toute réutilisation doit **rester open source**.
- L'origine du projet doit être **citée**.

**Recommandation : GNU Affero General Public License v3 (AGPLv3)**, et non la GPLv3 classique.

Pourquoi l'AGPL spécifiquement, plutôt que la GPL :
- La GPL classique n'oblige à republier le code source que si le logiciel **modifié est
  distribué** (envoyé à quelqu'un sous forme de binaire/exécutable). Or ton projet est un
  **service hébergé** (un serveur de jeu) : quelqu'un pourrait prendre ton code, l'améliorer,
  et le faire tourner sur son propre serveur pour ses joueurs **sans jamais rien redistribuer**
  — ce cas de figure échappe totalement à la GPL classique (c'est ce qu'on appelle la
  "faille SaaS").
- L'**AGPL ajoute une clause spécifique** : si quelqu'un fait tourner une version modifiée du
  code pour fournir un service réseau à des utilisateurs, il doit leur donner accès au code
  source de cette version modifiée. C'est exactement le scénario d'un serveur de jeu multijoueur.
- La citation d'origine est couverte par la clause générale de préservation des mentions de
  copyright et d'avis de licence, présente dans toutes les licences GNU.
- La commercialisation reste autorisée : l'AGPL n'empêche pas de vendre un service ou un produit
  basé sur le code, elle impose seulement que le code reste accessible et sous la même licence.

Point d'attention pour la Phase 2 (mods communautaires) : il faudra clarifier si les mods
tiers doivent eux-mêmes être publiés sous AGPL (cohérent avec l'esprit du projet) ou s'ils
peuvent avoir leur propre licence tant qu'ils respectent l'API — à trancher avant l'ouverture
de l'API de modding.

---

## 7. Infrastructure et réseau

- **Matériel de production** : Wyse 5070, meilleure configuration CPU disponible dans la gamme
  (à confirmer : référence exacte du modèle envisagé).
- **Matériel de développement** : HP Pavilion 16, Ryzen 7 8840U, 16 Gio RAM, Ubuntu 26.04 LTS.
- **Connectivité** : box Bouygue, redirection de port (NAT/PAT) vers le Wyse.
- **Nom de domaine / IP** : IP fixe côté box, résolution via **DuckDNS** (DNS dynamique gratuit) —
  à mettre en place et documenter (script de mise à jour automatique du DNS si l'IP publique
  venait à changer malgré tout, en filet de sécurité).
- **Déploiement** : script `install.sh` par machine pour amorcer un nouveau nœud rapidement
  (cohérent avec l'objectif de scaling simple en Phase 2).

---

## 8. Points à trancher avant le développement (backlog de décisions)

### 8.1 Bloquants — nécessaires avant de commencer à coder le MVP

- [x] Spécification chiffrée du mode Vanilla (§3.5) — **tranché**.
- [x] Stack backend (Node/TypeScript) et protocole (WebSocket) — **tranché** (§4.1-4.2).
- [x] Client web + PWA pour mobile — **tranché** (§4.6).
- [x] Licence du projet (AGPLv3) — **tranché** (§6).
- [x] Comportement aux bords de la carte (mur bloquant) — **tranché** (§3.5).
- [x] Authentification (pseudo/mot de passe, hachage) et modèle de compte joueur — **tranché** (§5.1-5.2).
- [x] Statut Premium (don libre, création de salons) — **tranché** (§5.3).
- [x] Interface d'administration (périmètre MVP) — **tranché** (§5.4).
- [ ] Formule exacte de décroissance de la vélocité selon la masse (§3.5) — ajustable en
      cours de développement par playtesting, ne bloque pas le démarrage du code.
- [ ] Choix du moteur de rendu client : Canvas 2D natif confirmé, ou évaluation rapide de
      PixiJS pour gagner du temps de développement sans sacrifier la légèreté (décision à
      prendre en tout début de chantier client, mais ne bloque pas le développement serveur).

### 8.2 Différables — n'empêchent pas de démarrer le développement du MVP

- [x] Nom du projet — **tranché : Angul.io** (§1).
- [ ] Détail précis des mécaniques des modes autres que Vanilla (Chaos, Classes, etc.) —
      seul Vanilla est nécessaire pour valider l'architecture de modding (§3.2).
- [ ] Modèle de données complet des cosmétiques (quels items, comment ils se débloquent) —
      peut suivre une fois le système de comptes de base en place.
- [ ] Automatisation du lien don → activation Premium (§5.3) — activation manuelle acceptable
      en tout début de projet.
- [ ] Référence exacte du modèle de Wyse 5070 à acheter — n'impacte pas le développement,
      seulement le déploiement final.
- [ ] Politique de review/validation des mods communautaires (Phase 2 uniquement).
- [ ] Licence des mods communautaires tiers, AGPL obligatoire ou libre (Phase 2 uniquement).
- [ ] Priorisation et système de tags des 10 modes du §3.4 (Phase post-MVP, une fois Vanilla
      et l'API de modding validés).

---

## 9. Roadmap proposée

1. **Socle technique** : boucle de jeu, WebSocket, rendu client basique, un seul salon, mode
   vanilla codé comme un mod.
2. **Salons** : création/liste de salons, salons privés sur invitation, configuration de reset.
3. **Comptes persistants** : authentification, stats, XP, PostgreSQL.
4. **Deuxième mode de jeu** : validation que l'API de hooks est suffisante pour un mode différent
   du vanilla, sans toucher au moteur central.
5. **Client mobile** : packaging PWA du client web (manifeste, service worker), pas de second développement natif.
6. **Documentation de l'API de mods** + ouverture communautaire (Phase 2).
7. **Scaling multi-Wyse** (Phase 2).

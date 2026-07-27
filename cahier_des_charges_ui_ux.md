# Cahier des charges UI/UX — Angul.io

**Version :** 0.3 — Deuxième refonte visuelle (palette jaune/noir/blanc, disposition d'accueil à 3
colonnes + nav haute + fond spectateur live) implémentée par-dessus le socle React/minimaliste de
la v0.2 ; reste ouvert : "Guilde"/"Clan" (§0/§12), modération en direct des salons, file de dons
automatisée.
**Date :** 27 juillet 2026 (créé), révisé le 27 juillet 2026 (migration React + refonte
minimaliste), re-révisé le 27 juillet 2026 (palette claire + accueil 3 colonnes, mockup fourni)
**Périmètre :** refonte complète de l'interface d'accueil/lobby joueur, de l'interface de jeu
(HUD), et de l'interface d'administration.

Ce document a servi à figer les décisions de design et d'architecture UI avant l'implémentation,
comme le [cahier_des_charges.md](cahier_des_charges.md) l'a fait pour le moteur de jeu — il reste
la référence à jour de ces décisions (§1-§2 révisés le 27/07 pour refléter le passage à React et
au style minimaliste, puis re-révisés le 27/07 pour la palette claire et la nouvelle disposition
d'accueil), pas un historique figé du jour de sa création.

---

## 0. Ce qui existe aujourd'hui (état des lieux — historique, avant migration)

Section conservée telle quelle pour la traçabilité de la décision (§2.2) ; voir §1-§2 pour l'état
actuel (React + Vite, design minimaliste).

- **Client joueur** (`client/`) et **admin** (`admin/`) : TypeScript vanilla, manipulation
  directe du DOM, bundlé avec esbuild. Aucun framework composant.
- **Style actuel** : glassmorphism noir/blanc ("labo premium"), thème clair fixe, déjà
  fonctionnel et documenté dans le code (`index.html` de chaque app).
- **Rendu du jeu** : canvas 2D bas niveau (`client/src/render.ts`), boucle de dessin
  indépendante du DOM — **ne fait pas partie de cette refonte** (voir §2.3).
- **3 modes de jeu existants côté serveur** : `vanilla`, `hardcore`, `folie` (configs dans
  `server/configs/`), exposés via `GET /api/modes` (liste d'identifiants bruts aujourd'hui, sans
  nom affichable ni description).
- **Salons** : `GET /api/rooms` renvoie déjà `{ id, name, modId, visibility, playerCount }` par
  salon public — la donnée pour des cartes de salon riches existe déjà côté serveur.
- **Comptes** : pseudo, mot de passe (haché), niveau, XP, meilleur score par mode, statut
  Premium, cosmétiques (liste de chaînes), banni (oui/non). Pas de classement global aujourd'hui
  (seuls les meilleurs scores personnels sont exposés via `/api/account/me`).
- **Admin** : connexion par mot de passe unique, recherche/édition de comptes (niveau, XP,
  Premium, cosmétiques, bannissement). Aucun tableau de bord, aucune vue sur les salons actifs,
  aucun historique des actions (cahier des charges §5.4 : la gestion des salons actifs est
  explicitement notée "à terme, Phase 2").
- **"Guilde"** : un champ `statGuild` existe déjà dans le panneau de stats en jeu, mais c'est un
  **espace réservé statique** (`—`) — aucun système de guilde n'est conçu ni implémenté. À
  trancher en §12 : le garder comme promesse de fonctionnalité future, ou le retirer de la
  refonte tant que rien n'est spécifié derrière.

---

## 1. Vision et direction artistique

### 1.1 Ton et univers visuel

**Révision (2026-07-27, migration React) :** la direction "coloré et ludique" (arcade/casual)
initialement retenue a été abandonnée après premier passage en revue — remplacée par une
direction **minimaliste, inspirée de l'outil Cobalt** : fond sombre plat, un seul accent de
marque, pas de dégradé décoratif, pas d'emoji.

**Deuxième révision (2026-07-27, mockup fourni) :** le fond bascule de sombre à **clair**
(blanc/gris très clair) et l'accent de marque passe du bleu/violet au **jaune**, pour matcher une
identité de marque fournie (palette jaune/noir/blanc). Le vocabulaire de composants posé par la
première révision (boutons pilule, cartes à coins arrondis modérés, bordures fines, pas de
glassmorphism/flou, pas d'emoji, densité faible sur l'accueil) **reste inchangé** — seule la
palette (fond clair, accent jaune) et la disposition de l'accueil (§3.1/§4.1, nav haute + 3
colonnes au lieu d'une carte centrée + panneaux modaux) changent. Un fond spectateur (§4.1) rend
désormais le canvas de jeu visible en transparence derrière l'accueil — cohérent avec le choix
initial de `render.ts` de dessiner sur un canvas transparent plutôt qu'un fond opaque (§1.5).

Principes directeurs (mis à jour) :
- **Formes rondes mais sobres** — boutons pilule, cartes à coins arrondis (rayon modéré, pas
  exagéré) — reste un écho à la mécanique de jeu (cellules circulaires) sans devenir un élément
  décoratif dominant.
- **Fond clair plat, un seul accent de marque** (jaune) pour l'action principale ("Rejoindre") et
  les éléments interactifs actifs. Les couleurs de mode (Vanilla/Hardcore/Folie, §1.2) restent
  utilisées, mais en usage strictement fonctionnel (petit point, bordure fine) — jamais comme
  remplissage décoratif de grandes surfaces.
- **Pas de glassmorphism/flou** : surfaces pleines, bordures fines (1px, opacité faible),
  élévation par une ombre discrète plutôt que par un flou d'arrière-plan.
- **Densité d'information faible sur l'accueil, plus élevée dans les sous-écrans** (voir §3.1) —
  nuancé par la deuxième révision : les salons/modes sont désormais visibles en permanence sur
  l'accueil (§3.1/§4.1), la densité y est donc plus élevée qu'avant, mais reste organisée en
  colonnes distinctes plutôt qu'en un mur d'informations.

### 1.2 Palette de couleurs — tranchée (2026-07-27, re-tranchée le 27/07 : palette claire)

Fond clair plat, tokens définis dans `client/src/styles.css` et dupliqués à l'identique dans
`admin/src/styles.css` (§3.3, cohérence entre les deux apps) :

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#FFFFFF` | Fond de page — laisse voir le fond spectateur en transparence sur l'accueil (§4.1) |
| `--surface` | `#F1F1EF` | Cartes, panneaux, champs |
| `--surface-hover` | `#E7E7E3` | États survolés |
| `--border` / `--border-strong` | `rgba(0,4,1,.10)` / `.20` | Bordures fines, jamais d'ombre large |
| `--text` / `--text-soft` / `--text-faint` | `#000401` / `#55564F` / `#8A8B84` | Hiérarchie de texte |
| `--accent` / `--accent-strong` | `#FFD32C` / `#E0BC00` | Bouton "Rejoindre", éléments actifs — **le seul accent de marque** |
| `--brand-yellow-pale` / `--brand-yellow-light` | `#FFEA99` / `#FFDE21` | Teintes de badge/highlight discrets (ex. badge "Niveau") |
| `--danger` / `--success` | `#C23B3B` / `#2F8A4E` | États d'erreur/confirmation |
| `--c-vanilla` / `--c-hardcore` / `--c-folie` | `#1F9D74` / `#C94F4F` / `#7C5CD4` | Couleur signature par mode — usage fonctionnel minimal (point, bordure fine), pas décoratif ; assombries par rapport à la v0.2 pour rester lisibles sur fond blanc |

Palette de marque fournie, à la base des tokens ci-dessus : `#E0BC00` (jaune foncé), `#FFD32C`
(jaune), `#FFDE21` (jaune clair), `#FFEA99` (jaune très clair), `#FFFFFF` (blanc), `#000401`
(noir). Cohérent avec le principe déjà en place (§1.1) : l'accent (jaune) reste un usage
fonctionnel ciblé (bouton principal, badges), jamais un remplissage décoratif de grandes surfaces.

La palette "pastilles de nourriture" évoquée dans une version antérieure de ce document reste hors
périmètre comme palette d'accent générale ; le principe de couleur signature par **mode de jeu**
(`--c-vanilla`/`--c-hardcore`/`--c-folie`) est inchangé, utilisé uniquement pour les distinguer
visuellement (chip de salon, bordure de carte de mode), jamais en remplissage.

Pas de mode sombre prévu pour l'instant : la direction est désormais **claire par défaut**
(inverse de la v0.2), cohérente avec la nouvelle identité de marque jaune/noir/blanc.

### 1.3 Typographie — tranchée

Une seule famille, système, dans les deux apps :
`-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`. Pas de
police web externe chargée (évite une dépendance réseau à un CDN de polices, cohérent avec la
priorité PWA/mobile légère et la sensibilité vie privée du projet). Une police à chasse fixe
(`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) est utilisée pour les valeurs
numériques du HUD (masse/vitesse) — lisibilité technique, cohérent avec le ton Cobalt.

### 1.4 Formes, iconographie, motion — révisé

- **Pas d'emoji** : la navigation et les boutons utilisent des libellés texte seuls (§4.1) — plus
  sobre, et évite toute dépendance à un jeu d'icônes externe.
- Coins arrondis modérés sur les surfaces (cartes, boutons, champs), boutons en pilule — sans les
  rayons très généreux de la version précédente.
- Animations réduites à l'essentiel : transitions d'opacité courtes (ouverture/fermeture de
  panneau), pas de rebond/spring ni de confettis — cohérent avec la sobriété Cobalt.
- **`prefers-reduced-motion` reste respecté** malgré des animations déjà minimales (voir §9).

### 1.5 Ce qui NE change PAS visuellement (et ce qui change malgré tout, deuxième révision)

- Le canvas de jeu lui-même (rendu des cellules, pastilles, grille) reste piloté par
  `render.ts` — cette refonte ne touche pas au rendu du monde de jeu, seulement aux couches
  d'interface autour (accueil, HUD, admin). Un futur ajustement des couleurs de rendu en jeu
  pour coller à la nouvelle palette reste possible mais est hors périmètre de ce document.
- **Exception (2026-07-27, demande explicite) :** la couleur des morceaux de joueur est
  désormais **hardcodée en un vert unique** (`#253D2C`, `DEFAULT_BLOB_COLOR` dans `render.ts`) à
  la place de la couleur dérivée par hash de l'id de joueur — un placeholder temporaire en
  attendant un vrai système de personnalisation (couleur débloquable par cosmétique).
- **Nouveau (2026-07-27) :** ce même canvas (`render.ts`) est désormais aussi utilisé en dehors
  d'une partie, comme fond animé de l'accueil (`SpectatorBackground.tsx`, §4.1) — une vraie
  connexion WebSocket en lecture seule au salon permanent, caméra fixe plutôt que centrée sur un
  joueur. Le fond de page passe donc de sombre plein à transparent (§1.2) précisément pour laisser
  ce canvas visible.

---

## 2. Choix technique : stack UI

### 2.1 Contrainte de départ (historique)

Avant cette migration, `client/` et `admin/` étaient deux apps indépendantes bundlées avec
esbuild, sans framework composant. Le serveur de jeu et le protocole WebSocket n'étaient pas
concernés par ce choix — et ne le sont toujours pas (§2.3).

### 2.2 Décision (2026-07-27) : React + Vite

Le choix initial recommandait Svelte (bundle plus léger, transitions intégrées). **Décision
finale : React**, explicitement demandé — l'écosystème/l'aide disponible à long terme (pertinent
pour l'ouverture communautaire de l'API de mods, Phase 2+) l'a emporté sur l'argument de poids
de bundle, avec un mandat clair d'**optimiser au maximum** en contrepartie (§2.4).

- **Outillage** : `client/` et `admin/` sont passés de scripts esbuild bruts à **Vite**
  (`vite build` en production, `vite` pour le dev-server avec HMR). Chaque app garde son
  `vite.config.ts` ; le build sort toujours dans `public/` (consommé tel quel par
  `server/src/index.ts`, aucun changement côté serveur).
- **`shared/`** ne change pas : reste du TypeScript pur (types, constantes) consommé tel quel
  par les composants.
- **Design system** : les tokens CSS (§1.2/§1.3) sont dupliqués à l'identique entre
  `client/src/styles.css` et `admin/src/styles.css` plutôt que partagés via un paquet commun —
  choix délibérément simple pour deux petites apps, à revoir si un troisième consommateur
  apparaît.

### 2.3 Ce qui reste hors du framework

- `render.ts` (boucle canvas) reste un module TypeScript impératif indépendant, monté dans un
  composant "coquille" (`GameView.tsx`, `<canvas>` unique via `useRef`) — pas de réécriture du
  rendu de jeu en composants.
- Le protocole réseau (`net.ts`, WebSocket) reste indépendant de la couche UI, orchestré dans le
  même effet impératif que la boucle de rendu (§2.5) plutôt que ré-architecturé en store React.

### 2.4 Impact sur le monorepo

- `client/package.json` et `admin/package.json` ont `react`, `react-dom`, `vite`,
  `@vitejs/plugin-react` comme dépendances, et un script `dev` (serveur Vite, HMR) en plus du
  script `build` (`tsc --noEmit` puis `vite build`).
- `eslint.config.js` (racine) gagne `eslint-plugin-react-hooks` pour les fichiers `.tsx`.
- Aucun changement côté `server/` ni `shared/` — le build Vite sort toujours dans `public/`
  (`client/public/`, `admin/public/`), consommé sans modification par
  `server/src/index.ts` (`staticDir`/`adminStaticDir`).

### 2.5 Stratégie d'optimisation (mandat "optimiser au maximum")

- **Code-splitting des panneaux secondaires** (`React.lazy` + `Suspense`) côté client : Compte,
  Salons, Modes, Classements, Soutenir et le modal Profil ne sont chargés que si l'utilisateur
  ouvre effectivement le panneau — le chemin critique "jouer vite" (§4.1) ne paie pas leur coût
  de parsing/exécution au premier chargement.
- **Le canvas et la boucle de jeu restent entièrement hors du cycle de rendu React** (§2.3) : pas
  de re-render React à chaque frame (~60 im/s) ni à chaque message réseau (~20 Hz). Les stats du
  HUD (masse/vitesse) sont mises à jour par mutation DOM directe via des refs, pas
  par `useState` — un `setState` par frame aurait un coût de re-render inutile pour du texte.
  Voir `client/src/components/GameView.tsx`.
- **Aucune librairie de composants tierce** : le design minimaliste (§1) est simple à exprimer en
  CSS pur, une dépendance UI supplémentaire (poids, surface de maintenance) n'apporterait rien.
- **`react-hooks/rules-of-hooks` et `react-hooks/exhaustive-deps`** activées en lint
  (`eslint-plugin-react-hooks`) pour attraper les dépendances d'effet manquantes et les patterns
  qui déclenchent des re-renders en cascade.

---

## 3. Architecture de l'information

### 3.1 Application joueur — accueil minimal + sous-menus

**Révision (2026-07-27, mockup fourni) :** la disposition change de "carte centrée + barre
d'icônes ouvrant des panneaux modaux" à une disposition **permanente à 3 colonnes**, surmontée
d'une nav haute et terminée par un pied de page — le contenu de l'ancien sous-menu "Salons" (liste
publique, créer, rejoindre par code) est désormais **toujours visible** sur l'accueil, plus caché
derrière une icône. "Jouer vite" reste l'objectif (§4.1), mais réalisé différemment : voir les
salons disponibles ne demande plus un clic supplémentaire.

```
Accueil (défaut)
├─ Nav haute : marque · Classement · Modes de Jeux · À Propos · compte (avatar + pseudo + Clan + Niveau)
├─ Colonne gauche  : sélecteur de mode + classement des salons publics de ce mode
├─ Colonne centre  : compteur "N Joueurs Connectés", pseudo du blob, bouton "Rejoindre"
│                    (rejoint le salon permanent, §12), classement global des salons (tous modes)
├─ Colonne droite  : "Créer un Salon Privé" (Premium) + "Rejoindre par code" (tous)
└─ Pied de page    : version, marque, lien Soutenir
```

Panneaux modaux restants (toujours des sous-menus au sens du §3.1 initial, ouverts depuis la nav
haute/le pied de page/le cercle de compte, pas empilés sur l'écran principal) : Compte/Profil,
Modes de jeu (description détaillée par mode), Classements, Soutenir, Paramètres (plafond FPS,
déplacé dans le panneau Compte faute de place dédiée dans la nav), À Propos (nouveau).

Fond de l'accueil : transparent, laisse voir une vraie vue en direct (zoomée, caméra fixe) du
salon permanent en lecture seule (`SpectatorBackground.tsx`, §1.5/§4.1) — respecte
`prefers-reduced-motion` (rien n'est monté si demandé).

**Transition d'entrée en jeu (demande utilisateur) :** au clic sur "Rejoindre" (ou tout autre
déclencheur d'entrée en partie — salon de la liste, code, création), l'UI (`.home-ui` : nav,
colonnes, pied de page) zoome légèrement en arrière et s'estompe pendant ~450ms, tandis que le
fond spectateur zoome en avant (grossissement centré) — donne l'impression de "plonger" dans le
monde avant que `GameView` ne prenne le relais. Respecte `prefers-reduced-motion` (transitions
neutralisées globalement, §9).

### 3.2 Application admin — restructuration complète

L'admin passe d'un écran unique (recherche + édition de compte) à une **application avec
navigation latérale**, structurée par domaine :

```
Admin
├─ Dashboard (nouveau — vue d'ensemble temps réel)
├─ Comptes joueurs (existant, retravaillé visuellement)
├─ Modération (nouveau)
├─ Premium & dons (nouveau)
└─ Classements (nouveau — vue de gestion)
```

### 3.3 Système de design partagé

Un seul jeu de tokens (couleurs, typographie, rayons, ombres, transitions — §1) partagé entre
`client/` et `admin/`, probablement via un petit paquet interne (`shared/` ou nouveau paquet
`ui/` du workspace) pour éviter la duplication de CSS entre les deux apps, qui a déjà un
précédent visuel aujourd'hui ("même langage visuel... app entièrement séparée", commentaire
actuel de `admin/public/index.html`).

---

## 4. Écrans détaillés — client joueur

### 4.1 Accueil (révisé 2026-07-27, mockup fourni)

| Élément | Contenu | État |
|---|---|---|
| Marque (nav haute) | Cercle plein, lien silencieux (`aria-label="Angul.io"`) | Toujours visible |
| Nav haute (liens texte) | Classement, Modes de Jeux, À Propos | — |
| Compte (nav haute, droite) | Cercle + pseudo + "Clan —" (statique, §0/§12) + badge "Niveau {n}" | "Connexion" si non connecté |
| Colonne gauche | Sélecteur de mode (`<select>`) + classement (rang, nom, count/capacité) des salons publics de ce mode | "Aucun salon public pour ce mode." si vide |
| Colonne centre | "N Joueurs Connectés" (`GET /api/stats`, §10), champ pseudo du blob (indépendant du compte, pré-rempli si connecté), swatch de couleur (fixe, §1.5), bouton "Rejoindre" | Erreur affichée sous le bouton (ex. pseudo déjà pris sur le salon visé) |
| Colonne centre (suite) | Classement global des salons les plus peuplés, tous modes confondus | Distinct du classement filtré de la colonne gauche |
| Colonne droite | "Créer un Salon Privé" (Premium) : Nom, Mode, **Nombre de Joueurs**, **Durée**, Public/Privé, Code de la Partie ; "Rejoindre par code" (tous) | Formulaire masqué (message Premium) si non éligible |
| Pied de page | Version, "Angul.io 2026", lien "Soutenir le Projet" | Toujours visible |
| Fond | Canvas spectateur transparent (§1.5) | Coupé si `prefers-reduced-motion` |

Bouton "Rejoindre" : voir décision de ciblage explicite du salon permanent en §12 (tranché).

### 4.2 Salons (désormais intégré à l'accueil, plus un sous-menu séparé)

- Colonne gauche + colonne centre (§4.1) : deux classements de salons publics (par mode / global),
  chacun avec **chip coloré du mode implicite** (regroupement par colonne plutôt qu'un chip par
  ligne, la colonne gauche étant déjà filtrée par mode) et `count/maxPlayers`.
- État vide : message, pas de suggestion active de créer un salon (le formulaire de création est
  déjà visible juste à côté, colonne droite).
- Colonne droite "Créer un Salon Privé" : réservée Premium, formulaire Nom + Mode + **Nombre de
  Joueurs** (capacité, nouveau champ) + **Durée** (nouveau champ — fermeture automatique du salon
  à l'échéance, tous les joueurs connectés sont alors renvoyés à l'accueil) + Public/Privé. Le
  champ "Code de la Partie" affiche le code généré après création (le créateur reste sur
  l'accueil, libre de le noter/partager, avant de cliquer "Rejoindre maintenant").
- "Rejoindre par code" : champ + bouton, **non réservé Premium** (accessible à tous, y compris
  invité), inchangé fonctionnellement depuis la version précédente.

### 4.3 Sous-menu Modes de jeu (nouveau contenu structuré)

Ouvert depuis le lien "Modes de Jeux" de la nav haute (§4.1, avant : icône dans la barre de
navigation de l'accueil) — contenu inchangé.

Nécessite que le serveur expose, en plus de l'identifiant de mode, un **nom affichable et une
description courte** par mode (aujourd'hui `GET /api/modes` ne renvoie que des identifiants
bruts — impact backend, voir §10). Pour chacun des 3 modes existants (`vanilla`, `hardcore`,
`folie`) :
- Nom affichable + couleur signature (§1.2).
- Description courte (1-2 phrases, reprise/adaptée du cahier des charges principal §3.4/3.6).
- Éventuellement des tags (solo/équipe, courte/longue — repris de la question ouverte §3.4 du
  cahier des charges principal).

### 4.4 Sous-menu Classements (nouveau)

Ouvert depuis le lien "Classement" de la nav haute (§4.1) — à ne pas confondre avec les
classements de **salons** (par nombre de joueurs) désormais visibles en permanence dans les
colonnes gauche/centre de l'accueil (§4.1/§4.2) : celui-ci reste le classement des **joueurs**
(meilleur score), toujours un panneau à part, toujours un placeholder tant que l'endpoint
d'agrégation (§10) n'existe pas.

- Classement global (meilleur score toutes parties confondues) + filtre par mode.
- Pseudo du joueur connecté mis en évidence s'il apparaît dans le classement affiché.
- Nécessite un nouvel endpoit d'agrégation côté serveur (voir §10) — n'existe pas aujourd'hui
  (seuls les meilleurs scores personnels sont exposés).

### 4.5 Sous-menu Compte / Profil

Ouvert depuis le cercle de compte de la nav haute (§4.1, avant : icône "Compte" de la barre de
navigation de l'accueil).

- Non connecté : formulaire connexion/inscription (comportement actuel conservé).
- Connecté : pseudo, niveau (barre de progression XP plutôt que chiffre brut — plus ludique),
  meilleurs scores par mode, cosmétiques débloqués (grille de vignettes plutôt que texte),
  badge Premium si actif, bouton déconnexion, lien **Paramètres** (plafond FPS — déplacé ici, la
  nouvelle nav haute n'ayant plus d'icône dédiée, voir §3.1).

### 4.6 Sous-menu Soutenir

Ouvert depuis le lien "Soutenir le Projet" du pied de page (§4.1, avant : icône de la barre de
navigation de l'accueil).

- Reprend le contenu actuel (explication don libre, lien Ko-fi) avec le nouveau style visuel ;
  logique inchangée (cahier des charges §5.3, activation manuelle par l'admin).

### 4.7 Écran de jeu (HUD)

- Canvas inchangé (§2.3), à l'exception de la couleur de blob désormais hardcodée (§1.5).
- **Nouveau (2026-07-27) :** le pseudo du blob est unique par salon — un pseudo déjà utilisé par
  un joueur connecté à ce salon est refusé à la connexion (message clair sur l'accueil, pas une
  erreur en cours de partie), pour éviter la confusion visuelle de deux blobs identiques (le
  pseudo s'affiche au-dessus du morceau).
- Panneau de stats restylé selon la nouvelle direction (§1) : Pseudo, Guilde\*, Masse, Vitesse
  — \*voir décision à trancher en §12 sur "Guilde". **Accélération retirée** (2026-07-27, demande
  explicite) : métrique jugée peu lisible pour un joueur, la simulation continue de la calculer
  côté serveur (voir `server/src/mods/parametric/physics.ts`), seul l'affichage HUD a été retiré.
- Ajout envisageable, cohérent avec la direction "ludique" : petites notifications éphémères
  ("Tu as mangé *Untel*", "Niveau supérieur !") — à cadrer précisément si retenu (hors périmètre
  strict de cette refonte visuelle si ça implique de la logique serveur nouvelle).
- **Nouveau (demande utilisateur, système d'XP/combo — voir metriques.md §15) :** bannière
  "Combo x{niveau}" en gros texte extra-bold, couleur vert → jaune → orange → rouge selon le
  niveau, effet d'apparition en mise à l'échelle (grossissement à 120%) — reste affichée 5
  secondes puis s'estompe (fade out), et réapparaît/rejoue l'animation à chaque nouveau niveau de
  combo (`GameView.tsx`, `.combo-banner`).
- Overlay de debug (F3) : reste au style diagnostique actuel, volontairement distinct (déjà le
  cas aujourd'hui, à conserver).

---

## 5. Écrans détaillés — admin

### 5.1 Connexion

Inchangé fonctionnellement (mot de passe admin unique), restylé selon le nouveau système de
design.

### 5.2 Dashboard (nouveau)

- Salons actifs : nom, mode, joueurs connectés, éventuellement durée depuis création/dernier
  reset.
- Total joueurs connectés, tous salons confondus.
- Emplacement pour indicateurs de charge serveur si disponibles (cohérent avec le monitoring
  déjà prévu en Lot 8.6, à réutiliser plutôt que dupliquer — voir §10).

### 5.3 Comptes joueurs (retravaillé)

Fonctionnalités actuelles conservées (recherche, édition niveau/XP/Premium/cosmétiques/
bannissement), présentation revue avec le nouveau système de design. Ajout proposé : un fil
d'historique des modifications par compte (qui a changé quoi, quand) pour tracer les
corrections manuelles de litiges — nécessite une nouvelle table de logs (voir §10).

### 5.4 Modération (nouveau)

- Historique des bannissements/débannissements et corrections manuelles, si le fil d'historique
  du §5.3 est retenu.
- Éventuellement : action de déconnexion forcée d'un joueur d'un salon actif — étend le
  périmètre du cahier des charges §5.4 ("gestion des salons actifs", notée Phase 2 dans le
  document initial) ; à confirmer explicitement que c'est bien voulu maintenant (§12), car ça
  implique une nouvelle capacité serveur (pas seulement un habillage visuel).

### 5.5 Premium & dons (nouveau)

- Recherche rapide de compte + activation Premium en un clic (reprend une action déjà possible
  aujourd'hui via l'édition de compte, mais isolée dans un flux dédié plus rapide pour le geste
  répétitif "un don arrive sur Ko-fi → j'active Premium pour ce pseudo").
- Historique des activations (qui, quand) — même mécanisme de log que §5.3/5.4.
- Une file d'attente automatique des dons Ko-fi non traités impliquerait un webhook Ko-fi côté
  serveur : hors périmètre MVP du cahier des charges principal (§8.2, "automatisation différée"),
  donc **non retenu par défaut** dans cette refonte — juste une UI plus rapide pour le geste
  manuel existant.

### 5.6 Classements (gestion, nouveau)

- Vue admin du même classement global que §4.4, avec action de correction/suppression d'un
  score contesté (utile pour les litiges de triche évoqués nulle part explicitement dans le
  cahier des charges principal, mais cohérent avec "gestion des niveaux/XP" déjà prévue §5.4).

---

## 6. Parcours utilisateur (client)

| Parcours | Étapes |
|---|---|
| **Joueur pressé (invité)** | Accueil → pseudo (ou pseudo auto-généré) → "Jouer" → assignation à un salon public → en jeu |
| **Créer un compte** | Accueil → icône Compte → inscription → connecté → retour accueil (pseudo pré-rempli) |
| **Rejoindre entre amis** | Accueil → icône Salons → "Rejoindre via code" → code → en jeu |
| **Créer un salon (Premium)** | Accueil → icône Salons → "Créer" (si Premium) / redirection vers Soutenir (sinon) |
| **Consulter sa progression** | Accueil → icône Compte → profil (niveau, scores, cosmétiques) |
| **Faire un don** | Accueil (ou profil) → icône Soutenir → lien Ko-fi (nouvel onglet) → retour ; activation Premium traitée manuellement côté admin ensuite |
| **Voir le classement** | Accueil → icône Classements → filtrer par mode |

## 7. Parcours admin

| Parcours | Étapes |
|---|---|
| **Connexion quotidienne** | Login → Dashboard par défaut |
| **Traiter un don reçu** | Premium & dons → rechercher pseudo → activer → confirmation (loggée) |
| **Traiter un litige (XP/masse)** | Comptes → rechercher → corriger → enregistrer (loggé en Modération) |
| **Bannir un joueur** | Comptes (ou Modération) → bannir → confirmation → visible dans l'historique |
| **Surveiller l'activité** | Dashboard → salons actifs / joueurs connectés |

---

## 8. Responsive & PWA

- **Client joueur : mobile-first**, cohérent avec la priorité Android/PWA du cahier des charges
  principal (§4.6). Les sous-menus doivent fonctionner en plein écran sur petit écran (pas
  seulement en tiroir superposé pensé pour desktop).
- **Admin : desktop-first acceptable** (usage interne, probablement toujours depuis un
  ordinateur), mais doit rester utilisable sur tablette a minima — pas de contrainte mobile
  stricte.
- Cibles tactiles ≥ 44px partout côté client (boutons, chips de salon) — cohérent avec l'usage
  tactile PWA.

## 9. Accessibilité

- Contraste texte/fond conforme AA (WCAG) malgré la palette saturée du §1.2 — vérifier chaque
  paire couleur/texte en maquette, pas seulement à l'esthétique.
- `prefers-reduced-motion` respecté : animations "spring"/confettis désactivées si demandé par
  l'utilisateur (§1.4).
- Navigation clavier complète sur les sous-menus/modales (focus trap, échap pour fermer) —
  absent aujourd'hui, à ajouter avec la refonte.
- Labels explicites sur tous les champs/icônes (les icônes seules ne suffisent pas).

---

## 10. Impacts backend nécessaires

Cette refonte n'est pas purement visuelle : plusieurs écrans proposés en §4-5 ont besoin de
données que le serveur n'expose pas encore. Récapitulatif :

| Besoin UI | Endpoint/donnée manquante | Écran concerné |
|---|---|---|
| Nom + description affichables par mode | `GET /api/modes` ne renvoie que des IDs bruts aujourd'hui — à enrichir | §4.3 Modes |
| Classement global/par mode | Aucun endpoint d'agrégation aujourd'hui (seul `/api/account/me` expose les scores personnels) | §4.4, §5.6 Classements |
| Vue admin des salons actifs (tous, y compris privés) | `roomManager.listPublicRooms()` existe mais ignore les salons privés par conception (Lot 2.3) — un endpoint admin dédié est nécessaire | §5.2 Dashboard |
| Historique des modifications de compte (logs) | Aucune table de logs aujourd'hui | §5.3, §5.4 |
| Déconnexion forcée d'un joueur (si retenu) | Aucune capacité serveur aujourd'hui — **à confirmer explicitement**, extension du périmètre Phase 2 du cahier des charges principal | §5.4 |

Ces ajouts backend sont listés ici pour que le chiffrage du chantier soit réaliste, mais ne sont
**pas** un pré-requis bloquant pour démarrer le travail visuel (§1-§3, design system, accueil,
sous-menus avec les données déjà disponibles).

### 10.1 Réalisés lors de la refonte accueil (2026-07-27, mockup fourni)

Impacts backend supplémentaires apparus avec cette deuxième refonte (fond spectateur, colonnes
salon/mode, nouveaux champs de création) — implémentés dans le même effort, pas seulement
recensés :

| Besoin UI | Endpoint/donnée ajoutée | Écran concerné |
|---|---|---|
| "N Joueurs Connectés" | `GET /api/stats` (`{ playersOnline }`, tous salons confondus, y compris privés) | §4.1 colonne centre |
| Capacité de salon ("Nombre de Joueurs") | `RoomSummary.maxPlayers` (`GET /api/rooms`), `POST /api/rooms { maxPlayers }`, appliqué au `join` réseau (`server/src/net/server.ts`) | §4.1/§4.2 colonne droite |
| Durée de salon ("Durée") | `POST /api/rooms { durationMs }`, `RoomManager.expireRoom` (fermeture + déconnexion forcée des joueurs restants) | §4.2 colonne droite |
| Cibler le salon par défaut sans compter sur l'ordre de la liste | `RoomSummary.permanent` | §4.1 bouton "Rejoindre", fond spectateur |
| Fond spectateur (vue live du salon permanent) | Connexion WebSocket `?spectate=1` (lecture seule, jamais ajouté à `world`) | §1.5/§4.1 |
| Unicité de pseudo par salon | Rejet au `join` (code de fermeture WS dédié, `shared/src/protocol.ts`) | §4.7 |

Compte Premium "Fanta" (demande explicite) : migration de données
(`server/migrations/*_seed-fanta-premium.cjs`, simple `UPDATE`), pas un ajout d'endpoint.

---

## 11. Plan de migration proposé (phasage)

Découpage indicatif, à affiner une fois ce document validé — dans le même esprit que les "Lots"
de [plan_implementation.md](plan_implementation.md) :

1. **Socle** : mise en place Svelte+Vite (ou framework retenu), tokens de design (couleurs,
   typographie, composants de base : bouton, carte, chip, champ).
2. **Client — accueil et navigation** : écran minimal + système de sous-menus, migration de
   Salons et Modes (données déjà disponibles côté serveur, hors nom/description enrichis).
3. **Client — Compte, Classements, Soutenir** : migration progressive, en parallèle des ajouts
   backend du §10 nécessaires (modes enrichis, classement global).
4. **Client — HUD de jeu** : restylage du panneau de stats et des overlays en jeu.
5. **Admin — Dashboard et Comptes** : nouvelle navigation, dashboard temps réel (nécessite
   l'endpoint admin de §10), refonte visuelle de l'écran comptes existant.
6. **Admin — Modération et Dons** : nouveaux écrans, dépendent des logs backend (§10).
7. **Polish** : accessibilité, `prefers-reduced-motion`, responsive mobile fin, tests visuels
   sur les parcours du §6-7.

---

## 12. Points à trancher avant de coder

- [x] **Framework** — **tranché : React + Vite** (§2.2), avec mandat d'optimisation maximale
      (§2.5, code-splitting + canvas hors React + pas de librairie UI tierce).
- [x] **Palette exacte** — **re-tranché le 27/07 (mockup fourni) : palette jaune/noir/blanc**
      (§1.2), fond **clair** plat (inverse de la palette Cobalt sombre initiale), un seul accent
      de marque (`#FFD32C`), palette pastille toujours réduite à un usage fonctionnel par mode
      (chip/bordure), pas de fond dégradé.
- [x] **Typographies** — **tranché : police système uniquement** (§1.3), pas de police web
      externe.
- [x] **Sous-menus** — **tranché (implémenté) : modale centrée** (`client/src/components/
      Panel.tsx`), même famille visuelle que le profil, cohérent avec l'existant plutôt qu'un
      tiroir latéral ou une page dédiée.
- [x] **"Jouer" en un clic** — **re-tranché le 27/07 : cible explicitement le salon `permanent`**
      (demande utilisateur : "le premier serveur vanilla, toujours en ligne") plutôt que le
      premier de la liste par coïncidence d'ordre (voir `App.tsx`, `handlePlay`,
      `RoomSummary.permanent`). S'il n'y en a aucun (environnement de test sans salon par
      défaut), message d'erreur explicite sur l'accueil — reste un choix par défaut simple (pas
      de vrai matchmaking par charge/mode).
- [x] **Fond de l'accueil** — **tranché le 27/07 : vrai fond spectateur live** (pas une animation
      décorative), voir §1.5/§4.1/§10.1.
- [x] **Durée de vie d'un salon privé** — **tranché le 27/07 : fermeture automatique + retour à
      l'accueil** des joueurs connectés à l'échéance (pas un simple verrouillage des nouvelles
      connexions), voir §4.2/§10.1.
- [ ] **"Guilde"/"Clan" dans le HUD et la nav haute** : garder ces champs comme promesse de
      fonctionnalité future (restent des `—` statiques dans la nouvelle UI), ou les retirer tant
      qu'aucun système de guilde/clan n'est spécifié (§0, §4.1, §4.7) ? Toujours ouvert malgré la
      refonte accueil (le mockup fourni affiche "Clan" mais sans en spécifier le contenu).
- [ ] **Modération en direct des salons actifs** (déconnexion forcée d'un joueur) : dans le
      périmètre de cette refonte, ou reporté comme le prévoyait le cahier des charges principal
      (§5.4, Phase 2) ? Impacte §5.4 et §10.
- [ ] **File de dons Ko-fi automatisée** : confirmer qu'on reste sur activation 100% manuelle
      (§5.5) plutôt que d'ajouter un webhook Ko-fi (changerait le périmètre backend).
- [ ] **Mascotte/élément illustré** : un personnage/bulle mascotte pour incarner la marque, ou
      rester sur des formes géométriques abstraites uniquement (§1.4) ?
- [ ] **Notifications éphémères en jeu** ("Tu as mangé X", montée de niveau) : retenues pour
      cette refonte ou différées (§4.7) ?

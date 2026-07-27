# Cahier des charges UI/UX — Angul.io

**Version :** 0.2 — Design/architecture figés et implémentés pour l'accueil, le lobby, le HUD de
jeu et l'admin ; reste à trancher : quelques questions ouvertes du §12, et les impacts backend du
§10 (non bloquants).
**Date :** 27 juillet 2026 (créé), révisé le 27 juillet 2026 (migration React + refonte
minimaliste)
**Périmètre :** refonte complète de l'interface d'accueil/lobby joueur, de l'interface de jeu
(HUD), et de l'interface d'administration.

Ce document a servi à figer les décisions de design et d'architecture UI avant l'implémentation,
comme le [cahier_des_charges.md](cahier_des_charges.md) l'a fait pour le moteur de jeu — il reste
la référence à jour de ces décisions (§1-§2 révisés le 27/07 pour refléter le passage à React et
au style minimaliste), pas un historique figé du jour de sa création.

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

**Révision (2026-07-27) :** la direction "coloré et ludique" (arcade/casual) initialement
retenue a été abandonnée après premier passage en revue — remplacée par une direction
**minimaliste, inspirée de l'outil Cobalt** : fond sombre plat, un seul accent de marque, pas
de dégradé décoratif, pas d'emoji. Objectif inchangé (donner envie de jouer, rester
lisible/accessible), mais obtenu par la sobriété plutôt que par la couleur : hiérarchie visuelle
claire, beaucoup d'espace, un seul geste de couleur là où ça compte (bouton "Jouer", accents de
mode) plutôt qu'une interface saturée.

Principes directeurs (mis à jour) :
- **Formes rondes mais sobres** — boutons pilule, cartes à coins arrondis (rayon modéré, pas
  exagéré) — reste un écho à la mécanique de jeu (cellules circulaires) sans devenir un élément
  décoratif dominant.
- **Fond sombre plat, un seul accent de marque** (bleu/violet sobre) pour l'action principale
  ("Jouer") et les éléments interactifs actifs. Les couleurs de mode (Vanilla/Hardcore/Folie,
  §1.2) restent utilisées, mais en usage strictement fonctionnel (petit point, bordure fine) —
  jamais comme remplissage décoratif de grandes surfaces.
- **Pas de glassmorphism/flou** : surfaces pleines, bordures fines (1px, opacité faible),
  élévation par une ombre discrète plutôt que par un flou d'arrière-plan.
- **Densité d'information faible sur l'accueil, plus élevée dans les sous-écrans** (voir §3.1) —
  ce principe reste inchangé par rapport à la version initiale.

### 1.2 Palette de couleurs — tranchée (2026-07-27)

Fond sombre plat, tokens définis dans `client/src/styles.css` et dupliqués à l'identique dans
`admin/src/styles.css` (§3.3, cohérence entre les deux apps) :

| Token | Valeur | Usage |
|---|---|---|
| `--bg` | `#0B0B0D` | Fond de page, quasi-noir |
| `--surface` | `#141416` | Cartes, panneaux, champs |
| `--surface-hover` | `#1C1C1F` | États survolés |
| `--border` / `--border-strong` | `rgba(255,255,255,.08)` / `.16` | Bordures fines, jamais d'ombre large |
| `--text` / `--text-soft` / `--text-faint` | `#F2F2F3` / `#8B8B93` / `#55555C` | Hiérarchie de texte |
| `--accent` | `#5B7CFA` (bleu/violet) | Bouton "Jouer", éléments actifs — **le seul accent de marque** |
| `--danger` / `--success` | `#FF5C5C` / `#4ADE80` | États d'erreur/confirmation |
| `--c-vanilla` / `--c-hardcore` / `--c-folie` | `#34D399` / `#F87171` / `#A78BFA` | Couleur signature par mode — usage fonctionnel minimal (point, bordure fine), pas décoratif |

La palette "pastilles de nourriture" évoquée dans une version antérieure de ce document a été
abandonnée comme palette d'accent générale (trop colorée pour la direction minimaliste retenue)
mais son principe survit à échelle réduite : chaque **mode de jeu** garde sa couleur signature
(`--c-vanilla`/`--c-hardcore`/`--c-folie`), utilisée uniquement pour les distinguer visuellement
(chip de salon, bordure de carte de mode), jamais en remplissage.

Pas de mode clair prévu pour l'instant : contrairement à la version précédente (thème clair
fixe), la nouvelle direction est **sombre par défaut**, cohérente avec l'esthétique Cobalt visée.

### 1.3 Typographie — tranchée

Une seule famille, système, dans les deux apps :
`-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`. Pas de
police web externe chargée (évite une dépendance réseau à un CDN de polices, cohérent avec la
priorité PWA/mobile légère et la sensibilité vie privée du projet). Une police à chasse fixe
(`ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`) est utilisée pour les valeurs
numériques du HUD (masse/vitesse/accélération) — lisibilité technique, cohérent avec le ton
Cobalt.

### 1.4 Formes, iconographie, motion — révisé

- **Pas d'emoji** : la navigation et les boutons utilisent des libellés texte seuls (§4.1) — plus
  sobre, et évite toute dépendance à un jeu d'icônes externe.
- Coins arrondis modérés sur les surfaces (cartes, boutons, champs), boutons en pilule — sans les
  rayons très généreux de la version précédente.
- Animations réduites à l'essentiel : transitions d'opacité courtes (ouverture/fermeture de
  panneau), pas de rebond/spring ni de confettis — cohérent avec la sobriété Cobalt.
- **`prefers-reduced-motion` reste respecté** malgré des animations déjà minimales (voir §9).

### 1.5 Ce qui NE change PAS visuellement

- Le canvas de jeu lui-même (rendu des cellules, pastilles, grille) reste piloté par
  `render.ts` — cette refonte ne touche pas au rendu du monde de jeu, seulement aux couches
  d'interface autour (accueil, HUD, admin). Un futur ajustement des couleurs de rendu en jeu
  pour coller à la nouvelle palette reste possible mais est hors périmètre de ce document.

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
  HUD (masse/vitesse/accélération) sont mises à jour par mutation DOM directe via des refs, pas
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

Décision explicite : **l'écran d'accueil reste minimaliste, orienté "jouer vite"**. Tout le
reste (compte, salons, classements, modes, cosmétiques) vit dans des **sous-menus** accessibles
depuis l'accueil, pas empilé sur l'écran principal.

```
Accueil (défaut)
├─ Champ pseudo (pré-rempli si connecté) + gros bouton "Jouer"
├─ Icône Compte/Profil (état visuel différent connecté/non connecté)
├─ Icône Salons (liste publique, créer, rejoindre par code)
├─ Icône Classements
├─ Icône Modes de jeu
└─ Icône Soutenir (Premium/dons)
```

Chaque icône ouvre un **panneau/sous-menu** (modale ou tiroir, à trancher en maquette — voir
§12) plutôt qu'une nouvelle page pleine, pour garder la sensation d'un accueil unique et rapide,
cohérent avec le fonctionnement actuel en overlays superposés au canvas.

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

### 4.1 Accueil

| Élément | Contenu | État |
|---|---|---|
| Logo/titre | "Angul.io" | Toujours visible |
| Champ pseudo | Pré-rempli si compte connecté, sinon libre (jeu en invité conservé) | Vide / pré-rempli / erreur (pseudo pris) |
| Bouton "Jouer" | Action principale — voir décision de matchmaking rapide en §12 | Normal / chargement (recherche de salon) |
| Barre d'icônes | Compte, Salons, Classements, Modes, Soutenir | Badge sur "Compte" si connecté ; badge "Premium" si actif |

### 4.2 Sous-menu Salons

- Liste des salons publics : nom, **chip coloré du mode** (§1.2), nombre de joueurs / capacité,
  bouton rejoindre.
- État vide : message + suggestion de créer un salon (si Premium) ou d'attendre.
- Section "Créer un salon" : réservée Premium (comportement actuel conservé), formulaire nom +
  mode + privé/public.
- Section "Rejoindre via code" : champ code + bouton.

### 4.3 Sous-menu Modes de jeu (nouveau contenu structuré)

Nécessite que le serveur expose, en plus de l'identifiant de mode, un **nom affichable et une
description courte** par mode (aujourd'hui `GET /api/modes` ne renvoie que des identifiants
bruts — impact backend, voir §10). Pour chacun des 3 modes existants (`vanilla`, `hardcore`,
`folie`) :
- Nom affichable + couleur signature (§1.2).
- Description courte (1-2 phrases, reprise/adaptée du cahier des charges principal §3.4/3.6).
- Éventuellement des tags (solo/équipe, courte/longue — repris de la question ouverte §3.4 du
  cahier des charges principal).

### 4.4 Sous-menu Classements (nouveau)

- Classement global (meilleur score toutes parties confondues) + filtre par mode.
- Pseudo du joueur connecté mis en évidence s'il apparaît dans le classement affiché.
- Nécessite un nouvel endpoit d'agrégation côté serveur (voir §10) — n'existe pas aujourd'hui
  (seuls les meilleurs scores personnels sont exposés).

### 4.5 Sous-menu Compte / Profil

- Non connecté : formulaire connexion/inscription (comportement actuel conservé).
- Connecté : pseudo, niveau (barre de progression XP plutôt que chiffre brut — plus ludique),
  meilleurs scores par mode, cosmétiques débloqués (grille de vignettes plutôt que texte),
  badge Premium si actif, bouton déconnexion.

### 4.6 Sous-menu Soutenir

- Reprend le contenu actuel (explication don libre, lien Ko-fi) avec le nouveau style visuel ;
  logique inchangée (cahier des charges §5.3, activation manuelle par l'admin).

### 4.7 Écran de jeu (HUD)

- Canvas inchangé (§2.3).
- Panneau de stats restylé selon la nouvelle direction (§1), en conservant les mêmes données
  (Pseudo, Guilde\*, Masse, Vitesse, Accélération) — \*voir décision à trancher en §12 sur
  "Guilde".
- Ajout envisageable, cohérent avec la direction "ludique" : petites notifications éphémères
  ("Tu as mangé *Untel*", "Niveau supérieur !") — à cadrer précisément si retenu (hors périmètre
  strict de cette refonte visuelle si ça implique de la logique serveur nouvelle).
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
- [x] **Palette exacte** — **tranché : minimaliste façon Cobalt** (§1.2), fond sombre plat, un
      seul accent de marque (`#5B7CFA`), palette pastille réduite à un usage fonctionnel par
      mode (chip/bordure), pas de fond dégradé.
- [x] **Typographies** — **tranché : police système uniquement** (§1.3), pas de police web
      externe.
- [x] **Sous-menus** — **tranché (implémenté) : modale centrée** (`client/src/components/
      Panel.tsx`), même famille visuelle que le profil, cohérent avec l'existant plutôt qu'un
      tiroir latéral ou une page dédiée.
- [x] **"Jouer" en un clic** — **tranché (implémenté) : assignation automatique** au premier
      salon public de la liste fraîchement récupérée (voir `App.tsx`, `handlePlay`) ; s'il n'y en
      a aucun, ouverture du panneau Salons avec un message explicite. Reste un choix par défaut
      simple (pas de vrai matchmaking par charge/mode) — à raffiner si le besoin se confirme.
- [ ] **"Guilde" dans le HUD** : garder ce champ comme promesse de fonctionnalité future (reste
      un `—` statique dans la nouvelle UI), ou le retirer tant qu'aucun système de guilde n'est
      spécifié (§0, §4.7) ?
- [ ] **Modération en direct des salons actifs** (déconnexion forcée d'un joueur) : dans le
      périmètre de cette refonte, ou reporté comme le prévoyait le cahier des charges principal
      (§5.4, Phase 2) ? Impacte §5.4 et §10.
- [ ] **File de dons Ko-fi automatisée** : confirmer qu'on reste sur activation 100% manuelle
      (§5.5) plutôt que d'ajouter un webhook Ko-fi (changerait le périmètre backend).
- [ ] **Mascotte/élément illustré** : un personnage/bulle mascotte pour incarner la marque, ou
      rester sur des formes géométriques abstraites uniquement (§1.4) ?
- [ ] **Notifications éphémères en jeu** ("Tu as mangé X", montée de niveau) : retenues pour
      cette refonte ou différées (§4.7) ?

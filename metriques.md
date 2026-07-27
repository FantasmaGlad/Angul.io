# Métriques et formules — Angul.io

**Version :** 0.5 — Document de référence technique. (v0.3 ajoute le contrôle par
intensité du curseur, §5.1 ; v0.4 corrige le modèle de decay §6 — seuil absolu par mode,
`Mm`/`Ml` de la feuille Excel, plutôt que la masse de départ ; v0.5 remplace la
distribution continue de masse de nourriture par des types de pellets à poids de spawn
discrets et double la densité de nourriture des deux modes, §7 — demande utilisateur,
pas la feuille Excel.)
**Origine des valeurs :** dérivées du cahier des charges (§3.5) pour la première version
(v0.1), puis **révisées et étendues** à partir de la feuille de calcul fournie par
l'utilisateur ("Angul.io - Master Sheet Engine & Documentation Technique.xlsx") qui
introduit un modèle vitesse/accélération plus riche et une deuxième instance de mode
("Folie"), validant l'architecture décrite ci-dessous.

**Architecture :** depuis la v0.2, ce document ne décrit plus "le mode Vanilla" comme un
bloc de règles isolé, mais un **moteur paramétrique unique** (`server/src/mods/parametric/`)
piloté par un fichier de configuration JSON par mode (`server/configs/vanilla.json`,
`server/configs/folie.json`). Toutes les formules ci-dessous sont génériques ; les
tableaux donnent les valeurs concrètes pour Vanilla et Folie côte à côte. Ajouter un
nouveau mode purement paramétrique (mêmes mécaniques, valeurs différentes) ne demande
qu'un nouveau fichier JSON, pas de nouveau code — voir plan_implementation.md Lot 1.6.
Un mode aux mécaniques structurellement différentes (ex. IA de zombies) reste un module
de code à part entière (API de hooks, `engine/mod.ts`), ce document ne couvre alors que
sa partie "valeurs numériques" s'il en a.

---

## 0. Conventions et unités

- **Masse** : unité abstraite, sans dimension physique réelle — c'est le score et le
  paramètre de base de toutes les autres formules.
- **Distance** : **pixels (`px`)**, qui sont ici littéralement l'unité de simulation (pas
  seulement une unité d'affichage) — changement par rapport à la v0.1 de ce document, qui
  utilisait une unité abstraite ("uc") découplée du rendu. La feuille Excel raisonne
  directement en pixels (taille de carte, vitesse en px/s) ; le zoom caméra côté client
  (`client/src/render.ts`) reste un simple facteur d'affichage indépendant, sans lien
  avec cette unité de simulation.
- **Temps** : secondes (`s`).
- **Fréquence de tick serveur** : `f_tick` (Hz). Valeur de référence : **20 Hz**
  (`Δt = 0.05 s`), bas de la fourchette 20-30 Hz du Lot 1.2. Le moteur utilise en réalité
  le `dt` réel mesuré entre deux ticks (`Room.tick()`), pas un pas fixe supposé — les
  formules ci-dessous sont continues et discrétisées par ce `dt` réel.

---

## 1. Schéma de configuration paramétrique

Un mode = un objet JSON respectant ce schéma (voir
`server/src/mods/parametric/config.ts` pour la définition TypeScript exacte). Origine de
chaque champ précisée dans la dernière colonne : **Excel** = feuille de calcul
utilisateur, **v0.1** = première version de ce document (cahier des charges §3.5, pas
couvert par la feuille), **implémentation** = introduit par nécessité d'implémentation,
sans équivalent dans les deux sources précédentes.

| Champ | Symbole feuille | Rôle | Origine |
|---|---|---|---|
| `player.startMass` | M0 | Masse au spawn/respawn | Excel |
| `player.maxSplits` | Smax | Morceaux max simultanés | Excel |
| `player.minSplitMass` | — | Masse minimale pour avoir le droit de split | v0.1 (absent de la feuille) |
| `physics.v0` | V0 | Vitesse nominale à M0 (px/s) | Excel |
| `physics.speedMultiplier` | kv | Multiplicateur de vitesse global du mode | Excel |
| `physics.speedMassExponent` | gamma | Exposant d'atténuation de la vitesse | Excel |
| `physics.velocityFloor` | Vfloor | Vitesse plancher (px/s) | Excel |
| `physics.accelerationBase` | A0 | Accélération à M0 (px/s²) | Excel |
| `physics.accelerationMassExponent` | alpha | Exposant d'atténuation de l'accélération | Excel |
| `split.ejectEfficiency` | eta_W | Masse gagnée par le morceau éjecté / masse perdue | Excel |
| `split.ejectSpeedFactor` | — | Vitesse initiale d'éjection (× v(m)) | implémentation |
| `merge.baseTimeSec` | Tbase | Cooldown de fusion de base (s) | Excel |
| `merge.massFactor` | gamma_rec | Allongement du cooldown avec la masse | Excel |
| `merge.overlapMinFraction` | — | Chevauchement minimal pour fusionner | v0.1 (absent de la feuille) |
| `eating.massAdvantage` | — | Avantage de masse requis pour manger un joueur | v0.1 (absent de la feuille) |
| `eating.minMassToEatFood` | — | Masse minimale pour manger une particule | v0.1 (absent de la feuille) |
| `decay.threshold` | Ml (implicite) | Seuil de masse déterminant le taux de perte | Excel (v0.4, §1 — `massLoose`) |
| `decay.rateAboveThreshold`/`rateBelowThreshold` | Ml | Taux de perte au-dessus/en-dessous du seuil | Excel (v0.4) |
| `decay.intervalAboveThresholdSec`/`intervalBelowThresholdSec` | Ml | Intervalle des taux ci-dessus | Excel (v0.4) |
| `decay.floor` | Mm | Masse plancher (perte jamais en-dessous) | Excel (v0.4 — `minimumMass`) |
| `arena.width/height` | Wmap/Hmap | Dimensions de la carte (px) | Excel |
| `arena.borderType` | borderType | STRICT_WALL / ELASTIC_BOUNCE / TOROIDAL / TOXIC_ZONE | Excel (seul TOXIC_ZONE n'est pas implémenté — paramètres de dégâts non spécifiés) |
| `arena.bounceRestitution` | — | Fraction de vitesse restituée (ELASTIC_BOUNCE) | Excel |
| `food.density` | D_food | Pellets par bloc de 1000×1000 px² | Excel (valeurs doublées en v0.3, demande utilisateur) |
| `food.respawnRatePerSecond` | R_food | Pellets réapparaissant par seconde | Excel |
| `food.pelletTypes` | — | Types de pellets (couleur/masse/poids de spawn) — remplace `massMin`/`massMax`/`massSkewExponent` (v0.2) | v0.3, demande utilisateur (table de valeurs par couleur) |
| `areaConstant` | — | Constante masse→aire (K_AREA) | v0.1 (absent de la feuille) |

---

## 2. Table des valeurs — Vanilla vs Folie

| Paramètre | Vanilla | Folie |
|---|---|---|
| `player.startMass` (M0) | 50 | 200 |
| `player.maxSplits` (Smax) | 16 | 32 |
| `player.minSplitMass` | 100 (=2×M0) | 400 (=2×M0, notre extrapolation) |
| `physics.v0` (V0) | 300 px/s | 300 px/s |
| `physics.speedMultiplier` (kv) | 1.0 | **2.5** |
| `physics.speedMassExponent` (gamma) | 0.44 | 0.44 |
| `physics.velocityFloor` (Vfloor) | 20 px/s | 20 px/s |
| `physics.accelerationBase` (A0) | 1500 px/s² | 1500 px/s² |
| `physics.accelerationMassExponent` (alpha) | 0.70 | 0.70 |
| `split.ejectEfficiency` (eta_W) | 1.0 (conservation stricte) | 1.2 (crée +20% de masse) |
| `split.ejectSpeedFactor` | 2.0 | 2.0 |
| `merge.baseTimeSec` (Tbase) | 30 s | 15 s |
| `merge.massFactor` (gamma_rec) | 0 (cooldown fixe) | 0 (cooldown fixe) |
| `merge.overlapMinFraction` | 1/3 | 1/3 |
| `eating.massAdvantage` | 5 % | 5 % |
| `eating.minMassToEatFood` | 2 | 2 |
| `decay.threshold` (Ml) | 100 | 100 (⚠️ Folie démarre déjà au-dessus, voir §6) |
| `decay.rateAboveThreshold`/`rateBelowThreshold` (Ml) | 2 % / 1 % | 2 % / 1 % |
| `decay.floor` (Mm) | 2 | 2 |
| `arena.width` × `height` | 15000 × 15000 px | 20000 × 20000 px |
| `arena.borderType` | STRICT_WALL | ELASTIC_BOUNCE (restitution 0.8) |
| `food.density` (D_food) | 30 / 1000px² (v0.3, était 15) | 60 / 1000px² (v0.3, était 30) |
| `food.respawnRatePerSecond` (R_food) | 100 / s | 200 / s |
| `food.pelletTypes` | 8 types, voir §7 (poids concentrés sur les petites masses) | 8 types, voir §7 (poids concentrés sur les grosses masses) |
| `areaConstant` (K_AREA) | π (Rayon = √masse) | π |

> **Correction apportée** : la cellule Folie/`speedMultiplier` du fichier Excel source
> contenait une date (02/05/2026) au lieu d'un nombre — artefact classique de
> l'autocorrection Excel sur une saisie "2.5". Corrigée à **2.5** dans le fichier et
> reprise telle quelle ici.

Fichiers sources faisant foi pour l'implémentation :
[server/configs/vanilla.json](server/configs/vanilla.json),
[server/configs/folie.json](server/configs/folie.json).

---

## 3. Relation masse ↔ aire ↔ rayon

Inchangé depuis la v0.1 — absent de la feuille Excel, qui ne précise pas cette formule.

```
Aire(m)  = K_AREA * m
Rayon(m) = √(Aire(m) / π) = √(K_AREA * m / π)
```

Avec `K_AREA = π` (Vanilla et Folie), la formule se simplifie en **Rayon(m) = √m**.

---

## 4. Vitesse en fonction de la masse

```
v(m) = MAX( Vfloor, V0 * kv * (M0/m)^gamma )
```

Remplace la formule `v(m) = V_REF·√(M0/m)` de la v0.1 (exposant fixe 0.5) par un modèle
paramétrable (exposant `gamma`, multiplicateur `kv` par mode) et un plancher absolu
(`Vfloor`) plutôt qu'un facteur de clamp relatif.

Valeurs Vanilla (`V0=300, kv=1, gamma=0.44, Vfloor=20`) :

| Masse | v(m) |
|---|---|
| 50 (M0) | 300 px/s |
| 200 | ≈ 163.0 px/s |
| 1 000 000 | 20 px/s (plancher) |

Folie applique en plus `kv=2.5` : à masse égale, un morceau va 2.5× plus vite qu'en
Vanilla (mode "rapide et chaotique").

**Direction** : le vecteur vitesse *cible* est dirigé du centre du morceau vers la
position du curseur du joueur, normalisé puis multiplié par `v(m)`. Contrairement à la
v0.1, ce n'est **pas** la vélocité appliquée instantanément — voir §5.

---

## 5. Accélération (inertie du mouvement)

**Changement de modèle majeur par rapport à la v0.1.** La v0.1 n'avait aucune inertie sur
le mouvement normal (vitesse instantanée vers le curseur) et un mécanisme de "boost" ad
hoc réservé au split. La feuille Excel introduit un modèle d'accélération générique,
valable pour **tout** déplacement — plus une cellule est grosse, plus elle met de temps à
atteindre sa vitesse cible (inertie), pas seulement plus elle est lente en vitesse de
croisière.

```
a(m) = A0 * (M0/m)^alpha
```

`a(m)` est un taux de rapprochement (px/s²) vers la vitesse cible, pas une vitesse
instantanée. Chaque tick :

```
vitesse_cible = direction_curseur * v(m) * intensité     (§4, §5.1)
Δ_max         = a(m) * intensité * dt
vitesse       ← deplacer_vers(vitesse, vitesse_cible, Δ_max)
```

où `deplacer_vers(actuel, cible, max)` rapproche `actuel` de `cible` d'au plus `max` (en
norme) — implémenté génériquement dans `shared/src/vector.ts` (`moveToward`), réutilisable
par n'importe quel mod. `intensité` est défini en §5.1 (v0.3 — absent des versions
précédentes, qui appliquaient toujours l'intensité maximale).

Valeurs Vanilla/Folie (`A0=1500, alpha=0.70`, identique dans les deux modes) :

| Masse | a(m) |
|---|---|
| 50 (M0) | 1500 px/s² |
| 200 | ≈ 568.4 px/s² |

**Ce modèle remplace aussi le "boost" de split de la v0.1** : le morceau éjecté démarre
avec une vitesse initiale élevée (§8), puis le même modèle d'accélération générique le
ramène naturellement vers la vitesse cible du joueur, sans minuteur de décroissance
séparé — une seule formule pour tout le mouvement.

### 5.1. Intensité du curseur (contrôle analogique)

**Ajout v0.3**, suite à une proposition utilisateur. Auparavant, tout déplacement du
curseur hors du centre demandait la vitesse/accélération cible *maximale* d'un coup
(contrôle tout-ou-rien). Désormais, la distance du curseur au centre de l'écran module une
**intensité** ∈ [0, 1] qui réduit proportionnellement la vitesse cible **et** le taux
d'accélération — contrôle fin près du centre, plein régime au bord :

```
intensité = clamp( distance_curseur_écran / RAYON_CONTROLE_PX, 0, 1 )
```

Calculée **côté client** (`client/src/input.ts`, `RAYON_CONTROLE_PX = 300`, en pixels
écran — indépendant du zoom, puisque le joueur est toujours rendu au centre de son propre
écran). Le vecteur envoyé au serveur (`dir` du protocole, `shared/src/protocol.ts`) encode
direction et intensité en un seul `Vector2` : sa **norme** (∈ [0,1], garantie côté client)
est l'intensité, sa direction normalisée est l'angle visé — pas de champ supplémentaire
dans le protocole. Le split ignore l'intensité (toujours "plein", voir §8).

Exemple : à 50 % du rayon de contrôle, `intensité = 0.5` → vitesse cible à 50 % de `v(m)`
**et** taux d'accélération à 50 % de `a(m)` (converge donc deux fois plus lentement vers
une cible elle-même deux fois plus basse).

---

## 6. Perte de masse passive (decay)

**Révisé en v0.3** : la feuille Excel documente en fait ce paramètre (§1 du dictionnaire,
symboles `Mm`/`minimumMass` et `Ml`/`massLoose`, ajoutés après une première lecture
incomplète de la feuille). Différence clé par rapport à la v0.1/v0.2 : le seuil qui
détermine le taux de perte n'est **plus** la masse de départ (`M0`, qui varie par mode :
50 pour Vanilla, 200 pour Folie) mais une **valeur absolue propre au mode**
(`decay.threshold`), qui vaut 100 pour Vanilla — coïncidant avec son propre
`minSplitMass`, cohérent avec l'idée "on décroît plus vite une fois en capacité de
splitter".

```
λ_above = -ln(1 - rateAboveThreshold) / intervalAboveThresholdSec
λ_below = -ln(1 - rateBelowThreshold) / intervalBelowThresholdSec

dm/dt = -λ(m) * m,   λ(m) = λ_above si m > threshold, λ_below si floor < m ≤ threshold, 0 sinon

m ← max( m * exp(-λ(m) * dt), floor )
```

Valeurs (Vanilla et Folie, la feuille ne différencie pas les deux modes sur ce point) :
`threshold = 100`, `rateAboveThreshold = 2 %`, `intervalAboveThresholdSec = 5`,
`rateBelowThreshold = 1 %`, `intervalBelowThresholdSec = 5`, `floor = 2` (`Mm`).

> ⚠️ **Point à confirmer avec l'utilisateur** : `threshold = 100` a été repris tel quel
> (littéralement donné par la feuille) pour Folie aussi, alors que Folie démarre à
> `M0 = 200` — donc **un joueur Folie est toujours au-dessus du seuil dès le spawn** et
> décroît systématiquement au taux le plus rapide (2 %/5 s), jamais au taux réduit. C'est
> peut-être voulu (cohérent avec l'esprit "chaos", économie plus punitive), mais ça
> mériterait d'être confirmé plutôt que supposé — alternative possible : un seuil propre à
> Folie (ex. calé sur son propre `minSplitMass = 400`, par symétrie avec Vanilla).

---

## 7. Alimentation : manger une particule

- **Condition :** `masse_joueur ≥ eating.minMassToEatFood` (= 2, Vanilla et Folie)
- **Effet :** `masse_joueur ← masse_joueur + masse_particule`

**Masse d'une particule** (v0.3, remplace le modèle continu `massMin`/`massMax`/
`massSkewExponent` de la v0.2 — demande utilisateur du 2026-07-27, table de types de pellets) :
tirage pondéré parmi un ensemble de **types de pellets** (`food.pelletTypes`), chacun avec une
masse fixe et un poids de spawn relatif propre au mode. La masse *est* le type (aucun champ
supplémentaire sur le protocole réseau) — le client déduit la couleur d'affichage directement
de la masse reçue (`client/src/render.ts`, `foodColorForMass`), la correspondance masse→couleur
étant la même quel que soit le mode (seuls les poids de spawn diffèrent).

| Pellet | Masse | Poids Vanilla | Poids Folie |
|---|---|---|---|
| Vert | 1 | 28% | 10% |
| Bleu | 2 | 22% | 10% |
| Jaune | 3 | 18% | 10% |
| Violet | 4 | 13% | 10% |
| Rouge | 5 | 10% | 15% |
| Orange | 6 | 5% | 15% |
| Rose | 7 | 3% | 15% |
| Multicolor | 12 | 1% | 15% |

Vanilla reste très concentré sur les petites masses (Vert/Bleu/Jaune représentent 68% des
spawns) ; Folie est nettement plus généreux sur les pellets de haute valeur (60% de poids sur
Rouge/Orange/Rose/Multicolor, contre 28% en Vanilla). Le pellet Multicolor (masse 12, le plus
gros) reste le plus rare dans les deux modes, mais 15× plus fréquent en Folie (15% vs 1%).

**Densité et taux de réapparition** (inchangé depuis la v0.2 — remplace le `FOOD_TARGET_COUNT`
fixe de la v0.1, qui ne s'adaptait pas à la taille de la carte) :

```
cible = D_food * (largeur_carte * hauteur_carte) / 1000²
```

À chaque tick, un crédit de spawn s'accumule à `R_food` particules/seconde et se dépense
tant que le nombre de particules est sous la cible.

| | Vanilla | Folie |
|---|---|---|
| Carte | 15000×15000 | 20000×20000 |
| Densité | **30**/1000px² (v0.3, était 15) | **60**/1000px² (v0.3, était 30) |
| **Cible calculée** | **≈ 6750 particules** | **≈ 24 000 particules** |
| Taux de réapparition | 100/s | 200/s |

> ⚠️ **Densité doublée par rapport à la v0.2** (demande utilisateur du 2026-07-27), qui avait
> déjà noté que le total dérivé de la feuille (≈3375/≈12000) était bien plus élevé que le
> `FOOD_TARGET_COUNT = 300` fixé arbitrairement en v0.1, avec un effet mesurable sur la bande
> passante (Lot 1.8). Doubler encore la densité amplifie ce même effet — confirmé en
> conditions réelles (voir Journal, 2026-07-27) : jusqu'à ~741 particules de nourriture visibles
> simultanément par un seul client en Vanilla (rayon d'intérêt de 3000px), contre quelques
> centaines avant ce changement. Aucune nouvelle mesure de bande passante dédiée n'a été refaite
> à ce stade (le besoin d'interest management était déjà acté avant ce changement, voir Lot 1.8) ;
> à surveiller si un test de charge futur révèle un nouveau palier.

---

## 8. Split

**Condition :** `masse ≥ minSplitMass` **ET** nombre de morceaux du joueur `< maxSplits`.

**Répartition de la masse**, généralisée par `ejectEfficiency` (eta_W) — la v0.1 n'avait
qu'un partage 50/50 strict :

```
masse_restante = masse / 2
masse_éjectée  = (masse / 2) * ejectEfficiency
```

Vanilla (`ejectEfficiency = 1`) : partage 50/50 strict, comme en v0.1.
Folie (`ejectEfficiency = 1.2`) : le morceau éjecté reçoit 20 % de masse en plus que ce
que le joueur perd — de la masse est *créée* au split (cohérent avec l'esprit "chaos" du
mode).

**Position** : le morceau éjecté démarre à `position_origine + direction × (2 × rayon)`,
tangent au morceau d'origine.

**Vitesse initiale d'éjection** (remplace le mécanisme de boost à minuteur de la v0.1,
voir §5) :

```
vitesse_éjectée(T0) = direction_split * v(masse_éjectée) * ejectSpeedFactor
```

Puis le modèle d'accélération générique (§5) ramène progressivement cette vitesse vers la
vitesse cible du joueur — pas de minuteur de décroissance séparé.

---

## 9. Manger un autre joueur / répulsion sinon

Inchangé depuis la v0.1 (absent de la feuille Excel) :

```
Condition : masse_attaquant ≥ masse_cible * (1 + eating.massAdvantage)
Effet      : masse_attaquant ← masse_attaquant + masse_cible ; morceau cible retiré
```

Si aucun des deux morceaux ne remplit la condition, répulsion douce (formule inchangée,
proportionnelle à la pénétration, pondérée par les masses respectives) — voir
`server/src/mods/parametric/index.ts` (`applyRepulsion`).

---

## 10. Fusion (merge) entre morceaux du même joueur

**Cooldown généralisé** — la v0.1 avait un cooldown fixe (30 s) ; la feuille Excel
introduit une dépendance à la masse :

```
T_requis(m) = baseTimeSec + massFactor * m
```

Le cooldown de chaque morceau est évalué avec **sa propre masse au moment de son
dernier split** (`massAtSplit`), pas sa masse courante (qui peut avoir varié par
alimentation/decay depuis) :

```
requis_A = baseTimeSec + massFactor * massAtSplit_A
requis_B = baseTimeSec + massFactor * massAtSplit_B
fusion possible si splitElapsedS_A ≥ requis_A ET splitElapsedS_B ≥ requis_B
```

Vanilla et Folie ont `massFactor = 0` à ce jour → cooldown effectivement fixe (30 s
Vanilla, 15 s Folie), mais la formule générale permet à un futur mode de faire varier le
cooldown avec la masse sans changement de code.

**Condition de chevauchement** (inchangée depuis la v0.1, absente de la feuille) :

```
Aire_overlap(r1, r2, d) ≥ overlapMinFraction * (Aire(m1) + Aire(m2))
```

Formule de l'aire d'intersection de deux cercles : voir `shared/src/geometry.ts`
(`circleOverlapArea`), inchangée depuis la v0.1.

**Effet** : masse additive, position barycentrique pondérée par la masse — inchangé.

---

## 11. Bords de la carte

**Généralisé en v0.2** — la v0.1 ne connaissait que le mur bloquant. Quatre types
documentés par la feuille Excel, trois implémentés (`server/src/mods/parametric/border.ts`) :

| `borderType` | Comportement | Statut |
|---|---|---|
| `STRICT_WALL` | Position bloquée au bord, vélocité perpendiculaire annulée | Implémenté (Vanilla) |
| `ELASTIC_BOUNCE` | Position bloquée, vélocité perpendiculaire inversée × `bounceRestitution` | Implémenté (Folie, restitution 0.8) |
| `TOROIDAL` | Réapparition de l'autre côté de la carte (carte torique) | Implémenté, inutilisé par Vanilla/Folie à ce jour |
| `TOXIC_ZONE` | Dégâts hors des limites | **Non implémenté** — la feuille ne précise pas de taux de dégâts, on échoue explicitement plutôt que d'inventer une valeur |

---

## 12. Fréquence de tick et discrétisation générale

Inchangé depuis la v0.1 : toutes les formules continues ci-dessus sont appliquées par
tick avec le `dt` réel mesuré par `Room` (§0), pas un pas fixe supposé. Le déplacement
lui-même (`position ← position + vélocité * dt`) reste générique, calculé par le moteur
(`engine/room.ts`), indépendamment de tout mod.

---

## 13. Récapitulatif des points encore ouverts / assumés

- **Densité de nourriture élevée** (§7) : ~6750 particules (Vanilla) / ~24 000 (Folie)
  depuis le doublement de densité v0.3 (demande utilisateur, était ~3375/~12000 sur les
  valeurs de la feuille Excel), avec un impact bande passante déjà significatif avant ce
  doublement (Lot 1.8). À revalider en conditions réelles de déploiement (Lot 8).
- **`minSplitMass` de Folie (400)** : notre extrapolation (2×M0, comme Vanilla), la
  feuille ne le précise pas explicitement.
- **Poids de spawn des types de pellets par mode** (§7, v0.3) : table fournie par
  l'utilisateur (pas la feuille Excel) — remplace l'ancien `massSkewExponent`
  (interprétation d'une description qualitative de la feuille, "plus de petits que de
  gros", maintenant obsolète).
- **`decay.threshold` pour Folie (100, littéral)** : voir l'avertissement §6 — Folie
  démarre à `M0=200`, donc toujours au-dessus de ce seuil, jamais au taux réduit. À
  confirmer : voulu, ou seuil propre à Folie (ex. son propre `minSplitMass=400`) ?
- **`eating.*` pour Folie** : repris identique à Vanilla, ni la feuille ni l'utilisateur ne
  l'ont encore précisé pour Folie (vient du cahier des charges §3.5, spécifique à Vanilla
  à l'origine).
- **Incohérences entre le "dictionnaire" (§1 de la feuille) et sa "matrice de modes"
  (§2)** pour la taille de carte et `R_food` — le dictionnaire donne des valeurs exemple
  différentes de celles réellement utilisées par mode ; on a retenu les valeurs de la
  matrice (les plus spécifiques) comme faisant foi.
- **`TOXIC_ZONE`** non implémenté (§11) — à spécifier si un futur mode en a besoin.

---

## 14. Autres modes de jeu

Folie (§2 et suivants) est le premier exemple concret d'un second mode purement
paramétrique (aucune ligne de code spécifique, seulement `server/configs/folie.json`) —
il valide déjà une bonne partie de l'objectif du Lot 4 (prouver que l'architecture
supporte plusieurs modes). Un mode aux mécaniques structurellement nouvelles (ex. un mode
"zombie" avec IA d'entité non-joueur, cf. cahier des charges §3.4) restera un module de
code à part, documenté ici pour sa seule partie "valeurs numériques" s'il en a.

### 14.1 Hardcore (Lot 4 — mode aux mécaniques structurellement nouvelles)

Choisi comme second mode de validation de l'API de hooks (cahier des charges §3.4, #2) —
contrairement à Folie, Hardcore n'est **pas** réductible au schéma paramétrique (§1) : il
introduit deux mécaniques qu'aucun réglage de valeur ne peut exprimer.

**Mouvement/split/fusion/bords/nourriture** : identiques à Vanilla (`server/configs/hardcore.json`
reprend exactement les valeurs de `vanilla.json`) — rien à changer de ce côté-là, cf. §3.4 #2 du
cahier des charges qui ne décrit que l'absorption et la mort comme différentes.

**Multiplicateur d'absorption entre joueurs** — seule la masse gagnée en mangeant un **autre
joueur** est affectée (la nourriture ambiante reste 1:1, comme Vanilla) :

```
gain(attaquant) = masse(cible) × massGainMultiplier      (au lieu de gain = masse(cible))
```

`massGainMultiplier = 10` par défaut (configurable par salon, `HardcoreModConfig`) — valeur
d'exemple du cahier des charges ("x10 ou configurable"), pas mesurée en playtest à ce jour.
La condition pour avoir le droit de manger (`eating.massAdvantage`, 5 %) reste inchangée : seul
le montant gagné change, pas qui a le droit de manger qui.

**Perte totale de la progression XP de la partie en cas de mort** — contrairement aux autres
modes (la masse maximale atteinte pendant la vie est créditée au compte même après une mort,
Lot 3.5), Hardcore renvoie toujours 0 :

```
transformScoreForAccount(masseMaxAtteinte) = 0     (au lieu de = masseMaxAtteinte, identité)
```

Implémenté via un nouveau hook optionnel (`GameMod.transformScoreForAccount`, voir
`engine/mod.ts` et le bilan de l'API §4.5 du plan) plutôt qu'un cas particulier codé en dur
dans `net/server.ts` — appelé juste avant l'écriture en base (mort ou déconnexion, les deux
étant déjà traitées de façon identique par le Lot 3.5).

Fichier source : [server/configs/hardcore.json](server/configs/hardcore.json), code du mode :
[server/src/mods/hardcore/index.ts](server/src/mods/hardcore/index.ts) — composé au-dessus de
`createParametricMod` plutôt que dupliqué (voir commentaire en tête du fichier).

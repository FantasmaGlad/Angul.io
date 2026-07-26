# Métriques et formules — Angul.io

**Version :** 0.1 — Document de référence technique, dérivé de
[cahier_des_charges.md](cahier_des_charges.md) §3.5.
**Portée de cette version :** mode **Vanilla** uniquement. Les autres modes (§3.4 du
cahier des charges) auront chacun leur propre section à la suite de celle-ci, une fois
leur spécification chiffrée tranchée (Lot 4.2 et suivants du
[plan d'implémentation](plan_implementation.md)).

Ce document a vocation à être la **référence unique et implémentable** des formules de
jeu : un développeur doit pouvoir coder directement à partir de ce fichier sans deviner
de valeur manquante. Il résout notamment le point ouvert §3.5/tâche 0.2 du plan
("formule exacte de décroissance de la vélocité") en proposant une formule par défaut,
explicitement ajustable par playtesting sans changer l'architecture.

---

## 0. Conventions et unités

- **Masse** : unité abstraite `u`, sans dimension physique réelle — c'est le score et le
  paramètre de base de toutes les autres formules.
- **Distance** : "unité de carte" (`uc`), indépendante des pixels affichés à l'écran.
  L'échelle pixel/caméra est une affaire de rendu client (Lot 1.7), hors scope de ce
  document — ce qui compte ici est la cohérence interne des calculs de collision.
- **Temps** : secondes (`s`).
- **Fréquence de tick serveur** : `f_tick` (Hz). Valeur de référence utilisée dans ce
  document : **20 Hz** (`Δt = 0.05 s`), bas de la fourchette 20-30 Hz du Lot 1.2. Toutes
  les formules sont données en temps continu puis discrétisées par tick pour
  implémentation directe ; si la fréquence finale retenue diffère, seules les valeurs
  numériques discrètes changent, pas les formules.

---

## 1. Table des constantes (mode Vanilla)

| Symbole | Nom | Valeur par défaut | Source |
|---|---|---|---|
| `M_START` | Masse de départ | 50 | Cahier des charges §3.5 |
| `M_SPLIT_MIN` | Masse minimum pour avoir le droit de split | 100 | §3.5 |
| `N_PIECES_MAX` | Morceaux max sur le terrain par joueur | 16 | §3.5 |
| `T_MERGE_COOLDOWN` | Cooldown de fusion après split | 30 s | §3.5 |
| `OVERLAP_MERGE_MIN` | Chevauchement minimum pour fusion | 1/3 de la surface totale des 2 morceaux | §3.5 |
| `M_FOOD` | Masse d'une particule de nourriture | 1 | §3.5 |
| `M_EAT_FOOD_MIN` | Masse minimale pour manger une particule | 2 | §3.5 |
| `EAT_MASS_ADVANTAGE` | Avantage de masse requis pour manger un joueur | 5 % (×1.05) | §3.5 |
| `DECAY_RATE_ABOVE` | Taux de perte passive au-dessus de `M_START` | 1 %/5 s | §3.5 |
| `DECAY_RATE_BELOW` | Taux de perte passive en-dessous de `M_START` | 1 %/10 s | §3.5 |
| `M_DECAY_FLOOR` | Plancher de perte de masse passive | 2 | §3.5 |
| `K_AREA` | Constante de conversion masse → aire | π (donc `Rayon = √masse`) | Ce document §2, défaut MVP |
| `V_REF` | Vitesse de référence à `M_START` | 6 uc/s | Ce document §3, défaut MVP, **ajustable en playtest** |
| `V_MAX_FACTOR` / `V_MIN_FACTOR` | Bornes de clamp de vitesse | ×3 / ×0.25 de `V_REF` | Ce document §3 |
| `BOOST_SPEED_FACTOR` | Vitesse additionnelle au split (boost), en facteur de v(m_morceau) | ×2 | Ce document §4 |
| `T_BOOST` | Durée de décroissance du boost de split | 0.3 s | Ce document §4 |
| `f_tick` | Fréquence de tick serveur | 20 Hz (`Δt` = 0.05 s) | Lot 1.2, plage 20-30 Hz |

---

## 2. Relation masse ↔ aire ↔ rayon

Le rayon géométrique d'un morceau (joueur ou particule) est dérivé de sa masse en
supposant une **densité surfacique constante** : l'aire est proportionnelle à la masse.
C'est ce qui garantit que la masse totale se conserve visuellement lors d'un split (aire
totale inchangée) ou d'une fusion (aires additives).

```
Aire(m)  = K_AREA * m
Rayon(m) = √(Aire(m) / π) = √(K_AREA * m / π)
```

Avec `K_AREA = π` (valeur par défaut retenue pour ce MVP), la formule se simplifie en :

> **Rayon(m) = √m**

Exemples avec cette formule par défaut :

| Masse | Rayon |
|---|---|
| 2 (plancher de decay) | ≈ 1.41 uc |
| 50 (masse de départ) | ≈ 7.07 uc |
| 100 (seuil de split) | 10 uc |
| 500 | ≈ 22.36 uc |

---

## 3. Vitesse en fonction de la masse

Principe (§3.5) : plus un joueur/morceau est gros, plus il est lent. Formule à
décroissance en `1/√m`, ancrée sur la masse de départ comme référence :

```
v(m) = V_REF * √(M_START / m)
```

Avec clamp pour éviter des vitesses extrêmes aux masses très faibles ou très élevées :

```
v(m) = clamp( V_REF * √(M_START / m), V_MIN_FACTOR * V_REF, V_MAX_FACTOR * V_REF )
```

Valeurs avec les constantes par défaut (`V_REF` = 6 uc/s, `M_START` = 50) :

| Masse | v(m) brut | v(m) après clamp |
|---|---|---|
| 2 | 30 uc/s | 18 uc/s (clampé à ×3) |
| 10 | 13.42 uc/s | 13.42 uc/s |
| 50 | 6 uc/s | 6 uc/s (référence) |
| 100 | 4.24 uc/s | 4.24 uc/s |
| 500 | 1.90 uc/s | 1.90 uc/s |
| 5000 | 0.6 uc/s | 1.5 uc/s (clampé à ×0.25) |

**Direction** : le vecteur vitesse cible est dirigé du centre du morceau vers la position
du curseur/pointeur du joueur, normalisé puis multiplié par `v(m)`. Il n'y a **pas
d'inertie** sur ce mouvement de base dans le mode Vanilla (comportement Agar.io
classique : la vitesse instantanée suit directement l'intention du joueur) — voir §4
pour la seule exception (boost de split).

---

## 4. Accélération : le cas du split (boost)

Le mode Vanilla ne modélise pas d'accélération/inertie sur le déplacement courant (§3), à
une exception près : la propulsion du morceau au moment du split, qui nécessite une
décélération explicite pour ne pas garder une vitesse anormalement élevée en continu.

Au moment `T0` du split, le morceau éjecté reçoit une vitesse additionnelle :

```
v_boost(T0) = BOOST_SPEED_FACTOR * v(m_piece)
```

Cette composante additionnelle décroît **linéairement** à zéro sur `T_BOOST` secondes :

```
v_boost(t) = v_boost(T0) * max(0, 1 - (t - T0) / T_BOOST),   pour t ∈ [T0, T0 + T_BOOST]
```

Ce qui correspond à une décélération constante :

```
a_boost = -v_boost(T0) / T_BOOST
```

La vitesse totale du morceau pendant la fenêtre de boost est la somme vectorielle de la
vitesse de contrôle normale (§3, direction curseur) et de la composante de boost
(direction du split au moment `T0`, qui s'estompe) :

```
v_total(t) = v_controle(t) + v_boost(t) * direction_split
```

Après `T_BOOST`, seule `v_controle` subsiste (retour au comportement standard du §3).

---

## 5. Perte de masse passive (decay)

**Formulation discrète littérale** du §3.5 (fidèle au cahier des charges tel qu'écrit) :

- Si `m > M_START` : toutes les 5 s, `m ← m × 0.99`
- Si `M_DECAY_FLOOR < m ≤ M_START` : toutes les 10 s, `m ← m × 0.99`
- Si `m ≤ M_DECAY_FLOOR` : aucune perte

**Formulation continue équivalente**, recommandée pour l'implémentation (lissage par
tick plutôt que des "sauts" perceptibles toutes les 5 ou 10 secondes) :

```
λ_above = -ln(0.99) / 5  ≈ 0.0020101 s⁻¹
λ_below = -ln(0.99) / 10 ≈ 0.0010050 s⁻¹

dm/dt = -λ(m) * m,   avec λ(m) = λ_above si m > M_START,
                                 λ_below si M_DECAY_FLOOR < m ≤ M_START,
                                 0 sinon
```

Discrétisation par tick (`Δt = 1/f_tick`) :

```
m ← m * exp(-λ(m) * Δt)
```

(l'approximation linéaire `m ← m * (1 - λ(m) * Δt)` est équivalente à moins de 0.01 %
d'écart à 20 Hz, utilisable si `exp` doit être évité pour raison de performance).

**Point encore ouvert** (§3.5) : la masse perdue disparaît-elle simplement, ou se
retransforme-t-elle en particule de nourriture sur la carte ? Non tranché ici — n'affecte
pas la formule de décroissance elle-même, seulement ce qui se passe visuellement/
économiquement dans le monde après la perte.

---

## 6. Alimentation : manger une particule

- **Condition :** `m_joueur ≥ M_EAT_FOOD_MIN` (= 2)
- **Effet :** `m_joueur ← m_joueur + M_FOOD` (= +1)

La particule est retirée du monde ; une nouvelle apparaît ailleurs selon la logique de
spawn (densité de spawn non chiffrée pour Vanilla à ce stade — à définir lors de
l'implémentation du Lot 1.6, sans impact sur la formule ci-dessus).

---

## 7. Manger un autre joueur (ou un de ses morceaux)

**Condition** (§3.5) :

```
m_attaquant ≥ m_cible × (1 + EAT_MASS_ADVANTAGE) = m_cible × 1.05
```

**Effet**, conservation de la masse totale :

```
m_attaquant ← m_attaquant + m_cible
```

Le morceau cible est retiré du jeu.

**Cas non tranché en §3.5, tranché ici par défaut** : si aucun des deux morceaux ne
remplit la condition des 5 % (masses proches), comportement retenu pour le MVP :
**répulsion douce** (les deux morceaux se repoussent légèrement, voir §8) plutôt qu'un
passage à travers sans effet — cohérent avec l'attente visuelle standard d'un agar-like.
Ajustable en playtest sans impact architectural.

---

## 8. Résolution de collision entre morceaux de masses proches (répulsion)

Quand deux morceaux de joueurs différents se chevauchent sans qu'aucun ne remplisse la
condition d'absorption du §7, une force de répulsion les sépare, proportionnelle à la
profondeur de pénétration.

Soit `d` la distance entre les centres, `r1` et `r2` les rayons respectifs (§2), et la
pénétration `p = (r1 + r2) - d` (si `p > 0`) :

```
déplacement_1 = p * (m2 / (m1 + m2))
déplacement_2 = p * (m1 / (m1 + m2))
```

(chaque morceau est déplacé le long de l'axe centre-à-centre ; un gros morceau est
proportionnellement moins repoussé qu'un petit).

---

## 9. Split

**Condition** (§3.5) : `m ≥ M_SPLIT_MIN` (=100) **ET** nombre de morceaux du joueur
`< N_PIECES_MAX` (=16).

**Effet :**

- Le morceau d'origine de masse `m` devient 2 morceaux de masse `m/2` chacun
  (répartition 50/50, §3.5).
- Rayon de chaque nouveau morceau : `Rayon(m/2)` (§2).
- Position du morceau éjecté : centre d'origine + `direction_curseur` ×
  `(Rayon(m/2)_origine + Rayon(m/2)_éjecté)` — les deux morceaux démarrent tangents, sans
  se chevaucher.
- Vitesse du morceau éjecté : voir §4 (boost initial dans la direction du curseur au
  moment du split).
- Le morceau d'origine (resté sur place) ne reçoit pas de boost.

---

## 10. Fusion (merge) entre morceaux du même joueur

Deux morceaux du même joueur fusionnent quand les deux conditions suivantes sont
remplies (§3.5) :

1. Le cooldown `T_MERGE_COOLDOWN` (=30 s) est écoulé depuis le split qui a créé le plus
   récent des deux morceaux.
2. Chevauchement ≥ `OVERLAP_MERGE_MIN` (= 1/3) de la surface totale des deux morceaux :

```
Aire_overlap(r1, r2, d) ≥ (1/3) * (Aire(m1) + Aire(m2))
```

Formule standard de l'aire d'intersection de deux cercles (aire de la "lentille"),
nécessaire pour évaluer la condition ci-dessus :

```
Soit d la distance entre centres, r1 et r2 les rayons :

- Si d ≥ r1 + r2 :        Aire_overlap = 0                       (pas de contact)
- Si d ≤ |r1 - r2| :      Aire_overlap = π * min(r1, r2)²        (un morceau recouvre l'autre)
- Sinon :
    d1 = (d² - r2² + r1²) / (2d)
    d2 = d - d1
    Aire_overlap = r1² * acos(d1/r1) - d1 * √(r1² - d1²)
                 + r2² * acos(d2/r2) - d2 * √(r2² - d2²)
```

**Effet de la fusion :**

```
m_fusionné        = m1 + m2
position_fusionné = (position_1 * m1 + position_2 * m2) / (m1 + m2)   [barycentre pondéré]
Rayon(m_fusionné)  recalculé via §2
```

---

## 11. Bords de la carte (mur bloquant)

Soit `[0, TAILLE_CARTE] × [0, TAILLE_CARTE]` les limites de la carte (dimension à fixer
lors du Lot 1.1/1.2, hors scope de ce document) :

Pour chaque axe (x, y) :

```
position ← clamp(position, rayon, TAILLE_CARTE - rayon)
```

La composante de vitesse perpendiculaire au mur touché est mise à zéro pour ce tick
(pas de rebond, pas de traversée, §3.5) :

```
si position.x a été clampée → v.x ← 0   (de même pour l'axe y)
```

---

## 12. Fréquence de tick et discrétisation générale

Toutes les formules continues ci-dessus (vitesse, decay, boost) sont appliquées par tick
avec `Δt = 1/f_tick` :

- Déplacement par tick : `position ← position + v(m) * Δt`
- Décroissance de masse par tick : voir §5
- Décroissance du boost de split par tick : voir §4, en réévaluant `t - T0` à chaque tick

`f_tick` de référence pour ce document : **20 Hz** (`Δt = 0.05 s`), conforme à la
fourchette 20-30 Hz du Lot 1.2. Si la fréquence finale retenue diffère, seules les
valeurs numériques discrètes doivent être recalculées — pas les formules elles-mêmes.

---

## 13. Récapitulatif des points encore ouverts

Ces points n'affectent pas la validité des formules ci-dessus — ajustables par playtest
sans changement d'architecture (§3.5/§8.1 du cahier des charges) :

- Valeur exacte de `V_REF` (vitesse de référence) — 6 uc/s est un point de départ, à
  valider en jeu.
- Devenir de la masse perdue passivement (disparition vs. reconversion en particule) — §5.
  Tranché par défaut lors du Lot 1.6 : la masse perdue disparaît simplement (pas de
  reconversion), ajustable si l'économie de la partie s'avère trop pauvre en playtest.
- Densité de spawn des particules de nourriture — tranchée par défaut lors du Lot 1.6 :
  `FOOD_TARGET_COUNT = 300` particules ambiantes visées sur la carte, `FOOD_SPAWN_PER_TICK
  = 5` réapparitions max par tick tant que la cible n'est pas atteinte (voir
  `server/src/mods/vanilla/constants.ts`). Ajustable en playtest.
- Dimension réelle de la carte (`TAILLE_CARTE`, §11) — à fixer lors du Lot 1.1 ; en
  pratique paramétrée par `mapSize` à la création d'une `Room` (pas encore de valeur de
  production figée, les tests utilisent des tailles arbitraires).

---

## 14. Autres modes de jeu

Hors scope de cette version du document (cf. cahier des charges §3.4). Chaque mode
recevra sa propre section numérotée à la suite de celle-ci au fur et à mesure de sa
spécification chiffrée (Lot 4.2 pour le second mode, puis les suivants), afin de garder
un fichier unique de référence pour toutes les formules du projet, mod par mod.

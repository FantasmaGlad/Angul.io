# Cahier des Charges Fonctionnel et Technique : Système de Robots (Bots) — Angul.io

**Version :** 1.0  
**Statut :** Spécification Validée  
**Réf. Projet :** Angul.io (Monorepo Node.js / TypeScript / Canvas / WebSockets)  

---

## 1. Objectifs et Périmètre

### 1.1 Objectif Général
Le système de robots a pour but de **remplir dynamiquement les salons de jeu vides ou partiellement occupés** afin d'offrir une expérience dynamique et vivante dès l'arrivée des premiers joueurs humains, tout en garantissant des performances optimales (**zéro lag**) et une moddabilité complète via les fichiers de configuration JSON du serveur.

### 1.2 Périmètre Fonctionnel
* **Architecture In-Engine** : Les robots s'exécutent directement au sein du moteur du serveur (`Room` / `World`) sous forme d'entités virtuelles.
* **Cadence découplée (2 Hz)** : Mise à jour des décisions de l'IA deux fois par seconde (toutes les 500 ms), indépendamment du tick physique du serveur à 20 Hz.
* **4 Profils de Comportements** :
  1. **Fuis** (25%) : Survie maximale, peureux, fuit les prédateurs.
  2. **Neutre** (30%) : Farmer pacifique, focalisé sur la collecte de nourriture.
  3. **Agressif** (30%) : Chasseur actif, intercepte les proies et utilise le split tactique.
  4. **Fou** (15%) : Chaotique, mouvements erratiques et prévisibilité faible.
* **Équilibrage Dynamique** : Maintien d'une population de robots égale à **50% de la capacité maximale du salon**.
* **Nomenclature Debug** : Noms identifiables (`fuis_1`, `neutre_1`, `agressif_1`, `fou_1`...).

### 1.3 Périmètre Exclu (Hors-Scope v1)
* Pas de gestion des virus/mines par les robots.
* Pas d'éjection de masse (touche `w` / feeding).
* Pas de peaux (skins) personnalisées ni d'avatars complexes.
* Pas de clients WebSockets distants pour les bots (tous les bots sont gérés nativement sur le serveur).

---

## 2. Architecture Technique & Performances

### 2.1 Moteur d'IA et Découplage Temporel
```
                            BOUCLE DE SIMULATION (20 Hz / 50 ms)
   ┌──────────────────────────────────────────────────────────────────────────────────┐
   │ Tick 1  │ Tick 2  │ ... │ Tick 10 │ Tick 11 │ ... │ Tick 20 │ Tick 21 │ ...      │
   └────┬─────────────────────────┬─────────────────────────┬─────────────────────────┘
        │ (2000 ms / 500 ms)      │                         │
        ▼                         ▼                         ▼
   Impulsion IA 1            Impulsion IA 2            Impulsion IA 3
   - Query SpatialHash       - Query SpatialHash       - Query SpatialHash
   - Utility Evaluation      - Utility Evaluation      - Utility Evaluation
   - Update PlayerInput      - Update PlayerInput      - Update PlayerInput
```

* **Physique Moteur (20 Hz)** : La boucle [room.ts](file:///home/fanta/Dev/Angul.io/server/src/engine/room.ts) calcule le mouvement physique, le déplacement des morceaux, le decay de masse et les collisions tous les 50 ms.
* **Boucle décisionnelle IA (2 Hz)** : L'IA réévalue ses choix uniquement tous les 10 ticks (500 ms). Entre deux impulsions d'IA, le moteur physique continue d'appliquer le dernier vecteur `target` et l'intensité `intensity`, assurant un mouvement 100% continu et fluide sans saccade visuelle.

### 2.2 Optimisation de la Vision ($\mathcal{O}(1)$)
Chaque robot interroge son environnement à 2 Hz via le [spatialHash.ts](file:///home/fanta/Dev/Angul.io/server/src/engine/spatialHash.ts) de la `Room` :
* La méthode `queryNearby(position)` restreint le balayage aux entités dans la cellule du bot et ses 8 cellules voisines.
* Les entités sont classées en 3 groupes :
  * **Prédateurs** : $\text{Masse}_{autre} \ge 1.05 \times \text{Masse}_{bot}$
  * **Proies** : $\text{Masse}_{autre} \le 0.80 \times \text{Masse}_{bot}$
  * **Nourriture** : Pellets de masse

---

## 3. Régulation et Gestion de la Population

### 3.1 Règle de Capacité du Salon
* Pour une capacité maximale de salon $N_{max}$ (définie dans le mod, ex: 50 joueurs) :
  $$\text{Capacité Target Robots} = \left\lfloor \frac{N_{max}}{2} \right\rfloor$$
* Le nombre de robots actifs à un instant $t$ est donné par :
  $$N_{bots\_actifs} = \max\left(0, \left\lfloor \frac{N_{max}}{2} \right\rfloor - N_{humains}\right)$$

### 3.2 Cycle de Vie des Robots
1. **Connexion d'un joueur humain** :
   * Lorsqu'un joueur humain rejoint la salle, $N_{bots\_actifs}$ diminue de 1.
   * **Le robot ayant la plus petite masse totale** dans le salon est immédiatement supprimé (`removePlayer`).
2. **Mort d'un robot** :
   * Lorsqu'un robot perd l'ensemble de ses morceaux (`PlayerDied`), le robot est retiré.
   * Si $N_{bots\_actifs} < \lfloor N_{max} / 2 \rfloor - N_{humains}$, un **nouveau robot réapparaît immédiatement**.
   * Le type du nouveau robot est choisi par **tirage au sort pondéré** selon les proportions configurées (25% / 30% / 30% / 15%).
3. **Réinitialisation du Salon (`room.reset()`)** :
   * Lors d'un reset automatique ou manuel du salon, l'intégralité de la population de robots respawn immédiatement avec leur masse initiale $M_0$.

### 3.3 Nomenclature pour Debug
Les bots sont nommés avec leur type suivi d'un identifiant incrémental par salon :
* `fuis_1`, `fuis_2`, `fuis_3`...
* `neutre_1`, `neutre_2`...
* `agressif_1`, `agressif_2`...
* `fou_1`, `fou_2`...

---

## 4. Spécifications Détaillées des 4 Profils de Robots

```
                                  PROPORTIONS DES ROBOTS
  ┌──────────────────┬──────────────────┬──────────────────┬────────────┐
  │   Fuis (25%)     │   Neutre (30%)   │  Agressif (30%)  │ Fou (15%)  │
  └──────────────────┴──────────────────┴──────────────────┴────────────┘
```

### 4.1 Profil **Fuis** (25%)
* **Description** : Robot axé sur la survie passive et l'évitement.
* **Rayon de Vision** : $450\text{ px}$.
* **Déclencheur de Fuite** : Présence d'un prédateur ($\text{Masse} \ge 1.05 \times \text{Masse}_{bot}$) dans un rayon de $350\text{ px}$.
* **Vitesse / Intensité** :
  * En patrouille : `intensity: 0.5`
  * En fuite : `intensity: 1.0` (plein régime)
* **Comportement Split** : `split = false` (aucun split).
* **Multi-morceaux** : Oriente l'ensemble de ses morceaux vers le point opposé au prédateur le plus proche.

### 4.2 Profil **Neutre** (30%)
* **Description** : Farmer pacifique focalisé sur le moissonnage de nourriture.
* **Rayon de Vision** : $250\text{ px}$.
* **Déclencheur de Fuite** : Présence d'un prédateur à très courte distance ($< 150\text{ px}$).
* **Vitesse / Intensité** : Modérée (`intensity: 0.6` à `0.8`).
* **Comportement d'Attaque** : Ne traque pas activement.
* **Comportement Split** : Rarissime (`split = true` uniquement si $\text{Masse}_{bot} \ge 60$ et présence d'un champ de nourriture très dense).

### 4.3 Profil **Agressif** (30%)
* **Description** : Chasseur offensif, cherche les proies et utilise le split tactique.
* **Rayon de Vision** : $350\text{ px}$.
* **Vitesse / Intensité** : Maximum constant (`intensity: 1.0`).
* **Algorithme de Chasse** : Sélectionne la proie ayant le meilleur ratio $\frac{\text{Masse}_{bot}}{\text{Masse}_{proie}} \ge 1.25$ et calcule son point d'interception futur ($\vec{P} + \vec{V} \cdot \Delta t$).
* **Comportement Split Létal** :
  * Condition de Split : $\text{Distance} \le R_{split}$ ET $\frac{\text{Masse}_{bot}}{2} \ge 1.15 \times \text{Masse}_{proie}$ ET $\text{NbMorceaux} < S_{max}$.
  * Envoie immédiatement un impulsion `split = true`.

### 4.4 Profil **Fou** (15%)
* **Description** : Robot chaotique et imprévisible.
* **Rayon de Vision** : $200\text{ px}$.
* **Vitesse / Intensité** : Oscillante et aléatoire (`intensity` tirée entre `0.2` et `1.0` à chaque impulsion).
* **Algorithme de Mouvement** : Bruit de Perlin / Marche aléatoire.
* **Anomalies / Erreurs** :
  * 10% de chance de s'arrêter net pendant 1 à 2 impulsions (`intensity: 0.0`).
  * 5% de chance par impulsion de déclencher un `split = true` sans cible.
  * Peut avancer vers un prédateur sans réaction immédiate.

---

## 5. Configuration via Mod JSON

Chaque mod JSON (ex: [vanilla.json](file:///home/fanta/Dev/Angul.io/server/src/mods/vanilla.json)) est étendu avec la section de configuration `"bots"` :

```json
{
  "name": "Vanilla",
  "player": { ... },
  "physics": { ... },
  "bots": {
    "enabled": true,
    "targetRatio": 0.5,
    "updateFrequencyHz": 2,
    "proportions": {
      "fuis": 25,
      "neutre": 30,
      "agressif": 30,
      "fou": 15
    }
  }
}
```

---

## 6. Plan de Vérification et Critères d'Acceptation

### 6.1 Tests Unitaires
* **Calcul des Forces Steering** : Validation des vecteurs de fuite, d'attraction et d'interception.
* **Attribution des Profils** : Test statistique de la distribution du tirage aléatoire des 4 profils (respect des ratios 25/30/30/15).
* **Conditions de Split** : Validation du seuil de masse et de distance pour le split du bot Agressif.

### 6.2 Tests d'Intégration
* **Gestion de la Population** : Dans une `Room` de capacité 50, vérifier qu'exactement 25 bots apparaissent initialement.
* **Élimination à l'arrivée d'un joueur** : Vérifier que lorsqu'un joueur se connecte, le bot avec la plus petite masse est supprimé.
* **Respawn au Reset** : Exécuter `room.reset()` et valider que tous les bots réapparaissent immédiatement à $M_0$.

### 6.3 Test de Charge & Performance
* Exécuter la boucle de tick avec 25 bots à 2 Hz pendant 60 secondes.
* Vérifier que la consommation CPU reste négligeable et que la durée de calcul par tick reste $< 2\text{ ms}$.

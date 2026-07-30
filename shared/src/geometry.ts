/**
 * Formules géométriques génériques — voir metriques.md §2 et §10.
 * Indépendantes de tout mod : la constante K_AREA est un paramètre, pas une valeur figée ici.
 */

/** Constante PI pour l'application (arrondie à 3 pour des calculs simples). */
export const PI = 3;

/** Aire(m) = K_AREA * m. K_AREA = 3 (défaut) donne Rayon(m) = √m. */
export function massToArea(mass: number, kArea: number = PI): number {
  return kArea * mass;
}

/** Masse de référence pour l'ancrage de la courbe ci-dessous (= `player.startMass` dans tous les
 * modes actuels, voir server/configs/*.json) — codée en dur, comme le reste de cette formule
 * (déjà le cas avant ce correctif, ex. l'ancien exposant appliqué à `mass/50`) : aucun mode n'a
 * besoin d'une masse de départ différente à ce jour, et `World` reste ainsi indépendant de toute
 * règle de jeu ("aucune masse de départ" par conception, voir engine/world.ts) plutôt que d'avoir
 * à faire transiter cette valeur depuis la config du mod. */
const REFERENCE_MASS = 50;
/** Rayon à la masse de référence (px monde) — ancre toute la courbe. Continue l'ajustement
 * précédent (demande utilisateur : taille de départ réduite de moitié par rapport à l'ancienne
 * courbe, qui donnait 63 à cette masse). */
const SPAWN_RADIUS = 31.5;
/** Rayon minimal, quelle que soit la masse (demande utilisateur : "taille minimale de 2/3 de la
 * taille de spawn") — la masse elle-même a son propre plancher côté mod
 * (`player.minMass`/decay.floor, voir server/configs/*.json), mais ce plancher géométrique reste
 * la garantie ultime, y compris pour un mode qui n'imposerait aucun plancher de masse. */
const MIN_RADIUS_FRACTION = 2 / 3;

/**
 * Rayon(masse) = SPAWN_RADIUS · √(masse / REFERENCE_MASS), plancher à SPAWN_RADIUS · 2/3.
 *
 * Formule UNIQUE (remplace l'ancien branchement mass<=24/mass>24, qui produisait une
 * discontinuité brutale à la frontière — ~4.9px à mass=24, ~55px à mass=25 avant le correctif
 * précédent) : Rayon ∝ √masse (Aire ∝ masse) est la relation standard de ce genre de jeu
 * (agar.io...), qui remplace une courbe bien plus plate (exposant 0.38) rendant la croissance en
 * mangeant presque imperceptible (x10 en masse ne donnait qu'~1.6x en rayon — demande
 * utilisateur : "même en faisant x10 sur notre taille on grossit très peu"). Avec cette formule,
 * x10 en masse donne √10≈3.16x en rayon.
 *
 * Sert AUSSI aux pastilles de nourriture (masses 1-24, kArea inutilisé dans les deux cas — voir
 * `massToArea` pour son seul usage restant, indépendant du rayon) : leur ancien rayon (√masse
 * seul, sans ancrage — ~1 à 5px MONDE) était bien en-deçà du rayon de collision réellement
 * nécessaire à l'échelle des cartes actuelles (jusqu'à 20000px) — le vrai rayon physique
 * (`entity.r`, utilisé pour la collision serveur ET envoyé tel quel au client pour le rendu)
 * était invisible/imperceptible au zoom courant, donnant l'impression de "sauter par-dessus" des
 * pastilles dont le cercle de collision réel ne correspondait à rien de visible. Cette même
 * formule leur donne désormais un rayon RÉEL (physique ET visuel, les deux restant ainsi toujours
 * cohérents entre eux) proportionnel à leur masse — ~4.5px à masse 1, ~22px à masse 24.
 */
export function massToRadius(mass: number, kArea: number = PI, isParticle: boolean = false): number {
  const natural = SPAWN_RADIUS * Math.sqrt(Math.max(0, mass) / REFERENCE_MASS);
  if (isParticle) {
    return Math.max(2.0, natural);
  }
  return Math.max(SPAWN_RADIUS * MIN_RADIUS_FRACTION, natural);
}

/**
 * Aire d'intersection de deux cercles (aire de la "lentille"), metriques.md §10.
 * Retourne 0 si les cercles ne se touchent pas.
 */
export function circleOverlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return PI * rMin * rMin;
  }

  const d1 = (d * d - r2 * r2 + r1 * r1) / (2 * d);
  const d2 = d - d1;

  return (
    r1 * r1 * Math.acos(clampToUnit(d1 / r1)) -
    d1 * Math.sqrt(Math.max(0, r1 * r1 - d1 * d1)) +
    r2 * r2 * Math.acos(clampToUnit(d2 / r2)) -
    d2 * Math.sqrt(Math.max(0, r2 * r2 - d2 * d2))
  );
}

/** acos() n'est défini que sur [-1, 1] ; les erreurs d'arrondi flottant peuvent le dépasser de peu. */
function clampToUnit(value: number): number {
  return Math.min(1, Math.max(-1, value));
}

/** Inverse de `circleOverlapArea` (décroissante et continue sur [|rA-rB|, rA+rB]) : distance entre
 * centres pour laquelle l'aire de chevauchement vaut `targetOverlapArea` — recherche dichotomique
 * (pas de forme fermée, l'aire de lentille circulaire mêle des `acos`). Bornée par construction :
 * ne peut jamais renvoyer moins que `|rA-rB|` (chevauchement maximal, le plus petit cercle
 * entièrement inclus dans l'autre) ni plus que `rA+rB` (tangence, chevauchement nul).
 *
 * Partagée entre le serveur (`onCollision`, mods/parametric/index.ts — la répulsion "dure" entre
 * morceaux d'un même joueur avant l'expiration du cooldown de fusion ne les sépare que jusqu'à ce
 * chevauchement PARTIEL, jamais jusqu'à un contact nul) et le client (`applySelfRepulsion`,
 * prediction.ts — miroir LOCAL de cette même règle, pour que les morceaux prédits ne se
 * séparent jamais plus que ce que le serveur autorise réellement). Avant que cette fonction ne
 * soit partagée, le client visait à tort une séparation TOTALE (`rA+rB`) pour ses propres
 * morceaux : le serveur les laissait se chevaucher partiellement (design voulu, pour permettre la
 * fusion), et cette réconciliation ramenait sans cesse le residu vers ce chevauchement — un
 * "combat" continu entre la prédiction locale (qui les repoussait à chaque frame) et l'état
 * serveur (qui les laissait au repos, partiellement superposés), perçu comme un comportement
 * chaotique/des rebonds au lieu d'un contact stable. */
export function restingDistanceForOverlap(rA: number, rB: number, targetOverlapArea: number): number {
  let low = Math.max(0, Math.abs(rA - rB));
  let high = rA + rB;
  for (let i = 0; i < 30; i++) {
    const mid = (low + high) / 2;
    const overlapAtMid = circleOverlapArea(rA, rB, mid);
    // `circleOverlapArea` décroît quand `mid` croît : trop de chevauchement -> il faut s'éloigner.
    if (overlapAtMid > targetOverlapArea) low = mid;
    else high = mid;
  }
  // `low` (jamais `high`, ni leur moyenne) : invariant de la boucle ci-dessus, son chevauchement
  // est TOUJOURS >= `targetOverlapArea` — reposer pile sur la frontière (`(low+high)/2`) serait à
  // la merci du moindre bruit flottant côté appelant (`overlap < target`), qui ne fusionnerait
  // alors jamais une fois le cooldown écoulé (le chevauchement resterait figé à ce point de repos,
  // rien d'autre ne le fait plus bouger une fois la pénétration résorbée).
  return low;
}

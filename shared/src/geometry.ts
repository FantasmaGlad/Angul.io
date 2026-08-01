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

/** Masse (multiple de REFERENCE_MASS) à laquelle `blobGrowthFactor` passe du régime "rapide" au
 * régime "plat" — 10x la masse de spawn : au-delà, un blob est considéré "établi" (a largement
 * dépassé sa masse de départ), voir le commentaire de `blobGrowthFactor`. */
const GROWTH_BREAKPOINT_MASS = REFERENCE_MASS * 10;
/** Exposant du régime rapide (mass <= GROWTH_BREAKPOINT_MASS) — plus raide que l'ancien exposant
 * fixe (0.5, Aire ∝ masse) : chaque pastille mangée en tout début de partie se voit plus
 * nettement (demande utilisateur : "que le blob grossisse plus rapidement au début"). */
const GROWTH_EXPONENT_EARLY = 0.62;
/** Exposant du régime tardif (mass > GROWTH_BREAKPOINT_MASS) — plus plat que l'ancien exposant
 * fixe : un très gros blob continue de grossir (jamais de plafond dur, contrairement à une courbe
 * saturante type Michaelis-Menten qui aurait plafonné sa taille), mais chaque tranche de masse
 * supplémentaire se voit proportionnellement de moins en moins (demande utilisateur : "moins à la
 * fin") — remplace l'auto-similarité de l'ancienne courbe (même forme à toute échelle : x10 en
 * masse donnait TOUJOURS √10 en rayon, que ce x10 parte de 50 ou de 50 000) par une vraie
 * décroissance des rendements. */
const GROWTH_EXPONENT_LATE = 0.38;
/** Valeur du facteur de croissance au point de rupture — ancre la continuité de VALEUR entre les
 * deux régimes (voir `blobGrowthFactor`). Une discontinuité de valeur ici reproduirait exactement
 * le bug historique corrigé par le passage à une formule unique (voir ancien commentaire : ~4.9px
 * à mass=24, ~55px à mass=25) — à ne jamais réintroduire, contrairement à un simple coude de pente
 * (imperceptible en jeu, une masse ne saute jamais brutalement d'un côté à l'autre du point de
 * rupture). */
const GROWTH_FACTOR_AT_BREAKPOINT = Math.pow(GROWTH_BREAKPOINT_MASS / REFERENCE_MASS, GROWTH_EXPONENT_EARLY);

/**
 * Facteur de croissance visuelle NORMALISÉ (= rayon(masse) / SPAWN_RADIUS) — vaut 1 à
 * REFERENCE_MASS, croît selon deux régimes continus en valeur : rapide (exposant 0.62) jusqu'à
 * `GROWTH_BREAKPOINT_MASS`, puis plat (exposant 0.38) au-delà (voir les constantes ci-dessus pour
 * le détail de chaque exposant). Réutilisé tel quel par `shared/src/camera.ts`
 * (`computeScaleForMass`) : la caméra dézoome à l'inverse exact de ce facteur, pour que la taille
 * À L'ÉCRAN du blob reste cohérente quel que soit le régime de croissance actif — une seule courbe
 * de forme, jamais deux formules qui pourraient diverger l'une de l'autre.
 */
export function blobGrowthFactor(mass: number): number {
  const x = Math.max(0, mass) / REFERENCE_MASS;
  if (mass <= GROWTH_BREAKPOINT_MASS) return Math.pow(x, GROWTH_EXPONENT_EARLY);
  return GROWTH_FACTOR_AT_BREAKPOINT * Math.pow(mass / GROWTH_BREAKPOINT_MASS, GROWTH_EXPONENT_LATE);
}

/**
 * Rayon(masse) = SPAWN_RADIUS · blobGrowthFactor(masse), plancher à SPAWN_RADIUS · 2/3 — voir
 * `blobGrowthFactor` pour la forme de la courbe (BLOBS uniquement, joueurs/bots).
 *
 * Les pastilles de nourriture (`isParticle`, masses 1-24, kArea inutilisé dans les deux cas — voir
 * `massToArea` pour son seul usage restant, indépendant du rayon) gardent la racine carrée pure
 * d'origine (Aire ∝ masse) : statiques et de masse bornée, la refonte "grossissement visuel"
 * ci-dessus ne les concerne pas (rien ne les fait jamais grossir après leur spawn) — seul le
 * plancher diffère (2.0px fixe, pas une fraction de SPAWN_RADIUS, voir historique : leur ancien
 * rayon sans ancrage était invisible/imperceptible au zoom courant).
 */
export function massToRadius(mass: number, kArea: number = PI, isParticle: boolean = false): number {
  if (isParticle) {
    const natural = SPAWN_RADIUS * Math.sqrt(Math.max(0, mass) / REFERENCE_MASS);
    return Math.max(2.0, natural);
  }
  const natural = SPAWN_RADIUS * blobGrowthFactor(mass);
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

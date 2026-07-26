/**
 * Formules géométriques génériques — voir metriques.md §2 et §10.
 * Indépendantes de tout mod : la constante K_AREA est un paramètre, pas une valeur figée ici.
 */

/** Aire(m) = K_AREA * m. K_AREA = π (défaut) donne Rayon(m) = √m (metriques.md §2). */
export function massToArea(mass: number, kArea: number = Math.PI): number {
  return kArea * mass;
}

export function massToRadius(mass: number, kArea: number = Math.PI): number {
  return Math.sqrt(massToArea(mass, kArea) / Math.PI);
}

/**
 * Aire d'intersection de deux cercles (aire de la "lentille"), metriques.md §10.
 * Retourne 0 si les cercles ne se touchent pas.
 */
export function circleOverlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) {
    const rMin = Math.min(r1, r2);
    return Math.PI * rMin * rMin;
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

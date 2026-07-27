/** Réglages client persistés en localStorage (aucun lien avec le compte joueur — un réglage
 * d'affichage local à l'appareil, pas une donnée de compte). */

export const MIN_FPS_CAP = 24;
export const MAX_FPS_CAP = 240;
/** Pas de plafond par défaut au sens strict, mais 240 couvre déjà tous les écrans courants —
 * évite de brider un joueur sans qu'il ait rien choisi. */
export const DEFAULT_FPS_CAP = MAX_FPS_CAP;

const FPS_CAP_STORAGE_KEY = 'angulio.fpsCap';

export function loadFpsCap(): number {
  const raw = localStorage.getItem(FPS_CAP_STORAGE_KEY);
  const parsed = raw ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_FPS_CAP;
  return clampFpsCap(parsed);
}

export function saveFpsCap(fps: number): void {
  localStorage.setItem(FPS_CAP_STORAGE_KEY, String(clampFpsCap(fps)));
}

export function clampFpsCap(fps: number): number {
  return Math.min(MAX_FPS_CAP, Math.max(MIN_FPS_CAP, Math.round(fps)));
}

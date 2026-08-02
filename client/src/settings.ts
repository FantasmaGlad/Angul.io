/** Réglages client persistés en localStorage (aucun lien avec le compte joueur — un réglage
 * d'affichage local à l'appareil, pas une donnée de compte). */

/** Paliers du slider FPS (demande utilisateur : "comme sur Minecraft") — valeurs discrètes plutôt
 * qu'un curseur à granularité 1 fps, avec "Illimité" comme dernier cran plutôt qu'un nombre. */
export const FPS_SLIDER_STEPS: ReadonlyArray<number | 'unlimited'> = [
  30, 60, 90, 120, 144, 165, 200, 240, 'unlimited',
];

export const DEFAULT_VSYNC_ENABLED = true;
/** Dernier cran (`'unlimited'`) par défaut quand Vsync est désactivé — cohérent avec l'ancien
 * plafond par défaut (240, qui ne bridait personne) sans brider davantage un joueur qui coupe
 * explicitement le Vsync. */
export const DEFAULT_FPS_SLIDER_INDEX = FPS_SLIDER_STEPS.length - 1;

const VSYNC_STORAGE_KEY = 'angulio.vsyncEnabled';
const FPS_SLIDER_INDEX_STORAGE_KEY = 'angulio.fpsSliderIndex';

export function loadVsyncEnabled(): boolean {
  const raw = localStorage.getItem(VSYNC_STORAGE_KEY);
  if (raw === null) return DEFAULT_VSYNC_ENABLED;
  return raw === 'true';
}

export function saveVsyncEnabled(enabled: boolean): void {
  localStorage.setItem(VSYNC_STORAGE_KEY, String(enabled));
}

export function clampFpsSliderIndex(index: number): number {
  return Math.min(FPS_SLIDER_STEPS.length - 1, Math.max(0, Math.round(index)));
}

export function loadFpsSliderIndex(): number {
  const raw = localStorage.getItem(FPS_SLIDER_INDEX_STORAGE_KEY);
  const parsed = raw !== null ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? clampFpsSliderIndex(parsed) : DEFAULT_FPS_SLIDER_INDEX;
}

export function saveFpsSliderIndex(index: number): void {
  localStorage.setItem(FPS_SLIDER_INDEX_STORAGE_KEY, String(clampFpsSliderIndex(index)));
}

/** Intervalle minimal (ms) entre deux frames de rendu pour l'état courant (Vsync + slider) — `0` =
 * aucun plafond logiciel, la cadence de rendu suit alors uniquement `requestAnimationFrame`, déjà
 * calée sur le taux de rafraîchissement réel de l'écran (le navigateur ne permet pas d'aller plus
 * vite pour du rendu canvas — Vsync et le cran "Illimité" du slider sont donc mécaniquement
 * identiques ici). Vsync activé l'emporte sur le slider (comme sur Minecraft, où le slider de
 * framerate est ignoré tant que Vsync est actif) : seul un cran numérique du slider avec Vsync
 * désactivé impose un plafond explicite. */
export function minFrameIntervalMs(vsyncEnabled: boolean, fpsSliderIndex: number): number {
  if (vsyncEnabled) return 0;
  const step = FPS_SLIDER_STEPS[clampFpsSliderIndex(fpsSliderIndex)] ?? 'unlimited';
  return step === 'unlimited' ? 0 : 1000 / step;
}


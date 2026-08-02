/** Convertit l'ancrage "temps serveur" de `RenderEngine` (voir `serverTimeMsForTick`,
 * renderEngine.ts) en une latence estimée pour `LocalPrediction.reconcile()` (prediction.ts) —
 * remplace le ping 1Hz lissé (`smoothedLatencyMs`, GameView.tsx) comme source principale, celui-ci
 * ne servant plus que de repli. Extraite en fonction pure (plutôt que laissée en ligne dans
 * GameView.tsx, qui n'a aucun fichier de test dans ce repo) pour rester directement testable. */
export function estimatedLatencyMsFromAnchor(
  anchoredServerTimeMs: number | undefined,
  smoothedLatencyMs: number | undefined,
  nowMs: number,
): number | undefined {
  if (anchoredServerTimeMs !== undefined) return Math.max(0, nowMs - anchoredServerTimeMs);
  return smoothedLatencyMs;
}

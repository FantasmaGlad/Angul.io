import type { BotBehaviorConfig } from './behaviorConfig.js';
import type { ValidationIssue } from '../../mods/parametric/validateConfig.js';

export type ValidatedBehaviorConfig =
  | { ok: true; value: BotBehaviorConfig }
  | { ok: false; errors: ValidationIssue[] };

/** Validation STRUCTURELLE (pas champ-à-champ comme `validateParametricModConfig`) — un profil de
 * comportement de bots a une surface bien plus large (5 sous-profils imbriqués, ~25 champs
 * numériques) pour un enjeu bien moindre qu'un mod cassé (un bot mal réglé reste un bot qui joue
 * "bizarrement", jamais un salon injouable) : on vérifie la présence et le TYPE des 4 sous-objets
 * attendus (`fuis`/`neutre`/`agressif`/`wallAvoidance`) et des champs numériques de premier niveau,
 * pas chaque champ imbriqué individuellement. */
export function validateBotBehaviorConfig(input: unknown): ValidatedBehaviorConfig {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, errors: [{ path: '', message: 'La configuration doit être un objet JSON.' }] };
  }
  const record = input as Record<string, unknown>;
  const errors: ValidationIssue[] = [];

  for (const key of ['neighborQueryRadiusPx', 'predatorMassRatio', 'preyMassRatio', 'targetProjectionDistancePx', 'directionSmoothing']) {
    if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
      errors.push({ path: key, message: 'Nombre requis.' });
    }
  }

  for (const key of ['fuis', 'neutre', 'agressif', 'wallAvoidance']) {
    if (typeof record[key] !== 'object' || record[key] === null || Array.isArray(record[key])) {
      errors.push({ path: key, message: 'Section objet requise.' });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: record as unknown as BotBehaviorConfig };
}

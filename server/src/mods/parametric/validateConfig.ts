import type { ParametricModConfig } from './config.js';

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidatedModConfig =
  | { ok: true; value: ParametricModConfig }
  | { ok: false; errors: ValidationIssue[] };

/** Validateur "à la main" (décision §2.4 plan-implementation-admin.md — aucune dépendance de
 * schéma type zod/ajv, `grep`é absente du monorepo au moment de cette décision) calqué champ à
 * champ sur `ParametricModConfig` (config.ts) — un JSON syntaxiquement correct mais
 * sémantiquement faux (type incorrect, section manquante, enum invalide) doit être refusé avec un
 * message exploitable AVANT écriture disque (§13.2 cahier_des_charges_admin.md), jamais après.
 *
 * `bots`/`room` restent volontairement validés en surface (présence + type des champs de premier
 * niveau seulement, pas leurs sous-structures imbriquées comme `challengers`/`resetSchedule`) —
 * un mod SANS ces sections optionnelles reste parfaitement valide (voir leurs commentaires dans
 * config.ts, "absent = repli"), et une validation exhaustive de leurs variantes imbriquées
 * apporterait peu face au risque réel (un modder qui casse ces sections le remarque immédiatement
 * au comportement du salon, contrairement à une faute de frappe dans `physics`/`arena`, invisible
 * tant que personne ne joue dans les bonnes conditions).
 */
export function validateParametricModConfig(input: unknown): ValidatedModConfig {
  const errors: ValidationIssue[] = [];

  if (!isRecord(input)) {
    return { ok: false, errors: [{ path: '', message: 'La configuration doit être un objet JSON.' }] };
  }

  expectString(input, 'id', errors);

  withSection(input, 'player', errors, (player, base) => {
    expectNumber(player, 'startMass', errors, base);
    expectNumber(player, 'maxSplits', errors, base);
    expectNumber(player, 'minSplitMass', errors, base);
    expectOptionalBoolean(player, 'splitEnabled', errors, base);
    expectOptionalBoolean(player, 'ejectEnabled', errors, base);
  });

  withSection(input, 'physics', errors, (physics, base) => {
    expectNumber(physics, 'v0', errors, base);
    expectNumber(physics, 'speedMultiplier', errors, base);
    expectNumber(physics, 'speedMassExponent', errors, base);
    expectNumber(physics, 'velocityFloor', errors, base);
    expectNumber(physics, 'accelerationBase', errors, base);
    expectNumber(physics, 'accelerationMassExponent', errors, base);
    expectOptionalNumber(physics, 'decelerationMassExponent', errors, base);
  });

  withSection(input, 'split', errors, (split, base) => {
    expectNumber(split, 'ejectEfficiency', errors, base);
    expectNumber(split, 'ejectSpeedFactor', errors, base);
  });

  withSection(input, 'eject', errors, (eject, base) => {
    expectNumber(eject, 'amount', errors, base);
    expectOptionalNumber(eject, 'value', errors, base);
  });

  withSection(input, 'merge', errors, (merge, base) => {
    expectNumber(merge, 'baseTimeSec', errors, base);
    expectNumber(merge, 'massFactor', errors, base);
    expectNumber(merge, 'overlapMinFraction', errors, base);
  });

  withSection(input, 'eating', errors, (eating, base) => {
    expectNumber(eating, 'massAdvantage', errors, base);
    expectNumber(eating, 'minMassToEatFood', errors, base);
    expectOptionalNumber(eating, 'foodEfficiency', errors, base);
    expectOptionalNumber(eating, 'eatOverlapFraction', errors, base);
    expectOptionalNumber(eating, 'absorptionDurationSec', errors, base);
  });

  withSection(input, 'decay', errors, (decay, base) => {
    expectNumber(decay, 'graceSec', errors, base);
    expectNumber(decay, 'floor', errors, base);
    const tiersPath = `${base}.tiers`;
    if (!Array.isArray(decay.tiers) || decay.tiers.length === 0) {
      errors.push({ path: tiersPath, message: 'Tableau non vide requis (au moins un palier).' });
    } else {
      decay.tiers.forEach((tier, index) => {
        const tierBase = `${tiersPath}[${index}]`;
        if (!isRecord(tier)) {
          errors.push({ path: tierBase, message: 'Objet attendu.' });
          return;
        }
        expectNumber(tier, 'minMass', errors, tierBase);
        expectNumber(tier, 'rate', errors, tierBase);
        expectNumber(tier, 'intervalSec', errors, tierBase);
      });
    }
  });

  withSection(input, 'arena', errors, (arena, base) => {
    expectNumber(arena, 'width', errors, base);
    expectNumber(arena, 'height', errors, base);
    const validBorders = ['STRICT_WALL', 'ELASTIC_BOUNCE', 'TOROIDAL', 'TOXIC_ZONE'];
    if (typeof arena.borderType !== 'string' || !validBorders.includes(arena.borderType)) {
      errors.push({ path: `${base}.borderType`, message: `Doit être l'un de : ${validBorders.join(', ')}.` });
    }
    expectOptionalNumber(arena, 'bounceRestitution', errors, base);
  });

  withSection(input, 'food', errors, (food, base) => {
    expectNumber(food, 'density', errors, base);
    expectNumber(food, 'respawnRatePerSecond', errors, base);
    const pelletsPath = `${base}.pelletTypes`;
    if (!Array.isArray(food.pelletTypes) || food.pelletTypes.length === 0) {
      errors.push({ path: pelletsPath, message: 'Tableau non vide requis (au moins un type de pastille).' });
    } else {
      food.pelletTypes.forEach((pellet, index) => {
        const pelletBase = `${pelletsPath}[${index}]`;
        if (!isRecord(pellet)) {
          errors.push({ path: pelletBase, message: 'Objet attendu.' });
          return;
        }
        expectString(pellet, 'color', errors, pelletBase);
        expectNumber(pellet, 'mass', errors, pelletBase);
        expectNumber(pellet, 'weight', errors, pelletBase);
      });
    }
  });

  expectNumber(input, 'areaConstant', errors, '');

  if (input.bots !== undefined) {
    if (!isRecord(input.bots)) {
      errors.push({ path: 'bots', message: 'Objet attendu si présent.' });
    } else if (typeof input.bots.enabled !== 'boolean') {
      errors.push({ path: 'bots.enabled', message: 'Booléen requis.' });
    }
  }

  if (input.virus !== undefined) {
    if (!isRecord(input.virus)) {
      errors.push({ path: 'virus', message: 'Objet attendu si présent.' });
    } else {
      if (typeof input.virus.enabled !== 'boolean') {
        errors.push({ path: 'virus.enabled', message: 'Booléen requis.' });
      }
      if (input.virus.type !== 1 && input.virus.type !== 2 && input.virus.type !== 3) {
        errors.push({ path: 'virus.type', message: 'Doit être 1, 2 ou 3.' });
      }
    }
  }

  if (input.room !== undefined && !isRecord(input.room)) {
    errors.push({ path: 'room', message: 'Objet attendu si présent.' });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: input as unknown as ParametricModConfig };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withSection(
  input: Record<string, unknown>,
  key: string,
  errors: ValidationIssue[],
  check: (section: Record<string, unknown>, path: string) => void,
): void {
  const value = input[key];
  if (!isRecord(value)) {
    errors.push({ path: key, message: 'Section objet requise.' });
    return;
  }
  check(value, key);
}

function expectNumber(record: Record<string, unknown>, key: string, errors: ValidationIssue[], base: string): void {
  const path = base ? `${base}.${key}` : key;
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    errors.push({ path, message: 'Nombre requis.' });
  }
}

function expectOptionalNumber(
  record: Record<string, unknown>,
  key: string,
  errors: ValidationIssue[],
  base: string,
): void {
  if (record[key] === undefined) return;
  expectNumber(record, key, errors, base);
}

function expectString(record: Record<string, unknown>, key: string, errors: ValidationIssue[], base = ''): void {
  const path = base ? `${base}.${key}` : key;
  if (typeof record[key] !== 'string' || record[key] === '') {
    errors.push({ path, message: 'Chaîne non vide requise.' });
  }
}

function expectOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  errors: ValidationIssue[],
  base: string,
): void {
  if (record[key] === undefined) return;
  if (typeof record[key] !== 'boolean') {
    errors.push({ path: `${base}.${key}`, message: 'Booléen requis si présent.' });
  }
}

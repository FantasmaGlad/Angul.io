import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ParametricModConfig } from './config.js';

/** server/configs/, résolu relativement à ce fichier compilé (server/dist/mods/parametric/)
 * plutôt qu'au cwd du process — fonctionne quel que soit le répertoire depuis lequel le
 * serveur est démarré. */
const CONFIGS_DIR = fileURLToPath(new URL('../../../configs', import.meta.url));

export function loadModConfig(id: string): ParametricModConfig {
  const path = `${CONFIGS_DIR}/${id}.json`;
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    throw new Error(`Configuration de mod introuvable : "${id}" (attendu à ${path})`);
  }
  return JSON.parse(raw) as ParametricModConfig;
}

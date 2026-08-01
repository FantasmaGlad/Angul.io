import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_BOT_BEHAVIOR_CONFIG, type BotBehaviorConfig } from './behaviorConfig.js';

/** server/configs/bots/, résolu relativement à ce fichier compilé
 * (server/dist/engine/bots/) plutôt qu'au cwd du process — même principe que
 * `CONFIGS_DIR` dans mods/parametric/loadConfig.ts. */
const BOT_CONFIGS_DIR = fileURLToPath(new URL('../../../configs/bots', import.meta.url));

/** Charge un profil de comportement de robots par id (nom de fichier sans extension, voir
 * `BotConfig.behaviorId`, mods/parametric/config.ts) — repli silencieux sur
 * `DEFAULT_BOT_BEHAVIOR_CONFIG` si le fichier est introuvable/invalide plutôt qu'une exception :
 * contrairement à un mod de jeu (dont l'absence de config est une erreur de déploiement bloquante,
 * voir `loadModConfig`), un comportement de bot mal configuré ne doit jamais empêcher un salon de
 * démarrer — juste retomber sur le comportement par défaut, déjà éprouvé en production. */
export function loadBotBehaviorConfig(id = 'default'): BotBehaviorConfig {
  const path = `${BOT_CONFIGS_DIR}/${id}.json`;
  try {
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<BotBehaviorConfig>;
    // Fusion PAR SECTION (pas un simple `{...default, ...parsed}` au premier niveau) : un fichier
    // JSON ne redéfinissant qu'un seul champ d'un profil (ex. `fou.splitChance`) ne doit pas perdre
    // silencieusement le reste des réglages par défaut de ce même profil.
    return {
      ...DEFAULT_BOT_BEHAVIOR_CONFIG,
      ...parsed,
      fuis: { ...DEFAULT_BOT_BEHAVIOR_CONFIG.fuis, ...parsed.fuis },
      neutre: { ...DEFAULT_BOT_BEHAVIOR_CONFIG.neutre, ...parsed.neutre },
      agressif: { ...DEFAULT_BOT_BEHAVIOR_CONFIG.agressif, ...parsed.agressif },
      wallAvoidance: { ...DEFAULT_BOT_BEHAVIOR_CONFIG.wallAvoidance, ...parsed.wallAvoidance },
    };
  } catch {
    return DEFAULT_BOT_BEHAVIOR_CONFIG;
  }
}

/** Liste les profils de comportement disponibles (un id par fichier `server/configs/bots/*.json`)
 * — même usage que `listAvailableModIds` (mods/parametric/loadConfig.ts), pour une future
 * interface d'admin/lobby qui proposerait un choix plutôt qu'un id à taper à la main. */
export function listAvailableBotBehaviorIds(): string[] {
  try {
    return readdirSync(BOT_CONFIGS_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.slice(0, -'.json'.length))
      .sort();
  } catch {
    return [];
  }
}

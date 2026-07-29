/** Configuration des touches (clavier + manette), persistée en localStorage — même principe que
 * settings.ts (FPS/Vsync) : réglage local à l'appareil, relu au montage de `GameView`
 * (`attachInput`), pris en compte à la prochaine partie plutôt qu'en cours de jeu (demande
 * utilisateur : configuration dynamique — un rebind change bien le comportement réel du jeu, dès
 * la prochaine fois qu'on y entre, sans toucher au code). */

export type GameAction = 'split' | 'dash' | 'eject';

export const GAME_ACTIONS: GameAction[] = ['split', 'dash', 'eject'];

export interface ActionBinding {
  /** `KeyboardEvent.code` (ex. "Space", "KeyF") — jamais `.key` : indépendant de la disposition
   * clavier (AZERTY/QWERTY...), un `code` désigne la position physique de la touche. */
  key: string;
  /** Index de bouton Gamepad API (`navigator.getGamepads()[i].buttons[index]`, mapping standard)
   * — `undefined` = non lié à la manette. */
  gamepadButton?: number;
}

export type KeybindConfig = Record<GameAction, ActionBinding>;

export const DEFAULT_KEYBINDS: KeybindConfig = {
  split: { key: 'Space', gamepadButton: 0 }, // A (Xbox) / Croix (PlayStation)
  dash: { key: 'KeyF', gamepadButton: 2 }, // X (Xbox) / Carré (PlayStation)
  eject: { key: 'KeyW', gamepadButton: 1 }, // B (Xbox) / Rond (PlayStation)
};

/** Libellé lisible par action — utilisé par le HUD dash (DASH · <touche>) et l'UI de réglages. */
export const ACTION_LABELS: Record<GameAction, string> = {
  split: 'Diviser',
  dash: 'Dash',
  eject: 'Éjecter de la masse',
};

/** Icône material-symbols par action (voir styles.css `.material-symbols-outlined`). */
export const ACTION_ICONS: Record<GameAction, string> = {
  split: 'call_split',
  dash: 'bolt',
  eject: 'arrow_outward',
};

const STORAGE_KEY = 'angulio.keybinds';

function isValidBinding(value: unknown): value is Partial<ActionBinding> {
  return typeof value === 'object' && value !== null;
}

/** Fusionne par-dessus `DEFAULT_KEYBINDS` plutôt que de faire confiance tel quel au JSON stocké :
 * une sauvegarde partielle/corrompue (ancienne version, édition manuelle du localStorage) ne doit
 * jamais faire disparaître silencieusement une action entière (touche `undefined` == plus aucun
 * moyen de dasher, par exemple). */
export function loadKeybinds(): KeybindConfig {
  const result: KeybindConfig = { ...DEFAULT_KEYBINDS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return result;
    for (const action of GAME_ACTIONS) {
      const candidate = (parsed as Record<string, unknown>)[action];
      if (!isValidBinding(candidate)) continue;
      result[action] = {
        key: typeof candidate.key === 'string' && candidate.key ? candidate.key : DEFAULT_KEYBINDS[action].key,
        gamepadButton:
          typeof candidate.gamepadButton === 'number' ? candidate.gamepadButton : undefined,
      };
    }
  } catch {
    return { ...DEFAULT_KEYBINDS };
  }
  return result;
}

export function saveKeybinds(binds: KeybindConfig): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(binds));
  } catch {}
}

export function resetKeybinds(): KeybindConfig {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}
  return { ...DEFAULT_KEYBINDS };
}

/** `event.code` -> libellé court affiché dans l'UI de réglages (ex. "Espace", "F", "1", "↑"). */
export function keyLabel(code: string | undefined): string {
  if (!code) return '—';
  if (code === 'Space') return 'Espace';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) {
    const dir = code.slice(5);
    return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[dir] ?? code;
  }
  if (code === 'ShiftLeft' || code === 'ShiftRight') return 'Maj';
  if (code === 'ControlLeft' || code === 'ControlRight') return 'Ctrl';
  if (code === 'AltLeft' || code === 'AltRight') return 'Alt';
  return code;
}

/** Mapping standard Gamepad API (façon manette Xbox — les libellés PlayStation diffèrent mais
 * les INDEX de bouton, eux, sont les mêmes pour toute manette respectant le "standard mapping"). */
const GAMEPAD_BUTTON_LABELS: Record<number, string> = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Select',
  9: 'Start',
  10: 'L3',
  11: 'R3',
  12: '↑',
  13: '↓',
  14: '←',
  15: '→',
};

export function gamepadButtonLabel(index: number | undefined): string {
  if (index === undefined) return '—';
  return GAMEPAD_BUTTON_LABELS[index] ?? `Bouton ${index}`;
}

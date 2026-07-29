import { useEffect, useRef, useState } from 'react';
import {
  ACTION_ICONS,
  ACTION_LABELS,
  DEFAULT_KEYBINDS,
  gamepadButtonLabel,
  GAME_ACTIONS,
  keyLabel,
  loadKeybinds,
  resetKeybinds,
  saveKeybinds,
  type GameAction,
  type KeybindConfig,
} from '../keybinds.js';

type CaptureTarget = { action: GameAction; kind: 'key' | 'gamepad' } | null;

/** Configuration des touches (clavier + manette) par action de jeu — demande utilisateur,
 * entièrement dynamique : `input.ts` relit `loadKeybinds()` à chaque montage de `GameView`, un
 * rebind ici change donc réellement le comportement du jeu à la prochaine partie, sans toucher
 * au code. Pris en compte "à la prochaine partie" plutôt qu'en direct (même convention que la
 * section FPS d'avant, voir SettingsPage.tsx) : une partie déjà en cours garde ses écouteurs déjà
 * attachés. */
export default function KeybindSettings() {
  const [binds, setBinds] = useState<KeybindConfig>(() => loadKeybinds());
  const [capturing, setCapturing] = useState<CaptureTarget>(null);
  const [gamepadDetected, setGamepadDetected] = useState(
    () => navigator.getGamepads?.().some((p) => p !== null) ?? false,
  );
  const captureRafRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const onGamepadEvent = (): void => setGamepadDetected(true);
    window.addEventListener('gamepadconnected', onGamepadEvent);
    return () => window.removeEventListener('gamepadconnected', onGamepadEvent);
  }, []);

  // Capture du prochain input (clavier ou manette) pendant un rebind — écouteurs TEMPORAIRES,
  // retirés dès qu'une touche/bouton est capturé ou que l'utilisateur annule.
  useEffect(() => {
    if (!capturing) return;

    function commit(action: GameAction, kind: 'key' | 'gamepad', value: string | number): void {
      setBinds((prev) => {
        const next: KeybindConfig = {
          ...prev,
          [action]: {
            ...prev[action],
            ...(kind === 'key' ? { key: value as string } : { gamepadButton: value as number }),
          },
        };
        saveKeybinds(next);
        return next;
      });
      setCapturing(null);
    }

    if (capturing.kind === 'key') {
      const onKeyDown = (event: KeyboardEvent): void => {
        event.preventDefault();
        if (event.code === 'Escape') {
          setCapturing(null);
          return;
        }
        if (!event.code) return; // évènement sans code physique exploitable (ignoré, capture continue)
        commit(capturing.action, 'key', event.code);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
    }

    // Capture manette : pas d'événement natif, interrogation par frame (comme input.ts) jusqu'à
    // détecter un bouton qui n'était pas pressé à l'entrée de la capture.
    const wasPressed = new Set<number>();
    const pad = navigator.getGamepads?.().find((p) => p !== null);
    if (pad) {
      for (let i = 0; i < pad.buttons.length; i++) {
        if (pad.buttons[i]?.pressed) wasPressed.add(i);
      }
    }

    function pollForButton(): void {
      const activePad = navigator.getGamepads?.().find((p) => p !== null);
      if (activePad) {
        for (let i = 0; i < activePad.buttons.length; i++) {
          if (activePad.buttons[i]?.pressed && !wasPressed.has(i)) {
            commit(capturing!.action, 'gamepad', i);
            return;
          }
        }
      }
      captureRafRef.current = requestAnimationFrame(pollForButton);
    }
    captureRafRef.current = requestAnimationFrame(pollForButton);

    const onEscape = (event: KeyboardEvent): void => {
      if (event.code === 'Escape') setCapturing(null);
    };
    window.addEventListener('keydown', onEscape);

    return () => {
      if (captureRafRef.current !== undefined) cancelAnimationFrame(captureRafRef.current);
      window.removeEventListener('keydown', onEscape);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing]);

  const handleReset = (): void => {
    setBinds(resetKeybinds());
    setCapturing(null);
  };

  return (
    <section className="lobby-section">
      <span className="section-title">Touches &amp; Manette</span>
      <p className="account-status" style={{ marginTop: 6 }}>
        Clique sur une touche ou un bouton pour le réassigner — Échap pour annuler. Pris en compte
        à la prochaine partie.
        {!gamepadDetected && ' Aucune manette détectée pour le moment.'}
      </p>

      <div className="keybind-table" style={{ marginTop: 12 }}>
        {GAME_ACTIONS.map((action) => (
          <div key={action} className="keybind-row">
            <div className="keybind-action">
              <span className="material-symbols-outlined">{ACTION_ICONS[action]}</span>
              {ACTION_LABELS[action]}
            </div>
            <button
              type="button"
              className={`keybind-btn${capturing?.action === action && capturing.kind === 'key' ? ' capturing' : ''}`}
              onClick={() => setCapturing({ action, kind: 'key' })}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>keyboard</span>
              {capturing?.action === action && capturing.kind === 'key'
                ? 'Appuie sur une touche…'
                : keyLabel(binds[action].key)}
            </button>
            <button
              type="button"
              className={`keybind-btn${capturing?.action === action && capturing.kind === 'gamepad' ? ' capturing' : ''}`}
              onClick={() => setCapturing({ action, kind: 'gamepad' })}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>sports_esports</span>
              {capturing?.action === action && capturing.kind === 'gamepad'
                ? 'Appuie sur un bouton…'
                : gamepadButtonLabel(binds[action].gamepadButton)}
            </button>
          </div>
        ))}
      </div>

      <button
        type="button"
        className="btn-ghost"
        style={{ marginTop: 14 }}
        onClick={handleReset}
        disabled={JSON.stringify(binds) === JSON.stringify(DEFAULT_KEYBINDS)}
      >
        Réinitialiser les touches par défaut
      </button>
    </section>
  );
}

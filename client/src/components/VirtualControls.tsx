import { useRef } from 'react';
import type { Vector2 } from '@angulio/shared';
import type { InputTracker } from '../input.js';

/** Rayon maximal (px CSS) de déflexion du joystick virtuel — au-delà, le pouce continue de
 * bouger mais l'intensité reste plafonnée à 1 (comme un vrai stick physique en butée). */
const MAX_DRAG_RADIUS_PX = 42;

interface VirtualControlsProps {
  /** Réf vers l'`InputTracker` courant (créé dans l'effet principal de GameView.tsx, pas un state
   * React — c'est une API impérative, pas une donnée d'affichage) — `null` tant que la partie
   * n'a pas encore démarré son effet de connexion. */
  inputRef: React.RefObject<InputTracker | null>;
  /** Bouton d'action à droite : Dash si le mode actif le propose (Hardcore, `dashInfo` présent
   * côté GameView.tsx), Split sinon (Vanilla) — jamais les deux, un mode n'offre jamais les deux
   * actions simultanément (voir server/configs/*.json, `splitEnabled`/dash). */
  hasDash: boolean;
}

/** Contrôles tactiles mobile (demande utilisateur) : joystick virtuel (fond + bouton central,
 * assets `assets/Joystick/`) en bas à gauche pour le déplacement, bouton d'action en bas à droite
 * réutilisant le même bouton de joystick comme icône (Dash ou Split selon le mode). Visible
 * uniquement sur appareil à pointeur "grossier" (`(pointer: coarse)`, voir styles.css) : jamais
 * affiché sur desktop souris/clavier, y compris avec un écran tactile secondaire. Rendu par
 * `GameView.tsx` inconditionnellement — c'est le CSS qui décide de l'affichage, pas une
 * détection JS, pour rester cohérent avec un éventuel changement de mode d'interaction en cours
 * de partie (ex. brancher une souris) sans avoir à re-render. */
export default function VirtualControls({ inputRef, hasDash }: VirtualControlsProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLImageElement>(null);
  const activePointerId = useRef<number | null>(null);

  function resetKnob(): void {
    const knob = knobRef.current;
    if (knob) knob.style.transform = 'translate(-50%, -50%)';
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    const base = baseRef.current;
    if (!base) return;
    base.setPointerCapture(e.pointerId);
    activePointerId.current = e.pointerId;
    updateFromPointer(e.clientX, e.clientY);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== e.pointerId) return;
    updateFromPointer(e.clientX, e.clientY);
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>): void {
    if (activePointerId.current !== e.pointerId) return;
    activePointerId.current = null;
    resetKnob();
    inputRef.current?.setVirtualJoystick(null, 0);
  }

  function updateFromPointer(clientX: number, clientY: number): void {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const distance = Math.hypot(dx, dy);

    // Zone morte minime (évite un tremblement de doigt au repos qui déclencherait un mouvement
    // parasite) — même principe que `MOUSE_DEADZONE_PX` (input.ts), rayon bien plus petit ici
    // puisque le pouce reste physiquement posé sur le joystick, pas en mouvement libre.
    if (distance < 4) {
      resetKnob();
      inputRef.current?.setVirtualJoystick(null, 0);
      return;
    }

    const clampedDistance = Math.min(distance, MAX_DRAG_RADIUS_PX);
    const direction: Vector2 = { x: dx / distance, y: dy / distance };
    const intensity = clampedDistance / MAX_DRAG_RADIUS_PX;

    const knob = knobRef.current;
    if (knob) {
      const knobX = direction.x * clampedDistance;
      const knobY = direction.y * clampedDistance;
      knob.style.transform = `translate(calc(-50% + ${knobX}px), calc(-50% + ${knobY}px))`;
    }

    inputRef.current?.setVirtualJoystick(direction, intensity);
  }

  return (
    <div className="virtual-controls" aria-hidden="true">
      <div
        ref={baseRef}
        className="virtual-joystick-base"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <img
          src="/assets/Joystick/JoystickFond.png"
          alt=""
          className="virtual-joystick-bg"
          draggable={false}
        />
        <img
          ref={knobRef}
          src="/assets/Joystick/Joystick.png"
          alt=""
          className="virtual-joystick-knob"
          draggable={false}
        />
      </div>

      <button
        type="button"
        className="virtual-action-button"
        onPointerDown={(e) => {
          e.preventDefault();
          if (hasDash) inputRef.current?.triggerDash();
          else inputRef.current?.triggerSplit();
        }}
      >
        <img src="/assets/Joystick/Joystick.png" alt="" className="virtual-action-icon" draggable={false} />
        <span className="virtual-action-label">{hasDash ? 'DASH' : 'SPLIT'}</span>
      </button>
    </div>
  );
}

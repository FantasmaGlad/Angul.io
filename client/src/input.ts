import type { Vector2 } from '@angulio/shared';
import { loadKeybinds, type KeybindConfig } from './keybinds.js';
import type { Camera } from './render.js';

/** Rayon en pixels écran au-delà duquel l'intensité de déplacement est maximale (100%). En
 *-deçà, l'intensité (et donc la vitesse/accélération appliquées côté serveur) est
 * proportionnelle à la distance du curseur au centre — contrôle "analogique" plutôt que
 * tout-ou-rien. Indépendant de la cible visée (voir `getTarget`) : ne module que la vitesse. */
const CONTROL_RADIUS_PX = 300;
/** Magnitude minimale du stick gauche (Gamepad API) en-deçà de laquelle on l'ignore et traite
 * comme "aucune commande" (zone morte matérielle : un vrai stick n'est presque jamais à
 * exactement 0 au repos). */
const GAMEPAD_STICK_DEAD_ZONE = 0.15;
/** Décalage (unités monde) simulé pour la déflexion du stick, indépendant du zoom caméra —
 * seule la DIRECTION du vecteur cible sert au-delà de la zone morte de pilotage
 * (`TARGET_DEAD_ZONE_PX`, prediction.ts) ; l'intensité (vitesse) est un scalaire séparé dérivé
 * directement de la magnitude du stick. Sert AUSSI au joystick virtuel tactile (voir `getTarget`),
 * d'où son dimensionnement pour le pire cas mobile.
 *
 * Pourquoi si loin devant (et non les 500 px d'origine, "juste assez grand pour sortir de la zone
 * morte") — deux raisons, toutes deux propres aux vitesses de Dash (`DASH_BASE_SPEED` = 4050 px/s,
 * shared/src/movement.ts, la plus haute du jeu) :
 *
 *  1. DÉPASSEMENT DE CIBLE. Le serveur conserve la dernière cible reçue jusqu'à l'input suivant
 *     (~50 ms à 20 Hz) et pilote par `normalize(target - piece.position)`. À 4050 px/s, 500 px ne
 *     représentent que ~123 ms de trajet : il suffit d'un trou d'input un peu plus long (gigue
 *     cellulaire/wifi chargé, banal sur mobile — bien moins sur le LAN où ces réglages ont été
 *     validés) pour que le morceau DÉPASSE sa propre cible. La direction s'inverse alors à 180°, ou
 *     retombe sous `TARGET_DEAD_ZONE_PX` (intensité forcée à 0, voir mods/parametric/index.ts
 *     `inputVectorOf`) : un freinage brutal en plein dash. À 4000 px, la même cible couvre ~1 s de
 *     trajet — hors d'atteinte de toute gigue réaliste.
 *  2. ACCORD PRÉDICTION/SERVEUR. La cible est projetée depuis la position PRÉDITE localement, mais
 *     le serveur normalise depuis SA position (en retard de la latence). Pour un même écart entre
 *     les deux, l'erreur angulaire décroît avec la distance de projection : ~11° à 500 px contre
 *     ~1,4° à 4000 px pour 100 px d'écart. Projeter loin rend donc les deux directions
 *     pratiquement identiques, au lieu de simplement "assez différentes pour se voir" au dash.
 *
 * Aucun risque à agrandir : la cible n'est jamais bornée à la carte côté serveur (seule sa
 * finitude est validée, voir net/ws/connectionHandler.ts `validateInputMessage`) et sa distance
 * n'entre dans aucun calcul de vitesse — client comme serveur ne lisent que sa direction. */
const GAMEPAD_TARGET_OFFSET_WORLD_PX = 4000;

export interface InputTracker {
  /**
   * Position du curseur convertie en coordonnées monde (via la caméra courante) + intensité de
   * contrôle ∈ [0,1] (distance au centre de l'écran, plafonnée à `CONTROL_RADIUS_PX`). Envoyé
   * tel quel au serveur (`PlayerInput`) : chaque morceau du joueur calcule sa propre direction
   * vers cette cible plutôt que de partager une direction unique — un curseur positionné entre
   * plusieurs morceaux les fait donc converger (regroupement) au lieu de tous partir dans la
   * même direction relative.
   */
  getTarget(camera: Camera): { target: Vector2; intensity: number };
  /** true une seule fois par pression de la touche/bouton "diviser" (consommé après lecture). */
  consumeSplit(): boolean;
  /** true une seule fois par pression de la touche/bouton "dash" (consommé après lecture). */
  consumeDash(): boolean;
  /** true une seule fois par pression de la touche/bouton "éjecter de la masse" (demande
   * utilisateur), consommé après lecture. */
  consumeEject(): boolean;
  /** Pilotage par joystick virtuel tactile (VirtualJoystick.tsx, mobile) — `direction` un vecteur
   * DÉJÀ normalisé (magnitude 1, ou `null` quand le pouce relâche le joystick) et `intensity` ∈
   * [0,1] la déflexion réelle (distance du pouce au centre / rayon max, voir VirtualJoystick.tsx).
   * Priorité ABSOLUE sur souris/manette tant qu'actif (`direction !== null`) — symétrique à la
   * manette, qui prend déjà le pas sur la souris (voir `getTarget`) : un joueur qui touche l'écran
   * pilote forcément volontairement, jamais un signal parasite à arbitrer contre autre chose. */
  setVirtualJoystick(direction: Vector2 | null, intensity: number): void;
  /** Déclenche une division comme une vraie pression clavier/manette (bouton tactile dédié,
   * voir VirtualJoystick.tsx) — met à jour `consumeSplit()` ET déclenche `onSplitRequested`
   * (retour visuel immédiat), exactement comme `onKeyDown`. */
  triggerSplit(): void;
  /** Équivalent tactile de `triggerSplit` pour le dash. */
  triggerDash(): void;
  /** Retire les écouteurs attachés par `attachInput` — à appeler quand le canvas associé est
   * démonté (ex. retour à l'accueil, GameView.tsx) pour ne pas accumuler d'écouteurs `keydown`
   * au fil des parties successives (chaque partie remonte un nouveau canvas). */
  detach(): void;
}

/** Le joueur vise toujours depuis le centre de son écran — cohérent avec une caméra centrée
 * sur son propre joueur (render.ts).
 *
 * `onSplitRequested`/`onDashRequested` (optionnels) : appelés IMMÉDIATEMENT à chaque vraie
 * pression (front montant clavier/manette), en plus de — jamais à la place de — leur
 * `consumeX()` respectif (qui reste le seul canal vers le réseau, lu au rythme de
 * `scheduleInput`, voir GameView.tsx). Sert uniquement de retour visuel local instantané (effet
 * de zoom au split/dash, demande utilisateur) : attendre le prochain envoi réseau planifié
 * (jusqu'à ~50ms à 20Hz) pour déclencher l'animation la ferait démarrer perceptiblement en
 * retard sur la pression réelle.
 *
 * Touches/boutons lus depuis `loadKeybinds()` (demande utilisateur : configuration dynamique,
 * voir keybinds.ts/KeybindSettings.tsx) — chargés une fois à l'attache plutôt qu'observés en
 * continu, même convention que les réglages FPS/Vsync (settings.ts) : un rebind s'applique à la
 * prochaine partie, pas en cours de jeu. */
export function attachInput(
  canvas: HTMLCanvasElement,
  onSplitRequested?: () => void,
  onDashRequested?: () => void,
): InputTracker {
  const keybinds: KeybindConfig = loadKeybinds();

  // `clientWidth`/`clientHeight` (taille CSS affichée), PAS `canvas.width/height` (résolution
  // physique de dessin, qui peut valoir `dpr` fois plus sur écran HiDPI depuis le correctif Retina
  // de GameView.tsx `resizeCanvas`) — `e.clientX`/`clientY` (souris) sont toujours en pixels CSS.
  let mouseX = canvas.clientWidth / 2;
  let mouseY = canvas.clientHeight / 2;
  let splitRequested = false;
  let dashRequested = false;
  let ejectRequested = false;
  /** Détection du front montant des boutons manette — l'API Gamepad n'a pas d'événement,
   * seulement un état interrogé à chaque frame (voir `frameTick`), donc le front doit être
   * calculé nous-mêmes en comparant à l'état précédent. */
  const gamepadButtonWasPressed = { split: false, dash: false, eject: false };
  let gamepadRafId: number | undefined;
  /** Manette active au sens de cette frame (voir `frameTick`) — souris explicitement désactivée
   * comme source d'input tant que vrai (demande utilisateur : "si une manette est branchée,
   * désactiver la souris"), y compris visuellement (curseur masqué sur le canvas). */
  let gamepadActive = false;
  /** Direction (normalisée) + intensité du joystick virtuel tactile — voir `setVirtualJoystick`
   * sur `InputTracker`. `null` = pouce relâché (joystick inactif, retombe sur souris/manette). */
  let virtualJoystickDirection: Vector2 | null = null;
  let virtualJoystickIntensity = 0;


  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === keybinds.split.key) {
      event.preventDefault();
      splitRequested = true;
      onSplitRequested?.();
    } else if (event.code === keybinds.dash.key) {
      event.preventDefault();
      dashRequested = true;
      onDashRequested?.();
    } else if (event.code === keybinds.eject.key) {
      event.preventDefault();
      ejectRequested = true;
    }
  };

  let smoothedMouseX = canvas.clientWidth / 2;
  let smoothedMouseY = canvas.clientHeight / 2;
  let smoothedStickX = 0;
  let smoothedStickY = 0;
  let lastFrameTickTime = performance.now();

  function findActiveGamepad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const gamepads = Array.from(navigator.getGamepads());
    return gamepads.find((p) => p !== null && p.connected) ?? null;
  }

  const onGamepadConnected = (e: GamepadEvent) => {
    if (e.gamepad) {
      gamepadActive = true;
      canvas.style.cursor = 'none';
    }
  };
  const onGamepadDisconnected = () => {
    const pad = findActiveGamepad();
    if (!pad) {
      gamepadActive = false;
      canvas.style.cursor = 'default';
    }
  };
  window.addEventListener('gamepadconnected', onGamepadConnected);
  window.addEventListener('gamepaddisconnected', onGamepadDisconnected);

  function onMouseMove(e: MouseEvent): void {
    const pad = findActiveGamepad();
    const rawStickX = pad?.axes[0] ?? 0;
    const rawStickY = pad?.axes[1] ?? 0;
    const hasStickInput = Math.hypot(rawStickX, rawStickY) > GAMEPAD_STICK_DEAD_ZONE;
    if (!hasStickInput) {
      gamepadActive = false;
      canvas.style.cursor = 'default';
    }
    mouseX = e.clientX;
    mouseY = e.clientY;
  }

  // Boucle interne dédiée, cadencée sur une vraie frame d'affichage (`requestAnimationFrame`)
  function frameTick(): void {
    const now = performance.now();
    const dtSec = Math.min(0.05, Math.max(0.001, (now - lastFrameTickTime) / 1000));
    lastFrameTickTime = now;

    // Lissage exponentiel ultra-réactif (k = 120) pour la souris
    const mouseLerp = 1 - Math.exp(-120 * dtSec);
    smoothedMouseX += (mouseX - smoothedMouseX) * mouseLerp;
    smoothedMouseY += (mouseY - smoothedMouseY) * mouseLerp;

    const pad = findActiveGamepad();
    const rawStickX = pad?.axes[0] ?? 0;
    const rawStickY = pad?.axes[1] ?? 0;

    // Lissage exponentiel fluide (k = 60) pour le joystick : absorbe le bruit d'échantillonnage
    const stickLerp = 1 - Math.exp(-60 * dtSec);
    smoothedStickX += (rawStickX - smoothedStickX) * stickLerp;
    smoothedStickY += (rawStickY - smoothedStickY) * stickLerp;

    const hasStickInput = Math.hypot(rawStickX, rawStickY) > GAMEPAD_STICK_DEAD_ZONE;
    const hasAnyButtonPressed = pad?.buttons.some((b) => b.pressed) ?? false;
    const isGamepadInUse = pad !== null && (hasStickInput || hasAnyButtonPressed);

    if (isGamepadInUse && !gamepadActive) {
      gamepadActive = true;
      canvas.style.cursor = 'none';
    }

    const checkButton = (
      action: 'split' | 'dash' | 'eject',
      onTriggered?: () => void,
    ): void => {
      const buttonIndex = keybinds[action].gamepadButton;
      const pressed =
        buttonIndex !== undefined ? (pad?.buttons[buttonIndex]?.pressed ?? false) : false;
      if (pressed && !gamepadButtonWasPressed[action]) {
        if (action === 'split') splitRequested = true;
        else if (action === 'dash') dashRequested = true;
        else ejectRequested = true;
        onTriggered?.();
      }
      gamepadButtonWasPressed[action] = pressed;
    };
    checkButton('split', onSplitRequested);
    checkButton('dash', onDashRequested);
    checkButton('eject');

    gamepadRafId = requestAnimationFrame(frameTick);
  }
  gamepadRafId = requestAnimationFrame(frameTick);

  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  return {
    getTarget(camera: Camera): { target: Vector2; intensity: number } {
      // Joystick virtuel tactile : priorité absolue, avant même la manette — voir le commentaire
      // de `setVirtualJoystick` sur `InputTracker`.
      if (virtualJoystickDirection) {
        return {
          target: {
            x: camera.x + virtualJoystickDirection.x * GAMEPAD_TARGET_OFFSET_WORLD_PX,
            y: camera.y + virtualJoystickDirection.y * GAMEPAD_TARGET_OFFSET_WORLD_PX,
          },
          intensity: virtualJoystickIntensity,
        };
      }

      // Manette connectée (détectée par le navigateur dès qu'un bouton/axe a été actionné une
      // première fois) : priorité totale sur la souris, y compris au repos (stick centré ->
      // cible = position actuelle, zone morte de pilotage) — la souris est explicitement
      // désactivée comme source d'input tant qu'une manette est active (demande utilisateur), pas
      // seulement reléguée en second — un retour silencieux sur la souris laisserait le curseur,
      // potentiellement resté loin du centre ou hors canvas, imposer une commande parasite dès
      // que le stick se recentre.
      if (gamepadActive) {
        const rawStickX = smoothedStickX;
        const rawStickY = smoothedStickY;
        const magnitude = Math.hypot(rawStickX, rawStickY);
        let intensity = 0;
        if (magnitude > GAMEPAD_STICK_DEAD_ZONE) {
          intensity = Math.min(1, (magnitude - GAMEPAD_STICK_DEAD_ZONE) / (1 - GAMEPAD_STICK_DEAD_ZONE));
        }
        const direction: Vector2 =
          magnitude > 0 ? { x: rawStickX / magnitude, y: rawStickY / magnitude } : { x: 1, y: 0 };
        return {
          target: {
            x: camera.x + direction.x * GAMEPAD_TARGET_OFFSET_WORLD_PX,
            y: camera.y + direction.y * GAMEPAD_TARGET_OFFSET_WORLD_PX,
          },
          intensity,
        };
      }

      const dx = smoothedMouseX - canvas.clientWidth / 2;
      const dy = smoothedMouseY - canvas.clientHeight / 2;
      const distPx = Math.hypot(dx, dy);
      const MOUSE_DEADZONE_PX = 10;

      if (distPx < MOUSE_DEADZONE_PX) {
        return { target: { x: camera.x, y: camera.y }, intensity: 0 };
      }

      const intensity = Math.min(1, (distPx - MOUSE_DEADZONE_PX) / (CONTROL_RADIUS_PX - MOUSE_DEADZONE_PX));
      const dirX = dx / distPx;
      const dirY = dy / distPx;
      // Projeter la cible suffisamment loin devant le blob dans la direction de la souris pour que
      // la position simulée ne dépasse jamais la cible en une seule frame (ce qui inverserait la
      // direction à 180° et causait des saccades/tressautements près du centre).
      const projectedDistWorld = Math.max(300, distPx / camera.scale);
      const target: Vector2 = {
        x: camera.x + dirX * projectedDistWorld,
        y: camera.y + dirY * projectedDistWorld,
      };
      return { target, intensity };
    },
    consumeSplit(): boolean {
      const value = splitRequested;
      splitRequested = false;
      return value;
    },
    consumeDash(): boolean {
      const value = dashRequested;
      dashRequested = false;
      return value;
    },
    consumeEject(): boolean {
      const value = ejectRequested;
      ejectRequested = false;
      return value;
    },
    setVirtualJoystick(direction: Vector2 | null, intensity: number): void {
      virtualJoystickDirection = direction;
      virtualJoystickIntensity = intensity;
    },
    triggerSplit(): void {
      splitRequested = true;
      onSplitRequested?.();
    },
    triggerDash(): void {
      dashRequested = true;
      onDashRequested?.();
    },
    detach(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('gamepadconnected', onGamepadConnected);
      window.removeEventListener('gamepaddisconnected', onGamepadDisconnected);
      canvas.style.cursor = '';
      if (gamepadRafId !== undefined) cancelAnimationFrame(gamepadRafId);
    },
  };
}

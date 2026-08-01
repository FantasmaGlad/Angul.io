import type {
  DeathCustomCard,
  EntitySnapshot,
  LeaderboardEntry,
  MovementConfig,
  ServerMessage,
} from '@angulio/shared';
import {
  computeScaleForMass,
  DEFAULT_DEATH_BANNER_ID,
  DEFAULT_DEATH_MESSAGE,
  dashSpeedForMass,
  isCustomImageBanner,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_EXPIRED,
  WS_CLOSE_ROOM_FULL,
} from '@angulio/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  calculateGridSector,
  createFpsTracker,
  createTickRateTracker,
  detectBatteryInfo,
  detectGpuInfo,
  detectMemoryInfo,
  detectNetworkInfo,
  detectSystemInfo,
  formatDebugText,
  type BatteryInfo,
  type GpuInfo,
  type NetworkInfo,
} from '../debugOverlay.js';
import { audioManager } from '../audio.js';
import { savePendingScoreClaim } from '../auth.js';
import { attachInput, type InputTracker } from '../input.js';
import { keyLabel, loadKeybinds } from '../keybinds.js';
import { GameConnection } from '../net.js';
import { LocalPrediction } from '../prediction.js';
import {
  BASE_SCALE,
  computeCamera,
  renderFrame,
  type Camera,
} from '../render.js';
import { RenderEngine } from '../renderEngine.js';
import { navigate } from '../router.js';
import {
  loadFpsSliderIndex,
  loadVsyncEnabled,
  minFrameIntervalMs as computeMinFrameIntervalMs,
} from '../settings.js';
import { ownAggregate, speedBetween } from '../stats.js';
import Minimap from './Minimap.js';
import VirtualControls from './VirtualControls.js';

/** Repli avant que `welcome` (et donc `serverTickRateHz`) ne soit connu — l'envoi des inputs se
 * cale ensuite dynamiquement sur la cadence réelle du salon (voir `scheduleInput` plus bas) au
 * lieu d'un intervalle fixe indépendant du tick serveur, qui battait auparavant avec lui. */
const DEFAULT_INPUT_INTERVAL_MS = 1000 / 30;
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;
/** Réactivité de l'EMA de latence (voir `smoothedLatencyMs`) — assez lent pour amortir un pic bas
 * isolé (un seul échantillon/s), assez réactif pour suivre une vraie dégradation en quelques
 * secondes. */
const LATENCY_EMA_ALPHA = 0.25;
/** Marge de sécurité (ms) ajoutée à l'estimation lissée — biaise délibérément vers une latence
 * surestimée plutôt que sous-estimée (voir le commentaire sur `smoothedLatencyMs`). */
const LATENCY_SAFETY_MARGIN_MS = 15;
const MAP_UNITS_TO_METERS = 0.01;

/** `LeaderboardEntry` du protocole + `isSelf` calculé côté client (comparaison à `selfPlayerId`)
 * plutôt que reçu du serveur — voir shared/src/protocol.ts `LeaderboardEntry.playerId` pour
 * pourquoi ce booléen ne peut plus être calculé côté serveur (bug de classement mélangé entre
 * joueurs, corrigé). */
interface DisplayLeaderboardEntry extends LeaderboardEntry {
  isSelf: boolean;
}

interface DeathState {
  isDead: boolean;
  finalScore: number;
  survivalTimeSec: number;
  xpEarned: number;
  killerNickname?: string;
  customCard: DeathCustomCard;
  /** Voir `DiedMessage.claimId` (protocol.ts) — présent uniquement pour un invité ayant un
   * score/XP non nul à sauvegarder, sert à afficher la proposition "créer un compte" sur l'écran
   * de fin de partie (voir plus bas). */
  claimId?: string;
}

const DEFAULT_DEATH_STATE: DeathState = {
  isDead: false,
  finalScore: 0,
  survivalTimeSec: 0,
  xpEarned: 0,
  customCard: { message: DEFAULT_DEATH_MESSAGE, bannerId: DEFAULT_DEATH_BANNER_ID },
};

/** Piste de musique pour le mode actif — `modId` autoritaire (connu dès le premier `welcome`)
 * prioritaire sur l'heuristique de secours (nom de salon contenant "hardcore"), utilisée avant
 * que `welcome` ne soit jamais arrivé. Factorisée pour être appelée aussi bien de façon
 * SYNCHRONE au clic sur "Rejouer"/à l'appui d'Espace (voir `doRespawn`) que dans le handler
 * `welcome` lui-même (voir son commentaire sur l'autoplay). */
function musicUrlForMod(modId: string | undefined, roomIdOrInviteCode: string): string {
  const isHardcore = modId === 'hardcore' || (modId === undefined && roomIdOrInviteCode.toLowerCase().includes('hardcore'));
  return isHardcore ? '/assets/Sons/Musiques/Hardcore.m4a' : '/assets/Sons/Musiques/vanilla.m4a';
}

/** "04m 12s" (cahier des charges fourni, maquette de l'écran de mort) plutôt qu'un nombre brut
 * de secondes — plus lisible pour une partie qui peut durer plusieurs minutes. */
function formatSurvivalTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

/** "HH:MM:SS" (décompte reset serveur) — écrit imperativement dans le HUD à chaque frame (voir
 * `resetTimerRef`), comme le reste du panneau de stats (Masse/Vitesse) : évite un re-render React
 * pour une valeur qui change chaque seconde. `undefined`/passé = aucun décompte à afficher. */
function formatCountdown(nextAtMs: number | undefined, nowMs: number): string {
  if (nextAtMs === undefined) return '—';
  const remainingSec = Math.max(0, Math.round((nextAtMs - nowMs) / 1000));
  const hours = Math.floor(remainingSec / 3600);
  const minutes = Math.floor((remainingSec % 3600) / 60);
  const seconds = remainingSec % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

interface GameViewProps {
  nickname: string;
  roomIdOrInviteCode: string;
  inviteCodeToShow?: string;
  authToken?: string;
  /** Skin choisi par un invité (voir ProfilePage.tsx/`localStorage['angulio.guestSkin']`) — envoyé
   * dans le `join` initial pour qu'un invité conserve son choix d'une connexion à l'autre (retour
   * utilisateur : sans ça, le serveur réassignait un skin aléatoire à chaque connexion, voir
   * connectionHandler.ts). Ignoré côté serveur pour un compte authentifié (la DB reste toujours
   * prioritaire). */
  guestSkin?: string;
  onExit: (message?: string) => void;
  /** Transfert forcé par un admin (§3.3 cahier_des_charges_admin.md) — GameView ne rouvre pas la
   * connexion lui-même (son effet principal ne dépend que du montage, voir plus bas) : l'appelant
   * (App.tsx) doit remonter ce composant avec un nouveau `roomIdOrInviteCode` (ex. via `key`). */
  onForceRoomChange?: (roomId: string) => void;
}

export default function GameView({
  nickname,
  roomIdOrInviteCode,
  inviteCodeToShow,
  authToken,
  guestSkin,
  onExit,
  onForceRoomChange,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugOverlayRef = useRef<HTMLPreElement | null>(null);
  const comboBannerRef = useRef<HTMLDivElement | null>(null);
  const announcementBannerRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  const statNicknameRef = useRef<HTMLSpanElement | null>(null);
  const statMassRef = useRef<HTMLSpanElement | null>(null);
  const statSpeedRef = useRef<HTMLSpanElement | null>(null);
  const resetTimerRef = useRef<HTMLSpanElement | null>(null);

  const onExitRef = useRef(onExit);
  useLayoutEffect(() => {
    onExitRef.current = onExit;
  });

  const onForceRoomChangeRef = useRef(onForceRoomChange);
  useLayoutEffect(() => {
    onForceRoomChangeRef.current = onForceRoomChange;
  });

  const connectionRef = useRef<GameConnection | null>(null);
  /** Réf impérative vers l'`InputTracker` de la partie en cours — permet à `VirtualControls.tsx`
   * (joystick/bouton d'action tactile, hors de cet effet) de piloter la même instance sans passer
   * par un state React (l'input est lu à chaque frame, pas une donnée d'affichage). */
  const inputRef = useRef<InputTracker | null>(null);
  /** `modId` du salon courant, appris au premier `welcome` — nécessaire hors de la boucle
   * d'effet (voir bouton "Rejouer" ci-dessous, `musicUrlForMod`) pour relancer la musique
   * SYNCHRONEMENT au clic plutôt que d'attendre le prochain `welcome` (round-trip réseau qui
   * casse le geste utilisateur requis par certains navigateurs pour l'autoplay avec son). */
  const modIdRef = useRef<string | undefined>(undefined);
  const [leaderboard, setLeaderboard] = useState<DisplayLeaderboardEntry[]>([]);
  const [deathState, setDeathState] = useState<DeathState>(DEFAULT_DEATH_STATE);
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [playerMass, setPlayerMass] = useState<number | undefined>(undefined);
  const [mapSizeState, setMapSizeState] = useState<number>(15000);
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  // Écran de connexion (demande utilisateur) : masque le léger lag entre le montage de GameView et
  // le moment où le blob est réellement synchronisé avec le monde (premier `state` reçu) — voir
  // l'effet de connexion plus bas, qui l'éteint après un délai MINIMUM de 2s (jamais avant, même si
  // la connexion est immédiate) pour ne pas clignoter sur un aller-retour local ultra-rapide.
  const [connecting, setConnecting] = useState(true);
  const [dashInfo, setDashInfo] = useState<{
    charges: number;
    maxCharges: number;
    canDash: boolean;
    rechargeProgress: number;
    rechargeTimeSec?: number;
  } | undefined>(undefined);
  // Touche de dash CONFIGURÉE (demande utilisateur : configuration dynamique, voir
  // keybinds.ts/KeybindSettings.tsx) — lue une fois au montage, affichée dans le HUD dash à la
  // place de l'ancien "F" fixe.
  const [dashKeyLabel] = useState(() => keyLabel(loadKeybinds().dash.key));

  useEffect(() => {
    const isHardcore = roomIdOrInviteCode.toLowerCase().includes('hardcore');
    const musicTrack = isHardcore
      ? '/assets/Sons/Musiques/Hardcore.m4a'
      : '/assets/Sons/Musiques/vanilla.m4a';
    audioManager.playMusic(musicTrack, true);
    return () => {
      audioManager.stopMusic();
    };
  }, [roomIdOrInviteCode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Rendu net sur écran HiDPI/Retina (audit Safari/macOS) : sans ce correctif, le canvas
    // dessinait à résolution CSS (1 pixel canvas = 1 pixel CSS) puis était upscalé par le
    // navigateur — flou visible sur tout écran Retina (quasi tous les Mac), pas spécifique à
    // Safari mais surtout remarqué là. `canvas.width/height` (attributs, la "surface" physique de
    // dessin) passent à `dpr` fois la taille CSS ; `ctx.setTransform` compense ce facteur pour que
    // TOUT le reste (render.ts, input.ts) continue de raisonner en coordonnées CSS-pixel via
    // `canvas.clientWidth/clientHeight` (déjà fixé à 100vw/100vh par `#game` en CSS, voir
    // styles.css) — la taille AFFICHÉE ne change pas, seule la résolution interne augmente.
    function resizeCanvas(): void {
      const dpr = window.devicePixelRatio || 1;
      canvas!.width = Math.round(window.innerWidth * dpr);
      canvas!.height = Math.round(window.innerHeight * dpr);
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let selfPlayerId: string | undefined;
    let mapSize = 15000;
    let serverTickRateHz: number | undefined;
    /** Modèle de mouvement du mode actif, reçu dans `welcome` — nécessaire à la prédiction locale
     * (voir prediction.ts) ; `undefined` tant que `welcome` n'est pas encore arrivé, auquel cas la
     * prédiction reste simplement inactive (le blob suit le pipeline serveur habituel). */
    let movementConfig: MovementConfig | undefined;
    let latestSnapshot: EntitySnapshot[] = [];
    let previousSnapshot: EntitySnapshot[] | undefined;
    let latestSnapshotAt = performance.now();
    const nicknames = new Map<string, string>();
    // Couleur de blob par joueur (refonte UI/UX, avatar procédural) — apprise via les mêmes
    // messages `player` que les pseudos (voir PlayerInfoMessage.color côté serveur), utilisée par
    // `colorFor` (render.ts) à la place de l'ancien `DEFAULT_BLOB_COLOR` unique.
    const colors = new Map<string, string>();
    let latestCamera: Camera = { x: 7500, y: 7500, scale: BASE_SCALE };
    /** `false` tant que la caméra n'a pas encore été calée sur la position RÉELLE du joueur — sa
     * valeur initiale ci-dessus n'est qu'un espace réservé (le centre d'une carte de 15000, qui
     * n'a même plus de sens sur une carte d'une autre taille). Le premier `state` la place
     * directement, position ET zoom, sans passer par le lissage habituel (voir `frameBody`).
     *
     * Sans ce calage direct, les deux lissages partent de cet espace réservé : la position
     * converge vite (k=60) mais le ZOOM (k=18) met ~200-300ms à quitter `BASE_SCALE` — or
     * `cullEntitiesForViewport` (renderEngine.ts) dimensionne le viewport à partir de CE zoom :
     * tant qu'il est faux, tout ce qui est réellement à l'écran mais hors du viewport calculé est
     * cullé, puis apparaît d'un coup à mesure que le zoom se corrige. C'est le "gros lag à la
     * connexion" ressenti — pas un vrai lag réseau, une image incomplète qui se remplit.
     *
     * Remis à `false` à chaque `welcome` (nouvelle vie/reconnexion, voir plus bas) : un respawn
     * place le joueur ailleurs sur la carte, avec une masse remise à zéro — donc exactement la
     * même situation qu'à la première connexion. */
    let cameraInitialized = false;
    // `undefined` tant qu'aucun `pong` n'est encore arrivé (écran F3, RTT) — distinct de `0`, qui
    // afficherait une latence mesurée alors qu'aucune mesure n'a encore eu lieu.
    let lastPingMs: number | undefined;
    /** Latence aller simple lissée (EMA) + marge de sécurité — utilisée UNIQUEMENT pour le rejeu
     * de réconciliation (prediction.ts), jamais pour l'affichage (`lastPingMs` brut reste
     * inchangé, voir écran F3/rapport admin). Un seul échantillon de ping brut (mesuré 1x/s,
     * PING_INTERVAL_MS) peut ponctuellement sous-estimer la vraie latence par simple gigue réseau
     * — et sous-estimer fait rejouer TROP PEU de l'historique local : la position reconstruite au
     * rejeu se retrouve alors légèrement en retard sur la position réellement prédite pendant un
     * déplacement, et la réconciliation la tire en arrière à chaque `state` avant que le
     * déplacement suivant la ramène en avant — un aller-retour visible ("avant/arrière") en
     * mouvement, invisible à l'arrêt (résidu nul). Sur-estimer, à l'inverse, ne fait rejouer qu'un
     * peu plus que nécessaire — un simple surplus d'avance déjà toléré par construction (voir
     * l'en-tête de prediction.ts). D'où le lissage (amorti les pics bas isolés) et la marge fixe
     * (biaise délibérément vers l'estimation la moins risquée des deux). */
    let smoothedLatencyMs: number | undefined;
    let lastComboLevel: number | undefined;
    let comboHideTimer: ReturnType<typeof setTimeout> | undefined;
    let announcementHideTimer: ReturnType<typeof setTimeout> | undefined;
    let justDied = false;
    let isDeadNow = false;
    /** `true` entre une coupure réseau transitoire détectée par `GameConnection` et le `welcome`
     * qui confirme la reconnexion (voir net.ts) — purement pour informer le joueur (statut HUD)
     * que la partie n'est pas figée, juste en train de se rattacher. */
    let isReconnecting = false;
    /** Horodatage (`Date.now()`) du prochain reset auto du salon (voir `welcome.nextResetAtMs`,
     * protocol.ts) — `undefined` tant qu'aucun `welcome` n'est encore arrivé, ou si ce salon n'a
     * aucun reset planifié. Décompté imperativement dans `frame()` (voir `resetTimerRef`), comme
     * le reste du panneau de stats. */
    let nextResetAtMs: number | undefined;
    /** `buildVersion` du premier `welcome` de cette session (voir protocol.ts) — un `welcome`
     * ULTÉRIEUR portant une valeur différente signifie que la reconnexion (automatique, voir
     * net.ts) a atterri sur un nouveau process serveur (déploiement) : le bundle actuellement en
     * mémoire est alors potentiellement périmé, d'où le rechargement forcé plus bas. `undefined`
     * tant qu'aucun `welcome` n'est encore arrivé. */
    let knownBuildVersion: string | undefined;

    function showComboBanner(level: number): void {
      const banner = comboBannerRef.current;
      if (!banner) return;
      banner.textContent = `Combo x${level} !`;
      banner.classList.add('visible');
      if (comboHideTimer) clearTimeout(comboHideTimer);
      comboHideTimer = setTimeout(() => {
        banner.classList.remove('visible');
      }, 2000);
    }

    /** Annonce admin (§4.6 cahier_des_charges_admin.md, "Diffusion de Messages & Overlays") —
     * même principe imperatif que `showComboBanner` (pas de re-render React pour un texte affiché
     * en surimpression pendant la boucle de jeu). */
    function showAnnouncement(text: string, color: string, durationMs: number): void {
      const banner = announcementBannerRef.current;
      if (!banner) return;
      banner.textContent = text;
      banner.style.color = color;
      banner.classList.add('visible');
      if (announcementHideTimer) clearTimeout(announcementHideTimer);
      announcementHideTimer = setTimeout(() => {
        banner.classList.remove('visible');
      }, durationMs);
    }

    let lastMouseX = window.innerWidth / 2;
    let lastMouseY = window.innerHeight / 2;
    const trackMouse = (e: MouseEvent) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };
    window.addEventListener('mousemove', trackMouse);

    let dashZoomBonus = 0;
    let currentModId: string | undefined;
    // Dernier `self.dash.canDash` connu (voir la branche `state` plus bas) — lu SYNCHRONEMENT par
    // le callback de dash ci-dessous pour ne jouer l'effet visuel/l'impulsion locale QUE si le
    // serveur accepterait réellement ce dash (charge disponible, un seul morceau). Avant ce
    // correctif, presser Dash sans charge disponible zoomait la caméra ET appliquait quand même
    // l'impulsion de vélocité en PRÉDICTION LOCALE — le serveur, lui, ignorait silencieusement cet
    // input (`onPlayerInput`, hardcore/index.ts, `state.charges > 0` déjà à false) : le blob
    // fonçait donc en avant pendant quelques frames sur la seule foi de la prédiction, avant un
    // rollback net et visible dès le `state` suivant confirmant l'absence de tout changement de
    // vélocité côté serveur — l'"animation avortée" et les lags visuels rapportés par l'utilisateur.
    let currentCanDash = false;

    const input = attachInput(
      canvas,
      () => {
        // Split entièrement désactivé pour ce mode (`splitEnabled: false`, voir
        // server/configs/hardcore.json et parametric/physics.ts `splitEnabled()`) : le serveur
        // n'effectuera jamais ce split, quelle que soit la masse — jouer le pincement caméra ici
        // n'aurait aucune fonction à confirmer/annuler (contrairement au Dash, purement
        // décoratif dans ce cas), mais reste une animation qui ne correspond à rien de réel. Le
        // seuil de masse minimum (`minSplitMass`) n'est en revanche pas exposé au client : un
        // split refusé pour ce motif (mode où il est activé) rejoue encore ce pincement — un
        // faux-positif bien plus rare et sans conséquence de rendu (contrairement au Dash), non
        // traité ici.
        if (currentModId === 'hardcore') return;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = lastMouseX - centerX;
        const dy = lastMouseY - centerY;
        const dist = Math.hypot(dx, dy);
        const dirX = dist > 0 ? dx / dist : 0;
        const dirY = dist > 0 ? dy / dist : 0;

        canvas.style.transformOrigin = `${50 + dirX * 18}% ${50 + dirY * 18}%`;
        canvas.style.transition = 'none';
        canvas.style.transform = 'scale(0.96)';
        requestAnimationFrame(() => {
          if (!canvas) return;
          canvas.style.transition = 'transform 0.22s cubic-bezier(0.1, 0.9, 0.2, 1)';
          canvas.style.transform = 'scale(1)';
        });
      },
      () => {
        if (currentModId !== 'hardcore') return;
        // Aucune charge disponible (recharge en cours) ou déjà divisé (plus d'un morceau, voir
        // `getDashState`, hardcore/index.ts) : le serveur ignorerait silencieusement cet input de
        // toute façon — jouer quand même le zoom caméra/l'impulsion de prédiction locale ici
        // produirait un aller "fantôme" jamais confirmé par le serveur, corrigé en rollback visible
        // dès le `state` suivant (voir le commentaire de `currentCanDash`). Rien à faire du tout
        // plutôt qu'une animation qui n'aboutira jamais.
        if (!currentCanDash) return;
        dashZoomBonus = 0.10;
        if (!canvas) return;

        // Direction du dash dérivée de la CIBLE D'INPUT EFFECTIVE (`input.getTarget`, la même que
        // celle envoyée au serveur juste en dessous), JAMAIS de la position souris brute.
        //
        // Pourquoi (correctif du "lag énorme au dash sur téléphone") : le serveur calcule la
        // direction du dash par `normalize(input.target - piece.position)` (voir
        // mods/hardcore/index.ts `onPlayerInput`) — donc à partir de la cible d'input, quelle que
        // soit la source qui l'a produite. Cette prédiction locale, elle, la dérivait de
        // `lastMouseX/lastMouseY` relativement au centre du canvas : une valeur alimentée
        // UNIQUEMENT par l'écouteur `mousemove`. Sur téléphone, aucun `mousemove` réel n'existe —
        // `lastMouseX/Y` restait donc figé sur son initialisation (`window.innerWidth/2`,
        // `innerHeight/2`, soit exactement le centre du canvas) : `len` valait 0 et la direction
        // prédite retombait systématiquement sur le repli `{ x: 1, y: 0 }`. Autrement dit, TOUT
        // dash tactile était prédit localement vers la DROITE de l'écran pendant que le serveur,
        // lui, l'appliquait dans la direction réelle du joystick virtuel. À la vitesse du dash
        // (`DASH_BASE_SPEED` = 4050 px/s, la plus haute du jeu), les deux positions divergeaient de
        // plusieurs centaines de pixels en un seul aller-retour réseau — puis `reconcile()`
        // rattrapait cet écart d'un coup au `state` suivant. C'est très exactement le "lag au début
        // du dash" rapporté : pas un vrai lag réseau, une prédiction locale qui partait dans une
        // direction sans rapport avec le mouvement autoritaire. Le cas dégradé où le navigateur
        // synthétise malgré tout un `mousemove` de compatibilité au tap n'était pas meilleur : il
        // enregistrait la position du BOUTON tactile (coin bas de l'écran), donc une direction tout
        // aussi étrangère à celle visée.
        //
        // Passer par `getTarget` corrige la source du problème pour TOUTES les sources d'input à la
        // fois (joystick virtuel tactile, manette — qui souffrait exactement du même défaut — et
        // souris, pour laquelle le résultat est inchangé) : la prédiction et le serveur partent
        // désormais littéralement de la même cible.
        const ownPosition = prediction.getOwnPosition() ?? latestCamera;
        const { target, intensity } = input.getTarget({ ...latestCamera, ...ownPosition });
        const dx = target.x - ownPosition.x;
        const dy = target.y - ownPosition.y;
        const len = Math.hypot(dx, dy);
        const dir = len > 0 ? { x: dx / len, y: dy / len } : { x: 1, y: 0 };
        // Impulsion atténuée avec la masse (cahier des charges §4a) — même formule partagée que
        // le serveur (voir mods/hardcore/index.ts), pour ne jamais diverger/roll back au dash.
        const ownMassForDash = ownAggregate(latestSnapshot, selfPlayerId)?.mass ?? 50;
        prediction.applyDash(dir, dashSpeedForMass(ownMassForDash));

        // Envoi réseau IMMÉDIAT du dash, hors de la cadence normale de `scheduleInput` (plus bas) —
        // sans ça, l'input `dash: true` n'aurait été envoyé qu'au PROCHAIN tick programmé (jusqu'à
        // un tick serveur complet de délai, indépendant de l'instant réel de la pression), alors que
        // le serveur traite `handleInput` immédiatement à la réception (voir room.ts) : le serveur
        // recevait donc systématiquement le dash plus tard que ce que `reconcile()` (prediction.ts)
        // supposait via la seule latence réseau estimée — d'où un mini rollback résiduel au tout
        // début de chaque dash (retour utilisateur), même après le correctif de réapplication de
        // l'impulsion. `input.consumeDash()` ici (au lieu d'attendre `scheduleInput`) évite que ce
        // même dash ne soit renvoyé une seconde fois au tick programmé suivant.
        // `target`/`intensity` sont ceux calculés ci-dessus pour la direction de l'impulsion — un
        // second appel à `getTarget` ici pourrait renvoyer une cible légèrement différente (le
        // joystick/la souris ont pu bouger entre les deux) et ré-introduirait, en plus petit,
        // exactement le désaccord prédiction/serveur que ce correctif supprime.
        if (selfPlayerId) {
          connection.send({
            type: 'input',
            target,
            intensity,
            split: input.consumeSplit(),
            dash: input.consumeDash(),
            eject: input.consumeEject(),
          });
        }
      },
    );
    inputRef.current = input;

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
    );
    connectionRef.current = connection;

    // Filet de sécurité Safari/macOS (audit rendu+réseau) : au retour au premier plan après une
    // mise en arrière-plan prolongée, vérifie/relance activement la connexion plutôt que de
    // compter uniquement sur l'événement `close` du socket (voir `GameConnection.ensureConnected`).
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') connection.ensureConnected();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const renderEngine = new RenderEngine();
    const prediction = new LocalPrediction();

    let lastMinimapUpdateAt = 0;

    // Écran de connexion (voir `connecting`/son commentaire) : durée minimum forcée à 2s même si le
    // premier `state` arrive plus vite, pour ne jamais clignoter sur un aller-retour local quasi
    // instantané (dev/LAN) ; filet de sécurité au-delà (`CONNECTING_SCREEN_FALLBACK_MS`) pour ne
    // jamais rester bloqué dessus si, pour une raison quelconque, aucun `state` n'arrive jamais
    // (le socket resterait alors "connecting" indéfiniment sans jamais déclencher `onClose` non
    // plus) — mêmes ordres de grandeur que le filet de secours d'AssetPreloader.tsx.
    const MIN_CONNECTING_SCREEN_MS = 500;
    const CONNECTING_SCREEN_FALLBACK_MS = 8000;
    const connectStartMs = performance.now();
    let connectingOverlayHidden = false;
    function hideConnectingOverlaySoon(): void {
      if (connectingOverlayHidden) return;
      connectingOverlayHidden = true;
      const remainingMs = Math.max(0, MIN_CONNECTING_SCREEN_MS - (performance.now() - connectStartMs));
      setTimeout(() => setConnecting(false), remainingMs);
    }
    const connectingFallbackTimer = setTimeout(hideConnectingOverlaySoon, CONNECTING_SCREEN_FALLBACK_MS);

    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        // Détection de nouveau déploiement (voir le commentaire de `knownBuildVersion`) : un
        // `welcome` ULTÉRIEUR (reconnexion auto après coupure, ou respawn) portant une version
        // différente du tout premier `welcome` de cette session signifie que le process serveur a
        // redémarré (déploiement) — recharge la page pour repartir sur un bundle à jour plutôt que
        // de continuer silencieusement sur l'ancien. Un reconnect a de toute façon déjà provoqué un
        // nouveau spawn côté serveur (voir net.ts, `GameConnection` rejoue le dernier `join`) : rien
        // d'une "vie en cours" n'est perdu de plus par ce rechargement.
        if (message.buildVersion !== undefined) {
          if (knownBuildVersion === undefined) {
            knownBuildVersion = message.buildVersion;
          } else if (knownBuildVersion !== message.buildVersion) {
            window.location.reload();
            return;
          }
        }
        // Jeton à représenter si cette connexion venait à se couper (voir net.ts
        // `GameConnection.setResumeToken` / connectionHandler.ts `pendingLeaves`) — permet au
        // serveur de reconnaître un retour rapide et de reprendre la vie en cours plutôt que de la
        // considérer perdue (correctif "déconnexion = perte immédiate de l'XP en cours").
        connection.setResumeToken(message.resumeToken);
        currentModId = message.modId;
        modIdRef.current = message.modId;
        selfPlayerId = message.playerId;
        mapSize = message.mapSize;
        serverTickRateHz = message.tickRateHz;
        movementConfig = message.movement;
        nextResetAtMs = message.nextResetAtMs;
        isReconnecting = false;
        renderEngine.reset();
        prediction.reset();
        // Nouvelle vie : la caméra doit se recaler directement sur le nouveau point de spawn
        // (position ET zoom) au premier `state`, au lieu de traverser la carte / de dézoomer
        // progressivement depuis l'état de la vie précédente (voir `cameraInitialized`).
        cameraInitialized = false;
        setMapSizeState(message.mapSize);
        isDeadNow = false;
        setDeathState(DEFAULT_DEATH_STATE);
        if (statNicknameRef.current) statNicknameRef.current.textContent = nickname;

        // Filet de sécurité : `doRespawn`/le bouton "Rejouer" ont déjà relancé la musique de
        // façon synchrone au geste utilisateur (voir `musicUrlForMod`) — cet appel est un no-op
        // dans ce cas (même URL déjà en lecture, voir le garde en tête de `playMusic`). Reste
        // nécessaire pour le tout premier `join` (aucun clic "Rejouer" impliqué) et pour un
        // changement de mode forcé côté serveur.
        audioManager.playMusic(musicUrlForMod(message.modId, roomIdOrInviteCode));
      } else if (message.type === 'player') {
        nicknames.set(message.playerId, message.nickname);
        if (message.color) colors.set(message.playerId, message.color);
      } else if (message.type === 'state') {
        // Premier `state` reçu pour cette vie = le blob est réellement synchronisé avec le monde
        // (voir le commentaire de `connecting`) — éteint l'écran de connexion (après son délai
        // minimum). No-op à chaque `state` suivant (voir le garde `connectingOverlayHidden`).
        hideConnectingOverlaySoon();
        previousSnapshot = latestSnapshot;
        latestSnapshot = message.entities;
        latestSnapshotAt = performance.now();
        if (selfPlayerId && !cameraInitialized) {
          const own = ownAggregate(message.entities, selfPlayerId);
          if (own) {
            // Calage DIRECT (jamais un lissage) sur la position ET le zoom cible — voir
            // `cameraInitialized`. Le zoom est calculé par la même et unique formule que le
            // régime permanent (`computeScaleForMass`, via `computeCamera` dans `frameBody`) : ce
            // qui est posé ici est donc exactement la valeur vers laquelle le lissage aurait
            // convergé, simplement atteinte à la première image au lieu de ~200-300ms plus tard.
            latestCamera = { x: own.x, y: own.y, scale: computeScaleForMass(own.mass) };
            cameraInitialized = true;
          }
        }
        if (selfPlayerId && movementConfig) {
          // Latence aller simple estimée, lissée + marge de sécurité (voir `smoothedLatencyMs`) —
          // détermine depuis quel instant rejouer l'historique d'inputs local lors de la
          // réconciliation (voir prediction.ts).
          const estimatedLatencyMs = smoothedLatencyMs;
          // Vélocité autoritaire par morceau (voir protocol.ts `self.pieces`) — permet à
          // `reconcile()` de ré-ancrer `predicted.velocity` avant de rejouer l'historique, au lieu
          // de repartir de la vélocité déjà avancée en direct (voir prediction.ts).
          const authoritativeVelocities = message.self?.pieces
            ? new Map(message.self.pieces.map((p) => [p.id, { x: p.vx, y: p.vy }]))
            : undefined;
          prediction.reconcile(
            message.entities,
            selfPlayerId,
            movementConfig,
            estimatedLatencyMs,
            serverTickRateHz,
            authoritativeVelocities,
          );
        }
        renderEngine.pushSnapshot(
          message.entities,
          message.tick,
          serverTickRateHz,
          message.entitiesFull,
        );
        serverTpsCurrent = tickRateTracker.record(latestSnapshotAt);
        if (message.leaderboard) {
          setLeaderboard(
            message.leaderboard.map((entry) => ({ ...entry, isSelf: entry.playerId === selfPlayerId })),
          );
        }
        if (message.self?.dash !== undefined) {
          setDashInfo(message.self.dash);
          currentCanDash = message.self.dash.canDash;
        }
        const comboLevel = message.self?.combo?.level;
        if (comboLevel !== undefined && comboLevel !== lastComboLevel) {
          showComboBanner(comboLevel);
        }
        lastComboLevel = comboLevel;
      } else if (message.type === 'died') {
        // Éteint IMMÉDIATEMENT l'écran de connexion, sans attendre son délai minimum de 2s (voir
        // `hideConnectingOverlaySoon`) — une mort confirme sans ambiguïté que le blob a bien été
        // synchronisé avec le monde, rien à masquer de plus. Sans ça, mourir vite (fréquent contre
        // des bots agressifs en Hardcore, souvent en moins d'une seconde) laissait l'écran de mort
        // exister dans le DOM mais rester VISUELLEMENT CACHÉ derrière l'écran de connexion — encore
        // au-dessus (`z-index` 300 contre 100) — jusqu'à l'expiration de ce délai minimum : le
        // joueur restait bloqué à regarder les 3 points sans rien comprendre pendant jusqu'à 2
        // secondes avant que l'écran de mort n'apparaisse enfin (retour utilisateur : "le problème
        // de l'écran persiste").
        connectingOverlayHidden = true;
        setConnecting(false);
        audioManager.stopMusic();
        justDied = true;
        isDeadNow = true;
        // Score/XP d'invité en attente de compte (demande utilisateur : proposer de créer un
        // compte pour sauvegarder son score en fin de partie) — persisté en `localStorage` pour
        // survivre à la navigation vers /compte (voir AccountPage.tsx, qui le réclame après une
        // inscription/connexion réussie). Le serveur n'inclut `claimId` QUE pour un invité avec un
        // score/XP non nul à sauvegarder (voir DiedMessage.claimId, protocol.ts) : rien à faire ici
        // pour un joueur déjà connecté (déjà crédité directement côté serveur) ou sans score.
        if (message.claimId) savePendingScoreClaim(message.claimId);
        setDeathState({
          isDead: true,
          finalScore: message.finalScore,
          survivalTimeSec: message.survivalTimeSec,
          xpEarned: message.xpEarned,
          killerNickname: message.killerNickname,
          customCard: message.customCard ?? { bannerId: '', message: DEFAULT_DEATH_MESSAGE },
          claimId: message.claimId,
        });
        setTimeout(() => {
          justDied = false;
        }, 1500);
      } else if (message.type === 'pong') {
        lastPingMs = performance.now() - message.t;
        const oneWayMs = lastPingMs / 2 + LATENCY_SAFETY_MARGIN_MS;
        smoothedLatencyMs =
          smoothedLatencyMs === undefined
            ? oneWayMs
            : smoothedLatencyMs + (oneWayMs - smoothedLatencyMs) * LATENCY_EMA_ALPHA;
        // Rapporté au serveur pour affichage dans l'interface admin ("Salons & Écrans") — le
        // client est seul à mesurer sa propre latence (voir ClientLatencyMessage).
        connection.send({ type: 'latency', ms: Math.round(lastPingMs) });
      } else if (message.type === 'announcement') {
        showAnnouncement(message.text, message.color, message.durationMs);
      } else if (message.type === 'forceRoomChange') {
        onForceRoomChangeRef.current?.(message.roomId);
      }
    });

    // Mesure la latence dès l'OUVERTURE du socket — le plus tôt possible, sans attendre le
    // `welcome` du serveur : l'aller-retour de ce `ping` se superpose alors à celui du `join`
    // (envoyés dans la même salve, voir `GameConnection.onOpen`) au lieu de s'y ajouter en série.
    // La réconciliation (prediction.ts) travaille sinon sur `DEFAULT_LATENCY_MS` — une latence
    // SUPPOSÉE, généralement fausse — pendant toute cette fenêtre, et la première correction
    // qu'elle applique une fois la vraie valeur connue est d'autant plus visible qu'elle survient
    // juste après l'entrée en partie.
    connection.onOpen(() => {
      connection.send({ type: 'ping', t: performance.now() });
    });

    connection.onReconnecting(() => {
      isReconnecting = true;
    });

    let closedByUs = false;
    connection.onClose((event) => {
      if (closedByUs) return;
      if (event.code === WS_CLOSE_NICKNAME_TAKEN) {
        onExitRef.current('Ce pseudo est déjà utilisé sur ce salon — choisis-en un autre.');
        return;
      }
      if (event.code === WS_CLOSE_ROOM_FULL) {
        onExitRef.current('Ce salon est complet.');
        return;
      }
      if (event.code === WS_CLOSE_ROOM_EXPIRED) {
        onExitRef.current('Ce salon a été fermé (durée écoulée).');
        return;
      }
      const wasMidGame = selfPlayerId !== undefined;
      onExitRef.current(
        wasMidGame
          ? 'Connexion au serveur perdue — reconnectez-vous.'
          : 'Salon introuvable ou code invalide.',
      );
    });

    connection.send(guestSkin ? { type: 'join', nickname, skin: guestSkin } : { type: 'join', nickname });
    // Cadence dynamique (au lieu d'un intervalle fixe indépendant du tick serveur) : se recale
    // sur `serverTickRateHz` dès que `welcome` est connu, pour ne pas battre avec le vrai tick du
    // salon.
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleInput(): void {
      const intervalMs = serverTickRateHz ? 1000 / serverTickRateHz : DEFAULT_INPUT_INTERVAL_MS;
      inputTimer = setTimeout(() => {
        if (selfPlayerId) {
          // Référence de conversion écran->monde : la position prédite locale, pas la caméra
          // (lissée/en retard) — voir `LocalPrediction.getOwnPosition`.
          const ownPosition = prediction.getOwnPosition() ?? latestCamera;
          const { target, intensity } = input.getTarget({ ...latestCamera, ...ownPosition });
          connection.send({
            type: 'input',
            target,
            intensity,
            split: input.consumeSplit(),
            dash: currentModId === 'hardcore' ? input.consumeDash() : (input.consumeDash(), false),
            eject: input.consumeEject(),
          });
        }
        scheduleInput();
      }, intervalMs);
    }
    scheduleInput();

    const pingInterval = setInterval(() => {
      connection.send({ type: 'ping', t: performance.now() });
    }, PING_INTERVAL_MS);

    const fpsTracker = createFpsTracker();
    const tickRateTracker = createTickRateTracker();
    let serverTpsCurrent = 0;
    const systemInfo = detectSystemInfo();
    let gpuInfo: GpuInfo | undefined;
    let networkInfo: NetworkInfo | undefined;
    let batteryInfo: BatteryInfo | undefined;
    let debugVisible = false;

    const minFrameIntervalMs = computeMinFrameIntervalMs(loadVsyncEnabled(), loadFpsSliderIndex());
    // `undefined` = pas de plafond logiciel (Vsync ou palier "Illimité") : impossible de connaître
    // le taux de rafraîchissement réel de l'écran depuis le JS, donc rien à afficher comme cible
    // chiffrée dans ce cas (voir debugOverlay.ts, RenderStats.targetHz).
    const targetHz =
      minFrameIntervalMs > 0 ? Math.round(1000 / minFrameIntervalMs) : undefined;
    let lastFrameAt = 0;
    function doRespawn(): void {
      setDeathState(DEFAULT_DEATH_STATE);
      // Relance la musique ICI, synchrone au geste utilisateur (touche Espace/bouton manette),
      // plutôt que d'attendre le `welcome` qui suivra (round-trip réseau) — voir le commentaire
      // de `musicUrlForMod`/`modIdRef`.
      audioManager.playMusic(musicUrlForMod(modIdRef.current, roomIdOrInviteCode));
      // Force une reconnexion immédiate si le socket est dans la fenêtre de backoff entre deux
      // tentatives automatiques (voir GameConnection.handleClose/RECONNECT_DELAYS_MS, net.ts) —
      // sans ça, un `join` cliqué pendant cette fenêtre (micro-coupure réseau juste après la mort,
      // par exemple) est silencieusement perdu (`send()` sur un socket CLOSED/CLOSING) et le
      // joueur reste bloqué jusqu'à 4.8s sur un écran de mort déjà masqué (`setDeathState` ci-
      // dessus) sans statistiques ni blob — un "écran blanc" perçu comme figé (retour
      // utilisateur : "après Rejouer, pas de stats, page blanche coincée"). No-op si déjà
      // ouvert/en cours d'ouverture (voir `ensureConnected`).
      connection.ensureConnected();
      connection.send({ type: 'join', nickname });
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === ' ' || event.code === 'Space') {
        if (isDeadNow && !justDied) {
          event.preventDefault();
          doRespawn();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowQuitConfirm((prev) => !prev);
        return;
      }
      if (event.key !== 'F3') return;
      event.preventDefault();
      debugVisible = !debugVisible;
      if (debugOverlayRef.current) {
        debugOverlayRef.current.style.display = debugVisible ? 'block' : 'none';
      }
      debugOverlayRef.current?.classList.toggle('visible', debugVisible);
      if (debugVisible) {
        gpuInfo ??= detectGpuInfo();
        networkInfo = detectNetworkInfo();
        if (!batteryInfo) void detectBatteryInfo().then((info) => (batteryInfo = info));
      }
    }
    window.addEventListener('keydown', onKeyDown);

    let rafId = 0;
    let gamepadRespawnWasPressed = false;

    function frame(): void {
      const now = performance.now();

      if (isDeadNow && !justDied) {
        const pad = navigator.getGamepads?.().find((p) => p !== null);
        const anyButtonPressed = pad?.buttons.some((b) => b.pressed) ?? false;
        if (anyButtonPressed) {
          if (!gamepadRespawnWasPressed) {
            gamepadRespawnWasPressed = true;
            doRespawn();
          }
        } else {
          gamepadRespawnWasPressed = false;
        }
      }
      // Le pipeline de rendu (culling viewport, nourriture groupée en Path2D, sprites de skin
      // pré-détourés en cache) est assez léger pour tourner à la cadence normale même pendant
      // l'écran de mort — l'ancien plafond dédié à 10 FPS (`DEAD_FRAME_INTERVAL_MS`) créait une
      // saccade perceptible à chaque mort sans bénéfice mesurable, voir son ancien commentaire
      // ("aucun recalcul canvas/WebGL lourd" — vrai aujourd'hui même sans ce plafond).
      if (now - lastFrameAt < minFrameIntervalMs) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const frameDt = Math.min(50, lastFrameAt > 0 ? now - lastFrameAt : 16);
      lastFrameAt = now;

      // Filet de sécurité (retour utilisateur : "écran blanc, parfois la page crash et n'affiche
      // plus le jeu") : `requestAnimationFrame` n'a AUCUN mécanisme de rattrapage intégré — une
      // exception non interceptée n'importe où dans le corps de `frame()` (donnée serveur
      // inattendue, cas limite de rendu...) interrompt silencieusement la chaîne de rappels, sans
      // jamais planter l'onglet ni afficher la moindre erreur : plus aucun `requestAnimationFrame`
      // n'est reprogrammé, le canvas reste figé sur sa dernière frame dessinée (ou blanc si
      // l'exception survenait avant le tout premier dessin). `ErrorBoundary.tsx` ne couvre QUE les
      // exceptions levées pendant le rendu React — jamais celles-ci, qui se produisent dans une
      // boucle impérative hors de l'arbre React. Le `try`/`catch` ci-dessous ne change rien au cas
      // normal (aucun coût, aucune différence de comportement) ; il garantit seulement qu'une
      // exception ponctuelle ne tue plus JAMAIS la boucle de jeu : la frame fautive est perdue,
      // journalisée, et la suivante reprend normalement au prochain rappel.
      try {
        frameBody(now, frameDt);
      } catch (error) {
        console.error('[GameView] frame() a levé une exception — frame ignorée, boucle relancée.', error);
      }
      rafId = requestAnimationFrame(frame);
    }

    function frameBody(now: number, frameDt: number): void {
      const logicStart = performance.now();

      // Prédiction locale : avance le(s) morceau(x) du joueur avec la même formule que le
      // serveur, à partir de l'input LIVE de cette frame — réagit donc au curseur sans attendre
      // l'aller-retour réseau. Inactif tant que `welcome` n'est pas encore arrivé (`movementConfig`
      // inconnu) ou hors partie (`selfPlayerId` inconnu) : le blob suit alors simplement le
      // pipeline serveur habituel.
      if (movementConfig && selfPlayerId) {
        // Référence de conversion écran->monde : la position prédite locale, pas la caméra
        // (lissée/en retard) — voir `LocalPrediction.getOwnPosition`.
        const ownPosition = prediction.getOwnPosition() ?? latestCamera;
        const { target, intensity } = input.getTarget({ ...latestCamera, ...ownPosition });
        prediction.step(frameDt / 1000, target, intensity, movementConfig);
      }

      let entities = renderEngine.getInterpolatedEntities(
        frameDt,
        latestCamera,
        canvas!.clientWidth,
        canvas!.clientHeight,
        selfPlayerId,
        false,
      );
      if (selfPlayerId) entities = prediction.applyTo(entities, selfPlayerId);

      // `targetCamera.scale` (voir computeCamera, render.ts) est la SEULE formule de zoom par
      // masse — pas de duplication locale avec des bornes MIN_SCALE/MAX_SCALE recopiées à la
      // main : une telle copie était restée figée à l'ancienne valeur de MAX_SCALE lors du réglage
      // du dézoom de base (demande utilisateur, task #7) alors que `computeCamera` avait bien été
      // mis à jour — la caméra effectivement affichée ne suivait donc PAS le nouveau réglage tant
      // que cette duplication existait.
      const targetCamera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });

      dashZoomBonus += (0 - dashZoomBonus) * (1 - Math.exp(-8 * (frameDt / 1000)));
      const zoomMultiplier = 1 + dashZoomBonus;
      const targetScale = targetCamera.scale * zoomMultiplier;

      // Suivi de caméra ultra-fluide et indépendant du framerate :
      // - cameraPosLerp (k = 30) : suit le joueur immédiatement tout en absorbant les téléportations
      //   brutales du centre de masse lors des splits et dashes.
      // - cameraScaleLerp (k = 12) : ajuste le zoom lors de la prise de masse (manger) en ~150ms
      //   sans micro-freeze ni à-coup.
      const cameraScaleLerp = 1 - Math.exp(-18 * (frameDt / 1000));
      const cameraPosLerp = 1 - Math.exp(-60 * (frameDt / 1000));
      latestCamera = {
        x: latestCamera.x + (targetCamera.x - latestCamera.x) * cameraPosLerp,
        y: latestCamera.y + (targetCamera.y - latestCamera.y) * cameraPosLerp,
        scale: latestCamera.scale + (targetScale - latestCamera.scale) * cameraScaleLerp,
      };
      // L'effet de "dash" au split est un pur transform CSS sur le canvas (voir attachInput
      // plus haut et styles.css `#game.split-punch`) — jamais mélangé à cette caméra LOGIQUE, qui
      // reste le seul repère utilisé par le rendu ET par la conversion écran->monde (input.ts).
      const camera = latestCamera;
      const logicStepMs = performance.now() - logicStart;

      const drawStart = performance.now();
      const renderInfo = renderFrame(ctx!, canvas!, entities, camera, nicknames, colors, selfPlayerId);
      const drawTimeMs = performance.now() - drawStart;
      // Purge définitive des pastilles mangées ce cadre (voir renderEngine.ts `forgetFood`) —
      // sans ça, le filtrage visuel de `renderFrame` ne les masque que le temps que le blob reste
      // dessus, elles réapparaissent dès qu'il s'en éloigne (correctif "pastille mangée qui met
      // plusieurs secondes à disparaître").
      if (renderInfo.eatenFood.length > 0) {
        const forgotten = renderEngine.forgetFood(renderInfo.eatenFood.map((food) => food.id));
        // Crédit optimiste de la masse au morceau qui vient de la recouvrir (voir
        // `LocalPrediction.addPredictedMass`) : la pastille disparaissait déjà instantanément,
        // mais le blob ne grossissait qu'au `state` suivant — le décalage perçu comme "manger
        // n'est pas instantané". Restreint aux ids RÉELLEMENT oubliés à l'instant (voir la valeur
        // de retour de `forgetFood`) : la même pastille reste signalée mangée pendant la dizaine
        // de frames que les snapshots déjà en file mettent à s'écouler, et la créditer à chaque
        // fois gonflerait la masse prédite d'un ordre de grandeur.
        if (forgotten.length > 0) {
          const forgottenIds = new Set(forgotten);
          for (const food of renderInfo.eatenFood) {
            if (forgottenIds.has(food.id)) prediction.addPredictedMass(food.eaterId, food.mass);
          }
        }
      }

      if (hudRef.current) {
        const status = isReconnecting
          ? 'Connexion interrompue — reconnexion en cours…'
          : justDied
            ? 'Vous êtes mort — respawn en cours…'
            : '';
        hudRef.current.textContent = [
          status,
          inviteCodeToShow && `Code d'invitation : ${inviteCodeToShow}`,
        ]
          .filter(Boolean)
          .join(' — ');
      }

      const own = ownAggregate(latestSnapshot, selfPlayerId);
      const currentPos = own ? { x: own.x, y: own.y } : { x: camera.x, y: camera.y };
      if (now - lastMinimapUpdateAt > 100) {
        lastMinimapUpdateAt = now;
        setPlayerPos(currentPos);
        setPlayerMass(own?.mass);
      }

      if (statMassRef.current) {
        statMassRef.current.textContent = own ? Math.round(own.mass).toString() : '—';
      }
      if (resetTimerRef.current) {
        resetTimerRef.current.textContent = formatCountdown(nextResetAtMs, Date.now());
      }
      const previousOwn = ownAggregate(previousSnapshot ?? [], selfPlayerId);
      const stateIntervalSec = serverTickRateHz ? 1 / serverTickRateHz : SERVER_STATE_INTERVAL_MS / 1000;
      const speed =
        own && previousOwn ? speedBetween(previousOwn, own, stateIntervalSec) : undefined;
      if (statSpeedRef.current) {
        statSpeedRef.current.textContent =
          speed !== undefined ? `${(speed * MAP_UNITS_TO_METERS).toFixed(1)} m/s` : '—';
      }

      let playersCount = 0;
      let foodCount = 0;
      for (const entity of latestSnapshot) {
        if (entity.k === 'c' || entity.p !== undefined) playersCount++;
        else foodCount++;
      }

      const fps = fpsTracker.tick(now);
      if (debugVisible && debugOverlayRef.current) {
        debugOverlayRef.current.textContent = formatDebugText({
          fps,
          pingMs: lastPingMs,
          visibleEntities: entities.length,
          totalEntities: latestSnapshot.length,
          roomId: roomIdOrInviteCode,
          cameraScale: camera.scale,
          gpu: gpuInfo,
          network: networkInfo,
          memory: detectMemoryInfo(),
          system: systemInfo,
          render: {
            drawTimeMs,
            drawCalls: renderInfo.drawCalls,
            batches: renderInfo.batches,
            visibleEntities: entities.length,
            totalEntities: latestSnapshot.length,
            viewportWidth: canvas!.width,
            viewportHeight: canvas!.height,
            cameraScale: camera.scale,
            dpiRatio: window.devicePixelRatio,
            targetHz,
          },
          simulation: {
            logicStepMs,
            playersCount,
            foodCount,
            localX: currentPos.x,
            localY: currentPos.y,
            gridSector: calculateGridSector(currentPos.x, currentPos.y, mapSize),
          },
          networkSync: {
            rttMs: lastPingMs,
            serverTpsCurrent,
            serverTpsTarget: serverTickRateHz,
            netInKbps: connection.netInKbps,
            netInPktSec: connection.netInPktSec,
            netOutKbps: connection.netOutKbps,
            interpBufferMs: Math.round(renderEngine.currentInterpDelayMs),
            // Vraie profondeur du buffer d'interpolation (pas un booléen déguisé, voir
            // renderEngine.ts `snapshotQueue`) — corrigé pour que ce champ F3 soit une mesure
            // réelle comme tous les autres (retour utilisateur : vérifier qu'aucune valeur du menu
            // F3 n'est inventée).
            interpSnapshots: renderEngine.snapshotQueue.length,
            missedTicks: renderEngine.missedTickCount,
          },
          hardware: {
            cpuCores: systemInfo.hardwareConcurrency,
            batteryPercent: batteryInfo?.percent,
            batteryCharging: batteryInfo?.charging,
          },
        });
      }
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      closedByUs = true;
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      inputRef.current = null;
      input.detach();
      audioManager.stopMusic();
      if (inputTimer) clearTimeout(inputTimer);
      clearInterval(pingInterval);
      clearTimeout(connectingFallbackTimer);
      if (comboHideTimer) clearTimeout(comboHideTimer);
      cancelAnimationFrame(rafId);
      connection.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="game" />

      {/* Écran de connexion (demande utilisateur) : masque le léger lag d'arrivée en salon derrière
          un écran glassmorphism cohérent avec le reste de l'UI (même style que `.play-panel-card`
          de l'accueil), le temps que le blob soit réellement synchronisé avec le monde. */}
      {connecting && (
        <div className="connecting-overlay">
          <div className="connecting-card">
            <p className="connecting-text">
              Connexion à l'arène
              <span className="connecting-dots" aria-hidden="true">
                <span className="connecting-dot" />
                <span className="connecting-dot" />
                <span className="connecting-dot" />
              </span>
            </p>
          </div>
        </div>
      )}

      <div className="combo-banner" ref={comboBannerRef} aria-hidden="true" />
      <div className="announcement-banner" ref={announcementBannerRef} aria-hidden="true" />
      {dashInfo && (
        <div className="dash-hud-wrapper">
          <div className="dash-hud-badge">
            <span className="dash-hud-label">
              DASH <span className="dash-hud-key">{dashKeyLabel}</span>
            </span>
            <div className="dash-segments-track">
              {Array.from({ length: dashInfo.maxCharges }).map((_, i) => {
                const isFull = i < dashInfo.charges;
                const isCurrentRecharging = i === dashInfo.charges;
                const fillWidth = isFull
                  ? 100
                  : isCurrentRecharging
                    ? Math.round(dashInfo.rechargeProgress * 100)
                    : 0;
                return (
                  <div key={i} className={`dash-segment-box ${isFull ? 'full' : ''}`}>
                    {!isFull && <div className="dash-segment-fill" style={{ width: `${fillWidth}%` }} />}
                  </div>
                );
              })}
            </div>
          </div>
          {!dashInfo.canDash && dashInfo.charges === 0 && (
            <div className="dash-disabled-hint">
              Recharge en cours… ({dashInfo.rechargeTimeSec ?? 4}s/charge)
            </div>
          )}
        </div>
      )}
      <div className="game-overlay">
        <div className="stats-panel">
          <div className="stat-row">
            <span className="stat-label">Pseudo</span>
            <span className="stat-value" ref={statNicknameRef}>
              —
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Masse</span>
            <span className="stat-value" ref={statMassRef}>
              —
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Vitesse</span>
            <span className="stat-value" ref={statSpeedRef}>
              —
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Reset serveur</span>
            <span className="stat-value" ref={resetTimerRef}>
              —
            </span>
          </div>
        </div>
        <button type="button" className="hud-quit-button" onClick={() => setShowQuitConfirm(true)}>
          Quitter
        </button>
        <div className="hud-status" ref={hudRef} />
      </div>

      {showQuitConfirm && (
        <div className="death-overlay" style={{ zIndex: 200 }}>
          <div className="death-modal">
            <h2>Quitter la partie ?</h2>
            <p className="death-killer">Voulez-vous vraiment abandonner la partie en cours ?</p>
            <div className="death-actions" style={{ flexDirection: 'row', justifyContent: 'center' }}>
              <button className="btn-secondary-action" type="button" onClick={() => setShowQuitConfirm(false)}>
                Annuler
              </button>
              <button className="btn-primary-action" type="button" onClick={() => onExit()}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Top 10 Live Leaderboard */}
      <div className="leaderboard-overlay">
        <div className="leaderboard-header">CLASSEMENT (TOP 10)</div>
        <div className="leaderboard-list">
          {leaderboard.length === 0 ? (
            <div className="leaderboard-row">— En attente —</div>
          ) : (
            leaderboard.map((entry) => (
              <div
                key={`${entry.rank}-${entry.nickname}`}
                className={`leaderboard-row ${entry.isSelf ? 'is-self' : ''}`}
              >
                <span className="leaderboard-rank">#{entry.rank}</span>
                <span className="leaderboard-nickname">{entry.nickname}</span>
                <span className="leaderboard-score">{entry.score}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Écran de mort personnalisé (cahier des charges fourni) */}
      {deathState.isDead && (
        <div className="death-overlay">
          <div className="death-modal">
            <h2>Fin de partie</h2>
            {deathState.killerNickname && (
              <p className="death-killer">
                Éliminé par : <strong>{deathState.killerNickname}</strong>
              </p>
            )}

            <div
              className="death-banner"
              style={{
                background: isCustomImageBanner(deathState.customCard?.bannerId ?? '')
                  ? `url("${deathState.customCard?.bannerId}") center/cover no-repeat`
                  : 'linear-gradient(135deg, rgba(30, 32, 34, 0.95), rgba(20, 22, 24, 0.95))',
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid var(--border-strong)',
              }}
            >
              {isCustomImageBanner(deathState.customCard?.bannerId ?? '') && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)' }} />
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <p className="death-banner-message">"{deathState.customCard?.message || DEFAULT_DEATH_MESSAGE}"</p>
              </div>
            </div>

            <div className="death-stats-grid">
              <div className="death-stat-cell">
                <span className="death-stat-label">Masse finale</span>
                <span className="death-stat-value">{deathState.finalScore}</span>
              </div>
              <div className="death-stat-cell">
                <span className="death-stat-label">Temps de survie</span>
                <span className="death-stat-value">
                  {formatSurvivalTime(deathState.survivalTimeSec)}
                </span>
              </div>
              <div className="death-stat-cell">
                <span className="death-stat-label">XP gagnée</span>
                <span className="death-stat-value">+{Math.round(deathState.xpEarned)}</span>
              </div>
            </div>

            {/* Invité avec un score à sauvegarder (demande utilisateur) — `claimId` n'est présent
                que dans ce cas précis (voir DiedMessage.claimId, protocol.ts) : jamais affiché à
                un joueur déjà connecté (déjà crédité), ni à un invité sans score/XP gagné. */}
            {deathState.claimId && (
              <div className="death-save-score-cta">
                <p>Crée un compte pour enregistrer ce score et ton XP !</p>
                <button
                  className="btn-primary-action"
                  type="button"
                  onClick={() => {
                    navigate('/compte');
                    onExit();
                  }}
                >
                  Créer un compte / Se connecter
                </button>
              </div>
            )}

            <div className="death-actions">
              <button
                className="btn-primary-action"
                type="button"
                onClick={() => {
                  setDeathState(DEFAULT_DEATH_STATE);
                  // Voir `doRespawn`/`musicUrlForMod` dans l'effet ci-dessus : relance synchrone
                  // au clic plutôt que d'attendre le `welcome` réseau.
                  audioManager.playMusic(musicUrlForMod(modIdRef.current, roomIdOrInviteCode));
                  // Voir le commentaire de `doRespawn` (même effet, dupliqué ici car cette JSX
                  // n'a pas accès aux fonctions de l'effet) : force une reconnexion immédiate si
                  // le socket est en fenêtre de backoff, pour ne jamais perdre silencieusement ce
                  // `join`.
                  connectionRef.current?.ensureConnected();
                  connectionRef.current?.send({ type: 'join', nickname });
                }}
              >
                Rejouer (Espace / Manette)
              </button>
              <button className="btn-secondary-action" type="button" onClick={() => onExit()}>
                Menu Principal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minimap (quadrillage 3x3 : 1-3 horizontal, A-C vertical) */}
      <Minimap position={playerPos} playerMass={playerMass} mapSize={mapSizeState} />

      {/* Joystick virtuel + bouton d'action tactile (demande utilisateur, mobile) — masqué en CSS
          hors appareil à pointeur "grossier" (`(pointer: coarse)`, voir styles.css). */}
      <VirtualControls inputRef={inputRef} hasDash={dashInfo !== undefined} />

      <pre className="debug-overlay" ref={debugOverlayRef} />

      {/* Repli visuel "Tournez votre appareil" (demande utilisateur : jeu verrouillé en paysage
          sur téléphone) — invisible par défaut, affiché en CSS uniquement en portrait sur
          pointeur tactile (voir styles.css `.rotate-device-hint`). Couvre le cas Safari iOS, qui
          ne supporte ni le plein écran d'élément arbitraire ni le verrouillage d'orientation
          (voir mobileScreen.ts) : le verrouillage programmatique ne fonctionne alors pas, mais ce
          message invite quand même l'utilisateur à tourner son téléphone lui-même. */}
      <div className="rotate-device-hint" aria-hidden="true">
        <span className="material-symbols-outlined rotate-device-icon">screen_rotation</span>
        <p>Tourne ton téléphone pour jouer en mode paysage</p>
      </div>
    </>
  );
}

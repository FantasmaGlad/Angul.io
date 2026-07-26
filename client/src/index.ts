import type { EntitySnapshot, ServerMessage } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import {
  clearSession,
  fetchProfile,
  loadSession,
  login,
  register,
  saveSession,
  type AuthResult,
} from './auth.js';
import {
  createFpsTracker,
  detectGpuInfo,
  detectMemoryInfo,
  detectNetworkInfo,
  detectSystemInfo,
  formatDebugText,
  type GpuInfo,
  type NetworkInfo,
} from './debugOverlay.js';
import { attachInput } from './input.js';
import { createRoom, fetchAvailableModes, fetchPublicRooms, type RoomSummary } from './lobby.js';
import { GameConnection } from './net.js';
import { computeCamera, interpolateEntities, renderFrame } from './render.js';
import { ownAggregate, speedBetween } from './stats.js';

const INPUT_SEND_INTERVAL_MS = 50; // aligné sur le tick serveur par défaut (20 Hz)
/** Intervalle attendu entre deux messages `state` (20 Hz par défaut, voir Room/index.ts côté
 * serveur) — sert de base à l'interpolation d'affichage (render.ts, `interpolateEntities`) et
 * à la dérivation de la vitesse (stats.ts, `speedBetween`) : sans elle, le rendu reste figé
 * pendant 50 ms puis saute d'un coup à la position suivante, perceptible comme du "lag" même à
 * un framerate d'affichage élevé (60/120 Hz). */
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D non supporté par ce navigateur.');

const gameOverlay = document.getElementById('gameOverlay') as HTMLDivElement;
const hud = document.getElementById('hud') as HTMLDivElement;
const statNickname = document.getElementById('statNickname') as HTMLSpanElement;
const statMass = document.getElementById('statMass') as HTMLSpanElement;
const statSpeed = document.getElementById('statSpeed') as HTMLSpanElement;
const statAccel = document.getElementById('statAccel') as HTMLSpanElement;
const debugOverlay = document.getElementById('debugOverlay') as HTMLPreElement;
const lobbyOverlay = document.getElementById('lobbyOverlay') as HTMLDivElement;
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
const roomList = document.getElementById('roomList') as HTMLUListElement;
const refreshRoomsButton = document.getElementById('refreshRoomsButton') as HTMLButtonElement;
const roomNameInput = document.getElementById('roomNameInput') as HTMLInputElement;
const roomModeSelect = document.getElementById('roomModeSelect') as HTMLSelectElement;
const roomPrivateCheckbox = document.getElementById('roomPrivateCheckbox') as HTMLInputElement;
const createRoomButton = document.getElementById('createRoomButton') as HTMLButtonElement;
const joinCodeInput = document.getElementById('joinCodeInput') as HTMLInputElement;
const joinCodeButton = document.getElementById('joinCodeButton') as HTMLButtonElement;
const lobbyError = document.getElementById('lobbyError') as HTMLParagraphElement;

// --- Compte joueur (Lot 3.2/3.3/3.6) ---
const accountToggleModeButton = document.getElementById(
  'accountToggleModeButton',
) as HTMLButtonElement;
const accountForm = document.getElementById('accountForm') as HTMLDivElement;
const accountPseudoInput = document.getElementById('accountPseudoInput') as HTMLInputElement;
const accountPasswordInput = document.getElementById('accountPasswordInput') as HTMLInputElement;
const accountSubmitButton = document.getElementById('accountSubmitButton') as HTMLButtonElement;
const accountLoggedIn = document.getElementById('accountLoggedIn') as HTMLDivElement;
const accountLoggedInPseudo = document.getElementById('accountLoggedInPseudo') as HTMLElement;
const viewProfileButton = document.getElementById('viewProfileButton') as HTMLButtonElement;
const logoutButton = document.getElementById('logoutButton') as HTMLButtonElement;
const accountError = document.getElementById('accountError') as HTMLParagraphElement;
const profileOverlay = document.getElementById('profileOverlay') as HTMLDivElement;
const profilePseudo = document.getElementById('profilePseudo') as HTMLParagraphElement;
const profileLevel = document.getElementById('profileLevel') as HTMLSpanElement;
const profileXp = document.getElementById('profileXp') as HTMLSpanElement;
const profilePremium = document.getElementById('profilePremium') as HTMLSpanElement;
const profileCosmetics = document.getElementById('profileCosmetics') as HTMLSpanElement;
const profileBestScores = document.getElementById('profileBestScores') as HTMLUListElement;
const closeProfileButton = document.getElementById('closeProfileButton') as HTMLButtonElement;

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

/** Les deux derniers snapshots reçus du serveur (voir `SERVER_STATE_INTERVAL_MS`) — jamais
 * rendus directement, seulement interpolés entre eux (render.ts, `interpolateEntities`), mais
 * aussi utilisés bruts pour dériver la vitesse réelle (stats.ts, `speedBetween`). */
let previousSnapshot: EntitySnapshot[] | undefined;
let latestSnapshot: EntitySnapshot[] = [];
let latestSnapshotAt = performance.now();
let selfPlayerId: string | undefined;
let selfNickname = '';
let selfAccelerationPerSec2: number | undefined;
let mapSize = 4000;
let justDied = false;
/** Code d'invitation du salon en cours, si privé (Lot 2.3) — affiché dans le HUD pendant la
 * partie pour que le créateur puisse le partager, puisque le lobby (où il est aussi montré à
 * la création) disparaît dès l'entrée en jeu. */
let currentInviteCode: string | undefined;
let currentRoomKey: string | undefined;
let inputInterval: ReturnType<typeof setInterval> | undefined;
let pingInterval: ReturnType<typeof setInterval> | undefined;
let lastPingMs: number | undefined;
/** Pseudo par id de joueur, appris via les messages `player` (envoyés une fois par joueur,
 * pas répétés sur chaque entité à chaque tick — voir plan Lot 1.8, bande passante). */
const nicknames = new Map<string, string>();
const input = attachInput(canvas);

function resetGameState(): void {
  previousSnapshot = undefined;
  latestSnapshot = [];
  latestSnapshotAt = performance.now();
  selfPlayerId = undefined;
  selfNickname = '';
  selfAccelerationPerSec2 = undefined;
  mapSize = 4000;
  justDied = false;
  currentInviteCode = undefined;
  currentRoomKey = undefined;
  lastPingMs = undefined;
  nicknames.clear();
  if (inputInterval !== undefined) clearInterval(inputInterval);
  inputInterval = undefined;
  if (pingInterval !== undefined) clearInterval(pingInterval);
  pingInterval = undefined;
}

// --- Lobby (Lot 2.2/2.3) : choisir, créer ou rejoindre par code un salon avant la partie ---

function renderRoomList(rooms: RoomSummary[]): void {
  roomList.innerHTML = '';
  if (rooms.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'Aucun salon public pour le moment — créez-en un ci-dessous.';
    roomList.appendChild(empty);
    return;
  }
  for (const room of rooms) {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${room.name} (${room.modId}) — ${room.playerCount} joueur(s)`;
    const joinButton = document.createElement('button');
    joinButton.textContent = 'Rejoindre';
    joinButton.addEventListener('click', () => enterGame(room.id));
    item.append(label, joinButton);
    roomList.appendChild(item);
  }
}

async function refreshLobby(): Promise<void> {
  try {
    const [rooms, modes] = await Promise.all([fetchPublicRooms(), fetchAvailableModes()]);
    renderRoomList(rooms);
    const previousMode = roomModeSelect.value;
    roomModeSelect.innerHTML = '';
    for (const modeId of modes) {
      const option = document.createElement('option');
      option.value = modeId;
      option.textContent = modeId;
      roomModeSelect.appendChild(option);
    }
    if (modes.includes(previousMode)) roomModeSelect.value = previousMode;
  } catch {
    lobbyError.textContent = 'Impossible de contacter le serveur pour lister les salons.';
  }
}

refreshRoomsButton.addEventListener('click', () => void refreshLobby());
void refreshLobby();

createRoomButton.addEventListener('click', () => {
  void (async () => {
    const name = roomNameInput.value.trim();
    if (!name) {
      lobbyError.textContent = 'Le nom du salon est requis.';
      return;
    }
    try {
      const visibility = roomPrivateCheckbox.checked ? 'private' : 'public';
      const room = await createRoom(name, roomModeSelect.value, visibility);
      // Un salon privé ne se rejoint jamais par son id brut (voir roomManager.ts) : seul le
      // code d'invitation y donne accès, y compris pour son propre créateur.
      enterGame(room.inviteCode ?? room.id, room.inviteCode);
    } catch (error) {
      lobbyError.textContent = (error as Error).message;
    }
  })();
});

joinCodeButton.addEventListener('click', () => {
  const code = joinCodeInput.value.trim();
  if (!code) {
    lobbyError.textContent = "Le code d'invitation est requis.";
    return;
  }
  enterGame(code);
});

// --- Compte joueur (Lot 3.2/3.3/3.6) --------------------------------------------------------
// Entièrement optionnel — une partie en invité (juste le champ "Pseudo" au-dessus) reste
// possible à tout moment, connecté ou non (voir net/server.ts, `?token=` absent/invalide).

let authSession: AuthResult | undefined = loadSession();
let authMode: 'login' | 'register' = 'login';

function renderAccountUI(): void {
  const loggedIn = authSession !== undefined;
  accountForm.style.display = loggedIn ? 'none' : 'block';
  accountLoggedIn.style.display = loggedIn ? 'block' : 'none';
  if (loggedIn) {
    accountLoggedInPseudo.textContent = authSession!.pseudo;
    // Le pseudo affiché en jeu (HUD) suit celui du compte par défaut — reste modifiable
    // librement, l'attribution des stats se fait via le token, pas via ce champ.
    if (!nicknameInput.value) nicknameInput.value = authSession!.pseudo;
  }
}

function setAuthMode(mode: 'login' | 'register'): void {
  authMode = mode;
  accountToggleModeButton.textContent = mode === 'login' ? "S'inscrire" : 'Se connecter';
  accountSubmitButton.textContent = mode === 'login' ? 'Se connecter' : "S'inscrire";
  accountError.textContent = '';
}
setAuthMode(authMode);
renderAccountUI();

accountToggleModeButton.addEventListener('click', () => {
  setAuthMode(authMode === 'login' ? 'register' : 'login');
});

accountSubmitButton.addEventListener('click', () => {
  void (async () => {
    const pseudo = accountPseudoInput.value.trim();
    const password = accountPasswordInput.value;
    accountError.textContent = '';
    try {
      authSession =
        authMode === 'login' ? await login(pseudo, password) : await register(pseudo, password);
      saveSession(authSession);
      accountPasswordInput.value = '';
      renderAccountUI();
    } catch (error) {
      accountError.textContent = (error as Error).message;
    }
  })();
});

logoutButton.addEventListener('click', () => {
  authSession = undefined;
  clearSession();
  renderAccountUI();
});

viewProfileButton.addEventListener('click', () => {
  void (async () => {
    if (!authSession) return;
    try {
      const profile = await fetchProfile(authSession.token);
      profilePseudo.textContent = profile.pseudo;
      profileLevel.textContent = profile.level.toString();
      profileXp.textContent = profile.xp.toString();
      profilePremium.textContent = profile.premium ? 'Oui' : 'Non';
      profileCosmetics.textContent =
        profile.cosmetics.length > 0 ? profile.cosmetics.join(', ') : 'Aucun';
      profileBestScores.innerHTML = '';
      if (profile.bestScores.length === 0) {
        const empty = document.createElement('li');
        empty.textContent = 'Aucune partie jouée pour le moment.';
        profileBestScores.appendChild(empty);
      } else {
        for (const bestScore of profile.bestScores) {
          const item = document.createElement('li');
          item.innerHTML = `<span>${bestScore.modeId}</span><span>${bestScore.bestScore}</span>`;
          profileBestScores.appendChild(item);
        }
      }
      profileOverlay.style.display = 'flex';
    } catch (error) {
      accountError.textContent = (error as Error).message;
    }
  })();
});

closeProfileButton.addEventListener('click', () => {
  profileOverlay.style.display = 'none';
});

// --- Partie -------------------------------------------------------------------------------

function enterGame(roomIdOrInviteCode: string, inviteCodeToShow?: string): void {
  resetGameState();
  currentInviteCode = inviteCodeToShow;
  currentRoomKey = roomIdOrInviteCode;

  const nickname = nicknameInput.value.trim() || 'Joueur';
  selfNickname = nickname;
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  // `&token=` (Lot 3.3) uniquement si connecté — une partie en invité omet simplement le
  // paramètre, le serveur traite ça comme "non authentifié" plutôt que comme une erreur.
  const tokenParam = authSession ? `&token=${encodeURIComponent(authSession.token)}` : '';
  const connection = new GameConnection(
    `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
  );

  connection.onMessage((message: ServerMessage) => {
    if (message.type === 'welcome') {
      selfPlayerId = message.playerId;
      mapSize = message.mapSize;
    } else if (message.type === 'player') {
      nicknames.set(message.playerId, message.nickname);
    } else if (message.type === 'state') {
      previousSnapshot = latestSnapshot;
      latestSnapshot = message.entities;
      latestSnapshotAt = performance.now();
      selfAccelerationPerSec2 = message.self?.accelerationPerSec2;
    } else if (message.type === 'died') {
      justDied = true;
      setTimeout(() => {
        justDied = false;
      }, 1500);
    } else if (message.type === 'pong') {
      lastPingMs = performance.now() - message.t;
    }
  });

  // Le serveur ferme immédiatement (code 4004) si le salon/code demandé n'existe pas — sans
  // ça, le joueur resterait bloqué sur un écran de jeu qui ne recevra jamais rien. **Pas de
  // reconnexion automatique pour le MVP** (voir GameConnection) : une coupure en cours de
  // partie (serveur redémarré, réseau perdu…) ramène donc aussi au lobby plutôt que de laisser
  // le joueur face à un dernier freeze-frame silencieux, sans indication que la connexion est
  // morte — bug rapporté par un utilisateur juste après un redémarrage serveur en cours de dev.
  connection.onClose(() => {
    const wasMidGame = selfPlayerId !== undefined;
    resetGameState();
    lobbyOverlay.style.display = 'flex';
    gameOverlay.style.display = 'none';
    debugOverlay.style.display = 'none';
    debugVisible = false;
    lobbyError.textContent = wasMidGame
      ? 'Connexion au serveur perdue — reconnectez-vous.'
      : 'Salon introuvable ou code invalide.';
    void refreshLobby();
  });

  lobbyOverlay.style.display = 'none';
  gameOverlay.style.display = 'flex';
  canvas.focus();

  connection.send({ type: 'join', nickname });
  inputInterval = setInterval(() => {
    if (!selfPlayerId) return;
    connection.send({ type: 'input', dir: input.getInputVector(), split: input.consumeSplit() });
  }, INPUT_SEND_INTERVAL_MS);
  // Latence réelle (aller-retour), affichée dans l'écran de debug F3 — pas de mécanisme de
  // ping/pong avant cette fonctionnalité, l'intervalle inter-état (20 Hz) n'aurait donné qu'une
  // approximation de la stabilité du tick, pas un vrai round-trip réseau.
  pingInterval = setInterval(() => {
    connection.send({ type: 'ping', t: performance.now() });
  }, PING_INTERVAL_MS);
}

// --- Panneau de stats (Pseudo/Guilde/Masse/Vitesse/Accélération) --------------------------
// "Guilde" reste un espace réservé statique ("—") : aucun système de guilde n'existe encore
// dans le projet (aucun Lot ne le prévoit à ce jour) — affiché tel quel plutôt qu'omis, comme
// demandé, en attendant qu'une vraie fonctionnalité de guilde soit conçue.

/** Facteur purement cosmétique (affichage uniquement) pour donner aux joueurs un ordre de
 * grandeur "physique" repérable (m/s, m/s²) plutôt que l'unité de simulation abstraite ("unité
 * de carte") — la simulation elle-même ne modélise aucune unité SI, ce n'est pas une conversion
 * réelle (demande utilisateur explicite : "même si non représentatif"). */
const MAP_UNITS_TO_METERS = 0.01;

function updateStatsPanel(): void {
  statNickname.textContent = selfNickname || '—';

  const own = ownAggregate(latestSnapshot, selfPlayerId);
  statMass.textContent = own ? Math.round(own.mass).toString() : '—';

  const previousOwn = ownAggregate(previousSnapshot ?? [], selfPlayerId);
  const speed =
    own && previousOwn
      ? speedBetween(previousOwn, own, SERVER_STATE_INTERVAL_MS / 1000)
      : undefined;
  statSpeed.textContent =
    speed !== undefined ? `${(speed * MAP_UNITS_TO_METERS).toFixed(1)} m/s` : '—';

  statAccel.textContent =
    selfAccelerationPerSec2 !== undefined
      ? `${(selfAccelerationPerSec2 * MAP_UNITS_TO_METERS).toFixed(1)} m/s²`
      : '—';
}

// --- Écran de debug F3 ---------------------------------------------------------------------

const fpsTracker = createFpsTracker();
const systemInfo = detectSystemInfo();
let gpuInfo: GpuInfo | undefined;
let networkInfo: NetworkInfo | undefined;
let debugVisible = false;

window.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'F3') return;
  event.preventDefault();
  debugVisible = !debugVisible;
  debugOverlay.style.display = debugVisible ? 'block' : 'none';
  if (debugVisible) {
    // Détection paresseuse (WebGL/Network Information API) : inutile de la faire tourner en
    // continu si l'écran de debug n'est jamais ouvert.
    gpuInfo ??= detectGpuInfo();
    networkInfo = detectNetworkInfo();
  }
});

function updateDebugOverlay(fps: { fps: number; frameTimeMs: number }): void {
  if (!debugVisible) return;
  const visibleEntities = latestSnapshot.length;
  const camera = computeCamera(latestSnapshot, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
  debugOverlay.textContent = formatDebugText({
    fps,
    pingMs: lastPingMs,
    tick: undefined,
    visibleEntities,
    roomId: currentRoomKey,
    cameraScale: camera.scale,
    gpu: gpuInfo,
    network: networkInfo,
    memory: detectMemoryInfo(),
    system: systemInfo,
  });
}

function frame(): void {
  const now = performance.now();
  const t = clamp((now - latestSnapshotAt) / SERVER_STATE_INTERVAL_MS, 0, 1);
  const entities = interpolateEntities(previousSnapshot, latestSnapshot, t);

  const camera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
  renderFrame(ctx!, canvas, entities, camera, nicknames);

  // Demande utilisateur : retirer le compteur "X morceau(x) en jeu" du HUD (bruit visuel, la
  // masse/le rendu des morceaux suffisent) — ne garder que le message mort/respawn et, le cas
  // échéant, le code d'invitation du salon privé.
  const status = justDied ? 'Vous êtes mort — respawn en cours…' : '';
  hud.textContent = [status, currentInviteCode && `Code d'invitation : ${currentInviteCode}`]
    .filter(Boolean)
    .join(' — ');

  updateStatsPanel();
  updateDebugOverlay(fpsTracker.tick(now));

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

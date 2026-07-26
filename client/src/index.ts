import type { EntitySnapshot, ServerMessage } from '@angulio/shared';
import { attachInput } from './input.js';
import { GameConnection } from './net.js';
import { computeCamera, renderFrame } from './render.js';

const INPUT_SEND_INTERVAL_MS = 50; // aligné sur le tick serveur par défaut (20 Hz)

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d');
if (!ctx) throw new Error('Canvas 2D non supporté par ce navigateur.');

const hud = document.getElementById('hud') as HTMLDivElement;
const joinOverlay = document.getElementById('joinOverlay') as HTMLDivElement;
const nicknameInput = document.getElementById('nickname') as HTMLInputElement;
const joinButton = document.getElementById('joinButton') as HTMLButtonElement;

function resizeCanvas(): void {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

let entities: EntitySnapshot[] = [];
let selfPlayerId: string | undefined;
let mapSize = 4000;
let justDied = false;
/** Pseudo par id de joueur, appris via les messages `player` (envoyés une fois par joueur,
 * pas répétés sur chaque entité à chaque tick — voir plan Lot 1.8, bande passante). */
const nicknames = new Map<string, string>();

const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
const connection = new GameConnection(`${wsProtocol}://${location.host}`);

connection.onMessage((message: ServerMessage) => {
  if (message.type === 'welcome') {
    selfPlayerId = message.playerId;
    mapSize = message.mapSize;
  } else if (message.type === 'player') {
    nicknames.set(message.playerId, message.nickname);
  } else if (message.type === 'state') {
    entities = message.entities;
  } else if (message.type === 'died') {
    justDied = true;
    setTimeout(() => {
      justDied = false;
    }, 1500);
  }
});

joinButton.addEventListener('click', () => {
  const nickname = nicknameInput.value.trim() || 'Joueur';
  connection.send({ type: 'join', nickname });
  joinOverlay.style.display = 'none';
  canvas.focus();
});

const input = attachInput(canvas);

setInterval(() => {
  if (!selfPlayerId) return;
  connection.send({ type: 'input', dir: input.getInputVector(), split: input.consumeSplit() });
}, INPUT_SEND_INTERVAL_MS);

function frame(): void {
  const camera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
  renderFrame(ctx!, canvas, entities, camera, nicknames);

  const pieceCount = entities.filter((entity) => entity.k === 'c').length;
  hud.textContent = justDied
    ? 'Vous êtes mort — respawn en cours…'
    : `${pieceCount} morceau(x) en jeu`;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

import { parentPort, workerData } from 'node:worker_threads';
import { resolveMod } from '../modRegistry.js';
import { DEFAULT_INTEREST_RADIUS_PX } from './roomHost.js';
import { RoomInstance } from './roomInstance.js';
import type { JoinResult, LeaveResult, RespawnResult, RoomCommand, RoomWorkerEvent } from './protocol.js';

/**
 * Point d'entrée exécuté à l'intérieur d'un `worker_thread` (voir `WorkerRoomHost`,
 * workerRoomHost.ts) — possède ses propres `RoomInstance` (donc ses propres `Room`/`World`,
 * jamais partagées avec le thread principal ni les autres workers), reçoit des commandes via
 * `postMessage` et répond par des événements du même type que ceux relayés en local par
 * `LocalRoomHost` (voir roomHost.ts) : `broadcast.ts`/`connectionHandler.ts` ne savent pas quel
 * hébergement ils utilisent, seul `WorkerRoomHost` connaît ce protocole.
 */
if (!parentPort) {
  throw new Error('roomWorker.ts doit être lancé comme worker_thread (parentPort absent).');
}
const port = parentPort;

const interestRadiusPx: number =
  (workerData as { interestRadiusPx?: number } | undefined)?.interestRadiusPx ??
  DEFAULT_INTEREST_RADIUS_PX;

const instances = new Map<string, RoomInstance>();

function post(event: RoomWorkerEvent): void {
  port.postMessage(event);
}

function wireInstance(instance: RoomInstance): void {
  instance.onTick((tick, payloads, stats) => {
    post({ type: 'tick', roomId: instance.id, tick, payloads, stats });
  });
  instance.onPlayerJoin((event) => {
    post({ type: 'playerJoin', roomId: instance.id, event });
  });
  instance.onPlayerDeath((playerId, info) => {
    post({ type: 'playerDeath', roomId: instance.id, playerId, info });
  });
  instance.onReset(() => {
    post({ type: 'roomReset', roomId: instance.id });
  });
}

function commandRoomId(command: RoomCommand): string | undefined {
  if (command.type === 'createRoom') return command.id;
  return 'roomId' in command ? command.roomId : undefined;
}

port.on('message', (command: RoomCommand) => {
  try {
    switch (command.type) {
      case 'createRoom': {
        const instance = new RoomInstance(command, resolveMod, interestRadiusPx);
        instances.set(command.id, instance);
        wireInstance(instance);
        break;
      }
      case 'destroyRoom': {
        instances.get(command.roomId)?.destroy();
        instances.delete(command.roomId);
        break;
      }
      case 'connectViewer': {
        instances.get(command.roomId)?.connectViewer(command.playerId, command.isSpectator);
        break;
      }
      case 'disconnectViewer': {
        instances.get(command.roomId)?.disconnectViewer(command.playerId);
        break;
      }
      case 'input': {
        instances.get(command.roomId)?.input(command.playerId, command.input);
        break;
      }
      case 'joinRequest': {
        const instance = instances.get(command.roomId);
        const result: JoinResult = instance
          ? instance.join(command.nickname, command.skin)
          : { ok: false, reason: 'room_full' };
        post({ type: 'joinResponse', reqId: command.reqId, result });
        break;
      }
      case 'respawnRequest': {
        const instance = instances.get(command.roomId);
        const result: RespawnResult = instance
          ? instance.respawn(command.playerId, command.nickname)
          : { respawned: false };
        post({ type: 'respawnResponse', reqId: command.reqId, result });
        break;
      }
      case 'leaveRequest': {
        const instance = instances.get(command.roomId);
        const result: LeaveResult | undefined = instance?.leave(command.playerId);
        post({ type: 'leaveResponse', reqId: command.reqId, result });
        break;
      }
    }
  } catch (error) {
    post({ type: 'workerError', roomId: commandRoomId(command), message: (error as Error).message });
  }
});

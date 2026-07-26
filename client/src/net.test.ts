import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientMessage } from '@angulio/shared';
import { GameConnection } from './net.js';

/** Faux WebSocket minimal : pas de connexion réseau réelle, ouverture déclenchée manuellement
 * via `triggerOpen()` — reproduit le délai réel entre `new WebSocket(url)` (état CONNECTING)
 * et l'événement `open`, pendant lequel `send()` ne doit rien perdre. */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  triggerOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    for (const listener of this.listeners.get('open') ?? []) listener(undefined);
  }

  triggerClose(code: number): void {
    for (const listener of this.listeners.get('close') ?? []) listener({ code });
  }
}

function socketOf(connection: GameConnection): FakeWebSocket {
  return (connection as unknown as { socket: FakeWebSocket }).socket;
}

describe('GameConnection', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('met en attente un message envoyé avant l’ouverture, puis le transmet à l’ouverture', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    const join: ClientMessage = { type: 'join', nickname: 'Alice' };

    connection.send(join);
    expect(fakeSocket.sent).toEqual([]); // pas encore ouvert : rien perdu, rien envoyé trop tôt

    fakeSocket.triggerOpen();
    expect(fakeSocket.sent).toEqual([JSON.stringify(join)]);
  });

  it('envoie immédiatement un message une fois le socket ouvert', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    fakeSocket.triggerOpen();

    const input: ClientMessage = { type: 'input', dir: { x: 1, y: 0 }, split: false };
    connection.send(input);

    expect(fakeSocket.sent).toEqual([JSON.stringify(input)]);
  });

  it('ne renvoie pas deux fois les messages déjà mis en attente', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    connection.send({ type: 'join', nickname: 'Bob' });
    fakeSocket.triggerOpen();
    connection.send({ type: 'input', dir: { x: 0, y: 1 }, split: true });

    expect(fakeSocket.sent).toHaveLength(2);
  });

  it('notifie onClose avec le code de fermeture (ex. 4004, salon introuvable)', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    const closeCodes: number[] = [];
    connection.onClose((event) => closeCodes.push(event.code));

    fakeSocket.triggerClose(4004);

    expect(closeCodes).toEqual([4004]);
  });
});

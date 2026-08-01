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

  close(): void {
    // Rien à simuler ici : les tests déclenchent `triggerClose` explicitement pour reproduire
    // l'événement `close` du navigateur (voir GameConnection.close(), qui appelle ceci puis
    // reçoit l'événement `close` en retour dans un vrai navigateur).
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

    const input: ClientMessage = {
      type: 'input',
      target: { x: 1, y: 0 },
      intensity: 1,
      split: false,
    };
    connection.send(input);

    expect(fakeSocket.sent).toEqual([JSON.stringify(input)]);
  });

  it('ne renvoie pas deux fois les messages déjà mis en attente', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    connection.send({ type: 'join', nickname: 'Bob' });
    fakeSocket.triggerOpen();
    connection.send({ type: 'input', target: { x: 0, y: 1 }, intensity: 1, split: true });

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

  it('reconnecte automatiquement sur une coupure transitoire au lieu de notifier onClose', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('ws://example.test');
      const firstSocket = socketOf(connection);
      firstSocket.triggerOpen();

      const closeCodes: number[] = [];
      const reconnectAttempts: number[] = [];
      connection.onClose((event) => closeCodes.push(event.code));
      connection.onReconnecting((attempt) => reconnectAttempts.push(attempt));

      firstSocket.triggerClose(1006); // fermeture anormale, pas un rejet applicatif
      expect(closeCodes).toEqual([]); // pas encore définitif : une reconnexion est programmée
      expect(reconnectAttempts).toEqual([1]);

      vi.advanceTimersByTime(300); // premier délai de backoff
      const secondSocket = socketOf(connection);
      expect(secondSocket).not.toBe(firstSocket);
      expect(closeCodes).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejoue automatiquement le dernier `join` après une reconnexion réussie', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('ws://example.test');
      const firstSocket = socketOf(connection);
      firstSocket.triggerOpen();

      const join: ClientMessage = { type: 'join', nickname: 'Alice' };
      connection.send(join);
      expect(firstSocket.sent).toEqual([JSON.stringify(join)]);

      firstSocket.triggerClose(1006);
      vi.advanceTimersByTime(300);
      const secondSocket = socketOf(connection);
      expect(secondSocket.sent).toEqual([]); // pas encore rejoué : le nouveau socket n'est pas ouvert

      secondSocket.triggerOpen();
      expect(secondSocket.sent).toEqual([JSON.stringify(join)]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne reconnecte jamais après un close() explicite (démontage du composant)', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('ws://example.test');
      const firstSocket = socketOf(connection);
      firstSocket.triggerOpen();

      const reconnectAttempts: number[] = [];
      connection.onReconnecting((attempt) => reconnectAttempts.push(attempt));

      connection.close();
      firstSocket.triggerClose(1006);
      vi.advanceTimersByTime(5000);

      expect(reconnectAttempts).toEqual([]);
      expect(socketOf(connection)).toBe(firstSocket); // aucun nouveau socket créé
    } finally {
      vi.useRealTimers();
    }
  });
});

/** `onOpen` sert au tout premier `ping` de mesure de latence (voir GameView.tsx) : il doit partir
 * au plus tôt — dès l'ouverture du socket — pour que son aller-retour se superpose à celui du
 * `join` plutôt que de s'y ajouter en série (correctif "le plus gros lag est juste après la
 * connexion"). */
describe('GameConnection — onOpen', () => {
  beforeEach(() => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("notifie à l'ouverture, APRÈS avoir vidé la file (le `join` part toujours en premier)", () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    const join: ClientMessage = { type: 'join', nickname: 'Alice' };
    connection.send(join);
    connection.onOpen(() => connection.send({ type: 'ping', t: 42 }));

    expect(fakeSocket.sent).toEqual([]); // rien tant que le socket n'est pas ouvert
    fakeSocket.triggerOpen();

    expect(fakeSocket.sent).toEqual([
      JSON.stringify(join),
      JSON.stringify({ type: 'ping', t: 42 }),
    ]);
  });

  it('notifie immédiatement un auditeur inscrit alors que le socket est DÉJÀ ouvert', () => {
    const connection = new GameConnection('ws://example.test');
    const fakeSocket = socketOf(connection);
    fakeSocket.triggerOpen();

    let notified = 0;
    connection.onOpen(() => {
      notified++;
    });

    expect(notified).toBe(1);
  });

  it('notifie à nouveau après une reconnexion transitoire (nouvelle mesure de latence)', () => {
    vi.useFakeTimers();
    try {
      const connection = new GameConnection('ws://example.test');
      socketOf(connection).triggerOpen();
      let notified = 0;
      connection.onOpen(() => {
        notified++;
      });
      expect(notified).toBe(1); // rattrapage immédiat (socket déjà ouvert)

      socketOf(connection).triggerClose(1006); // coupure transitoire -> reconnexion programmée
      vi.runOnlyPendingTimers();
      socketOf(connection).triggerOpen();

      expect(notified).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

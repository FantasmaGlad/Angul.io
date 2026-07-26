import type { ClientMessage, ServerMessage } from '@angulio/shared';

/** Connexion WebSocket au serveur de jeu. Pas de reconnexion automatique pour le MVP
 * (plan Lot 1.3 : côté client, à ajouter avec le reste du polish réseau). */
export class GameConnection {
  private readonly socket: WebSocket;
  private readonly listeners: Array<(message: ServerMessage) => void> = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      for (const listener of this.listeners) listener(message);
    });
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.push(listener);
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

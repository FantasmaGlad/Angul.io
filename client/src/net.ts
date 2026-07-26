import type { ClientMessage, ServerMessage } from '@angulio/shared';

/** Connexion WebSocket au serveur de jeu. Pas de reconnexion automatique pour le MVP
 * (plan Lot 1.3 : côté client, à ajouter avec le reste du polish réseau). */
export class GameConnection {
  private readonly socket: WebSocket;
  private readonly listeners: Array<(message: ServerMessage) => void> = [];
  private readonly closeListeners: Array<(event: CloseEvent) => void> = [];
  /** Messages envoyés avant l'ouverture effective du socket (ex. le `join` initial, envoyé dès
   * la création de la connexion depuis le lobby, Lot 2.2) — mis en attente puis vidés à
   * l'ouverture plutôt que silencieusement perdus. */
  private readonly pendingMessages: ClientMessage[] = [];

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      for (const message of this.pendingMessages) this.socket.send(JSON.stringify(message));
      this.pendingMessages.length = 0;
    });
    this.socket.addEventListener('message', (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      for (const listener of this.listeners) listener(message);
    });
    this.socket.addEventListener('close', (event: CloseEvent) => {
      for (const listener of this.closeListeners) listener(event);
    });
  }

  onMessage(listener: (message: ServerMessage) => void): void {
    this.listeners.push(listener);
  }

  /** Notifié à la fermeture de la connexion — utile pour détecter un salon introuvable ou un
   * code d'invitation invalide (le serveur ferme alors immédiatement avec le code `4004`,
   * voir net/server.ts) et ramener le joueur au lobby plutôt que de le laisser bloqué sur un
   * écran de jeu qui ne recevra jamais rien. */
  onClose(listener: (event: CloseEvent) => void): void {
    this.closeListeners.push(listener);
  }

  send(message: ClientMessage): void {
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(message);
    }
  }
}

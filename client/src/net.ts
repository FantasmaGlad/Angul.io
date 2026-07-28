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

  private lastRateCheckAt = performance.now();
  private bytesRecvWindow = 0;
  private bytesSentWindow = 0;
  private pktsRecvWindow = 0;

  public netInKbps = 0;
  public netOutKbps = 0;
  public netInPktSec = 0;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener('open', () => {
      for (const message of this.pendingMessages) {
        const payload = JSON.stringify(message);
        this.recordOutgoing(payload);
        this.socket.send(payload);
      }
      this.pendingMessages.length = 0;
    });
    this.socket.addEventListener('message', (event: MessageEvent<string>) => {
      this.recordIncoming(event.data);
      const message = JSON.parse(event.data) as ServerMessage;
      for (const listener of this.listeners) listener(message);
    });
    this.socket.addEventListener('close', (event: CloseEvent) => {
      for (const listener of this.closeListeners) listener(event);
    });
  }

  private recordIncoming(data: string) {
    this.bytesRecvWindow += typeof data === 'string' ? data.length : 0;
    this.pktsRecvWindow += 1;
    this.updateRates();
  }

  private recordOutgoing(data: string) {
    this.bytesSentWindow += data.length;
    this.updateRates();
  }

  private updateRates() {
    const now = performance.now();
    const elapsedSec = (now - this.lastRateCheckAt) / 1000;
    if (elapsedSec >= 1) {
      this.netInKbps = this.bytesRecvWindow / 1024 / elapsedSec;
      this.netOutKbps = this.bytesSentWindow / 1024 / elapsedSec;
      this.netInPktSec = Math.round(this.pktsRecvWindow / elapsedSec);

      this.bytesRecvWindow = 0;
      this.bytesSentWindow = 0;
      this.pktsRecvWindow = 0;
      this.lastRateCheckAt = now;
    }
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
    const payload = JSON.stringify(message);
    this.recordOutgoing(payload);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(message);
    }
  }

  /** Ferme la connexion côté client — à appeler quand le composant qui la possède est démonté
   * (GameView.tsx) pour ne pas laisser un socket ouvert en arrière-plan (notamment le double
   * montage volontaire de React.StrictMode en développement, qui appellerait sinon deux fois la
   * connexion sans jamais fermer la première). */
  close(): void {
    this.socket.close();
  }
}

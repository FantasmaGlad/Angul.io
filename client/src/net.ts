import {
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_EXPIRED,
  WS_CLOSE_ROOM_FULL,
  WS_CLOSE_ROOM_NOT_FOUND,
  type ClientMessage,
  type ServerMessage,
} from '@angulio/shared';

/** Codes de fermeture qu'il ne sert à rien de retenter (voir `GameConnection`, plan
 * plan_performance_reseau.md §4.3/Phase 4.3) : soit un rejet applicatif délibéré du serveur
 * (salon introuvable/complet/pseudo pris/expiré — retenter obtiendrait exactement le même refus),
 * soit une fermeture normale (1000, celle que `close()` déclenche nous-mêmes). Tout le reste
 * (1006 abnormal closure, 1001 going away, 1013 surcharge temporaire, coupure Wi-Fi...) est
 * considéré transitoire et déclenche une reconnexion automatique. */
const NON_RETRYABLE_CLOSE_CODES = new Set<number>([
  1000,
  WS_CLOSE_ROOM_NOT_FOUND,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_FULL,
  WS_CLOSE_ROOM_EXPIRED,
]);

/** Délais (ms) entre tentatives successives, backoff court et plafonné — une micro-coupure
 * Wi-Fi/4G ou un redémarrage serveur bref doit se rattraper en quelques secondes tout au plus,
 * pas en boucle indéfinie qui masquerait un vrai problème. Au-delà, `onClose` est notifié comme
 * avant (retour au lobby avec un message d'erreur, voir GameView.tsx). */
const RECONNECT_DELAYS_MS = [300, 600, 1200, 2400, 4800];

/** Connexion WebSocket au serveur de jeu, avec reconnexion automatique transparente sur coupure
 * transitoire (voir `NON_RETRYABLE_CLOSE_CODES`/`RECONNECT_DELAYS_MS` ci-dessus). Ne restaure PAS
 * l'état de jeu exact d'avant la coupure (aucune session ne survit côté serveur pour le socket de
 * jeu lui-même, seulement pour le compte, voir `AccountsService`/`sessionStore.ts`) — une
 * reconnexion réussie renvoie automatiquement le dernier message `join` envoyé (nouveau spawn),
 * ce qui évite au joueur de se retrouver éjecté au lobby pour un simple aller-retour réseau raté,
 * sans prétendre reprendre exactement là où la partie s'était arrêtée. */
export class GameConnection {
  private readonly url: string;
  private socket: WebSocket;
  private readonly listeners: Array<(message: ServerMessage) => void> = [];
  private readonly closeListeners: Array<(event: CloseEvent) => void> = [];
  /** Notifiés à chaque tentative de reconnexion programmée (pas à chaque succès) — purement
   * informatif pour l'UI (voir GameView.tsx, statut "reconnexion en cours"). */
  private readonly reconnectingListeners: Array<(attempt: number) => void> = [];
  /** Notifiés dès que le socket est réellement ouvert (première connexion ET chaque reconnexion
   * réussie), une fois la file d'attente vidée — voir `onOpen`. */
  private readonly openListeners: Array<() => void> = [];
  /** Messages envoyés avant l'ouverture effective du socket (ex. le `join` initial, envoyé dès
   * la création de la connexion depuis le lobby, Lot 2.2) — mis en attente puis vidés à
   * l'ouverture plutôt que silencieusement perdus. */
  private readonly pendingMessages: ClientMessage[] = [];
  /** Dernier `join` envoyé — rejoué automatiquement après une reconnexion réussie (voir
   * `createSocket`), puisque le serveur ne conserve aucune session pour le socket de jeu
   * lui-même : sans ce rejeu, une reconnexion transparente laisserait le joueur connecté mais
   * jamais réellement dans la partie. */
  private lastJoinMessage: ClientMessage | undefined;
  /** Jeton reçu dans le dernier `welcome` (voir `WelcomeMessage.resumeToken`, mis à jour par
   * `setResumeToken` — appelé par GameView.tsx à chaque `welcome`) — rejoué avec le `join` lors
   * d'une reconnexion transitoire pour que le serveur reprenne la vie en cours au lieu d'en créer
   * une nouvelle (voir connectionHandler.ts, correctif "déconnexion = perte immédiate de XP"). */
  private resumeToken: string | undefined;
  private closedByUs = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  private lastRateCheckAt = performance.now();
  private bytesRecvWindow = 0;
  private bytesSentWindow = 0;
  private pktsRecvWindow = 0;

  public netInKbps = 0;
  public netOutKbps = 0;
  public netInPktSec = 0;

  constructor(url: string) {
    this.url = url;
    this.socket = this.createSocket(false);
  }

  private createSocket(isReconnect: boolean): WebSocket {
    const socket = new WebSocket(this.url);
    socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      for (const message of this.pendingMessages) {
        const payload = JSON.stringify(message);
        this.recordOutgoing(payload);
        socket.send(payload);
      }
      this.pendingMessages.length = 0;

      if (isReconnect && this.lastJoinMessage) {
        const joinMessage = this.resumeToken
          ? { ...this.lastJoinMessage, resumeToken: this.resumeToken }
          : this.lastJoinMessage;
        const payload = JSON.stringify(joinMessage);
        this.recordOutgoing(payload);
        socket.send(payload);
      }

      // Après le `join` (mis en file avant l'ouverture, ou rejoué ci-dessus) : ce que ces
      // auditeurs envoient est ainsi traité par le serveur APRÈS l'entrée en partie, jamais
      // avant.
      for (const listener of this.openListeners) listener();
    });
    socket.addEventListener('message', (event: MessageEvent<string>) => {
      this.recordIncoming(event.data);
      const message = JSON.parse(event.data) as ServerMessage;
      for (const listener of this.listeners) listener(message);
    });
    socket.addEventListener('close', (event: CloseEvent) => {
      this.handleClose(event);
    });
    return socket;
  }

  private handleClose(event: CloseEvent): void {
    if (this.closedByUs) return;

    if (!NON_RETRYABLE_CLOSE_CODES.has(event.code) && this.reconnectAttempt < RECONNECT_DELAYS_MS.length) {
      const delay = RECONNECT_DELAYS_MS[this.reconnectAttempt]!;
      this.reconnectAttempt += 1;
      for (const listener of this.reconnectingListeners) listener(this.reconnectAttempt);
      this.reconnectTimer = setTimeout(() => {
        this.socket = this.createSocket(true);
      }, delay);
      return;
    }

    for (const listener of this.closeListeners) listener(event);
  }

  /** Force une tentative de reconnexion immédiate si le socket n'est ni ouvert ni déjà en train
   * de s'ouvrir (voir GameView.tsx, appelé sur `visibilitychange` au retour au premier plan) —
   * filet de sécurité Safari/macOS : l'onglet peut suspendre l'activité en arrière-plan (App Nap)
   * sans forcément déclencher l'événement `close` du socket à temps, laissant la reconnexion
   * automatique habituelle (basée sur `close`, voir `handleClose`) attendre indéfiniment. Sans
   * effet si tout va bien (socket déjà ouvert/en cours d'ouverture, ou fermeture volontaire). */
  public ensureConnected(): void {
    if (this.closedByUs) return;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.socket = this.createSocket(true);
  }

  /** À appeler à chaque `welcome` reçu (voir GameView.tsx) — mémorise le jeton de reprise à
   * représenter au serveur si cette connexion venait à se couper. */
  setResumeToken(token: string | undefined): void {
    this.resumeToken = token;
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

  /** Notifié uniquement quand la connexion est définitivement perdue (rejet applicatif, ou
   * reconnexion transitoire épuisée après `RECONNECT_DELAYS_MS` — voir `handleClose`) — jamais
   * pour une coupure que la reconnexion automatique a fini par rattraper. Utile pour détecter un
   * salon introuvable ou un code d'invitation invalide (le serveur ferme alors immédiatement avec
   * le code `4004`, voir net/server.ts) et ramener le joueur au lobby plutôt que de le laisser
   * bloqué sur un écran de jeu qui ne recevra jamais rien. */
  onClose(listener: (event: CloseEvent) => void): void {
    this.closeListeners.push(listener);
  }

  /** Notifié à chaque tentative de reconnexion programmée après une coupure transitoire — sert
   * uniquement à afficher un statut ("reconnexion en cours…", voir GameView.tsx), jamais consommé
   * pour une décision de logique de jeu. */
  onReconnecting(listener: (attempt: number) => void): void {
    this.reconnectingListeners.push(listener);
  }

  /** Notifié dès que le socket est OUVERT — c'est-à-dire au plus tôt où un message peut réellement
   * partir, sans attendre la moindre réponse applicative du serveur. Utilisé pour le tout premier
   * `ping` (voir GameView.tsx) : mesuré depuis l'ouverture, son aller-retour se superpose à celui
   * du `join` au lieu de s'y ajouter en série — la première vraie mesure de latence remplace donc
   * le repli `DEFAULT_LATENCY_MS` (prediction.ts) beaucoup plus tôt, réduisant la fenêtre pendant
   * laquelle la réconciliation travaille sur une latence supposée et produit une correction
   * visible peu après l'entrée en partie.
   *
   * Appelé IMMÉDIATEMENT si le socket est déjà ouvert au moment de l'inscription : sans ce
   * rattrapage, un auditeur inscrit après coup (montage de composant retardé, socket ouvert entre
   * temps) ne serait jamais notifié — l'événement `open` étant, lui, déjà passé. */
  onOpen(listener: () => void): void {
    this.openListeners.push(listener);
    if (this.socket.readyState === WebSocket.OPEN) listener();
  }

  send(message: ClientMessage): void {
    if (message.type === 'join') this.lastJoinMessage = message;
    const payload = JSON.stringify(message);
    this.recordOutgoing(payload);
    if (this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(payload);
    } else if (this.socket.readyState === WebSocket.CONNECTING) {
      this.pendingMessages.push(message);
    }
    // CLOSING/CLOSED (fenêtre de backoff entre deux tentatives) : message perdu, comme avant ce
    // module pour tout état hors CONNECTING/OPEN — sans conséquence pour `input`/`ping`, envoyés
    // à nouveau au prochain tick/intervalle une fois reconnecté.
  }

  /** Ferme la connexion côté client — à appeler quand le composant qui la possède est démonté
   * (GameView.tsx) pour ne pas laisser un socket ouvert en arrière-plan (notamment le double
   * montage volontaire de React.StrictMode en développement, qui appellerait sinon deux fois la
   * connexion sans jamais fermer la première). Désactive aussi la reconnexion automatique : un
   * démontage explicite n'est jamais une coupure transitoire à rattraper.
   *
   * Si le socket est encore `CONNECTING` (retour utilisateur : le fond spectateur de l'accueil,
   * SpectatorBackground.tsx, se démonte souvent avant la fin du handshake pendant la transition
   * "entrer en jeu"), on attend l'événement `open` avant de fermer plutôt que d'appeler
   * `socket.close()` immédiatement — fermer un socket encore en cours de connexion est légal mais
   * Chrome journalise alors "WebSocket is closed before the connection is established" en
   * console : bruyant sans être un vrai bug, mais évitable. La fermeture reste quasi immédiate
   * dans tous les cas (le temps d'un aller-retour local), aucun délai perceptible. */
  close(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.addEventListener('open', () => this.socket.close(), { once: true });
    } else {
      this.socket.close();
    }
  }
}

/** Client de l'API HTTP du lobby (Lot 2.2) — liste/création de salons, servie par le même
 * process que le jeu (net/server.ts), donc pas de configuration d'origine à faire. */
export interface RoomSummary {
  id: string;
  name: string;
  modId: string;
  visibility: 'public' | 'private';
  playerCount: number;
  /** Capacité maximale de joueurs (refonte UI/UX, "Nombre de Joueurs") — affiché en "count/max". */
  maxPlayers: number;
  /** `true` pour le salon par défaut créé au démarrage du serveur — cible explicite du bouton
   * "Rejoindre" et du fond spectateur de l'accueil (voir App.tsx), plutôt que de compter sur
   * l'ordre de la liste renvoyée par le serveur. */
  permanent: boolean;
}

/** Réponse à la création d'un salon : inclut le code d'invitation pour un salon privé (Lot
 * 2.3) — à afficher/transmettre au créateur, jamais renvoyé par `fetchPublicRooms` (qui ignore
 * de toute façon les salons privés). */
export interface CreatedRoomSummary extends RoomSummary {
  inviteCode?: string;
}

export async function fetchPublicRooms(): Promise<RoomSummary[]> {
  const response = await fetch('/api/rooms');
  return (await response.json()) as RoomSummary[];
}

export async function fetchAvailableModes(): Promise<string[]> {
  const response = await fetch('/api/modes');
  return (await response.json()) as string[];
}

/** "N Joueurs Connectés" (refonte UI/UX, accueil) — total réel tous salons confondus (y compris
 * privés), voir `GET /api/stats` côté serveur. */
export async function fetchServerStats(): Promise<{ playersOnline: number }> {
  const response = await fetch('/api/stats');
  return (await response.json()) as { playersOnline: number };
}

export interface CreateRoomOptions {
  /** "Nombre de Joueurs" (refonte UI/UX) — omis = capacité par défaut du serveur. */
  maxPlayers?: number;
  /** "Durée" (refonte UI/UX) — durée de vie du salon en ms, omis = pas d'expiration. */
  durationMs?: number;
  /** "Activer les bots (IA)" — omis = bots activés selon la configuration du mode. */
  botsEnabled?: boolean;
  /** Code d'invitation pré-généré à la volée par le client pour le salon privé. */
  inviteCode?: string;
}

/** `token` (Lot 6.4) : la création de salon est réservée aux comptes Premium — le serveur
 * refuse (403) sans token ou sans statut Premium associé, voir net/server.ts. */
export async function createRoom(
  name: string,
  modId: string,
  visibility: 'public' | 'private' = 'public',
  token?: string,
  options: CreateRoomOptions = {},
): Promise<CreatedRoomSummary> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      name,
      modId,
      visibility,
      maxPlayers: options.maxPlayers,
      durationMs: options.durationMs,
      botsEnabled: options.botsEnabled,
      inviteCode: options.inviteCode,
    }),
  });


  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Impossible de créer le salon.');
  }
  return (await response.json()) as CreatedRoomSummary;
}

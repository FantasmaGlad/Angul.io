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
  /** Horodatage (`Date.now()`) du prochain reset automatique de ce salon — `undefined` si aucun
   * reset n'est planifié. */
  nextResetAtMs?: number;
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

/** Une ligne du classement public (page Classements) — voir `GET /api/leaderboard` côté serveur. */
export interface LeaderboardEntry {
  rank: number;
  pseudo: string;
  level: number;
  avatarColor?: string;
  score: number;
}

/** `mode` : `'global'` pour le classement par XP totale, ou un id de mode (`vanilla`/`hardcore`)
 * pour le classement par meilleur score de ce mode. Public, pas de token requis. */
export async function fetchLeaderboard(mode: string, limit = 50): Promise<LeaderboardEntry[]> {
  const response = await fetch(
    `/api/leaderboard?mode=${encodeURIComponent(mode)}&limit=${limit}`,
  );
  if (!response.ok) throw new Error('Impossible de récupérer le classement.');
  return (await response.json()) as LeaderboardEntry[];
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
  /** Taille de carte personnalisée (carrée, px) — 1000 à 50000, omis = taille par défaut du mode. */
  mapSize?: number;
  /** Population de bots personnalisée — 0 à 50 chacun, `min === max` pour une population FIXE,
   * omis = réglages par défaut du mode. */
  botCount?: { min: number; max: number };
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
      mapSize: options.mapSize,
      botCount: options.botCount,
    }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Impossible de créer le salon.');
  }
  return (await response.json()) as CreatedRoomSummary;
}

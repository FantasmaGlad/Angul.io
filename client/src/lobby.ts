/** Client de l'API HTTP du lobby (Lot 2.2) — liste/création de salons, servie par le même
 * process que le jeu (net/server.ts), donc pas de configuration d'origine à faire. */
export interface RoomSummary {
  id: string;
  name: string;
  modId: string;
  visibility: 'public' | 'private';
  playerCount: number;
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

export async function createRoom(
  name: string,
  modId: string,
  visibility: 'public' | 'private' = 'public',
): Promise<CreatedRoomSummary> {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, modId, visibility }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Impossible de créer le salon.');
  }
  return (await response.json()) as CreatedRoomSummary;
}

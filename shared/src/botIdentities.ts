export interface BotIdentity {
  name: string;
  color: string;
}

export const BOT_IDENTITIES: BotIdentity[] = [
  { name: 'Robibou', color: '#FF69B4' },
  { name: 'Robibozo', color: '#FFB6C1' },
  { name: 'Eliotoumtoum', color: '#87CEEB' },
  { name: 'Eliotitos', color: '#00BFFF' },
  { name: 'Olibom', color: '#32CD32' },
  { name: 'Olibomix', color: '#00FA9A' },
  { name: 'Baamix', color: '#FFA500' },
  { name: 'Gigi', color: '#FFC0CB' },
  { name: 'Lune', color: '#F4F6F0' },
  { name: 'Coton', color: '#FFFFFF' },
];

export const BOT_COLORS: Record<string, string> = Object.fromEntries(
  BOT_IDENTITIES.map((b) => [b.name, b.color]),
);

/** Détermine si un ID de joueur correspond à un bot d'après son préfixe déterministe (`bot-`). */
export function isBotId(id: string): boolean {
  return id.startsWith('bot-');
}

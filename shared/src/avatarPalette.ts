/** Skins d'avatar choisissables et utilisables en jeu pour les joueurs et les bots.
 * Les fichiers PNG correspondants sont hébergés sous `/assets/Profil/`. */
export const SKINS = [
  'Banane',
  'BmxPor',
  'Calamard',
  'Champi',
  'KK',
  'Radiateur',
] as const;

export type SkinId = (typeof SKINS)[number];

export const SKIN_IMAGE_MAP: Record<string, string> = {
  Banane: '/assets/Profil/Banane.png',
  BmxPor: '/assets/Profil/BmxPor.png',
  Calamard: '/assets/Profil/Calamard.png',
  Champi: '/assets/Profil/Champi.png',
  KK: '/assets/Profil/KK.png',
  Radiateur: '/assets/Profil/Radiateur.png',
};

/** Palette d'avatars — exportée pour compatibilité avec l'existant (`ProfilePage`, `AccountsService`...) */
export const AVATAR_PALETTE: readonly string[] = SKINS as unknown as readonly string[];

export function isValidSkin(skin: string): boolean {
  if (!skin || typeof skin !== 'string') return false;
  if (skin.length > 200) return false;
  if (skin.includes('..') || skin.includes('<') || skin.includes('>')) return false;
  return true;
}

export function isValidAvatarColor(color: string): boolean {
  return isValidSkin(color);
}

/** Choix déterministe d'un skin pour un joueur sans compte (invité) ou sans choix explicite. */
export function skinForNickname(nickname: string): string {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) >>> 0;
  }
  return SKINS[hash % SKINS.length]!;
}

export function colorForNickname(nickname: string): string {
  return skinForNickname(nickname);
}

/** Choix aléatoire d'un skin pour un robot (bot) lorsqu'il apparaît. */
export function getRandomSkin(): string {
  return SKINS[Math.floor(Math.random() * SKINS.length)]!;
}


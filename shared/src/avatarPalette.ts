/** Skins d'avatar choisissables et utilisables en jeu pour les joueurs et les bots.
 * Les fichiers PNG correspondants sont hébergés sous `/assets/Profil/`. */
export const SKINS = [
  'Baamix',
  'La Mouche',
  'Monstera',
  'Oli',
  'Pieuvrito',
  'Requin',
  'Samouraï',
  'Scoobi',
  'Seigneur',
  'Skibidi',
] as const;

export type SkinId = (typeof SKINS)[number];

/** Skin de repli — utilisé partout où un défaut concret est nécessaire (nouvel invité, morceau
 * sans propriétaire, image cassée) plutôt qu'un nom codé en dur (`'Banane'`) qui devenait un skin
 * invalide/404 à chaque changement du contenu réel d'`assets/Profil/` (retour utilisateur). Toujours
 * le premier de `SKINS`, donc toujours valide par construction même si la palette change. */
export const DEFAULT_SKIN: SkinId = SKINS[0];

export const SKIN_IMAGE_MAP: Record<string, string> = {
  Baamix: '/assets/Profil/Baamix.png',
  'La Mouche': '/assets/Profil/La Mouche.png',
  Monstera: '/assets/Profil/Monstera.png',
  Oli: '/assets/Profil/Oli.png',
  Pieuvrito: '/assets/Profil/Pieuvrito.png',
  Requin: '/assets/Profil/Requin.png',
  Samouraï: '/assets/Profil/Samouraï.png',
  Scoobi: '/assets/Profil/Scoobi.png',
  Seigneur: '/assets/Profil/Seigneur.png',
  Skibidi: '/assets/Profil/Skibidi.png',
};

/** Palette d'avatars — exportée pour compatibilité avec l'existant (`ProfilePage`, `AccountsService`...) */
export const AVATAR_PALETTE: readonly string[] = SKINS as unknown as readonly string[];

/** Un skin n'est valide que s'il appartient à `SKINS` — auparavant, seuls `..`/`<`/`>` et la
 * longueur étaient rejetés, donc N'IMPORTE QUELLE chaîne (y compris le nom d'un fichier déjà
 * supprimé d'`assets/Profil/`) pouvait être persistée comme choix de skin (retour utilisateur :
 * 404 sur l'avatar d'un joueur/bot une fois ce fichier disparu). */
export function isValidSkin(skin: string): boolean {
  if (!skin || typeof skin !== 'string') return false;
  if (skin.length > 200) return false;
  if (skin.includes('..') || skin.includes('<') || skin.includes('>')) return false;
  return (SKINS as readonly string[]).includes(skin);
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


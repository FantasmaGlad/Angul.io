export const DEFAULT_DEATH_BANNER_ID = '';
export const DEFAULT_DEATH_MESSAGE = 'Bien joué ! À la prochaine.';
export const MAX_DEATH_MESSAGE_LENGTH = 100;

export function isCustomImageBanner(id: string | undefined): boolean {
  if (!id) return false;
  return (
    id.startsWith('data:image/') ||
    id.startsWith('http://') ||
    id.startsWith('https://') ||
    id.startsWith('url(') ||
    // Asset statique servi par le client (ex. GIF de victoire par bot, voir
    // server/src/engine/botKillBanners.ts) — même convention que le reste de l'app pour référencer
    // un fichier de `client/public` (skins, logo...), jamais un id de catalogue arbitraire (le seul
    // autre id existant, `DEFAULT_DEATH_BANNER_ID`, est la chaîne vide, jamais `/...`).
    id.startsWith('/')
  );
}

export function isDeathBannerUnlocked(_id: string, _level: number): boolean {
  return true;
}

export const DEFAULT_DEATH_BANNER_ID = '';
export const DEFAULT_DEATH_MESSAGE = 'Bien joué ! À la prochaine.';
export const MAX_DEATH_MESSAGE_LENGTH = 100;

export function isCustomImageBanner(id: string | undefined): boolean {
  if (!id) return false;
  return (
    id.startsWith('data:image/') ||
    id.startsWith('http://') ||
    id.startsWith('https://') ||
    id.startsWith('url(')
  );
}

export function isDeathBannerUnlocked(_id: string, _level: number): boolean {
  return true;
}

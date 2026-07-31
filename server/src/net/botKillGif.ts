import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Racine du dossier `assets/` du dépôt — PAS `client/public/assets/`, qui n'existe qu'après un
 * build client et en est de toute façon entièrement vidé par `vite build` (`emptyOutDir: true`,
 * voir .claude/launch.json "knownQuirks") : un GIF y déposé disparaissait donc du build final, et
 * cette fonction (qui ne vérifiait que ce dossier) ne le trouvait alors JAMAIS, même correctement
 * déposé — `botKillGifPath` retombait systématiquement sur `undefined` (bannière par défaut, voir
 * broadcast.ts), quel que soit le contenu réel de `assets/BotKills/` (retour utilisateur : les
 * bots n'ont jamais de bannière). Même dossier racine que Profil/Logos/Sons/Joystick, déjà servi
 * tel quel en repli par server/src/net/http/staticServer.ts pour toute URL `/assets/*` absente de
 * `client/public/` — un GIF de victoire de bot doit donc être déposé dans `assets/BotKills/`,
 * comme les autres catégories d'assets, jamais dans `client/public/assets/BotKills/`. */
const ROOT_ASSETS_DIR = fileURLToPath(new URL('../../../assets', import.meta.url));

/** Bannières GIF (Giphy) associées aux 10 identités de bots officiels. */
export const BOT_KILL_GIFS: Record<string, string> = {
  Robibou: 'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZW5uMnpiaGVzaHA5cmNrNXdncHVobTNrenU5MW5ubzUxMHlzcnU4eSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/KmxmoHUGPDjfQXqGgv/giphy.gif',
  Robibozo: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaHh3cnBqMXJlMHZkem5nMjVicGxtbDN0cmVjdDY5ZmRiNm1jOGVsNSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/GfgW6K3PjKvtnc16IK/giphy.gif',
  Eliotoumtoum: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOGNwNm0xaXBjOWduNHM1cjZ0cWMwbGQzNXBmaWhzbWNqY2x2M2pzdSZlcD12MV9naWZzX3NlYXJjaCZjdD1n/DJ0unq2Lzabx8oHnxP/giphy.gif',
  Eliotitos: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExN244NWQ5Z2VybHBoYzRjemlhdTNmeG80ZzlqN3Rtd3lud3ViNnlhZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/EFUiKHUiZNQUo/giphy.gif',
  Olibom: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdmtqNThxYTJjaGQ3aHhvOGNnM2czdmNmbzNka2RwZmc2aWNmNTQwaiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3o6MbhltzPdQwAMh20/giphy.gif',
  Olibomix: 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExMm04MHowcGwxZjJmOGptOThhNmczcDIzdmRlNGtiaTBjYmRyZGViNCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/3o7aD2tSaTpzcf7t4s/giphy.gif',
  Baamix: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExaHJubnA3dno2cXFwMWl3MWV6OWNsM2Nsa3Jybjdnb3EwenVtaWpvayZlcD12MV9naWZzX3NlYXJjaCZjdD1n/3DnDRfZe2ubQc/giphy.gif',
  Gigi: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExejR0eTByZGl0aDl0ZmNmbWkxYWltZjdseDdrdHI2N2psMHMwN3dnMyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/d2ItDZZumUI6Y/giphy.gif',
  Lune: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExOWp6bHdsNW9nNHU3ZjY1bHVvZTVkanVkdmZsY2FlazNsa2E4Mmw5MiZlcD12MV9naWZzX3NlYXJjaCZjdD1n/SUBxai0moNW7K/giphy.gif',
  Coton: 'https://media.giphy.com/media/v1.Y2lkPTc5MGI3NjExdzRkZ2Jodmxwd2pzNG9icGx0ejl1MGQya2UyZ20ycThwMTFodHYzZyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/03FrApcG2n2wlKga6t/giphy.gif',
};

/** URL (relative ou Giphy direct) du GIF de victoire d'un bot. Priorité au fichier local
 * `assets/BotKills/<nom du bot>.gif` s'il existe, puis repli sur l'URL Giphy du bot. */
export function botKillGifPath(botName: string): string | undefined {
  const absolutePath = join(ROOT_ASSETS_DIR, 'BotKills', `${botName}.gif`);
  if (existsSync(absolutePath)) {
    return `/assets/BotKills/${botName}.gif`;
  }
  return BOT_KILL_GIFS[botName];
}

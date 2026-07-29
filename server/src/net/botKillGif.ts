import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Même répertoire que `staticDir` (voir server/src/index.ts), recalculé ici de la même façon
 * (chemin relatif au fichier compilé, robuste dev/prod) plutôt que de faire transiter un
 * `staticDir` explicite depuis index.ts à travers plusieurs couches jusqu'à broadcast.ts. */
const CLIENT_PUBLIC_DIR = fileURLToPath(new URL('../../../client/public', import.meta.url));

/** URL (relative, servie telle quelle par le client) du GIF de victoire d'un bot, si un fichier a
 * été déposé dans `client/public/assets/BotKills/<nom du bot>.gif` — `undefined` sinon, auquel cas
 * l'appelant (broadcast.ts) retombe sur la bannière par défaut (dégradé) plutôt que de référencer
 * un fichier inexistant (image cassée). Le nom de fichier attendu est le nom du bot tel qu'il
 * apparaît dans `BOT_IDENTITIES` (shared/src/botIdentities.ts), à l'octet près (accents compris) —
 * aucun fichier n'existe encore dans ce dossier au moment de ce commit : cette fonction rend le
 * système "prêt pour les GIFs" dès qu'on y dépose des fichiers, sans changement de code. */
export function botKillGifPath(botName: string): string | undefined {
  const absolutePath = join(CLIENT_PUBLIC_DIR, 'assets', 'BotKills', `${botName}.gif`);
  return existsSync(absolutePath) ? `/assets/BotKills/${botName}.gif` : undefined;
}

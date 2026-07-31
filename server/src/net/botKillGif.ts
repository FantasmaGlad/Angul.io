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

/** URL (relative, servie telle quelle par le client) du GIF de victoire d'un bot, si un fichier a
 * été déposé dans `assets/BotKills/<nom du bot>.gif` — `undefined` sinon, auquel cas l'appelant
 * (broadcast.ts) retombe sur la bannière par défaut (dégradé) plutôt que de référencer un fichier
 * inexistant (image cassée). Le nom de fichier attendu est le nom du bot tel qu'il apparaît dans
 * `BOT_IDENTITIES` (shared/src/botIdentities.ts), à l'octet près (accents compris) — aucun fichier
 * n'existe encore dans ce dossier au moment de ce commit : cette fonction rend le système "prêt
 * pour les GIFs" dès qu'on y dépose des fichiers, sans changement de code. */
export function botKillGifPath(botName: string): string | undefined {
  const absolutePath = join(ROOT_ASSETS_DIR, 'BotKills', `${botName}.gif`);
  return existsSync(absolutePath) ? `/assets/BotKills/${botName}.gif` : undefined;
}

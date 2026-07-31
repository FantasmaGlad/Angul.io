/** Réplique personnalisée par bot (demande utilisateur), affichée sur l'écran de mort du joueur
 * mangé PAR ce bot — à la place de son propre message personnalisé (voir
 * `server/src/net/ws/broadcast.ts`, `onPlayerDeath`), qui lui reste utilisé pour toute autre
 * cause de mort (joueur humain, reset de salon...). Clé = `BotIdentity.name` (botIdentities.ts),
 * à l'octet près (accents compris). "Lune" apparaît deux fois dans la liste fournie : la
 * dernière valeur du tableau l'emporte (`Object.fromEntries`, même principe que `BOT_COLORS`). */
const BOT_KILL_MESSAGE_ENTRIES: Array<[string, string]> = [
  ['Robibou', 'Un gros câlin mortel de Robibou, étouffe-toi avec mon amour !'],
  ['Robibozo', "Ma blague t'a tué, mais ta façon de jouer était encore plus drôle !"],
  ['Eliotoumtoum', 'Je rebondis sur tes restes, tu sers au moins de trampoline !'],
  ['Eliotitos', "Croustillant ! Je t'ai mangé comme un vieux chips périmé !"],
  ['Olibom', "J'ai fait exploser ton score et ta dignité en même temps !"],
  ['Olibomix', 'Mixé et avalé, tu fais un excellent smoothie de noob !'],
  ['Baamix', "J'ai fait le ménage, tu étais la poussière à balayer !"],
  ['Gigi', 'Gigi a toujours faim, et tu étais le plat de résistance parfait !'],
  ['Lune', "Je t'engloutis dans la nuit, fais de beaux cauchemars !"],
  ['Coton', "Je suis doux, mais je t'ai étouffé dans ton sommeil, minable !"],
];

export const BOT_KILL_MESSAGES: Record<string, string> = Object.fromEntries(
  BOT_KILL_MESSAGE_ENTRIES,
);

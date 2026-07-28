/** Palette de couleurs d'avatar choisissables (refonte UI/UX — avatar procédural plutôt qu'un
 * upload d'image : aucune infra de stockage/modération de fichiers dans ce projet, tout le rendu
 * est volontairement procédural, voir structure.md §3). La couleur choisie devient à la fois le
 * badge de compte (TopNav.tsx) et la couleur du blob en jeu (render.ts `colorFor`) — calibrée
 * pour rester lisible sur le canvas de jeu, qui reste clair (`--game-bg`) même si le reste du
 * chrome est passé au thème sombre Onyx. */
export const AVATAR_PALETTE: readonly string[] = [
  '#2E86AB', // bleu
  '#E4572E', // orange rouille
  '#3AAE8C', // vert émeraude
  '#8E44AD', // violet
  '#D64550', // rouge corail
  '#1B998B', // sarcelle
  '#C9A227', // ambre
  '#5C6BC0', // indigo
  '#EF6C9B', // rose
  '#4E7A51', // vert forêt
];

export function isValidAvatarColor(color: string): boolean {
  return AVATAR_PALETTE.includes(color);
}

/** Couleur de repli déterministe pour un joueur sans compte (invité) ou sans choix explicite :
 * même pseudo → même couleur d'une session à l'autre, et deux joueurs simultanés ont (le plus
 * souvent) des couleurs différentes — au lieu de l'ancien `DEFAULT_BLOB_COLOR` unique partagé par
 * tout le monde. */
export function colorForNickname(nickname: string): string {
  let hash = 0;
  for (let i = 0; i < nickname.length; i++) {
    hash = (hash * 31 + nickname.charCodeAt(i)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length]!;
}

/** Catalogue des bannières de l'écran de mort personnalisé (cahier des charges fourni par
 * l'utilisateur, §1 : "Système de Presets Graphiques / Bannières de Mort") — approche
 * ultra-légère retenue plutôt qu'un upload d'image libre (pas d'infra de stockage/modération de
 * fichiers dans ce projet, voir structure.md §3) : chaque bannière est un dégradé CSS + une
 * icône, rendus côté client (`GameView.tsx`, `ProfilePage.tsx`), rien à charger ni à stocker en
 * base à part l'id choisi. Certaines se débloquent par niveau (`unlockLevel`), comme suggéré par
 * la maquette fournie ("Débloqué au Niveau 15"). */
export interface DeathBanner {
  id: string;
  label: string;
  icon: string;
  /** Dégradé CSS (2 teintes), rendu en fond de la bannière. */
  gradient: readonly [string, string];
  /** Niveau de compte requis pour débloquer cette bannière — 1 = disponible dès le départ. */
  unlockLevel: number;
}

export const DEATH_BANNERS: readonly DeathBanner[] = [
  {
    id: 'default_skull',
    label: 'Tête de Mort',
    icon: '💀',
    gradient: ['#484A6E', '#2E3133'],
    unlockLevel: 1,
  },
  {
    id: 'frost',
    label: 'Givre',
    icon: '❄️',
    gradient: ['#6E708F', '#2E86AB'],
    unlockLevel: 5,
  },
  {
    id: 'neon_cyber',
    label: 'Néon Cyber',
    icon: '⚡',
    gradient: ['#5C6BC0', '#8E44AD'],
    unlockLevel: 8,
  },
  {
    id: 'venom',
    label: 'Venin',
    icon: '☠️',
    gradient: ['#3AAE8C', '#2E3133'],
    unlockLevel: 12,
  },
  {
    id: 'crown',
    label: 'Couronne',
    icon: '👑',
    gradient: ['#C9A227', '#2E3133'],
    unlockLevel: 15,
  },
  {
    id: 'magma',
    label: 'Magma',
    icon: '🔥',
    gradient: ['#E4572E', '#2E3133'],
    unlockLevel: 20,
  },
];

export const DEFAULT_DEATH_BANNER_ID = DEATH_BANNERS[0]!.id;
export const DEFAULT_DEATH_MESSAGE = 'Bien joué ! À la prochaine.';
export const MAX_DEATH_MESSAGE_LENGTH = 100;

export function deathBannerById(id: string): DeathBanner {
  return DEATH_BANNERS.find((banner) => banner.id === id) ?? DEATH_BANNERS[0]!;
}

/** Une bannière est utilisable par un compte si elle est déverrouillée à son niveau — validé
 * côté serveur (voir `AccountsService.updateDeathScreen`) avant tout enregistrement, jamais
 * fait confiance au client. */
export function isDeathBannerUnlocked(id: string, level: number): boolean {
  const banner = DEATH_BANNERS.find((b) => b.id === id);
  return banner !== undefined && level >= banner.unlockLevel;
}

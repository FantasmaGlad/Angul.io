/** Métadonnées d'affichage par mode de jeu (nom, description courte, couleur signature) —
 * définies côté client tant que `GET /api/modes` ne renvoie que des identifiants bruts (voir
 * cahier_des_charges_ui_ux.md §10, impact backend listé mais pas encore fait). Utilisé à la
 * fois par le panneau "Modes de jeu" et par le point coloré de la liste de salons — usage
 * fonctionnel minimal (distinguer les modes), pas décoratif (§1 révisé, style minimaliste). */

export interface ModeMeta {
  label: string;
  description: string;
  color: string;
}

const MODE_METADATA: Record<string, ModeMeta> = {
  vanilla: {
    label: 'Vanilla',
    description:
      'Le mode de référence : grossis en mangeant, sépare-toi pour attaquer, fusionne pour te regrouper.',
    color: 'var(--c-vanilla)',
  },
  hardcore: {
    label: 'Hardcore',
    description:
      'Manger un autre joueur rapporte 10x plus de masse — mais mourir efface toute la progression de la partie.',
    color: 'var(--c-hardcore)',
  },
  infini: {
    label: 'Infini',
    description:
      'Carte 5000x5000 aux bords toroïdaux : franchir un mur te téléporte de l\'autre côté sans perte de vitesse.',
    color: '#a855f7',
  },
  'mega-split': {
    label: 'Mega Split',
    description:
      'Jusqu\'à 64 cellules et refusion instantanée à chaque instant.',
    color: '#ec4899',
  },
};

export function modeMeta(modeId: string): ModeMeta {
  return (
    MODE_METADATA[modeId] ?? {
      label: modeId,
      description: 'Description à venir.',
      color: 'var(--text-faint)',
    }
  );
}

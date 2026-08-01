import { clamp } from './vector.js';

/**
 * Formule de zoom caméra — SOURCE UNIQUE partagée entre le client (dessin réel, voir
 * client/src/render.ts `computeCamera`) et le serveur (rayon d'intérêt réseau dérivé de la même
 * masse, voir server/src/engine/worker/interestFilter.ts). Avant ce fichier, ces constantes
 * n'existaient que côté client — les dupliquer côté serveur pour le filtrage par intérêt aurait
 * créé un risque de divergence silencieuse (une pastille visible à l'écran mais jamais envoyée,
 * si les deux formules dérivaient un jour l'une de l'autre) : un seul jeu de constantes, importé
 * des deux côtés, élimine structurellement ce risque.
 *
 * Base (1.44) : dézoom "confortable" au spawn (retour utilisateur, voir historique de
 * client/src/render.ts). Puis divisée par 4.5 (1.5 × 3, dézoom cumulatif demandé par les
 * retours utilisateur successifs) : la carte reste "spacieuse" y compris en tout début de partie.
 */
export const BASE_SCALE = 1.44 / 4.5;
export const MIN_SCALE = 0.1;
/** Légèrement au-dessus de `BASE_SCALE` : laisse un peu de marge de zoom supplémentaire pour les
 * morceaux plus petits que la référence (ex. juste après un split). */
export const MAX_SCALE = 1.76 / 4.5;
/** Le client n'a pas besoin de connaître M_START du mod actif : cette référence ne sert qu'à
 * calibrer le zoom, pas la simulation elle-même — voir le même raisonnement côté serveur pour le
 * rayon d'intérêt (`interestRadiusForMass` ci-dessous). */
export const REFERENCE_MASS = 50;

/** Échelle caméra (px écran / px monde) pour un joueur de masse `mass` — identique à la formule
 * historique de `computeCamera` (client/src/render.ts), extraite ici pour être réutilisable côté
 * serveur sans dupliquer la formule elle-même. */
export function computeScaleForMass(mass: number): number {
  return clamp(BASE_SCALE / Math.sqrt(mass / REFERENCE_MASS), MIN_SCALE, MAX_SCALE);
}

/** Demi-diagonale (px ÉCRAN) d'un viewport de référence 1920×1080 — sert uniquement à calibrer
 * `interestRadiusForMass` ci-dessous : le serveur ne connaît jamais la taille d'écran réelle du
 * client (aucun nouveau message n'est ajouté au protocole pour la lui transmettre, voir cahier
 * des charges §3.3), donc ce viewport de référence sert de gabarit générique. Un écran plus grand
 * (4K, multi-moniteur) est couvert par `INTEREST_SAFETY_MARGIN_WORLD_PX` ci-dessous, pas par une
 * détection réelle de la taille d'écran. */
export const REFERENCE_VIEWPORT_HALF_DIAGONAL_PX = Math.hypot(1920, 1080) / 2;

/** Marge de sécurité (px MONDE, donc indépendante du zoom) ajoutée au rayon d'intérêt calculé —
 * couvre la latence réseau (le joueur a pu bouger depuis le dernier `state` reçu), un Dash
 * (impulsion par défaut 4050px/s, voir client/src/prediction.ts `applyDash`) et un écran large/
 * multi-moniteur. Valeur de départ = distance parcourue en 500ms à pleine vitesse de Dash
 * (4050 × 0.5 = 2025px) + 20% de confort, arrondie — À CALIBRER en conditions réelles (cahier des
 * charges §3.3), ce n'est délibérément pas une valeur figée définitive. */
export const INTEREST_SAFETY_MARGIN_WORLD_PX = 2400;

/**
 * Rayon d'intérêt réseau (px MONDE) pour un joueur de masse `mass` — borne quelles entités lui
 * sont envoyées (voir server/src/engine/worker/interestFilter.ts), dérivé de la même formule de
 * zoom que la caméra réelle du client (`computeScaleForMass`) plutôt que d'un nouveau message
 * client dédié : le serveur connaît déjà la masse totale de chaque joueur
 * (`World.getPiecesByOwner`), et le zoom en est une fonction pure — voir cahier des charges §3.3.
 */
export function interestRadiusForMass(mass: number): number {
  return REFERENCE_VIEWPORT_HALF_DIAGONAL_PX / computeScaleForMass(mass) + INTEREST_SAFETY_MARGIN_WORLD_PX;
}

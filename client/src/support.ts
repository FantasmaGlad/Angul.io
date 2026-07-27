/** Lot 6.1/6.2 — plateforme de don et contenu de la page Soutien (cahier des charges §5.3).
 *
 * Plateforme choisie : **Ko-fi** — 0% de commission sur la formule gratuite (seuls les frais du
 * processeur de paiement s'appliquent), aucune création de société requise, don ponctuel libre
 * (pas de palier), disponible depuis la France. Alternatives écartées : Liberapay (orienté
 * dons récurrents, moins connu), PayPal.Me (frais PayPal plus élevés, aucune page dédiée),
 * GitHub Sponsors (processus d'éligibilité/vérification plus long avant le premier don possible).
 * Voir plan_implementation.md, Journal des décisions.
 *
 * **`DONATION_URL` est un espace réservé** : le compte Ko-fi réel doit être créé manuellement
 * (création de compte tiers, hors de portée d'un agent) puis cette constante mise à jour avant
 * mise en production — voir plan_implementation.md Lot 6.1.
 */
export const DONATION_URL = 'https://ko-fi.com/angulio';

/** Activation du statut Premium volontairement **manuelle** pour le MVP (Lot 6.3) : après un
 * don, l'admin active le compte via l'interface admin (Lot 5.4) — pas d'automatisation webhook
 * (Lot 6.5, différé). Le donateur doit donc indiquer son pseudo en jeu dans le message de don
 * pour que l'admin puisse faire le lien. */
export const SUPPORT_BODY =
  'Angul.io est un projet gratuit, sans publicité. Un don libre (aucun montant minimum) ' +
  'débloque le statut Premium, qui permet de créer vos propres salons (les comptes standards ' +
  "rejoignent les salons existants). L'activation est manuelle pour l'instant : indiquez votre " +
  'pseudo en jeu dans le message de don pour que votre compte soit activé.';

/** Module Économie & Boosts (§12 cahier_des_charges_admin.md) — placeholder architecture-ready,
 * volontairement sans aucune logique fonctionnelle (v1) : aucune monnaie ni boost n'existe dans
 * le jeu aujourd'hui. Sert uniquement à réserver l'entrée de navigation avec un état "Bientôt
 * disponible" — ne fait aucun appel réseau (§17 : "ne provoque aucune erreur ni appel réseau
 * superflu"). Le catalogue de boosts / attribution manuelle sera spécifié dans un document dédié
 * le jour où la monnaie sera conçue, ce module ne préempte pas ces décisions produit. */
export default function EconomyView() {
  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Économie &amp; Boosts</h2>
          <p className="view-subtitle">Monnaie in-app et boosts joueurs.</p>
        </div>
      </div>

      <section className="panel">
        <div className="placeholder">
          <span className="placeholder-tag">Bientôt disponible</span>
          <p>
            Aucune monnaie ni aucun boost n'existe encore dans Angul.io. Cette entrée réserve la
            place dans la navigation et dans le modèle de données compte joueur (champs optionnels
            non exploités) pour que l'activation future soit un ajout, pas une refonte.
          </p>
        </div>
      </section>
    </div>
  );
}

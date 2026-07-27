import { useState } from 'react';
import { modeMeta } from '../modes.js';

interface WikiPageProps {
  onClose: () => void;
  modes: string[];
}

type WikiSection = 'modes' | 'particles' | 'entities' | 'events';

export default function WikiPage({ onClose, modes }: WikiPageProps) {
  const [activeSection, setActiveSection] = useState<WikiSection>('modes');

  return (
    <div className="wiki-doc-container">
      {/* Bandeau d'ouverture vertical (Sidebar de gauche) */}
      <aside className="wiki-sidebar">
        <div className="wiki-sidebar-header">
          <div className="wiki-sidebar-title">ANGUL.IO</div>
          <div className="wiki-sidebar-subtitle">DOCUMENTATION TECHNIQUE</div>
        </div>

        <nav className="wiki-sidebar-nav">
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'modes' ? 'active' : ''}`}
            onClick={() => setActiveSection('modes')}
          >
            <span className="wiki-nav-num">01.</span> MODES DE JEU
          </button>
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'particles' ? 'active' : ''}`}
            onClick={() => setActiveSection('particles')}
          >
            <span className="wiki-nav-num">02.</span> PARTICULES & MASSE
          </button>
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'entities' ? 'active' : ''}`}
            onClick={() => setActiveSection('entities')}
          >
            <span className="wiki-nav-num">03.</span> ENTITES & IA
          </button>
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'events' ? 'active' : ''}`}
            onClick={() => setActiveSection('events')}
          >
            <span className="wiki-nav-num">04.</span> EVENEMENTS
          </button>
        </nav>

        <div className="wiki-sidebar-footer">
          <button type="button" className="wiki-back-button" onClick={onClose}>
            &lt;- RETOUR ACCUEIL
          </button>
        </div>
      </aside>

      {/* Zone de contenu principal (Style Documentation Froide) */}
      <main className="wiki-main-content">
        <header className="wiki-doc-header">
          <div className="wiki-breadcrumb">
            angulio / docs / {activeSection}
          </div>
          <div className="wiki-version-tag">DOC_VERSION 1.1.0</div>
        </header>

        <div className="wiki-doc-body">
          {activeSection === 'modes' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">01. MODES DE JEU</h1>
              <p className="wiki-doc-intro">
                Spécifications fonctionnelles et paramètres physiques des modes de jeu disponibles.
              </p>

              <div className="wiki-mode-grid">
                {modes.map((modeId) => {
                  const meta = modeMeta(modeId);
                  let startMass = '50 UC';
                  let xpMult = '1.0x';
                  let status = 'NOMINAL';

                  if (modeId === 'folie') {
                    startMass = '75 UC';
                    xpMult = '1.5x';
                    status = 'DYNAMIQUE';
                  } else if (modeId === 'hardcore') {
                    startMass = '100 UC';
                    xpMult = '10.0x';
                    status = 'HIGH_RISK';
                  }

                  return (
                    <div key={modeId} className="wiki-doc-block">
                      <div className="wiki-block-header">
                        <h2 className="wiki-doc-h2">{meta.label.toUpperCase()}</h2>
                        <span className="wiki-tech-badge">{status}</span>
                      </div>
                      <p className="wiki-doc-p">{meta.description}</p>

                      <table className="wiki-tech-table">
                        <thead>
                          <tr>
                            <th>PROPRIETE</th>
                            <th>VALEUR</th>
                            <th>DESCRIPTION</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Masse initiale (M0)</td>
                            <td>{startMass}</td>
                            <td>Masse attribuée au spawn initial.</td>
                          </tr>
                          <tr>
                            <td>Multiplicateur XP</td>
                            <td>{xpMult}</td>
                            <td>Facteur de conversion des gains d'expérience.</td>
                          </tr>
                          <tr>
                            <td>Seuil d'absorption</td>
                            <td>33.3% (1/3)</td>
                            <td>Surface minimale d'intersection requise.</td>
                          </tr>
                          <tr>
                            <td>Avantage de masse</td>
                            <td>+15%</td>
                            <td>Ratio de masse requis pour engager l'absorption.</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {activeSection === 'particles' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">02. PARTICULES ET MASSE</h1>
              <p className="wiki-doc-intro">
                Anatomie des éléments passifs et des transferts de masse au sein de l'arène.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">PARTICULES DE NOURRITURE (FOOD)</h2>
                <p className="wiki-doc-p">
                  Éléments passifs générés de façon homogène sur la carte. Ils constituent la ressource de base pour augmenter la masse des entités.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>PARAMÈTRE</th>
                      <th>VALEUR</th>
                      <th>REMARQUES</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Masse unitaire</td>
                      <td>1 à 3 UC</td>
                      <td>Valeur distribuée de manière aléatoire.</td>
                    </tr>
                    <tr>
                      <td>Gain d'XP</td>
                      <td>1 XP / UC</td>
                      <td>Calculé directement lors de la consommation.</td>
                    </tr>
                    <tr>
                      <td>Régénération</td>
                      <td>Continue</td>
                      <td>Maintenue au plafond calculé pour le salon.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">PROJECTIONS DE MASSE (MASS EJECT)</h2>
                <p className="wiki-doc-p">
                  Impulsions de masse émises par les entités pour transférer de la masse ou ajuster la vitesse.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>PARAMÈTRE</th>
                      <th>VALEUR</th>
                      <th>REMARQUES</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Masse éjectée</td>
                      <td>12 UC</td>
                      <td>Déduite immédiatement de la masse de l'émetteur.</td>
                    </tr>
                    <tr>
                      <td>Vélocité initiale</td>
                      <td>Élevée</td>
                      <td>Décroissance rapide sous l'effet des frottements.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === 'entities' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">03. ENTITES ET IA</h1>
              <p className="wiki-doc-intro">
                Structure du moteur comportemental des entités autonomes (Bots) et Challengers.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">MOTEUR COMPORTEMENTAL (FREQUENCY: 2 HZ)</h2>
                <p className="wiki-doc-p">
                  Les bots s'exécutent en boucle locale au niveau du moteur serveur avec une évaluation de trajectoire toutes les 500 ms.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>PROFIL</th>
                      <th>PROPORTION</th>
                      <th>COMPORTEMENT SPECIFIQUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>FUIS</td>
                      <td>25%</td>
                      <td>Région de détection 450px. Évitement actif si prédateur &lt; 350px.</td>
                    </tr>
                    <tr>
                      <td>NEUTRE</td>
                      <td>30%</td>
                      <td>Collecte passive. Évitement local si prédateur &lt; 150px.</td>
                    </tr>
                    <tr>
                      <td>AGRESSIF</td>
                      <td>30%</td>
                      <td>Chasse active. Déclenchement de split si distance &lt;= 300px.</td>
                    </tr>
                    <tr>
                      <td>FOU</td>
                      <td>15%</td>
                      <td>Changements de direction et pauses aléatoires.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">LIGUE DES CHALLENGERS (TOP 1 A 10)</h2>
                <p className="wiki-doc-p">
                  10 entités de rang prédéfini maintenues en permanence pour alimenter le haut du classement.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>RANG</th>
                      <th>MULTIPLICATEUR MASSE</th>
                      <th>REGENERATION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Rang 1 (Top 1)</td>
                      <td>50x M0</td>
                      <td>Réapparition automatique sur élimination.</td>
                    </tr>
                    <tr>
                      <td>Rang 5 (Top 5)</td>
                      <td>30x M0</td>
                      <td>Réapparition automatique sur élimination.</td>
                    </tr>
                    <tr>
                      <td>Rang 10 (Top 10)</td>
                      <td>5x M0</td>
                      <td>Réapparition automatique sur élimination.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === 'events' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">04. EVENEMENTS ET EXTENSIONS</h1>
              <p className="wiki-doc-intro">
                Modules d'extension et événements planifiés pour les futures révisions du moteur.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">ÉVÉNEMENTS DE CARTE (PLANIFIÉ)</h2>
                <p className="wiki-doc-p">
                  Documentation des modules d'événements temporaires en cours de spécification.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>MODULE</th>
                      <th>STATUT</th>
                      <th>DESCRIPTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Anomalies de masse</td>
                      <td>EN SPÉCIFICATION</td>
                      <td>Zones d'attraction temporaires à haute densité.</td>
                    </tr>
                    <tr>
                      <td>Entités World Boss</td>
                      <td>EN SPÉCIFICATION</td>
                      <td>Cibles de grande taille à comportement complexe.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}

import { useState } from 'react';
import { modeMeta } from '../modes.js';

interface WikiPageProps {
  onClose: () => void;
  modes: string[];
}

type WikiTab = 'modes' | 'particles' | 'entities' | 'bosses';

export default function WikiPage({ onClose, modes }: WikiPageProps) {
  const [activeTab, setActiveTab] = useState<WikiTab>('modes');

  return (
    <div className="wiki-page-container">
      {/* Header collant */}
      <header className="wiki-header">
        <div className="wiki-brand">
          <div className="wiki-brand-icon">📖</div>
          <div>
            <div className="wiki-title">Encyclopédie Angul.io</div>
            <div className="wiki-subtitle">Guide officiel des modes, particules et entités</div>
          </div>
        </div>
        <button type="button" className="wiki-close-btn" onClick={onClose}>
          ⬅ Retour à l'accueil
        </button>
      </header>

      {/* Hero Section */}
      <div className="wiki-hero">
        <h1>Centre de Connaissances Angul.io</h1>
        <p>
          Découvrez en détail la physique de l'arène, les subtilités de chaque mode de jeu, la
          mécanique des particules ainsi que le comportement des robots et boss.
        </p>
      </div>

      {/* Navigation des Onglets */}
      <nav className="wiki-tabs">
        <button
          type="button"
          className={`wiki-tab-btn ${activeTab === 'modes' ? 'active' : ''}`}
          onClick={() => setActiveTab('modes')}
        >
          🎮 Modes de Jeu
        </button>
        <button
          type="button"
          className={`wiki-tab-btn ${activeTab === 'particles' ? 'active' : ''}`}
          onClick={() => setActiveTab('particles')}
        >
          🧪 Particules & Éléments
        </button>
        <button
          type="button"
          className={`wiki-tab-btn ${activeTab === 'entities' ? 'active' : ''}`}
          onClick={() => setActiveTab('entities')}
        >
          🤖 IA & Challengers
        </button>
        <button
          type="button"
          className={`wiki-tab-btn ${activeTab === 'bosses' ? 'active' : ''}`}
          onClick={() => setActiveTab('bosses')}
        >
          👑 Boss & Événements
        </button>
      </nav>

      {/* Contenu dynamique par Onglet */}
      <main className="wiki-content-body">
        {activeTab === 'modes' && (
          <div className="wiki-grid">
            {modes.map((modeId) => {
              const meta = modeMeta(modeId);
              let badge = 'Mode Référence';
              let xpMult = '1.0x';
              let startMass = '50';
              let details = 'Vitesse standard, croissance progressive et fusion équilibrée.';

              if (modeId === 'folie') {
                badge = 'Chaos & Cadence';
                xpMult = '1.5x';
                startMass = '75';
                details = 'Physique accélérée, cooldown de fusion -30% et éjection +50%.';
              } else if (modeId === 'hardcore') {
                badge = 'Haute Tension (XP x10)';
                xpMult = '10.0x';
                startMass = '100';
                details =
                  'Éliminations à haut gain d’XP. Perte totale à la mort sans conservation.';
              }

              return (
                <div
                  key={modeId}
                  className="wiki-card"
                  style={{ borderTop: `4px solid ${meta.color}` }}
                >
                  <span className="wiki-card-badge">{badge}</span>
                  <h3 className="wiki-card-title">{meta.label}</h3>
                  <p className="wiki-card-desc">{meta.description}</p>
                  <ul className="wiki-spec-list">
                    <li className="wiki-spec-item">
                      <span className="wiki-spec-label">Masse de départ</span>
                      <span className="wiki-spec-value">{startMass}</span>
                    </li>
                    <li className="wiki-spec-item">
                      <span className="wiki-spec-label">Multiplicateur d'XP</span>
                      <span className="wiki-spec-value">{xpMult}</span>
                    </li>
                    <li className="wiki-spec-item">
                      <span className="wiki-spec-label">Chevauchement d'absorption</span>
                      <span className="wiki-spec-value">33.3% (1/3)</span>
                    </li>
                    <li className="wiki-spec-item">
                      <span className="wiki-spec-label">Spécificités</span>
                      <span className="wiki-spec-value">{details}</span>
                    </li>
                  </ul>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === 'particles' && (
          <div className="wiki-grid">
            <div className="wiki-card">
              <span className="wiki-card-badge">Élément de Base</span>
              <h3 className="wiki-card-title">🟢 Nourriture Standard</h3>
              <p className="wiki-card-desc">
                Particules d'énergie générées en continu sur toute la carte. Elles constituent la
                source primaire de croissance pour les cellules de petite taille.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Masse conférée</span>
                  <span className="wiki-spec-value">+1 à +3</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">XP rapportée</span>
                  <span className="wiki-spec-value">+1 XP / unité</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Plafond dynamique</span>
                  <span className="wiki-spec-value">Régulation auto par salon</span>
                </li>
              </ul>
            </div>

            <div className="wiki-card">
              <span className="wiki-card-badge">Action Joueur</span>
              <h3 className="wiki-card-title">🔵 Projections de Masse</h3>
              <p className="wiki-card-desc">
                Morceaux de masse éjectés volontairement par les joueurs pour nourrir un allié,
                alléger leur cellule afin de gagner en vitesse ou interagir avec le décor.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Masse de l'éjection</span>
                  <span className="wiki-spec-value">+12 masse</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Vélocité initiale</span>
                  <span className="wiki-spec-value">Impulsion rapide</span>
                </li>
              </ul>
            </div>

            <div className="wiki-card">
              <span className="wiki-card-badge badge-soon">Prochainement</span>
              <h3 className="wiki-card-title">🦠 Virus & Instabilités</h3>
              <p className="wiki-card-desc">
                Cellules épineuses fixes qui font éclater en 16 morceaux les cellules de masse
                supérieure à 130 lorsqu'elles entrent en collision.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Effet d'impact</span>
                  <span className="wiki-spec-value">Split forcé en 16</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Interaction</span>
                  <span className="wiki-spec-value">Alimentable par éjection</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'entities' && (
          <div className="wiki-grid">
            <div className="wiki-card">
              <span className="wiki-card-badge">Moteur AI 2 Hz</span>
              <h3 className="wiki-card-title">🤖 Profils de Bots</h3>
              <p className="wiki-card-desc">
                L'arène est peuplée dynamiquement par 4 types d'IA évaluées à une fréquence de 2 Hz
                (500 ms) avec calcul de trajectoire et de split létal.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">🛡️ Fuis (25%)</span>
                  <span className="wiki-spec-value">Évite prédateurs dès 350px</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">⚖️ Neutre (30%)</span>
                  <span className="wiki-spec-value">Ferme la nourriture paisiblement</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">⚔️ Agressif (30%)</span>
                  <span className="wiki-spec-value">Chasseur & Split Létal (d≤300px)</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">🤪 Fou (15%)</span>
                  <span className="wiki-spec-value">Mouvements & Splits imprévisibles</span>
                </li>
              </ul>
            </div>

            <div className="wiki-card">
              <span className="wiki-card-badge">Ligue de Salon</span>
              <h3 className="wiki-card-title">🏆 Top 10 Challengers</h3>
              <p className="wiki-card-desc">
                10 Boss de salon permanents de Top 1 à Top 10 servant de cibles de haut niveau à
                gravir dans le classement en direct.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Rang 1 (Top 1)</span>
                  <span className="wiki-spec-value">50x Masse initiale (2500 mass)</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Rang 5 (Top 5)</span>
                  <span className="wiki-spec-value">30x Masse initiale (1500 mass)</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Rang 10 (Top 10)</span>
                  <span className="wiki-spec-value">5x Masse initiale (250 mass)</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Régénération</span>
                  <span className="wiki-spec-value">Immédiate sur défaite</span>
                </li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'bosses' && (
          <div className="wiki-grid">
            <div className="wiki-card">
              <span className="wiki-card-badge badge-soon">Bientôt Disponible</span>
              <h3 className="wiki-card-title">🐉 Boss d'Arène Géant</h3>
              <p className="wiki-card-desc">
                Créature colossale contrôlée par le serveur qui apparaîtra périodiquement au centre de
                la carte. Les joueurs devront s'allier pour venir à bout de sa masse démesurée.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Type d’événement</span>
                  <span className="wiki-spec-value">Raid World Boss</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Recompense</span>
                  <span className="wiki-spec-value">Loot d'XP & Titre exclusif</span>
                </li>
              </ul>
            </div>

            <div className="wiki-card">
              <span className="wiki-card-badge badge-soon">Bientôt Disponible</span>
              <h3 className="wiki-card-title">🌌 Pluie de Particules Célestes</h3>
              <p className="wiki-card-desc">
                Événement météo provoquant une averse concentrée de super-particules de masse dans
                une zone donnée de la carte pendant 60 secondes.
              </p>
              <ul className="wiki-spec-list">
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Durée</span>
                  <span className="wiki-spec-value">60 secondes</span>
                </li>
                <li className="wiki-spec-item">
                  <span className="wiki-spec-label">Impact</span>
                  <span className="wiki-spec-value">Zone à haute densité de masse</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

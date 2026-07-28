import { BOT_IDENTITIES } from '@angulio/shared';
import { useEffect, useState } from 'react';
import { fetchAvailableModes } from '../lobby.js';
import { modeMeta } from '../modes.js';

interface WikiPageProps {
  onClose?: () => void;
  modes?: string[];
}

type WikiSection = 'modes' | 'world' | 'foes' | 'events';

/** Étiquette d'ambiance par mode (wiki joueur — pas un statut d'ingénierie). Modes inconnus
 * (mod futur) : libellé neutre plutôt que de ne rien afficher. */
function modeVibe(modeId: string): string {
  if (modeId === 'folie') return 'IMPRÉVISIBLE';
  if (modeId === 'hardcore') return 'RISQUE MAXIMUM';
  if (modeId === 'vanilla') return 'CLASSIQUE';
  return 'À DÉCOUVRIR';
}

export default function WikiPage({ onClose, modes }: WikiPageProps) {
  const [activeSection, setActiveSection] = useState<WikiSection>('modes');
  const [modesList, setModesList] = useState<string[]>(modes || []);

  useEffect(() => {
    if (modes && modes.length > 0) {
      setModesList(modes);
      return;
    }
    void (async () => {
      try {
        const fetched = await fetchAvailableModes();
        setModesList(fetched);
      } catch {
        setModesList(['vanilla', 'folie', 'hardcore']);
      }
    })();
  }, [modes]);

  const handleBack = (): void => {
    if (onClose) {
      onClose();
    } else {
      window.location.href = '/';
    }
  };

  const sectionTitle: Record<WikiSection, string> = {
    modes: 'Modes de jeu',
    world: 'Le monde',
    foes: 'Adversaires',
    events: 'À venir',
  };

  return (
    <div className="wiki-doc-container">
      {/* Bandeau d'ouverture vertical (Sidebar de gauche) */}
      <aside className="wiki-sidebar">
        <div className="wiki-sidebar-header">
          <div className="wiki-sidebar-title">ANGUL.IO</div>
          <div className="wiki-sidebar-subtitle">GUIDE DU JOUEUR</div>
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
            className={`wiki-nav-item ${activeSection === 'world' ? 'active' : ''}`}
            onClick={() => setActiveSection('world')}
          >
            <span className="wiki-nav-num">02.</span> LE MONDE
          </button>
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'foes' ? 'active' : ''}`}
            onClick={() => setActiveSection('foes')}
          >
            <span className="wiki-nav-num">03.</span> ADVERSAIRES
          </button>
          <button
            type="button"
            className={`wiki-nav-item ${activeSection === 'events' ? 'active' : ''}`}
            onClick={() => setActiveSection('events')}
          >
            <span className="wiki-nav-num">04.</span> À VENIR
          </button>
        </nav>

        <div className="wiki-sidebar-footer">
          <button type="button" className="wiki-back-button" onClick={handleBack}>
            &lt;- RETOUR ACCUEIL
          </button>
        </div>
      </aside>

      {/* Zone de contenu principal */}
      <main className="wiki-main-content">
        <header className="wiki-doc-header">
          <div className="wiki-breadcrumb">Wiki Angul.io</div>
          <div className="wiki-version-tag">{sectionTitle[activeSection]}</div>
        </header>

        <div className="wiki-doc-body">
          {activeSection === 'modes' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">Modes de jeu</h1>
              <p className="wiki-doc-intro">
                Trois façons de jouer à Angul.io, du plus classique au plus radical — choisis
                l'ambiance que tu cherches depuis l'accueil.
              </p>

              <div className="wiki-mode-grid">
                {modesList.map((modeId) => {
                  const meta = modeMeta(modeId);

                  let startMass = '50 UC';
                  let xpPace = 'Normale';

                  if (modeId === 'folie') {
                    startMass = '75 UC';
                    xpPace = '1.5x plus rapide';
                  } else if (modeId === 'hardcore') {
                    startMass = '100 UC';
                    xpPace = '10x plus rapide';
                  }

                  return (
                    <div key={modeId} className="wiki-doc-block">
                      <div className="wiki-block-header">
                        <h2 className="wiki-doc-h2">{meta.label.toUpperCase()}</h2>
                        <span className="wiki-tech-badge">{modeVibe(modeId)}</span>
                      </div>
                      <p className="wiki-doc-p">{meta.description}</p>

                      <table className="wiki-tech-table">
                        <thead>
                          <tr>
                            <th>À SAVOIR</th>
                            <th>VALEUR</th>
                            <th>CE QUE ÇA CHANGE</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>Masse de départ</td>
                            <td>{startMass}</td>
                            <td>Ta taille au moment de rejoindre la partie.</td>
                          </tr>
                          <tr>
                            <td>Progression (XP)</td>
                            <td>{xpPace}</td>
                            <td>À quelle vitesse tu montes de niveau sur ton compte.</td>
                          </tr>
                          <tr>
                            <td>Pour avaler quelqu'un</td>
                            <td>+15% de masse</td>
                            <td>Il te faut environ un sixième de masse en plus que ta cible.</td>
                          </tr>
                          <tr>
                            <td>Contact nécessaire</td>
                            <td>1/3 de recouvrement</td>
                            <td>Ta cellule doit en recouvrir au moins un tiers pour l'absorber.</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {activeSection === 'world' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">Le monde</h1>
              <p className="wiki-doc-intro">
                Ce que tu croises dans l'arène : de quoi grossir, et de quoi frapper plus fort.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">La nourriture</h2>
                <p className="wiki-doc-p">
                  De petites pastilles colorées parsèment toute la carte — la ressource de base pour
                  prendre de la masse. Leur couleur indique leur valeur : plus une pastille est
                  rare, plus elle te fait grossir. Garde l'œil ouvert pour la pastille arc-en-ciel,
                  bien plus rare et bien plus généreuse que les autres.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>PASTILLE</th>
                      <th>CE QU'ELLE RAPPORTE</th>
                      <th>REMARQUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Pastilles courantes</td>
                      <td>1 à 3 UC</td>
                      <td>La ressource de base, partout sur la carte.</td>
                    </tr>
                    <tr>
                      <td>Pastille arc-en-ciel</td>
                      <td>12 UC</td>
                      <td>Rare et bien plus généreuse — à ne pas laisser filer.</td>
                    </tr>
                    <tr>
                      <td>Régénération</td>
                      <td>Continue</td>
                      <td>La carte ne reste jamais vide bien longtemps.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">L'éjection de masse</h2>
                <p className="wiki-doc-p">
                  Tu peux éjecter un petit morceau de ta propre masse dans la direction de ton
                  curseur — un coup de pouce pour accélérer une fuite, ou de quoi nourrir un allié.
                  Une manœuvre à double tranchant : elle te fait perdre de la masse immédiatement,
                  alors garde-la pour le bon moment.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>À SAVOIR</th>
                      <th>VALEUR</th>
                      <th>REMARQUE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Masse éjectée</td>
                      <td>12 UC</td>
                      <td>Déduite immédiatement de ta propre masse.</td>
                    </tr>
                    <tr>
                      <td>Vitesse d'éjection</td>
                      <td>Élevée</td>
                      <td>Ralentit vite — vise juste, l'effet ne dure pas.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === 'foes' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">Adversaires</h1>
              <p className="wiki-doc-intro">
                Tu ne joueras jamais seul : des robots peuplent chaque salon pour qu'il y ait
                toujours du monde dans l'arène.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">Quatre tempéraments</h2>
                <p className="wiki-doc-p">
                  Chaque robot suit l'un de ces quatre comportements — apprends à les reconnaître
                  pour savoir qui chasser et qui éviter.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>TEMPÉRAMENT</th>
                      <th>PART DES ROBOTS</th>
                      <th>COMMENT LE RECONNAÎTRE</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Les Prudents</td>
                      <td>25%</td>
                      <td>
                        Détectent le danger de loin et s'enfuient dès qu'un prédateur approche.
                      </td>
                    </tr>
                    <tr>
                      <td>Les Tranquilles</td>
                      <td>30%</td>
                      <td>
                        Se concentrent sur la nourriture, ne s'écartent qu'au dernier moment si
                        quelqu'un les menace de près.
                      </td>
                    </tr>
                    <tr>
                      <td>Les Chasseurs</td>
                      <td>30%</td>
                      <td>
                        Traquent activement les proies et n'hésitent pas à se scinder pour attaquer.
                      </td>
                    </tr>
                    <tr>
                      <td>Les Imprévisibles</td>
                      <td>15%</td>
                      <td>Changent de direction sans prévenir — impossibles à anticiper.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">La Ligue des Challengers</h2>
                <p className="wiki-doc-p">
                  Dix adversaires de rang fixe occupent en permanence le haut du classement. Ils ne
                  restent jamais éliminés bien longtemps : les vaincre est un exploit, mais ils
                  reviendront toujours pour une revanche.
                </p>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>RANG</th>
                      <th>PUISSANCE</th>
                      <th>PARTICULARITÉ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Rang 1 (le champion)</td>
                      <td>50x un joueur standard</td>
                      <td>Revient toujours après sa mort.</td>
                    </tr>
                    <tr>
                      <td>Rang 5</td>
                      <td>30x un joueur standard</td>
                      <td>Revient toujours après sa mort.</td>
                    </tr>
                    <tr>
                      <td>Rang 10</td>
                      <td>5x un joueur standard</td>
                      <td>Revient toujours après sa mort.</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">Bestiaire</h2>
                <p className="wiki-doc-p">
                  {BOT_IDENTITIES.length} noms circulent dans les salons d'Angul.io — croise-les
                  assez souvent et tu commenceras à reconnaître les habitués.
                </p>
                <div className="wiki-bestiary-grid">
                  {BOT_IDENTITIES.map((bot) => (
                    <div key={bot.name} className="wiki-bestiary-chip">
                      <span
                        className="wiki-bestiary-dot"
                        style={{ background: bot.color }}
                        aria-hidden="true"
                      />
                      {bot.name}
                    </div>
                  ))}
                </div>
              </div>
            </section>
          )}

          {activeSection === 'events' && (
            <section className="wiki-doc-section">
              <h1 className="wiki-doc-h1">À venir</h1>
              <p className="wiki-doc-intro">
                Des idées d'extensions en réflexion pour la suite d'Angul.io.
              </p>

              <div className="wiki-doc-block">
                <h2 className="wiki-doc-h2">Événements de carte</h2>
                <table className="wiki-tech-table">
                  <thead>
                    <tr>
                      <th>IDÉE</th>
                      <th>STATUT</th>
                      <th>DESCRIPTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Anomalies de masse</td>
                      <td>En réflexion</td>
                      <td>Des zones temporaires à forte concentration de nourriture.</td>
                    </tr>
                    <tr>
                      <td>Boss de map</td>
                      <td>En réflexion</td>
                      <td>Une cible géante, rare, au comportement bien à elle.</td>
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

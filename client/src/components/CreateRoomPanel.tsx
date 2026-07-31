import { useEffect, useState } from 'react';
import { createRoom } from '../lobby.js';
import { modeMeta } from '../modes.js';
import { navigate } from '../router.js';

const MIN_ROOM_MAX_PLAYERS = 2;
const MAX_ROOM_MAX_PLAYERS = 200;
const DEFAULT_ROOM_MAX_PLAYERS = 50;

/** Bornes de personnalisation d'un salon privé (demande utilisateur, mêmes bornes que côté
 * serveur — voir net/http/routes/lobby.ts). */
const MIN_ROOM_BOT_COUNT = 0;
const MAX_ROOM_BOT_COUNT = 50;
const DEFAULT_ROOM_BOT_COUNT = 15;
const MIN_ROOM_MAP_SIZE = 1000;
const MAX_ROOM_MAP_SIZE = 50_000;
const DEFAULT_ROOM_MAP_SIZE = 15_000;

const DURATION_OPTIONS: Array<{ value: string; label: string; ms: number | undefined }> = [
  { value: '15m', label: '15 minutes', ms: 15 * 60_000 },
  { value: '30m', label: '30 minutes', ms: 30 * 60_000 },
  { value: '1h', label: '1 heure', ms: 60 * 60_000 },
  { value: '2h', label: '2 heures', ms: 2 * 60 * 60_000 },
  { value: '4h', label: '4 heures', ms: 4 * 60 * 60_000 },
  { value: 'unlimited', label: 'Illimitée', ms: undefined },
];

interface CreateRoomPanelProps {
  modes: string[];
  authToken: string | undefined;
  isPremium: boolean;
  isLoggedIn: boolean;
  onJoinRoom: (roomIdOrInviteCode: string, inviteCodeToShow?: string) => void;
}

function generate6DigitCode(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
}

/** Parse+borne un champ numérique de formulaire — `undefined` si non renseigné/non entier, sinon
 * clampé dans `[min, max]` plutôt que rejeté (une valeur hors bornes tapée au clavier reste
 * corrigée silencieusement à la borne la plus proche, comme les champs `maxPlayers` existants). */
function parseClampedInt(raw: string, min: number, max: number): number | undefined {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return undefined;
  return Math.min(max, Math.max(min, parsed));
}

export default function CreateRoomPanel({
  modes,
  authToken,
  isPremium,
  isLoggedIn,
  onJoinRoom,
}: CreateRoomPanelProps) {
  const [roomName, setRoomName] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(String(DEFAULT_ROOM_MAX_PLAYERS));
  const [duration, setDuration] = useState('2h');
  const [isPrivate, setIsPrivate] = useState(true);
  const [botsEnabled, setBotsEnabled] = useState(true);
  const [botCountMode, setBotCountMode] = useState<'fixed' | 'range'>('fixed');
  const [botCountFixed, setBotCountFixed] = useState(String(DEFAULT_ROOM_BOT_COUNT));
  const [botCountMin, setBotCountMin] = useState('6');
  const [botCountMax, setBotCountMax] = useState(String(DEFAULT_ROOM_BOT_COUNT));
  const [mapSize, setMapSize] = useState(String(DEFAULT_ROOM_MAP_SIZE));
  const [previewCode, setPreviewCode] = useState(() => generate6DigitCode());
  const [joinCode, setJoinCode] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (modes.length > 0 && !modes.includes(selectedMode)) setSelectedMode(modes[0]!);
  }, [modes, selectedMode]);

  const canCreateRoom = isLoggedIn && isPremium;

  const handleRegenerateCode = (): void => {
    setPreviewCode(generate6DigitCode());
  };

  const handleCreate = (): void => {
    void (async () => {
      setFormError('');
      const name = roomName.trim();
      if (!name) {
        setFormError('Le nom du salon est requis.');
        return;
      }
      const parsedMaxPlayers = Number(maxPlayers);
      const durationMs = DURATION_OPTIONS.find((option) => option.value === duration)?.ms;
      const parsedMapSize = parseClampedInt(mapSize, MIN_ROOM_MAP_SIZE, MAX_ROOM_MAP_SIZE);
      // "Fixe" = min et max identiques (population de bots qui ne varie jamais, voir
      // `applyRoomBotCountOverride`, roomInstance.ts) — seulement envoyé si les bots sont activés,
      // sinon `botsEnabled: false` côté serveur ignore de toute façon toute population demandée.
      const botCount = botsEnabled
        ? botCountMode === 'fixed'
          ? (() => {
              const fixed = parseClampedInt(botCountFixed, MIN_ROOM_BOT_COUNT, MAX_ROOM_BOT_COUNT);
              return fixed !== undefined ? { min: fixed, max: fixed } : undefined;
            })()
          : (() => {
              const min = parseClampedInt(botCountMin, MIN_ROOM_BOT_COUNT, MAX_ROOM_BOT_COUNT);
              const max = parseClampedInt(botCountMax, MIN_ROOM_BOT_COUNT, MAX_ROOM_BOT_COUNT);
              if (min === undefined || max === undefined) return undefined;
              return min <= max ? { min, max } : { min: max, max: min };
            })()
        : undefined;

      try {
        const room = await createRoom(
          name,
          selectedMode,
          isPrivate ? 'private' : 'public',
          authToken,
          {
            maxPlayers: Number.isInteger(parsedMaxPlayers) ? parsedMaxPlayers : undefined,
            durationMs,
            botsEnabled,
            inviteCode: isPrivate ? previewCode : undefined,
            mapSize: parsedMapSize,
            botCount,
          },
        );
        const finalCode = room.inviteCode || previewCode;
        // Un salon PRIVÉ n'est résolu par le réseau que par son code d'invitation, jamais par son
        // id interne (voir `RoomManager.getManagedRoom`, roomManager.ts : un id de salon privé
        // renvoie délibérément `undefined`, pour ne pas le rendre devinable/énumérable) — passer
        // `room.id` ici pour un salon privé faisait échouer la connexion WebSocket qui suit
        // immédiatement (`WS_CLOSE_ROOM_NOT_FOUND`), alors même que le salon venait d'être créé et
        // peuplé de bots côté serveur : "le salon se crée, se remplit de robots, mais est
        // introuvable et non joignable" (retour utilisateur). `room.id` reste correct pour un
        // salon PUBLIC, résolu par son id.
        onJoinRoom(isPrivate ? finalCode : room.id, isPrivate ? finalCode : undefined);
      } catch (error) {
        setFormError((error as Error).message);
      }
    })();
  };

  const handleJoinCode = (): void => {
    const code = joinCode.trim();
    if (!code) {
      setFormError("Le code d'invitation est requis.");
      return;
    }
    onJoinRoom(code);
  };

  return (
    <section className="home-column create-room-panel">
      <div className="create-section-block">
        <span className="section-title">CRÉER UN SALON PRIVÉ</span>

        {canCreateRoom ? (
          <div className="create-room-form">
            <label className="field">
              <span className="field-label">NOM DU SALON</span>
              <input
                className="clean-input"
                value={roomName}
                onChange={(event) => setRoomName(event.target.value)}
                placeholder="Nom personnalisé..."
                maxLength={40}
              />
            </label>

            <label className="field">
              <span className="field-label">MODE DE JEU</span>
              <select
                className="clean-select"
                value={selectedMode}
                onChange={(event) => setSelectedMode(event.target.value)}
              >
                {modes.map((modeId) => (
                  <option key={modeId} value={modeId}>
                    {modeMeta(modeId).label}
                  </option>
                ))}
              </select>
            </label>

            <div className="field-row-split">
              <label className="field">
                <span className="field-label">CAPACITÉ</span>
                <input
                  className="clean-input"
                  type="number"
                  min={MIN_ROOM_MAX_PLAYERS}
                  max={MAX_ROOM_MAX_PLAYERS}
                  value={maxPlayers}
                  onChange={(event) => setMaxPlayers(event.target.value)}
                />
              </label>

              <label className="field">
                <span className="field-label">DURÉE</span>
                <select
                  className="clean-select"
                  value={duration}
                  onChange={(event) => setDuration(event.target.value)}
                >
                  {DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="field-row-toggle">
              <span className="field-label">ROBOTS (IA)</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={botsEnabled}
                  onChange={(event) => setBotsEnabled(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true" />
              </label>
            </div>

            {botsEnabled && (
              <>
                <label className="field">
                  <span className="field-label">NOMBRE DE ROBOTS</span>
                  <select
                    className="clean-select"
                    value={botCountMode}
                    onChange={(event) => setBotCountMode(event.target.value as 'fixed' | 'range')}
                  >
                    <option value="fixed">Fixe</option>
                    <option value="range">Variable (min / max selon les joueurs)</option>
                  </select>
                </label>

                {botCountMode === 'fixed' ? (
                  <label className="field">
                    <span className="field-label">TOTAL ({MIN_ROOM_BOT_COUNT}-{MAX_ROOM_BOT_COUNT})</span>
                    <input
                      className="clean-input"
                      type="number"
                      min={MIN_ROOM_BOT_COUNT}
                      max={MAX_ROOM_BOT_COUNT}
                      value={botCountFixed}
                      onChange={(event) => setBotCountFixed(event.target.value)}
                    />
                  </label>
                ) : (
                  <div className="field-row-split">
                    <label className="field">
                      <span className="field-label">MINI ({MIN_ROOM_BOT_COUNT}-{MAX_ROOM_BOT_COUNT})</span>
                      <input
                        className="clean-input"
                        type="number"
                        min={MIN_ROOM_BOT_COUNT}
                        max={MAX_ROOM_BOT_COUNT}
                        value={botCountMin}
                        onChange={(event) => setBotCountMin(event.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">MAXI ({MIN_ROOM_BOT_COUNT}-{MAX_ROOM_BOT_COUNT})</span>
                      <input
                        className="clean-input"
                        type="number"
                        min={MIN_ROOM_BOT_COUNT}
                        max={MAX_ROOM_BOT_COUNT}
                        value={botCountMax}
                        onChange={(event) => setBotCountMax(event.target.value)}
                      />
                    </label>
                  </div>
                )}
              </>
            )}

            <label className="field">
              <span className="field-label">
                TAILLE DE LA CARTE ({MIN_ROOM_MAP_SIZE} - {MAX_ROOM_MAP_SIZE})
              </span>
              <input
                className="clean-input"
                type="number"
                step={1000}
                min={MIN_ROOM_MAP_SIZE}
                max={MAX_ROOM_MAP_SIZE}
                value={mapSize}
                onChange={(event) => setMapSize(event.target.value)}
              />
            </label>

            <div className="field-row-toggle">
              <span className="field-label">ACCÈS PRIVÉ</span>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(event) => setIsPrivate(event.target.checked)}
                />
                <span className="toggle-track" aria-hidden="true" />
              </label>
            </div>

            {isPrivate && (
              <label className="field">
                <span className="field-label">CODE DU SALON (À LA VOLÉE)</span>
                <div className="join-code-row">
                  <input className="clean-input code-output" value={previewCode} readOnly />
                  <button
                    className="btn-secondary-action"
                    type="button"
                    onClick={handleRegenerateCode}
                    title="Générer un autre code"
                  >
                    Régénérer
                  </button>
                </div>
              </label>
            )}

            <button className="btn-primary-action" type="button" onClick={handleCreate}>
              CRÉER ET REJOINDRE
            </button>
          </div>
        ) : (
          <div className="premium-promo-card">
            <p className="premium-promo-text">
              La création de salons personnalisés est réservée aux membres <strong>Premium</strong>{' '}
              (don libre).
            </p>
            <button
              className="btn-secondary-action"
              type="button"
              onClick={() => navigate('/soutenir')}
            >
              SOUTENIR LE PROJET
            </button>
          </div>
        )}
      </div>

      <div className="join-by-code-section">
        <span className="section-title">REJOINDRE PAR CODE</span>
        <div className="join-code-row">
          <input
            className="clean-input code-input"
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="Code d'accès"
            maxLength={6}
          />
          <button className="btn-secondary-action" type="button" onClick={handleJoinCode}>
            REJOINDRE
          </button>
        </div>
      </div>

      {formError && <p className="error-text">{formError}</p>}
    </section>
  );
}

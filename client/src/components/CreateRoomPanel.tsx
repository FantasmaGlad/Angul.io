import { useEffect, useState } from 'react';
import { createRoom } from '../lobby.js';
import { modeMeta } from '../modes.js';

const MIN_ROOM_MAX_PLAYERS = 2;
const MAX_ROOM_MAX_PLAYERS = 200;
const DEFAULT_ROOM_MAX_PLAYERS = 50;

/** Options de durée du formulaire "Durée" (nouveau champ, demande utilisateur) — préréglages
 * plutôt qu'un champ libre : plus simple à choisir, et évite une valeur absurde (ex. 3 secondes)
 * qui fermerait le salon quasi immédiatement. `undefined` = pas d'expiration automatique. */
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
  onOpenSupport: () => void;
}

/** Colonne droite de l'accueil (refonte UI/UX, mockup fourni) : création de salon privé (réservée
 * Premium, logique reprise de l'ancien RoomsPanel.tsx) enrichie de deux champs — "Nombre de
 * Joueurs" (capacité) et "Durée" (fermeture automatique du salon à l'échéance, voir
 * server/src/engine/roomManager.ts `expireRoom`) — et d'un bloc "Rejoindre par code" toujours
 * disponible, non réservé Premium (fonctionnalité existante, juste déplacée depuis le panneau
 * modal Salons désormais supprimé). */
export default function CreateRoomPanel({
  modes,
  authToken,
  isPremium,
  isLoggedIn,
  onJoinRoom,
  onOpenSupport,
}: CreateRoomPanelProps) {
  const [roomName, setRoomName] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [maxPlayers, setMaxPlayers] = useState(String(DEFAULT_ROOM_MAX_PLAYERS));
  const [duration, setDuration] = useState(DURATION_OPTIONS[DURATION_OPTIONS.length - 1]!.value);
  const [isPrivate, setIsPrivate] = useState(true);
  const [createdCode, setCreatedCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (modes.length > 0 && !modes.includes(selectedMode)) setSelectedMode(modes[0]!);
  }, [modes, selectedMode]);

  const canCreateRoom = isLoggedIn && isPremium;

  const handleCreate = (): void => {
    void (async () => {
      setFormError('');
      setCreatedCode('');
      const name = roomName.trim();
      if (!name) {
        setFormError('Le nom du salon est requis.');
        return;
      }
      const parsedMaxPlayers = Number(maxPlayers);
      const durationMs = DURATION_OPTIONS.find((option) => option.value === duration)?.ms;

      try {
        const room = await createRoom(
          name,
          selectedMode,
          isPrivate ? 'private' : 'public',
          authToken,
          {
            maxPlayers: Number.isInteger(parsedMaxPlayers) ? parsedMaxPlayers : undefined,
            durationMs,
          },
        );
        if (room.inviteCode) {
          // Salon privé : on affiche le code (le champ "Code de la Partie" existe précisément
          // pour ça) et on laisse la main au créateur pour le noter/partager avant de rejoindre,
          // plutôt que de l'emmener directement en jeu sans jamais le lui montrer.
          setCreatedCode(room.inviteCode);
          return;
        }
        onJoinRoom(room.id);
      } catch (error) {
        setFormError((error as Error).message);
      }
    })();
  };

  const handleJoinCreatedRoom = (): void => {
    onJoinRoom(createdCode, createdCode);
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
      <span className="section-title">Créer un Salon Privé</span>

      {canCreateRoom ? (
        <div>
          <label className="field">
            <span className="field-label">Nom</span>
            <input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="Nom du salon"
              maxLength={40}
            />
          </label>

          <label className="field">
            <span className="field-label">Mode de jeu</span>
            <select value={selectedMode} onChange={(event) => setSelectedMode(event.target.value)}>
              {modes.map((modeId) => (
                <option key={modeId} value={modeId}>
                  {modeMeta(modeId).label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field-label">Nombre de Joueurs</span>
            <input
              type="number"
              min={MIN_ROOM_MAX_PLAYERS}
              max={MAX_ROOM_MAX_PLAYERS}
              value={maxPlayers}
              onChange={(event) => setMaxPlayers(event.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Durée</span>
            <select value={duration} onChange={(event) => setDuration(event.target.value)}>
              {DURATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <span className="field-label" style={{ margin: 0 }}>
              Public
            </span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(event) => setIsPrivate(event.target.checked)}
              />
              <span className="toggle-track" aria-hidden="true" />
            </label>
            <span className="field-label" style={{ margin: 0 }}>
              Privé
            </span>
          </div>

          <label className="field">
            <span className="field-label">Code de la Partie</span>
            <input value={createdCode} placeholder="—" readOnly />
          </label>

          {createdCode ? (
            <button
              className="btn-primary"
              type="button"
              onClick={handleJoinCreatedRoom}
              style={{ width: '100%' }}
            >
              Rejoindre maintenant
            </button>
          ) : (
            <button
              className="btn-primary"
              type="button"
              onClick={handleCreate}
              style={{ width: '100%' }}
            >
              Créer et rejoindre
            </button>
          )}
        </div>
      ) : (
        <p className="account-status">
          Réservé aux comptes <strong>Premium</strong> (don libre, voir{' '}
          <button className="btn-ghost" type="button" onClick={onOpenSupport}>
            Soutenir
          </button>
          ).
        </p>
      )}

      <div className="join-by-code-section">
        <span className="section-title">Rejoindre par code</span>
        <div className="field-row">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="Code d'invitation"
            maxLength={6}
            inputMode="numeric"
          />
          <button className="btn-ghost" type="button" onClick={handleJoinCode}>
            Rejoindre
          </button>
        </div>
      </div>

      <p className="error-text">{formError}</p>
    </section>
  );
}

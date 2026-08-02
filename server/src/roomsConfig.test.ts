import { afterEach, describe, expect, it } from 'vitest';
import { loadBaseRoomsConfig, saveBaseRoomsConfig, type BaseRoomConfig } from './roomsConfig.js';

describe('loadBaseRoomsConfig', () => {
  it('charge server/rooms.json (Vanilla + Hardcore par défaut)', () => {
    const rooms = loadBaseRoomsConfig();
    expect(rooms.length).toBeGreaterThanOrEqual(1);
    expect(
      rooms.every(
        (room) => typeof room.id === 'string' && room.id.length > 0 && typeof room.name === 'string' && typeof room.modId === 'string',
      ),
    ).toBe(true);
    expect(rooms.map((room) => room.modId)).toContain('vanilla');
  });
});

describe('saveBaseRoomsConfig / loadBaseRoomsConfig — id stable (P6, §8.1 plan-implementation-admin.md)', () => {
  // Restaure le contenu réel après chaque test (ce module écrit directement server/rooms.json,
  // pas un dossier temporaire — §13 cahier_des_charges_admin.md exige que ce soit le VRAI fichier
  // lu par index.ts au démarrage, donc pas de fixture séparée à disposition).
  const original = loadBaseRoomsConfig();
  afterEach(() => {
    saveBaseRoomsConfig(original);
  });

  it('écrit puis relit exactement les mêmes salons (id déjà présent)', () => {
    const draft: BaseRoomConfig[] = [
      { id: 'test-a', name: 'Salon Test A', modId: 'vanilla' },
      { id: 'test-b', name: 'Salon Test B', modId: 'hardcore' },
    ];
    saveBaseRoomsConfig(draft);
    expect(loadBaseRoomsConfig()).toEqual(draft);
  });

  it('migration silencieuse : une entrée sans id en reçoit un généré ET persisté', () => {
    // Simule un fichier écrit AVANT l'introduction de `id` (cast : `id` manquant volontairement).
    const legacyDraft = [{ name: 'Salon Historique', modId: 'vanilla' }] as unknown as BaseRoomConfig[];
    saveBaseRoomsConfig(legacyDraft);

    const firstLoad = loadBaseRoomsConfig();
    expect(firstLoad).toHaveLength(1);
    expect(typeof firstLoad[0]!.id).toBe('string');
    expect(firstLoad[0]!.id.length).toBeGreaterThan(0);

    // Persisté immédiatement (pas recalculé à chaque lecture) : une seconde lecture renvoie LE
    // MÊME id, jamais un nouveau.
    const secondLoad = loadBaseRoomsConfig();
    expect(secondLoad[0]!.id).toBe(firstLoad[0]!.id);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { loadBaseRoomsConfig, saveBaseRoomsConfig, type BaseRoomConfig } from './roomsConfig.js';

describe('loadBaseRoomsConfig', () => {
  it('charge server/rooms.json (Vanilla + Hardcore par défaut)', () => {
    const rooms = loadBaseRoomsConfig();
    expect(rooms.length).toBeGreaterThanOrEqual(1);
    expect(rooms.every((room) => typeof room.name === 'string' && typeof room.modId === 'string')).toBe(true);
    expect(rooms.map((room) => room.modId)).toContain('vanilla');
  });
});

describe('saveBaseRoomsConfig', () => {
  // Restaure le contenu réel après chaque test (ce module écrit directement server/rooms.json,
  // pas un dossier temporaire — §13 cahier_des_charges_admin.md exige que ce soit le VRAI fichier
  // lu par index.ts au démarrage, donc pas de fixture séparée à disposition).
  const original = loadBaseRoomsConfig();
  afterEach(() => {
    saveBaseRoomsConfig(original);
  });

  it('écrit puis relit exactement les mêmes salons', () => {
    const draft: BaseRoomConfig[] = [
      { name: 'Salon Test A', modId: 'vanilla' },
      { name: 'Salon Test B', modId: 'hardcore' },
    ];
    saveBaseRoomsConfig(draft);
    expect(loadBaseRoomsConfig()).toEqual(draft);
  });
});

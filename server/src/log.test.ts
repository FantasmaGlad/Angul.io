import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvent } from './log.js';

describe('logEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('écrit une ligne JSON sur stdout avec le nom d’événement, l’horodatage et les champs fournis', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvent('player_join', { roomId: '1', playerId: '2', nickname: 'Alice' });

    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({
      event: 'player_join',
      roomId: '1',
      playerId: '2',
      nickname: 'Alice',
    });
    expect(typeof logged.ts).toBe('string');
    expect(new Date(logged.ts).toString()).not.toBe('Invalid Date');
  });

  it('fonctionne sans champs additionnels', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvent('room_created');

    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged.event).toBe('room_created');
  });
});

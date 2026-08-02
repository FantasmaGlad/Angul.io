import { beforeEach, describe, expect, it } from 'vitest';
import { clearActivityLogForTests, getActivityLog, logAdminEvent } from './activityLog.js';

describe('activityLog (P5, §7.2 plan-implementation-admin.md)', () => {
  beforeEach(() => {
    clearActivityLogForTests();
  });

  it('journalise un événement admin et le rend disponible via getActivityLog', () => {
    logAdminEvent('admin_kick', { roomId: '1', playerId: '2', reason: 'Spam' });
    const log = getActivityLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event: 'admin_kick', fields: { roomId: '1', playerId: '2', reason: 'Spam' } });
    expect(typeof log[0]!.atMs).toBe('number');
  });

  it('renvoie le plus récent en premier', () => {
    logAdminEvent('first', {});
    logAdminEvent('second', {});
    const log = getActivityLog();
    expect(log.map((entry) => entry.event)).toEqual(['second', 'first']);
  });

  it('borne le buffer à 200 entrées (ring buffer)', () => {
    for (let i = 0; i < 250; i++) logAdminEvent(`event-${i}`, { i });
    const log = getActivityLog();
    expect(log).toHaveLength(200);
    // Les 50 plus anciennes (event-0..event-49) ont été évincées ; la plus récente conservée est
    // event-249 (en tête, ordre plus-récent-d'abord), la plus ancienne encore présente event-50.
    expect(log[0]!.event).toBe('event-249');
    expect(log[199]!.event).toBe('event-50');
  });
});

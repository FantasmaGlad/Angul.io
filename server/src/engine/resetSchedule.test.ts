import { describe, expect, it } from 'vitest';
import { delayUntilNextReset, type RoomResetSchedule } from './resetSchedule.js';

describe('delayUntilNextReset', () => {
  it('renvoie le délai fixe tel quel pour une planification "interval"', () => {
    const schedule: RoomResetSchedule = { type: 'interval', intervalMs: 12_345 };
    expect(delayUntilNextReset(schedule, Date.now())).toBe(12_345);
  });

  it('vise aujourd’hui si l’heure cible (heure d’été, Europe/Paris = UTC+2) n’est pas encore passée', () => {
    const schedule: RoomResetSchedule = {
      type: 'dailyAt',
      hour: 10,
      minute: 0,
      timeZone: 'Europe/Paris',
    };
    const now = Date.parse('2026-07-20T05:00:00Z');
    const expectedTarget = Date.parse('2026-07-20T08:00:00Z'); // 10h CEST = 08h UTC

    expect(delayUntilNextReset(schedule, now)).toBe(expectedTarget - now);
  });

  it('vise demain si l’heure cible d’aujourd’hui est déjà passée', () => {
    const schedule: RoomResetSchedule = {
      type: 'dailyAt',
      hour: 10,
      minute: 0,
      timeZone: 'Europe/Paris',
    };
    const now = Date.parse('2026-07-20T09:00:00Z'); // 11h CEST, déjà après 10h
    const expectedTarget = Date.parse('2026-07-21T08:00:00Z');

    expect(delayUntilNextReset(schedule, now)).toBe(expectedTarget - now);
  });

  it('applique le bon décalage en heure d’hiver (Europe/Paris = UTC+1)', () => {
    const schedule: RoomResetSchedule = {
      type: 'dailyAt',
      hour: 10,
      minute: 0,
      timeZone: 'Europe/Paris',
    };
    const now = Date.parse('2026-01-15T05:00:00Z');
    const expectedTarget = Date.parse('2026-01-15T09:00:00Z'); // 10h CET = 09h UTC

    expect(delayUntilNextReset(schedule, now)).toBe(expectedTarget - now);
  });

  it('ne renvoie jamais un délai négatif à l’instant exact de la cible', () => {
    const schedule: RoomResetSchedule = {
      type: 'dailyAt',
      hour: 10,
      minute: 0,
      timeZone: 'Europe/Paris',
    };
    const exactTarget = Date.parse('2026-07-20T08:00:00Z');

    expect(delayUntilNextReset(schedule, exactTarget)).toBe(0);
  });

  it('vise le prochain créneau de 2h (heure d’été, Europe/Paris = UTC+2) pour "everyNMinutes"', () => {
    const schedule: RoomResetSchedule = {
      type: 'everyNMinutes',
      minutes: 120,
      timeZone: 'Europe/Paris',
    };
    // 09h13 CEST -> prochain créneau 10h00 CEST = 08h00 UTC
    const now = Date.parse('2026-07-20T07:13:00Z');
    const expectedTarget = Date.parse('2026-07-20T08:00:00Z');

    expect(delayUntilNextReset(schedule, now)).toBe(expectedTarget - now);
  });

  it('repasse au créneau 00h du lendemain si le dernier créneau du jour est passé', () => {
    const schedule: RoomResetSchedule = {
      type: 'everyNMinutes',
      minutes: 120,
      timeZone: 'Europe/Paris',
    };
    // 23h30 CEST, dernier créneau (22h CEST) déjà passé -> 00h00 CEST le lendemain = 22h00 UTC
    const now = Date.parse('2026-07-20T21:30:00Z');
    const expectedTarget = Date.parse('2026-07-20T22:00:00Z');

    expect(delayUntilNextReset(schedule, now)).toBe(expectedTarget - now);
  });

  it('ne boucle jamais en reset immédiat pile à l’instant d’un créneau "everyNMinutes"', () => {
    const schedule: RoomResetSchedule = {
      type: 'everyNMinutes',
      minutes: 120,
      timeZone: 'Europe/Paris',
    };
    const exactSlot = Date.parse('2026-07-20T08:00:00Z'); // 10h00 CEST pile

    const delay = delayUntilNextReset(schedule, exactSlot);

    expect(delay).toBeGreaterThan(0);
    expect(delay).toBe(Date.parse('2026-07-20T10:00:00Z') - exactSlot); // 12h00 CEST
  });
});

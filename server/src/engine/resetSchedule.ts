/**
 * Planification du reset automatique d'un salon (Lot 2.4, §2.1 du cahier des charges : "1 fois
 * /24h à 10h, heure de Paris" par défaut). Deux formes : `dailyAt` pour la production (heure
 * murale dans un fuseau donné, recalculée à chaque déclenchement pour rester correcte malgré
 * les changements d'heure), `interval` pour les tests (délai fixe court, sans dépendre de
 * l'horloge murale réelle).
 */
export type RoomResetSchedule =
  | { type: 'dailyAt'; hour: number; minute: number; timeZone: string }
  | { type: 'interval'; intervalMs: number }
  /** Reset à intervalle régulier mais calé sur l'horloge murale d'un fuseau donné (ex. toutes les
   * 120 minutes à 00h/02h/04h.../22h heure de Paris) plutôt qu'un simple délai fixe depuis le
   * dernier démarrage du serveur — deux salons redémarrés à des instants différents restent
   * ainsi synchronisés sur les mêmes horaires de reset, prévisibles pour les joueurs. */
  | { type: 'everyNMinutes'; minutes: number; timeZone: string };

export const DEFAULT_RESET_SCHEDULE: RoomResetSchedule = {
  type: 'dailyAt',
  hour: 10,
  minute: 0,
  timeZone: 'Europe/Paris',
};

/** Salons publics de base (server/src/index.ts) : reset toutes les 2h, calé sur l'heure de Paris. */
export const TWO_HOUR_RESET_SCHEDULE: RoomResetSchedule = {
  type: 'everyNMinutes',
  minutes: 120,
  timeZone: 'Europe/Paris',
};

/** Délai (ms, jamais négatif) avant le prochain déclenchement du reset, à partir de `now`. */
export function delayUntilNextReset(schedule: RoomResetSchedule, now: number = Date.now()): number {
  if (schedule.type === 'interval') return schedule.intervalMs;
  if (schedule.type === 'everyNMinutes') {
    return Math.max(0, nextAlignedOccurrenceUtc(schedule.minutes, schedule.timeZone, now) - now);
  }
  return Math.max(
    0,
    nextDailyOccurrenceUtc(schedule.hour, schedule.minute, schedule.timeZone, now) - now,
  );
}

interface CivilDate {
  year: number;
  month: number; // 1-12
  day: number;
}

/** Prochain instant UTC (ms) où il est `hour:minute:00` heure locale dans `timeZone`, à partir
 * de `now`. Vise aujourd'hui si l'heure cible n'est pas encore passée, sinon demain — en
 * avançant la date civile (pas en ajoutant bêtement 24h en millisecondes, qui dériverait d'une
 * heure les jours de changement d'heure dans `timeZone`). */
function nextDailyOccurrenceUtc(
  hour: number,
  minute: number,
  timeZone: string,
  now: number,
): number {
  const today = civilDateInZone(now, timeZone);
  const todayAtTarget = zonedWallClockToUtc(today, hour, minute, timeZone);
  if (todayAtTarget >= now) return todayAtTarget;
  return zonedWallClockToUtc(addDays(today, 1), hour, minute, timeZone);
}

/** Premier créneau (`00h`, `00h+minutesInterval`, `00h+2*minutesInterval`, …) strictement après
 * `now`, heure murale de `timeZone` — pas `>=` : appelée juste après le déclenchement d'un reset,
 * elle doit trouver le *prochain* créneau, jamais celui qui vient de se produire (qui bouclerait
 * en reset immédiat). Repasse au premier créneau du lendemain si tous ceux d'aujourd'hui sont
 * déjà passés (n'arrive que si `minutesInterval` ne divise pas 1440 exactement). */
function nextAlignedOccurrenceUtc(minutesInterval: number, timeZone: string, now: number): number {
  const today = civilDateInZone(now, timeZone);
  const slotsPerDay = Math.ceil((24 * 60) / minutesInterval);

  for (let slot = 0; slot < slotsPerDay; slot++) {
    const minutesOfDay = slot * minutesInterval;
    const hour = Math.floor(minutesOfDay / 60) % 24;
    const minute = minutesOfDay % 60;
    const candidate = zonedWallClockToUtc(today, hour, minute, timeZone);
    if (candidate > now) return candidate;
  }
  return zonedWallClockToUtc(addDays(today, 1), 0, 0, timeZone);
}

function civilDateInZone(ms: number, timeZone: string): CivilDate {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(ms).map((part) => [part.type, part.value]),
  );
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function addDays(date: CivilDate, days: number): CivilDate {
  // Arithmétique calendaire pure via Date.UTC (jamais interprété comme un horodatage réel) —
  // gère nativement les débordements de mois/année.
  const rolled = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: rolled.getUTCFullYear(),
    month: rolled.getUTCMonth() + 1,
    day: rolled.getUTCDate(),
  };
}

/**
 * Convertit une date/heure "murale" (telle qu'affichée dans `timeZone`) en horodatage UTC —
 * technique standard sans dépendance de fuseau horaire supplémentaire : une première estimation
 * traite les composants comme s'ils étaient déjà UTC, puis mesure l'écart réel en relisant cette
 * estimation dans le fuseau visé, et corrige l'estimation de cet écart. Imprécis (de ±1h)
 * uniquement lors des deux nuits de changement d'heure du fuseau visé — acceptable pour un reset
 * quotidien approximatif, pas pour un usage sensible à la seconde près.
 */
function zonedWallClockToUtc(
  date: CivilDate,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const naiveUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(naiveUtc).map((part) => [part.type, part.value]),
  );
  // Certains moteurs JS rendent "24" pour minuit avec hour12:false — normalisé à 0.
  const hourRead = Number(parts.hour) % 24;
  const readAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hourRead,
    Number(parts.minute),
    Number(parts.second),
  );

  const offset = readAsUtc - naiveUtc;
  return naiveUtc - offset;
}

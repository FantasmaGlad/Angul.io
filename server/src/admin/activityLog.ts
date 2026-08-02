import { logEvent, type LogFields } from '../log.js';

/** Ring buffer borné (P5, §7.2/§14.1 plan-implementation-admin.md) — "activité récente" honnête
 * pour le Dashboard, en attendant le socle Modération/audit BDD (§14.2, hors périmètre de ce
 * plan, voir §9). Volontairement en mémoire (perdu au redémarrage) : un vrai journal d'audit
 * persistant est un chantier séparé, pas ce correctif. */
const MAX_ENTRIES = 200;

export interface AdminActivityEntry {
  atMs: number;
  event: string;
  fields: LogFields;
}

const buffer: AdminActivityEntry[] = [];

/** Remplace les appels `logEvent(...)` des routes admin MUTANTES (kick, actions de salon,
 * sauvegarde config, login...) — journalise TOUJOURS sur stdout comme avant (`logEvent`,
 * inchangé) ET pousse en plus dans ce buffer pour `GET /api/admin/activity`. */
export function logAdminEvent(event: string, fields: LogFields = {}): void {
  logEvent(event, fields);
  buffer.push({ atMs: Date.now(), event, fields });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

/** Plus récent en premier — c'est l'ordre naturel d'un flux d'activité affiché à un admin. */
export function getActivityLog(): AdminActivityEntry[] {
  return [...buffer].reverse();
}

/** Réservé aux tests. */
export function clearActivityLogForTests(): void {
  buffer.length = 0;
}

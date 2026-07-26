export type LogFields = Record<string, unknown>;

/**
 * Journalisation structurée (une ligne JSON par événement) sur stdout — capturée telle quelle
 * par systemd/journalctl une fois déployé (`install.sh`, Lot 8.4 : `ExecStart` redirige déjà
 * stdout vers le journal), sans dépendance de logging ni fichier à gérer soi-même. Pensé pour
 * les actions joueurs (join/leave/split/mort) et le cycle de vie des salons — de quoi rejouer
 * précisément ce qui s'est passé sur le serveur à partir des logs seuls.
 */
export function logEvent(event: string, fields: LogFields = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

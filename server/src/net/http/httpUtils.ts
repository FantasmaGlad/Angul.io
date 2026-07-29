import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_REQUEST_BODY_BYTES = 10_000;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** `maxBytes` par défaut (10 Ko) : largement suffisant pour toutes les routes JSON classiques
 * (pseudo/mot de passe, actions admin...) — l'écran de mort personnalisé (bannière en data URL
 * base64, voir handleUpdateDeathScreen) est la seule route qui a besoin d'un plafond bien plus
 * généreux, passé explicitement par son appelant plutôt que de relâcher la limite globale. */
export function readJsonBody(req: IncomingMessage, maxBytes = MAX_REQUEST_BODY_BYTES): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > maxBytes) {
        rejectPromise(new Error('Corps de requête trop volumineux.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch {
        rejectPromise(new Error('JSON invalide.'));
      }
    });
    req.on('error', rejectPromise);
  });
}

export function respondJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export function getBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

export function getClientIp(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const parts = forwarded.split(',');
    if (parts[0]) return parts[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

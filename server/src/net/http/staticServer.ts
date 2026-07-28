import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

export async function serveStatic(
  dir: string | undefined,
  requestedPath: string,
  res: ServerResponse,
): Promise<void> {
  if (!dir) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rootDir = resolve(dir);
  let filePath = join(rootDir, normalize(requestedPath || '/index.html'));

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    await stat(filePath);
  } catch {
    if (!extname(requestedPath)) {
      filePath = join(rootDir, 'index.html');
      try {
        await stat(filePath);
      } catch {
        res.writeHead(404);
        res.end();
        return;
      }
    } else {
      res.writeHead(404);
      res.end();
      return;
    }
  }

  const cacheControl =
    filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')
      ? 'no-cache, must-revalidate'
      : 'public, max-age=86400';
  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath), 'Cache-Control': cacheControl });
  createReadStream(filePath).pipe(res);
}

export function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

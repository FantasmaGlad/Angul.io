import { readdir, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

async function findCaseInsensitiveFile(dir: string, requestedPath: string): Promise<string | null> {
  const parts = requestedPath.split('/').filter(Boolean);
  let currentDir = resolve(dir);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    try {
      const entries = await readdir(currentDir);
      const matched = entries.find((e) => e.toLowerCase() === part.toLowerCase());
      if (!matched) return null;
      currentDir = join(currentDir, matched);
    } catch {
      return null;
    }
  }
  return currentDir.startsWith(resolve(dir)) ? currentDir : null;
}

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
    const insensitivePath = await findCaseInsensitiveFile(rootDir, requestedPath);
    if (insensitivePath) {
      filePath = insensitivePath;
    } else if (requestedPath.startsWith('/assets/')) {
      const rootAssetsDir = resolve(rootDir, '../../assets');
      const rootAssetPath = requestedPath.slice('/assets'.length);
      const rootInsensitive = await findCaseInsensitiveFile(rootAssetsDir, rootAssetPath);
      if (rootInsensitive) {
        filePath = rootInsensitive;
      } else {
        res.writeHead(404);
        res.end();
        return;
      }
    } else if (!extname(requestedPath)) {
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
  if (filePath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (filePath.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.m4a')) return 'audio/mp4';
  if (filePath.endsWith('.mp3')) return 'audio/mpeg';
  if (filePath.endsWith('.ogg')) return 'audio/ogg';
  if (filePath.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

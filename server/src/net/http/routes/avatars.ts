import type { ServerResponse } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { SKINS, SKIN_IMAGE_MAP } from '@angulio/shared';
import { respondJson } from '../httpUtils.js';

export interface AvatarItem {
  id: string;
  name: string;
  url: string;
}

const SUPPORTED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg', '.gif']);

/** Scanne le dossier `assets/Profil` et renvoie la liste complète des avatars disponibles. */
export async function handleGetAvatars(rootDir: string, res: ServerResponse): Promise<void> {
  const candidateDirs = [
    resolve(rootDir, '../../assets/Profil'),
    join(process.cwd(), 'assets/Profil'),
    join(rootDir, 'assets/Profil'),
  ];

  let profilDir: string | undefined;
  for (const dir of candidateDirs) {
    try {
      const s = await stat(dir);
      if (s.isDirectory()) {
        profilDir = dir;
        break;
      }
    } catch {}
  }

  const avatars: AvatarItem[] = [];

  if (profilDir) {
    try {
      const files = await readdir(profilDir);
      for (const file of files) {
        const ext = extname(file).toLowerCase();
        if (SUPPORTED_EXTENSIONS.has(ext)) {
          const nameWithoutExt = file.slice(0, -ext.length);
          const id = nameWithoutExt || file;
          avatars.push({
            id,
            name: nameWithoutExt,
            url: `/assets/Profil/${file}`,
          });
        }
      }
    } catch {}
  }

  // Fallback si le dossier est vide ou inaccessible — reflète `SKINS`/`SKIN_IMAGE_MAP`
  // (shared/src/avatarPalette.ts, source de vérité unique) plutôt qu'une liste dupliquée en dur
  // ici, qui divergeait silencieusement de la vraie palette à chaque changement d'assets/Profil.
  if (avatars.length === 0) {
    for (const id of SKINS) {
      avatars.push({ id, name: id, url: SKIN_IMAGE_MAP[id]! });
    }
  }

  respondJson(res, 200, { avatars });
}

import type { ServerResponse } from 'node:http';
import { readdir, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
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

  // Fallback si le dossier est vide ou inaccessible
  if (avatars.length === 0) {
    avatars.push(
      { id: 'Banane', name: 'Banane', url: '/assets/Profil/Banane.png' },
      { id: 'BmxPor', name: 'BmxPor', url: '/assets/Profil/BmxPor.png' },
      { id: 'Calamard', name: 'Calamard', url: '/assets/Profil/Calamard.png' },
      { id: 'Champi', name: 'Champi', url: '/assets/Profil/Champi.png' },
      { id: 'KK', name: 'KK', url: '/assets/Profil/KK.png' },
      { id: 'Radiateur', name: 'Radiateur', url: '/assets/Profil/Radiateur.png' },
    );
  }

  respondJson(res, 200, { avatars });
}

import argon2 from 'argon2';

/** Hachage de mot de passe (Lot 3.2, cahier des charges §5.1 : "jamais en clair", bcrypt ou
 * argon2 — argon2 recommandé par défaut). Paramètres par défaut d'argon2 (déjà des valeurs
 * recommandées pour un nouveau projet) plutôt que réglés à la main. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password);
}

/** `false` (jamais une exception) si le hash est corrompu/d'un format inattendu — un mot de
 * passe qui ne vérifie pas ne doit jamais faire planter le flux de connexion. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

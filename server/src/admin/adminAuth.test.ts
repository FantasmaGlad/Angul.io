import { describe, expect, it } from 'vitest';
import { hashPassword } from '../accounts/passwords.js';
import { AdminAuth } from './adminAuth.js';
import type { AdminUsersRepository } from './adminUsersRepository.js';

/** Repli minimal typé structurellement comme `AdminUsersRepository` (pas de Pool réel
 * nécessaire) — `AdminAuth` n'utilise que `findByUsername`. */
function fakeUsers(users: Array<{ id: number; username: string; passwordHash: string }>): AdminUsersRepository {
  return {
    findByUsername: async (username: string) => users.find((u) => u.username === username),
  } as AdminUsersRepository;
}

describe('AdminAuth', () => {
  it('isConfigured : false sans hash de repli ni comptes en base', () => {
    expect(new AdminAuth(undefined).isConfigured).toBe(false);
    expect(new AdminAuth('somehash').isConfigured).toBe(true);
    expect(new AdminAuth(undefined, fakeUsers([])).isConfigured).toBe(true);
  });

  it("login renvoie undefined si non configuré, quels que soient les identifiants", async () => {
    const admin = new AdminAuth(undefined);
    expect(await admin.login('admin', 'anything')).toBeUndefined();
  });

  it('login (repli historique "admin") : token valide pour le bon mot de passe, undefined sinon', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const admin = new AdminAuth(hash);

    expect(await admin.login('admin', 'wrong-password')).toBeUndefined();
    // Un pseudo différent de "admin" ne doit jamais matcher le repli historique.
    expect(await admin.login('Fantadmin', 'correct-horse-battery-staple')).toBeUndefined();

    const token = await admin.login('admin', 'correct-horse-battery-staple');
    expect(token).toBeTypeOf('string');
    expect(admin.isAuthenticated(token)).toBe(true);
  });

  it('login (compte nommé en base) : token valide pour le bon pseudo/mot de passe, undefined sinon', async () => {
    const hash = await hashPassword('#Caram8l@');
    const admin = new AdminAuth(undefined, fakeUsers([{ id: 1, username: 'Fantadmin', passwordHash: hash }]));

    expect(await admin.login('Fantadmin', 'wrong-password')).toBeUndefined();
    expect(await admin.login('Inconnu', '#Caram8l@')).toBeUndefined();

    const token = await admin.login('Fantadmin', '#Caram8l@');
    expect(token).toBeTypeOf('string');
    expect(admin.isAuthenticated(token)).toBe(true);
  });

  it('isAuthenticated : false pour un token absent ou inconnu', () => {
    const admin = new AdminAuth('somehash');
    expect(admin.isAuthenticated(undefined)).toBe(false);
    expect(admin.isAuthenticated('bogus-token')).toBe(false);
  });
});

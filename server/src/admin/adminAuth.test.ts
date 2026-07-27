import { describe, expect, it } from 'vitest';
import { hashPassword } from '../accounts/passwords.js';
import { AdminAuth } from './adminAuth.js';

describe('AdminAuth', () => {
  it('isConfigured : false sans hash fourni', () => {
    expect(new AdminAuth(undefined).isConfigured).toBe(false);
    expect(new AdminAuth('somehash').isConfigured).toBe(true);
  });

  it('login renvoie undefined si non configuré, quel que soit le mot de passe', async () => {
    const admin = new AdminAuth(undefined);
    expect(await admin.login('anything')).toBeUndefined();
  });

  it('login renvoie un token valide pour le bon mot de passe, undefined sinon', async () => {
    const hash = await hashPassword('correct-horse-battery-staple');
    const admin = new AdminAuth(hash);

    expect(await admin.login('wrong-password')).toBeUndefined();

    const token = await admin.login('correct-horse-battery-staple');
    expect(token).toBeTypeOf('string');
    expect(admin.isAuthenticated(token)).toBe(true);
  });

  it('isAuthenticated : false pour un token absent ou inconnu', () => {
    const admin = new AdminAuth('somehash');
    expect(admin.isAuthenticated(undefined)).toBe(false);
    expect(admin.isAuthenticated('bogus-token')).toBe(false);
  });
});

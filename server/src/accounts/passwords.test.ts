import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('hache un mot de passe (jamais stocké en clair)', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('$argon2')).toBe(true);
  });

  it('vérifie un mot de passe correct', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejette un mot de passe incorrect', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(hash, 'wrong password')).toBe(false);
  });

  it('rejette sans planter un hash corrompu/invalide', async () => {
    expect(await verifyPassword('not-a-real-hash', 'anything')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { createSessionStore } from './sessionStore.js';

describe('SessionStore', () => {
  it('résout un token vers le compte qui l’a créé', () => {
    const sessions = createSessionStore();
    const token = sessions.createSession(42);
    expect(sessions.resolveSession(token)).toBe(42);
  });

  it('renvoie undefined pour un token inconnu', () => {
    const sessions = createSessionStore();
    expect(sessions.resolveSession('bogus-token')).toBeUndefined();
  });

  it('génère des tokens différents à chaque session', () => {
    const sessions = createSessionStore();
    const a = sessions.createSession(1);
    const b = sessions.createSession(1);
    expect(a).not.toBe(b);
  });

  it('révoque un token : plus résolu ensuite', () => {
    const sessions = createSessionStore();
    const token = sessions.createSession(7);
    sessions.revokeSession(token);
    expect(sessions.resolveSession(token)).toBeUndefined();
  });

  it('revokeSessionsForAccount révoque tous les tokens d’un compte, laisse les autres intacts', () => {
    const sessions = createSessionStore();
    const tokenA1 = sessions.createSession(1);
    const tokenA2 = sessions.createSession(1);
    const tokenB = sessions.createSession(2);

    sessions.revokeSessionsForAccount(1);

    expect(sessions.resolveSession(tokenA1)).toBeUndefined();
    expect(sessions.resolveSession(tokenA2)).toBeUndefined();
    expect(sessions.resolveSession(tokenB)).toBe(2);
  });
});

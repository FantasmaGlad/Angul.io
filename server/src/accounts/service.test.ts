import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AccountError, AccountsService } from './service.js';

const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(!DATABASE_URL)('AccountsService (Postgres)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const createdPseudos: string[] = [];

  afterAll(async () => {
    if (createdPseudos.length > 0) {
      await pool.query('DELETE FROM players WHERE pseudo = ANY($1::text[])', [createdPseudos]);
    }
    await pool.end();
  });

  function uniquePseudo(prefix: string): string {
    const pseudo = `${prefix}_${randomUUID().slice(0, 8)}`;
    createdPseudos.push(pseudo);
    return pseudo;
  }

  it('inscrit un compte et connecte immédiatement (token utilisable tout de suite)', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('svc');
    const result = await service.register(pseudo, 'motdepasse123');
    expect(result.pseudo).toBe(pseudo);

    const accountId = service.resolveToken(result.token);
    expect(accountId).toBeDefined();

    const profile = await service.getProfile(accountId!);
    expect(profile?.pseudo).toBe(pseudo);
    expect(profile?.level).toBe(1);
    expect(profile?.premium).toBe(false);
    expect(profile?.bestScores).toEqual([]);
  });

  it('refuse un pseudo trop court ou un mot de passe trop court', async () => {
    const service = new AccountsService(pool);
    await expect(service.register('ab', 'motdepasse123')).rejects.toBeInstanceOf(AccountError);
    await expect(service.register(uniquePseudo('short'), 'short')).rejects.toBeInstanceOf(
      AccountError,
    );
  });

  it('refuse un pseudo déjà pris à l’inscription, avec un message dédié', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('dupsvc');
    await service.register(pseudo, 'motdepasse123');
    await expect(service.register(pseudo, 'autremotdepasse')).rejects.toThrow(/déjà pris/);
  });

  it('connecte avec le bon mot de passe, refuse avec le mauvais ou un pseudo inconnu', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('login');
    await service.register(pseudo, 'bonmotdepasse');

    const loginResult = await service.login(pseudo, 'bonmotdepasse');
    expect(loginResult.pseudo).toBe(pseudo);

    await expect(service.login(pseudo, 'mauvaismotdepasse')).rejects.toBeInstanceOf(AccountError);
    await expect(service.login(uniquePseudo('inconnu'), 'peu importe')).rejects.toBeInstanceOf(
      AccountError,
    );
  });

  it('resolveToken renvoie undefined sans token ou avec un token invalide', () => {
    const service = new AccountsService(pool);
    expect(service.resolveToken(undefined)).toBeUndefined();
    expect(service.resolveToken('bogus-token')).toBeUndefined();
  });

  it('recordGameResult met à jour XP/niveau/meilleur score, visible dans getProfile (Lot 3.5)', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('result');
    const { token } = await service.register(pseudo, 'motdepasse123');
    const accountId = service.resolveToken(token)!;

    // Score (masse max atteinte) et XP (engine/xp.ts) sont désormais deux valeurs distinctes.
    await service.recordGameResult(accountId, 'hardcore', 200, 850);
    const profile = await service.getProfile(accountId);
    expect(profile?.xp).toBe(850);
    expect(profile?.bestScores).toEqual([{ modeId: 'hardcore', bestScore: 200 }]);
  });

  it('isPremium : false pour invité/compte inconnu/standard, true après activation admin (Lot 6.4)', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('premium');
    const { token } = await service.register(pseudo, 'motdepasse123');
    const accountId = service.resolveToken(token)!;

    expect(await service.isPremium(undefined)).toBe(false);
    expect(await service.isPremium(-1)).toBe(false);
    expect(await service.isPremium(accountId)).toBe(false);

    await service.updateAccountForAdmin(accountId, { premium: true });
    expect(await service.isPremium(accountId)).toBe(true);
  });

  it('un compte banni ne peut plus se connecter (Lot 5.2) ; le bannissement révoque ses sessions actives', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('banned');
    const { token } = await service.register(pseudo, 'motdepasse123');
    const accountId = service.resolveToken(token)!;
    expect(service.resolveToken(token)).toBe(accountId);

    await service.updateAccountForAdmin(accountId, { banned: true });

    // La session déjà émise avant le ban ne doit plus être valable (révocation immédiate).
    expect(service.resolveToken(token)).toBeUndefined();
    await expect(service.login(pseudo, 'motdepasse123')).rejects.toThrow(/banni/);
  });

  it('searchAccountsForAdmin/getAccountForAdmin exposent id/banned mais jamais passwordHash', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('adminview');
    await service.register(pseudo, 'motdepasse123');

    const results = await service.searchAccountsForAdmin(pseudo);
    expect(results).toHaveLength(1);
    expect(results[0]).not.toHaveProperty('passwordHash');
    expect(results[0]).toMatchObject({ pseudo, banned: false });

    const detail = await service.getAccountForAdmin(results[0]!.id);
    expect(detail).toMatchObject({ pseudo, bestScores: [] });
    expect(await service.getAccountForAdmin(-1)).toBeUndefined();
  });

  it('updateAccountForAdmin rejette un niveau/XP invalide, renvoie undefined pour un compte inconnu', async () => {
    const service = new AccountsService(pool);
    const pseudo = uniquePseudo('adminpatch');
    const { token } = await service.register(pseudo, 'motdepasse123');
    const accountId = service.resolveToken(token)!;

    await expect(service.updateAccountForAdmin(accountId, { level: 0 })).rejects.toBeInstanceOf(
      AccountError,
    );
    await expect(service.updateAccountForAdmin(accountId, { xp: -1 })).rejects.toBeInstanceOf(
      AccountError,
    );
    expect(await service.updateAccountForAdmin(-1, { premium: true })).toBeUndefined();
  });
});

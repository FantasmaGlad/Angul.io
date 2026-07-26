import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { AccountsRepository, PseudoTakenError } from './accountsRepository.js';

const DATABASE_URL = process.env.DATABASE_URL;

// Tests d'intégration réels contre PostgreSQL (Lot 3.1) plutôt que des mocks — cohérent avec le
// reste du projet (vrais sockets WebSocket, vrai serveur compilé, etc.). `skipIf` plutôt qu'un
// échec dur : un environnement sans `DATABASE_URL` (contributeur sans Postgres local, avant
// l'ajout d'un service Postgres en CI) passe sans faux négatif sur le reste de la suite.
describe.skipIf(!DATABASE_URL)('AccountsRepository (Postgres)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const repository = new AccountsRepository(pool);
  const createdIds: number[] = [];

  afterAll(async () => {
    if (createdIds.length > 0) {
      await pool.query('DELETE FROM players WHERE id = ANY($1::int[])', [createdIds]);
    }
    await pool.end();
  });

  function uniquePseudo(prefix: string): string {
    return `${prefix}_${randomUUID().slice(0, 8)}`;
  }

  it('crée un compte et le retrouve par pseudo', async () => {
    const pseudo = uniquePseudo('create');
    const account = await repository.createAccount(pseudo, 'hashed-value');
    createdIds.push(account.id);

    expect(account.pseudo).toBe(pseudo);
    expect(account.level).toBe(1);
    expect(account.xp).toBe(0);
    expect(account.premium).toBe(false);
    expect(account.cosmetics).toEqual([]);

    const found = await repository.findByPseudo(pseudo);
    expect(found?.id).toBe(account.id);
  });

  it('refuse un pseudo déjà pris (contrainte unique, pas de course TOCTOU)', async () => {
    const pseudo = uniquePseudo('dup');
    const account = await repository.createAccount(pseudo, 'hash-1');
    createdIds.push(account.id);

    await expect(repository.createAccount(pseudo, 'hash-2')).rejects.toBeInstanceOf(
      PseudoTakenError,
    );
  });

  it('findByPseudo/findById renvoient undefined pour un compte inconnu', async () => {
    expect(await repository.findByPseudo(uniquePseudo('missing'))).toBeUndefined();
    expect(await repository.findById(-1)).toBeUndefined();
  });

  it("recordGameResult ajoute l'XP, recalcule le niveau, et ne garde que le meilleur score (GREATEST)", async () => {
    const pseudo = uniquePseudo('game');
    const account = await repository.createAccount(pseudo, 'hash');
    createdIds.push(account.id);

    await repository.recordGameResult(account.id, 'vanilla', 80, 80);
    expect((await repository.findById(account.id))?.xp).toBe(80);
    expect(await repository.getBestScores(account.id)).toEqual([
      { modeId: 'vanilla', bestScore: 80 },
    ]);

    // Score plus bas qu'avant : l'XP s'accumule quand même (récompense la partie jouée), mais
    // le meilleur score enregistré ne doit pas régresser.
    await repository.recordGameResult(account.id, 'vanilla', 30, 30);
    const afterLowerScore = await repository.findById(account.id);
    expect(afterLowerScore?.xp).toBe(110);
    expect(afterLowerScore?.level).toBe(2); // 110 XP -> niveau 2 (levels.test.ts)
    expect(await repository.getBestScores(account.id)).toEqual([
      { modeId: 'vanilla', bestScore: 80 },
    ]);

    // Nouveau record : écrase bien l'ancien.
    await repository.recordGameResult(account.id, 'vanilla', 150, 150);
    expect(await repository.getBestScores(account.id)).toEqual([
      { modeId: 'vanilla', bestScore: 150 },
    ]);
  });
});

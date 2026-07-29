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
    expect(afterLowerScore?.level).toBe(1); // 110 XP -> niveau 1 (coût du niveau 1 = 1000, levels.test.ts)
    expect(await repository.getBestScores(account.id)).toEqual([
      { modeId: 'vanilla', bestScore: 80 },
    ]);

    // Nouveau record : écrase bien l'ancien.
    await repository.recordGameResult(account.id, 'vanilla', 150, 150);
    expect(await repository.getBestScores(account.id)).toEqual([
      { modeId: 'vanilla', bestScore: 150 },
    ]);
  });

  it('searchByPseudo trouve par sous-chaîne, insensible à la casse', async () => {
    const pseudo = uniquePseudo('SearchMe');
    const account = await repository.createAccount(pseudo, 'hash');
    createdIds.push(account.id);

    const results = await repository.searchByPseudo(pseudo.slice(0, -2).toLowerCase());
    expect(results.some((row) => row.id === account.id)).toBe(true);

    expect(await repository.searchByPseudo(uniquePseudo('nope'))).toEqual([]);
  });

  it('adminUpdateAccount ne modifie que les champs fournis (Lot 5.2-5.4)', async () => {
    const pseudo = uniquePseudo('admin');
    const account = await repository.createAccount(pseudo, 'hash');
    createdIds.push(account.id);

    const afterPremium = await repository.adminUpdateAccount(account.id, { premium: true });
    expect(afterPremium?.premium).toBe(true);
    expect(afterPremium?.level).toBe(1); // inchangé

    const afterMultiple = await repository.adminUpdateAccount(account.id, {
      level: 5,
      xp: 999,
      cosmetics: ['hat'],
      banned: true,
    });
    expect(afterMultiple).toMatchObject({
      level: 5,
      xp: 999,
      cosmetics: ['hat'],
      banned: true,
      premium: true, // inchangé par ce second appel
    });

    expect(await repository.adminUpdateAccount(-1, { premium: true })).toBeUndefined();
  });

  // Ne suppose PAS que nos comptes de test occupent le haut du classement (d'autres comptes
  // réels/de test partagent la même base) : on récupère une tranche large et on vérifie l'ordre
  // RELATIF entre nos propres comptes plutôt qu'un rang absolu.
  it('getLeaderboard(global) trie par XP décroissante et exclut les comptes bannis', async () => {
    const top = await repository.createAccount(uniquePseudo('lbtop'), 'hash');
    const mid = await repository.createAccount(uniquePseudo('lbmid'), 'hash');
    const banned = await repository.createAccount(uniquePseudo('lbbanned'), 'hash');
    createdIds.push(top.id, mid.id, banned.id);

    await repository.adminUpdateAccount(top.id, { xp: 5_000_000 });
    await repository.adminUpdateAccount(mid.id, { xp: 1_000_000 });
    await repository.adminUpdateAccount(banned.id, { xp: 9_000_000, banned: true });

    const rows = await repository.getLeaderboard(undefined, 1000);
    const ours = rows.filter((row) => [top.pseudo, mid.pseudo, banned.pseudo].includes(row.pseudo));

    expect(ours.map((row) => row.pseudo)).toEqual([top.pseudo, mid.pseudo]);
    expect(ours[0]).toMatchObject({ pseudo: top.pseudo, score: 5_000_000 });
    expect(ours[1]).toMatchObject({ pseudo: mid.pseudo, score: 1_000_000 });
  });

  it('getLeaderboard(modeId) trie par meilleur score du mode, tous modes ne se mélangent pas', async () => {
    const player = await repository.createAccount(uniquePseudo('lbmode'), 'hash');
    const other = await repository.createAccount(uniquePseudo('lbmode'), 'hash');
    createdIds.push(player.id, other.id);

    await repository.recordGameResult(player.id, 'vanilla', 700, 0);
    await repository.recordGameResult(other.id, 'vanilla', 300, 0);
    await repository.recordGameResult(player.id, 'hardcore', 10, 0);

    const vanillaRows = await repository.getLeaderboard('vanilla', 1000);
    const ours = vanillaRows.filter((row) => [player.pseudo, other.pseudo].includes(row.pseudo));
    expect(ours.map((row) => row.pseudo)).toEqual([player.pseudo, other.pseudo]);
    expect(ours[0]).toMatchObject({ score: 700 });

    const hardcoreRows = await repository.getLeaderboard('hardcore', 1000);
    expect(hardcoreRows.some((row) => row.pseudo === other.pseudo)).toBe(false);
  });

  it('getLeaderboard("mass") trie par la meilleure masse atteinte tous modes confondus', async () => {
    const player = await repository.createAccount(uniquePseudo('lbmass'), 'hash');
    const other = await repository.createAccount(uniquePseudo('lbmass'), 'hash');
    createdIds.push(player.id, other.id);

    await repository.recordBestMass(player.id, 'vanilla', 25000);
    await repository.recordBestMass(other.id, 'hardcore', 15000);

    const massRows = await repository.getLeaderboard('mass', 1000);
    const ours = massRows.filter((row) => [player.pseudo, other.pseudo].includes(row.pseudo));
    expect(ours.map((row) => row.pseudo)).toEqual([player.pseudo, other.pseudo]);
    expect(ours[0]).toMatchObject({ pseudo: player.pseudo, score: 25000 });
    expect(ours[1]).toMatchObject({ pseudo: other.pseudo, score: 15000 });
  });
});

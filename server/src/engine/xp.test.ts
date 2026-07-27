import { describe, expect, it } from 'vitest';
import {
  activeComboLevel,
  createLifeStats,
  creditMassEatenXp,
  creditPlayerEatenXp,
  recordMassEaten,
  recordPlayerEaten,
} from './xp.js';
import { World } from './world.js';

describe('createLifeStats', () => {
  it('démarre à zéro, sans combo actif', () => {
    const stats = createLifeStats();
    expect(stats.massEaten).toBe(0);
    expect(stats.playersEaten).toBe(0);
    expect(stats.xpEarned).toBe(0);
    expect(activeComboLevel(stats.combo, 0)).toBeUndefined();
  });
});

describe('recordMassEaten — "1 masse mangée = 1xp"', () => {
  it('ajoute la masse mangée et l’XP correspondante, sans combo actif', () => {
    const stats = createLifeStats();
    recordMassEaten(stats, 21_000, 0);
    expect(stats.massEaten).toBe(21_000);
    expect(stats.xpEarned).toBe(21_000);
  });

  it('ignore un gain nul ou négatif (défensif)', () => {
    const stats = createLifeStats();
    recordMassEaten(stats, 0, 0);
    recordMassEaten(stats, -5, 0);
    expect(stats.massEaten).toBe(0);
    expect(stats.xpEarned).toBe(0);
  });
});

describe('recordPlayerEaten — "1 joueur mangé = 400xp"', () => {
  it('ajoute le bonus fixe et compte le joueur mangé', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBe(400);
  });

  it("dix joueurs mangés (hors combo) rapportent 4000xp, comme dans l'exemple fourni", () => {
    const stats = createLifeStats();
    // Espacés de plus de 10s : jamais de combo, chaque mangé reste isolé.
    for (let i = 0; i < 10; i++) recordPlayerEaten(stats, i * 20_000);
    expect(stats.playersEaten).toBe(10);
    expect(stats.xpEarned).toBe(4000);
  });
});

describe('combo — déclenchement (fenêtre de 5s)', () => {
  it('ne déclenche aucun combo après un seul joueur mangé', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    expect(activeComboLevel(stats.combo, 0)).toBeUndefined();
  });

  it('déclenche le combo (x1,2, niveau 1) si le second mangé arrive en moins de 5s', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 4_000);
    expect(activeComboLevel(stats.combo, 4_000)).toBe(1);
    expect(stats.combo.multiplier).toBeCloseTo(1.2, 6);
  });

  it('ne déclenche pas le combo si le second mangé arrive après 5s (redémarre à zéro)', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 5_001);
    expect(activeComboLevel(stats.combo, 5_001)).toBeUndefined();
    // Ce second mangé redevient le premier maillon d'une nouvelle tentative.
    expect(stats.combo.chain).toBe(1);
  });
});

describe('combo — prolongation (fenêtre de 10s) et plafond x10', () => {
  it('prolonge le combo (niveau 2) si un troisième mangé arrive en moins de 10s du précédent', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 3_000); // déclenche (niveau 1)
    recordPlayerEaten(stats, 3_000 + 9_000); // prolonge (niveau 2)
    expect(activeComboLevel(stats.combo, 12_000)).toBe(2);
    expect(stats.combo.multiplier).toBeCloseTo(1.2 * 1.2, 6);
  });

  it('la prolongation tolère jusqu’à 10s (plus large que le déclenchement initial à 5s)', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 4_000); // déclenche
    recordPlayerEaten(stats, 4_000 + 9_999); // toujours dans les 10s : prolonge
    expect(stats.combo.chain).toBe(3);
  });

  it('le combo retombe si la prolongation arrive après 10s (recommence à zéro)', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 3_000); // déclenche
    recordPlayerEaten(stats, 3_000 + 10_001); // trop tard : la chaîne recommence
    expect(stats.combo.chain).toBe(1);
    expect(activeComboLevel(stats.combo, 3_000 + 10_001)).toBeUndefined();
  });

  it('plafonne le multiplicateur à x10 ("Boost Max") malgré une chaîne très longue', () => {
    const stats = createLifeStats();
    let now = 0;
    recordPlayerEaten(stats, now);
    now += 3_000;
    recordPlayerEaten(stats, now); // déclenche
    for (let i = 0; i < 20; i++) {
      now += 5_000; // toujours dans la fenêtre de prolongation de 10s
      recordPlayerEaten(stats, now);
    }
    expect(stats.combo.multiplier).toBeLessThanOrEqual(10);
    expect(stats.combo.multiplier).toBeCloseTo(10, 6);
  });

  it('chaque prolongation repousse l’expiration de 20s (le combo "continue")', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 3_000); // déclenche, expire à 3000+20000=23000
    expect(activeComboLevel(stats.combo, 22_999)).toBe(1);
    recordPlayerEaten(stats, 3_000 + 9_000); // prolonge à 12000, nouvelle expiration 32000
    expect(activeComboLevel(stats.combo, 31_999)).toBe(2);
    expect(activeComboLevel(stats.combo, 32_001)).toBeUndefined();
  });
});

describe('combo — multiplie l’XP gagné pendant les 20 secondes suivantes', () => {
  it('un gain de masse pendant un combo actif est multiplié', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 3_000); // déclenche x1,2, xp jusque là : 400 + 400*1,2 = 880
    expect(stats.xpEarned).toBeCloseTo(400 + 400 * 1.2, 6);

    recordMassEaten(stats, 100, 3_500); // toujours dans la fenêtre des 20s
    expect(stats.xpEarned).toBeCloseTo(400 + 400 * 1.2 + 100 * 1.2, 6);
  });

  it('un gain de masse après expiration du combo n’est plus multiplié', () => {
    const stats = createLifeStats();
    recordPlayerEaten(stats, 0);
    recordPlayerEaten(stats, 3_000); // déclenche, expire à 23000
    const xpAfterCombo = stats.xpEarned;

    recordMassEaten(stats, 50, 23_001); // combo expiré : multiplicateur redevenu x1
    expect(stats.xpEarned).toBeCloseTo(xpAfterCombo + 50, 6);
  });
});

describe('creditMassEatenXp / creditPlayerEatenXp', () => {
  function freshWorld(): World {
    return new World({ mapSize: 1000 });
  }

  it("ne fait rien si l'ownerId est absent (nourriture, jamais de propriétaire)", () => {
    const world = freshWorld();
    expect(() => creditMassEatenXp(world, undefined, 10, 0)).not.toThrow();
    expect(() => creditPlayerEatenXp(world, undefined, 0)).not.toThrow();
  });

  it("ne fait rien si le joueur n'existe pas dans le monde (défensif)", () => {
    const world = freshWorld();
    expect(() => creditMassEatenXp(world, 'inconnu', 10, 0)).not.toThrow();
    expect(() => creditPlayerEatenXp(world, 'inconnu', 0)).not.toThrow();
  });

  it('crédite bien lifeStats du joueur propriétaire', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');

    creditMassEatenXp(world, 'p1', 30, 0);
    creditPlayerEatenXp(world, 'p1', 0);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBe(30);
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBe(30 + 400);
  });
});

describe('World.resetLifeStats', () => {
  it('remet les stats XP/combo à zéro pour un joueur existant', () => {
    const world = new World({ mapSize: 1000 });
    world.addPlayer('p1', 'Alice');
    creditMassEatenXp(world, 'p1', 500, 0);
    creditPlayerEatenXp(world, 'p1', 0);

    world.resetLifeStats('p1');

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBe(0);
    expect(stats.playersEaten).toBe(0);
    expect(stats.xpEarned).toBe(0);
  });

  it("ne fait rien (pas d'erreur) pour un id inconnu", () => {
    const world = new World({ mapSize: 1000 });
    expect(() => world.resetLifeStats('inconnu')).not.toThrow();
  });
});

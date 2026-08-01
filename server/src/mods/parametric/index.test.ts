import { distance } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import type { GameMod } from '../../engine/mod.js';
import { World } from '../../engine/world.js';
import { createParametricMod } from './index.js';
import { pieceState } from './pieceState.js';
import { testConfig } from './testConfig.js';
import { accelerationForMass, velocityForMass, absorptionDurationSec } from './physics.js';

function freshWorld(mapSize = 15000, kArea = testConfig().areaConstant): World {
  return new World({ mapSize, kArea });
}

/** Fait avancer le drain d'une absorption en cours (voir `beginConsumption`/
 * `advanceConsumptions`, mods/parametric/index.ts) jusqu'à extinction — l'absorption est
 * désormais PROGRESSIVE sur `config.eating.absorptionDurationSec` (0.3s par défaut) plutôt qu'un
 * transfert en un seul tick, pour que la victime ait le temps de comprendre ce qui lui arrive. */
function finishConsumption(mod: GameMod, world: World, config = testConfig(), stepSec = 0.05): void {
  const steps = Math.ceil(absorptionDurationSec(config) / stepSec) + 1;
  for (let i = 0; i < steps; i++) mod.onTick?.(world, stepSec);
}

describe('createParametricMod — getAccelerationForMass', () => {
  it('délègue à accelerationForMass avec la config du mod (panneau de stats client)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);

    expect(mod.getAccelerationForMass?.(200)).toBeCloseTo(accelerationForMass(200, config), 6);
  });
});

describe('createParametricMod — onPlayerJoin & règles d’apparition', () => {
  it('fait apparaître un unique morceau à la masse de départ du config', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');

    mod.onPlayerJoin?.(world, 'p1');

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.mass).toBe(config.player.startMass);
  });

  it('ne fait jamais apparaître un joueur/robot sur un joueur/robot existant', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();

    for (let i = 0; i < 20; i++) {
      const id = `player-${i}`;
      world.addPlayer(id, `Player ${i}`);
      mod.onPlayerJoin?.(world, id);
    }

    const allPieces = world.allEntities().filter((e) => e.kind === 'piece');
    expect(allPieces.length).toBe(20);

    for (let i = 0; i < allPieces.length; i++) {
      for (let j = i + 1; j < allPieces.length; j++) {
        const p1 = allPieces[i];
        const p2 = allPieces[j];
        const dist = Math.hypot(p1.position.x - p2.position.x, p1.position.y - p2.position.y);
        expect(dist).toBeGreaterThanOrEqual(p1.radius + p2.radius);
      }
    }
  });

  it('ne fait jamais apparaître un pellet sur un joueur/robot ni sur un autre pellet', () => {
    const config = testConfig({ food: { ...testConfig().food, density: 10, respawnRatePerSecond: 100 } });
    const mod = createParametricMod(config);
    const world = freshWorld();

    // Spawn 5 joueurs
    for (let i = 0; i < 5; i++) {
      const id = `player-${i}`;
      world.addPlayer(id, `Player ${i}`);
      mod.onPlayerJoin?.(world, id);
    }

    // Spawn nourriture via onTick
    mod.onTick?.(world, 1.0);

    const particles = world.allEntities().filter((e) => e.kind === 'particle');
    const pieces = world.allEntities().filter((e) => e.kind === 'piece');

    expect(particles.length).toBeGreaterThan(0);

    // Vérifie qu'aucun pellet ne chevauche un joueur/robot
    for (const p of particles) {
      for (const piece of pieces) {
        const dist = Math.hypot(p.position.x - piece.position.x, p.position.y - piece.position.y);
        expect(dist).toBeGreaterThanOrEqual(p.radius + piece.radius);
      }
    }

    // Vérifie qu'aucun pellet ne chevauche un autre pellet
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];
        const dist = Math.hypot(p1.position.x - p2.position.x, p1.position.y - p2.position.y);
        expect(dist).toBeGreaterThanOrEqual(p1.radius + p2.radius);
      }
    }
  });
});

describe('createParametricMod — onTick (vitesse/accélération)', () => {
  it('accélère vers v(m) sans la dépasser dans la direction de l’input', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false });
    // dt assez grand pour que l'accélération (1500 px/s²) atteigne v(50)=700 px/s
    mod.onTick?.(world, 0.5);

    expect(piece.velocity.x).toBeCloseTo(velocityForMass(50, config), 6);
    expect(piece.velocity.y).toBeCloseTo(0, 6);
  });

  it('ne saute pas instantanément à la vitesse cible sur un tick trop court (inertie)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false });
    mod.onTick?.(world, 0.01); // 1500*0.01 = 15 px/s de changement max, très inférieur à 300

    expect(piece.velocity.x).toBeCloseTo(15, 6);
  });

  it('réduit la vitesse cible proportionnellement à l’intensité du curseur', () => {
    const config = testConfig({ decay: { floor: 100 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    // intensité 50% (curseur à mi-chemin du rayon de contrôle), direction +x
    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 0.5, split: false });
    mod.onTick?.(world, 0.1); // 1500*0.1 = 150 px/s de changement max, réactivité immédiate vers la cible (150)

    expect(piece.velocity.x).toBeCloseTo(150, 6);

    mod.onTick?.(world, 1); // toujours à la cible réduite
    expect(piece.velocity.x).toBeCloseTo(velocityForMass(50, config) * 0.5, 5);
  });

  it('applique une zone morte autour de la cible (évite le tremblotement de direction sur un vecteur quasi nul)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    // Cible à moins de 3px (zone morte) : intensité effective nulle malgré intensity=1, donc
    // aucune force de pilotage — la vitesse reste nulle plutôt que d'osciller vers une direction
    // instable (offset quasi nul).
    mod.onPlayerInput?.(world, 'p1', { target: { x: 501, y: 500 }, intensity: 1, split: false });
    mod.onTick?.(world, 1);

    expect(piece.velocity.x).toBeCloseTo(0, 6);
    expect(piece.velocity.y).toBeCloseTo(0, 6);
  });

  it('applique la decay passive', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    // 0.2% par 10s après 10s d'inactivité pour masse < 500
    mod.onTick?.(world, 10); // 10s sans nourriture -> 0.2% de decay -> 99.8
    expect(piece.mass).toBeCloseTo(99.8, 1);
  });
});

describe('createParametricMod — ramassage de nourriture (hitbox +5%)', () => {
  it('ramasse une particule de nourriture à +5% du rayon du blob', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    const particle = world.spawnParticle({ x: 500 + piece.radius * 1.04, y: 500 }, 1);
    world.rebuildSpatialHash();

    const pairs = world.findOverlappingPairs();
    expect(pairs.length).toBe(1);

    mod.onCollision?.(world, pairs[0]![0], pairs[0]![1], 0.05);
    expect(world.getEntity(particle.id)).toBeUndefined();
  });
});

describe('createParametricMod — split', () => {
  it('divise un morceau en 2, avec une vitesse d’éjection initiale', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 1000, y: 1000 }, 200);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 1100, y: 1000 }, intensity: 1, split: true });

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(2);
    const origin = pieces.find((p) => p.id === piece.id);
    const ejected = pieces.find((p) => p.id !== piece.id);

    expect(origin?.mass).toBeCloseTo(100, 6);
    expect(ejected?.mass).toBeCloseTo(100, 6); // eta_W = 1 dans le config de test
    expect(ejected && ejected.velocity.x).toBeGreaterThan(0); // boost initial dans la direction du split
  });

  it('crée de la masse quand ejectEfficiency > 1', () => {
    const config = testConfig({ split: { ejectEfficiency: 1.2, ejectSpeedFactor: 2 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 1000, y: 1000 }, 200);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 1100, y: 1000 }, intensity: 1, split: true });

    const pieces = world.getPiecesByOwner('p1');
    const totalMass = pieces.reduce((sum, p) => sum + p.mass, 0);
    expect(totalMass).toBeCloseTo(220, 6); // 100 (origine) + 100*1.2 (éjecté)
  });

  it('ne fait rien en-dessous de minSplitMass', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: true });

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });
});

describe('createParametricMod — éjection de masse', () => {
  it('éjecte config.eject.amount de masse, mangeable par n’importe qui (une particule, pas un morceau possédé)', () => {
    const config = testConfig({ eject: { amount: 5 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 100); // 100 >= 5*4 (seuil minimal)

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false, eject: true });

    const [piece] = world.getPiecesByOwner('p1');
    expect(piece!.mass).toBeCloseTo(95, 6);

    const particles = world.allEntities().filter((e) => e.kind === 'particle');
    expect(particles).toHaveLength(1);
    expect(particles[0]!.mass).toBeCloseTo(5, 6);
    expect(particles[0]!.ownerId).toBeUndefined(); // mangeable par n'importe qui, pas un morceau possédé
  });

  it('refuse si la masse du morceau est sous 4x la masse envoyée (demande utilisateur)', () => {
    const config = testConfig({ eject: { amount: 5 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 19.999); // juste sous 5*4=20

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false, eject: true });

    const [piece] = world.getPiecesByOwner('p1');
    expect(piece!.mass).toBeCloseTo(19.999, 6); // inchangé
    expect(world.allEntities().filter((e) => e.kind === 'particle')).toHaveLength(0);
  });

  it('respecte un cooldown anti-spam entre deux éjections (touche maintenue/répétition clavier)', () => {
    const config = testConfig({ eject: { amount: 5 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    const input = { target: { x: 600, y: 500 }, intensity: 1, split: false, eject: true };
    mod.onPlayerInput?.(world, 'p1', input);
    mod.onPlayerInput?.(world, 'p1', input); // immédiat : cooldown pas écoulé, ignoré

    const [piece] = world.getPiecesByOwner('p1');
    expect(piece!.mass).toBeCloseTo(95, 6); // une seule éjection a eu lieu
    expect(world.allEntities().filter((e) => e.kind === 'particle')).toHaveLength(1);
  });

  it('freine la particule éjectée jusqu’à l’arrêt (rien d’autre ne freine une particule)', () => {
    const config = testConfig({ eject: { amount: 5 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false, eject: true });
    const [particle] = world.allEntities().filter((e) => e.kind === 'particle');
    const initialSpeed = Math.hypot(particle!.velocity.x, particle!.velocity.y);
    expect(initialSpeed).toBeGreaterThan(0);

    for (let i = 0; i < 400; i++) mod.onTick?.(world, 1 / 20); // 20s simulées

    const finalSpeed = Math.hypot(particle!.velocity.x, particle!.velocity.y);
    expect(finalSpeed).toBeLessThan(initialSpeed * 0.01);
  });

  it('ne fait rien quand `config.player.ejectEnabled` est `false` (Hardcore : ne garder que le Dash, pas de nourrissage volontaire d’un allié)', () => {
    const config = testConfig({ eject: { amount: 5 }, player: { ...testConfig().player, ejectEnabled: false } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false, eject: true });

    const [piece] = world.getPiecesByOwner('p1');
    expect(piece!.mass).toBeCloseTo(100, 6); // inchangé
    expect(world.allEntities().filter((e) => e.kind === 'particle')).toHaveLength(0);
  });
});

describe('createParametricMod — fusion', () => {
  it('fusionne deux morceaux du même joueur après cooldown et chevauchement suffisant', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = config.merge.baseTimeSec;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    mod.onCollision?.(world, a, b, 1 / 20);

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });

  it('ne fusionne pas avant la fin du cooldown', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = 1;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    mod.onCollision?.(world, a, b, 1 / 20);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2);
  });

  it('repousse DUREMENT les morceaux du même joueur tant que la fusion n’est pas possible (correctif : ils se chevauchaient librement au lieu de collisionner)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100); // très chevauchés (5px d'écart)
    pieceState(a).splitElapsedS = 1; // cooldown post-split pas écoulé
    pieceState(b).splitElapsedS = 1;
    // Vélocités qui se rapprochent l'une de l'autre le long de l'axe de contact (x) — la
    // répulsion "dure" (demande utilisateur : "collisions d'une même équipe dures, sans rebond")
    // doit annuler cette composante en plus de repousser les positions, voir `applyRepulsion`.
    a.velocity = { x: 50, y: 0 };
    b.velocity = { x: -50, y: 0 };
    const distanceBefore = distance(a.position, b.position);

    mod.onCollision?.(world, a, b, 1 / 20);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2); // toujours pas fusionnés
    expect(distance(a.position, b.position)).toBeGreaterThan(distanceBefore); // repoussés
    // La composante de vélocité qui rapprochait a et b (le long de x) est annulée : a ralentit,
    // b aussi — ils ne se rapprochent plus l'un de l'autre le long de l'axe de contact.
    expect(a.velocity.x).toBeLessThan(50);
    expect(b.velocity.x).toBeGreaterThan(-50);
  });

  it('ne repousse plus une fois la fusion effectuée (un seul morceau restant)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = config.merge.baseTimeSec;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    expect(() => mod.onCollision?.(world, a, b, 1 / 20)).not.toThrow();
    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });

  it('fusionne bien une fois le cooldown écoulé après avoir été maintenus en collision dure pendant tout le cooldown (régression : la répulsion dure ramenait le chevauchement à zéro à CHAQUE tick, empêchant la fusion pour toujours d’atteindre le chevauchement minimal requis une fois le cooldown écoulé — reproduit ici le scénario réel : le joueur pousse ses deux morceaux l’un vers l’autre pendant tout le cooldown)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100); // le joueur les maintient l'un contre l'autre
    pieceState(a).splitElapsedS = 0;
    pieceState(b).splitElapsedS = 0;

    // Simule le joueur qui maintient ses deux morceaux en collision pendant tout le cooldown :
    // à chaque tick, la répulsion dure s'applique (fusion impossible, cooldown pas écoulé) et les
    // repositionne — avec l'ANCIEN comportement (résolution à séparation complète), ils finiraient
    // totalement séparés (chevauchement nul) ; avec le correctif, ils restent à un chevauchement
    // suffisant pour fusionner dès que le cooldown expire.
    for (let i = 0; i < config.merge.baseTimeSec * 20; i++) {
      pieceState(a).splitElapsedS += 1 / 20;
      pieceState(b).splitElapsedS += 1 / 20;
      mod.onCollision?.(world, a, b, 1 / 20);
      if (world.getPiecesByOwner('p1').length === 1) break; // fusionné : `a`/`b` retirés du monde
    }

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });
});

describe('createParametricMod — manger', () => {


  it('laisse croiser librement deux morceaux de masse équivalente (différence <= 5%)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const piece1 = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const piece2 = world.spawnPiece('p2', { x: 505, y: 500 }, 100);
    const distanceBefore = distance(piece1.position, piece2.position);

    mod.onCollision?.(world, piece1, piece2, 1 / 20);

    expect(distance(piece1.position, piece2.position)).toBe(distanceBefore);
  });

  it('absorbe un morceau de joueur si l’attaquant a l’avantage de masse et recouvre au moins 2/3 du blob (absorption progressive : le seuil franchi condamne la cible, drainée sur absorptionDurationSec)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);
    // Seuil franchi : la cible n'est pas encore retirée (drain en cours), mais son sort est scellé.
    expect(world.getEntity(target.id)).toBeDefined();

    finishConsumption(mod, world, config);

    expect(world.getEntity(target.id)).toBeUndefined();
    expect(attacker.mass).toBeCloseTo(220, 6);
  });

  it('ne mange PAS un morceau de joueur si le chevauchement est inférieur à 0.6 (60%)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    // Attaquant à x:500 (r=77), cible à x:580 (r=44.5) — chevauchement partiel ~20% < 60%
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 300);
    const target = world.spawnPiece('p2', { x: 580, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);

    // Cible TOUJOURS en vie (pas mangée avant 60% de recouvrement)
    expect(world.getEntity(target.id)).toBeDefined();
  });


  it('mange une particule si la masse est suffisante', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, 1);

    mod.onCollision?.(world, piece, particle, 1 / 20);

    expect(world.getEntity(particle.id)).toBeUndefined();
    expect(piece.mass).toBeCloseTo(51, 6);
  });

  it("crédite l'XP au joueur qui mange un autre joueur (masse + bonus fixe, engine/xp.ts)", () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);
    finishConsumption(mod, world, config);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBeCloseTo(100, 6);
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBeCloseTo(100 + 400, 6); // 1 masse = 1xp + bonus fixe de 400xp
  });

  it("crédite l'XP de masse (mais pas le bonus joueur) en mangeant une particule", () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, 7);

    mod.onCollision?.(world, piece, particle, 1 / 20);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBe(7);
    expect(stats.playersEaten).toBe(0);
    expect(stats.xpEarned).toBe(7);
  });

  it('Blob Dieu (§4.5 cahier_des_charges_admin.md) : mange sans avantage de masse, ne peut jamais être mangé', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('admin-god-1', 'Fantadmin');
    world.addPlayer('p1', 'Alice');
    // Même masse (donc même rayon, chevauchement total) : sans l'exemption, ni l'un ni l'autre
    // n'a l'avantage de masse requis (il faut 1.05x, voir `hasMassAdvantage`) — seule l'exemption
    // Blob Dieu permet à `god` de manger `target` ici.
    const god = world.spawnPiece('admin-god-1', { x: 500, y: 500 }, 100);
    const target = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, god, target, 1);
    expect(world.getEntity(target.id)).toBeUndefined();
    expect(god.mass).toBeCloseTo(200, 6);

    // Un joueur avec un avantage de masse écrasant ne peut jamais manger le dieu.
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 1_000_000);
    mod.onCollision?.(world, attacker, god, 1);
    expect(world.getEntity(god.id)).toBeDefined();
  });

  it('exige au moins 70% de chevauchement de la cible pour qu’elle soit entièrement mangée', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Attacker');
    world.addPlayer('p2', 'Victim');

    // Attaquant de masse 1000 à (500, 500), Victime de masse 100
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 1000);
    // Victime placée à 160px (chevauchement partiel < 70%)
    const victimFar = world.spawnPiece('p2', { x: 660, y: 500 }, 100);

    mod.onCollision?.(world, attacker, victimFar, 0.05);
    // Chevauchement insuffisant (< 70%) : la cible n'est pas mangée
    expect(world.getEntity(victimFar.id)).toBeDefined();

    // Victime superposée quasi au centre (x: 550, chevauchement > 70%)
    const victimClose = world.spawnPiece('p2', { x: 550, y: 500 }, 100);
    mod.onCollision?.(world, attacker, victimClose, 0.05);
    // Seuil franchi : absorption engagée (progressive, voir `beginConsumption`) — puis mangée.
    finishConsumption(mod, world, config);
    expect(world.getEntity(victimClose.id)).toBeUndefined();
  });

  it('mange une cible traversée en un seul tick à haute vitesse (Dash), même si la distance de FIN de tick seule montre un chevauchement insuffisant', () => {
    // Reproduit le retour utilisateur "réactivité de manger lente à haute vitesse" : un attaquant
    // qui traverse ENTIÈREMENT sa cible en un seul tick (previousPosition -> position) doit la
    // manger si son trajet est passé par un point de chevauchement suffisant, même si sa position
    // de FIN de tick (déjà repassée de l'autre côté) ne montre plus, seule, que 160px d'écart —
    // exactement la distance jugée insuffisante par le test "exige au moins 70%" ci-dessus.
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Attacker');
    world.addPlayer('p2', 'Victim');

    const victim = world.spawnPiece('p2', { x: 500, y: 500 }, 100);
    victim.previousPosition = { x: 500, y: 500 }; // immobile ce tick

    const attacker = world.spawnPiece('p1', { x: 660, y: 500 }, 1000);
    // A traversé le centre de la victime (500,500) ce tick — trajet 340px -> 660px sur l'axe X.
    attacker.previousPosition = { x: 340, y: 500 };

    mod.onCollision?.(world, attacker, victim, 0.05);
    finishConsumption(mod, world, config);
    expect(world.getEntity(victim.id)).toBeUndefined();
  });

  it('ne mange pas et ne repousse pas deux blobs si le chevauchement est < 70%', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Player1');
    world.addPlayer('p2', 'Player2');

    const blobA = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const blobB = world.spawnPiece('p2', { x: 525, y: 500 }, 103); // Chevauchement partiel < 70%

    mod.onCollision?.(world, blobA, blobB, 0.05);
    // Ni mangé ni repoussé
    expect(world.getEntity(blobA.id)).toBeDefined();
    expect(world.getEntity(blobB.id)).toBeDefined();
    expect(blobA.position.x).toBe(500);
  });
});

describe('createParametricMod — onPostMove (bords de carte)', () => {
  it('délègue au comportement de bord configuré (STRICT_WALL par défaut)', () => {
    const config = testConfig({ arena: { width: 100, height: 100, borderType: 'STRICT_WALL' } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: -5, y: 50 }, 50);
    piece.velocity = { x: -10, y: 0 };

    mod.onPostMove?.(world, 0.1);

    expect(piece.position.x).toBeCloseTo(piece.radius, 6);
    expect(piece.velocity.x).toBe(0);
  });

  it('ne fait pas apparaître les particules de nourriture sous un joueur', () => {
    const config = testConfig({ food: { density: 10, respawnRatePerSecond: 10, pelletTypes: [{ color: 'vert', mass: 1, weight: 1 }] } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'BigPlayer');
    // Joueur de très grande masse avec un rayon de 500px au centre (5000, 5000)
    const bigPiece = world.spawnPiece('p1', { x: 5000, y: 5000 }, 250000);

    mod.onTick?.(world, 1);

    const particles = world.allEntities().filter((e) => e.kind === 'particle');
    for (const particle of particles) {
      const dist = Math.hypot(particle.position.x - bigPiece.position.x, particle.position.y - bigPiece.position.y);
      expect(dist).toBeGreaterThanOrEqual(bigPiece.radius);
    }
  });
});

describe('createParametricMod — intensité multi-morceaux', () => {
  it('force intensity = 1 quand le joueur possède plus d’un morceau', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    world.spawnPiece('p1', { x: 600, y: 500 }, 50);

    // Cible proche du premier morceau avec intensity 0.1
    mod.onPlayerInput?.(world, 'p1', { target: { x: 510, y: 500 }, intensity: 0.1, split: false });
    mod.onTick?.(world, 0.5);

    const pieces = world.getPiecesByOwner('p1');
    // Vitesse plein régime vers la cible grâce à intensity forced to 1
    expect(Math.abs(pieces[0]!.velocity.x)).toBeGreaterThan(100);
  });
});

describe('createParametricMod — Absence de malus/split punitif pour le leader', () => {
  it('ne divise jamais le leader, même très loin devant, même après de nombreux ticks', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Leader');
    world.addPlayer('p2', 'RunnerUp');

    world.spawnPiece('p1', { x: 500, y: 500 }, 5000);
    world.spawnPiece('p2', { x: 2000, y: 2000 }, 100);

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);

    // Largement plus que l'ancien intervalle de vérification (20 ticks) du malus retiré — garde
    // de régression contre sa réintroduction, pas seulement contre un unique tick.
    for (let i = 0; i < 50; i++) mod.onTick?.(world, 0.05);

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
    expect(world.getPiecesByOwner('p2')).toHaveLength(1);
  });
});

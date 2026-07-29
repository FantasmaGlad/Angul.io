import type { EntitySnapshot, MovementConfig } from '@angulio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPrediction } from './prediction.js';

/** Accélération quasi infinie : la vitesse cible est atteinte en un seul pas, ce qui rend la
 * position résultante de chaque `step` triviale à calculer à la main (déplacement constant de
 * v0*dt par pas tant que la cible reste loin) — simplifie les assertions sans perdre en fidélité
 * au vrai modèle (mêmes formules que shared/src/movement.ts). */
const MOVEMENT: MovementConfig = {
  v0: 100,
  speedMultiplier: 1,
  speedMassExponent: 0,
  velocityFloor: 0,
  accelerationBase: 1e9,
  accelerationMassExponent: 0,
  startMass: 50,
};

function ownSnapshot(id: string, x: number, y: number, mass = 50): EntitySnapshot {
  return { i: id, k: 'c', x, y, r: 10, m: mass, p: 'self' };
}

/** Régression : l'ancienne réconciliation (blend/snap direct entre position prédite courante et
 * position autoritaire) tirait systématiquement le blob en arrière à chaque `state` reçu, dès que
 * la latence réseau devenait significative — un "rollback" visible signalé après déploiement en
 * production (RTT ~50ms mesuré, voir plan_performance_reseau.md). La réconciliation par rejeu
 * élimine ce biais : un écart n'est corrigé que s'il reflète un vrai désaccord avec le serveur, pas
 * simplement l'avance normale de la prédiction sur un état forcément un peu plus vieux. */
describe('LocalPrediction — réconciliation par rejeu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ne tire pas la position en arrière quand l'autoritaire confirme la prédiction, latence compensée", () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    // Amorce (aucun historique à rejouer).
    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    // Trois pas locaux, chacun avance de 10 unités (v=100px/s à dt=0.1s), aux temps client 100/200/300.
    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // `state` reçu à t=300, latence aller simple estimée à 100ms : reflète donc l'état serveur à
    // t≈200 — et le serveur, ayant appliqué le même modèle sur les mêmes inputs, est bien à
    // (20,0), exactement ce que le client avait déjà prédit à ce moment-là.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 20, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // Toujours (30,0) : le rejeu retrouve exactement la position déjà prédite au lieu de la tirer
    // vers l'ancienne valeur autoritaire (ce que faisait l'ancien blend/snap).
    expect(entity!.x).toBeCloseTo(30, 5);
    expect(entity!.y).toBeCloseTo(0, 5);
  });

  it('lisse (au lieu de snapper d’un coup) un petit désaccord serveur non prédit (répulsion, croissance...)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // Cette fois, le serveur était réellement à (15,0) à t≈200 (ex. répulsion contre un bot) —
    // 5 unités de moins que ce que le client avait prédit. Rejouer le pas suivant (+10) par-dessus
    // cette vérité donne 25 (résidu de -5 par rapport aux 30 déjà prédits) — un petit résidu de ce
    // type (répulsion routinière, très fréquente sur une carte peuplée de bots) est maintenant
    // lissé progressivement plutôt qu'appliqué d'un coup (RECONCILE_BLEND_FACTOR = 0.35), pour
    // éviter le tressautement constant que produisait un snap dur à chaque `state` reçu.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 15, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // 30 + (25-30)*0.35 = 28.25 : seule une fraction du résidu est appliquée, pas le résidu entier.
    expect(entity!.x).toBeCloseTo(28.25, 5);
  });

  it('snap immédiatement sur un vrai désaccord massif (téléportation, mort/respawn, nouveau morceau)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // Écart de 200 unités (bien au-delà de RECONCILE_SNAP_THRESHOLD_PX = 120) : un vrai
    // désaccord discontinu, pas un nudge de répulsion — corrigé intégralement, sans lissage.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', -200, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // -200 + 10 (rejeu du dernier pas) = -190, sans atténuation.
    expect(entity!.x).toBeCloseTo(-190, 5);
  });

  it("n'applique aucune force dans la zone morte autour de la cible (évite le tremblotement)", () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    // Cible à 1px (< TARGET_DEAD_ZONE_PX) : intensité effective nulle malgré intensity=1, donc la
    // vitesse (nulle au départ) ne bouge pas — pas de direction instable calculée sur ce vecteur
    // quasi nul.
    nowSpy.mockReturnValueOnce(16);
    prediction.step(0.016, { x: 1, y: 0 }, 1, MOVEMENT);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    expect(entity!.x).toBeCloseTo(0, 6);
    expect(entity!.y).toBeCloseTo(0, 6);
  });

  it('amorce directement un morceau inconnu (premier state de la vie, ou apparu ce tick)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000);

    prediction.reconcile([ownSnapshot('42', 5, 7)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('42', 999, 999)], 'self');
    expect(entity).toEqual(expect.objectContaining({ x: 5, y: 7 }));
  });

  it('retire un morceau absent du dernier state (fusion/mort/absorption)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.reconcile([], 'self', MOVEMENT, 0);

    const result = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // Plus de morceau prédit pour '1' : l'entité passe telle quelle (pipeline serveur habituel).
    expect(result[0]).toEqual(ownSnapshot('1', 999, 999));
  });
});

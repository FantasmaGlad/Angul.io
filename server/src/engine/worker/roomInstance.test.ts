import { describe, expect, it } from 'vitest';
import type { BotConfig } from '../../mods/parametric/config.js';
import { applyRoomBotCountOverride } from './roomInstance.js';

const BASE_BOTS: BotConfig = {
  enabled: true,
  updateFrequencyHz: 4,
  proportions: { fuis: 0.25, neutre: 0.25, agressif: 0.25, fou: 0.25 },
};

describe('applyRoomBotCountOverride', () => {
  it('min === max produit une population fixe (baseline/max/min alignés)', () => {
    const result = applyRoomBotCountOverride(BASE_BOTS, { min: 10, max: 10 });
    expect(result.ambientTargetCount).toBe(10);
    expect(result.maxTotal).toBe(10);
    expect(result.challengers?.baselineCount).toBe(10);
    expect(result.challengers?.maxWithHumans).toBe(10);
    expect(result.challengers?.minWithHumans).toBe(10);
  });

  it('min < max reproduit la rampe existante bornée par ces valeurs', () => {
    const result = applyRoomBotCountOverride(BASE_BOTS, { min: 3, max: 40 });
    expect(result.challengers?.baselineCount).toBe(3);
    expect(result.challengers?.maxWithHumans).toBe(40);
    expect(result.challengers?.minWithHumans).toBe(3);
    expect(result.ambientTargetCount).toBe(40);
    expect(result.maxTotal).toBe(40);
  });

  it("étend massMultipliers pour couvrir jusqu'à `max` rangs (sinon BotManager les recoupe)", () => {
    const withShortMultipliers: BotConfig = {
      ...BASE_BOTS,
      challengers: {
        enabled: true,
        baselineCount: 6,
        maxWithHumans: 15,
        minWithHumans: 6,
        rampHumans: 5,
        massMultipliers: [50, 40, 30],
      },
    };
    const result = applyRoomBotCountOverride(withShortMultipliers, { min: 0, max: 50 });
    expect(result.challengers?.massMultipliers).toHaveLength(50);
    // Les 3 premiers paliers d'origine sont conservés tels quels...
    expect(result.challengers?.massMultipliers.slice(0, 3)).toEqual([50, 40, 30]);
    // ...le dernier palier connu (30) est répété pour tous les rangs supplémentaires.
    expect(result.challengers?.massMultipliers[49]).toBe(30);
  });

  it("préserve rampHumans/massMultipliers existants quand seules les bornes de population changent", () => {
    const withChallengers: BotConfig = {
      ...BASE_BOTS,
      challengers: {
        enabled: true,
        baselineCount: 6,
        maxWithHumans: 15,
        minWithHumans: 6,
        rampHumans: 8,
        massMultipliers: Array(20).fill(5),
      },
    };
    const result = applyRoomBotCountOverride(withChallengers, { min: 2, max: 20 });
    expect(result.challengers?.rampHumans).toBe(8);
    expect(result.challengers?.massMultipliers).toHaveLength(20);
  });
});

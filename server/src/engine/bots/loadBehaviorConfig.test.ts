import { describe, expect, it } from 'vitest';
import { DEFAULT_BOT_BEHAVIOR_CONFIG } from './behaviorConfig.js';
import { listAvailableBotBehaviorIds, loadBotBehaviorConfig } from './loadBehaviorConfig.js';

describe('loadBotBehaviorConfig', () => {
  it('charge server/configs/bots/default.json (identique à DEFAULT_BOT_BEHAVIOR_CONFIG)', () => {
    expect(loadBotBehaviorConfig('default')).toEqual(DEFAULT_BOT_BEHAVIOR_CONFIG);
  });

  it('id omis retombe sur "default"', () => {
    expect(loadBotBehaviorConfig()).toEqual(DEFAULT_BOT_BEHAVIOR_CONFIG);
  });

  it('id introuvable retombe silencieusement sur DEFAULT_BOT_BEHAVIOR_CONFIG', () => {
    expect(loadBotBehaviorConfig('ce-profil-n-existe-pas')).toEqual(DEFAULT_BOT_BEHAVIOR_CONFIG);
  });

  it('liste au moins "default" parmi les profils disponibles', () => {
    expect(listAvailableBotBehaviorIds()).toContain('default');
  });
});

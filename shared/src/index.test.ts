import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from './index.js';

describe('shared', () => {
  it('exposes the project name', () => {
    expect(PROJECT_NAME).toBe('Angul.io');
  });
});

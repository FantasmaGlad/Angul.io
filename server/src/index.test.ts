import { describe, expect, it } from 'vitest';
import { PROJECT_NAME } from '@angulio/shared';

describe('server placeholder', () => {
  it('can import the shared package', () => {
    expect(PROJECT_NAME).toBe('Angul.io');
  });
});

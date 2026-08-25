import { describe, expect, it } from 'vitest';
import { CORE_VERSION } from './index.js';

describe('@jay-reach/core', () => {
  it('exporte une version', () => {
    expect(CORE_VERSION).toBe('0.0.0');
  });
});

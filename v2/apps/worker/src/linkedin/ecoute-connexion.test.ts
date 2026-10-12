import { describe, expect, it } from 'vitest';
import { urlModeSession } from './ecoute-connexion.js';

describe('urlModeSession', () => {
  it('impose 5432 quelle que soit la valeur reçue, et garde le reste', () => {
    for (const port of ['6543', '5432', '']) {
      const u = urlModeSession(`postgresql://postgres.ref:mdp@pooler.exemple.com${port ? ':' + port : ''}/postgres`);
      expect(u).toBe('postgresql://postgres.ref:mdp@pooler.exemple.com:5432/postgres');
    }
  });
});

import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG, getProviderEntry } from './catalog.js';

describe('catalogue des providers', () => {
  it('chaque provider a un id unique et au moins un champ', () => {
    const ids = PROVIDER_CATALOG.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PROVIDER_CATALOG) {
      expect(p.fields.length).toBeGreaterThan(0);
    }
  });

  it('tout champ secret est requis et a une clé i18n', () => {
    for (const p of PROVIDER_CATALOG) {
      for (const f of p.fields) {
        expect(f.labelKey).toMatch(/^providers\./);
        if (f.secret) {
          expect(f.type).toBe('password');
        }
      }
    }
  });

  it('getProviderEntry retrouve un provider connu et rien sinon', () => {
    expect(getProviderEntry('smartlead')?.category).toBe('email');
    expect(getProviderEntry('inconnu')).toBeUndefined();
  });
});

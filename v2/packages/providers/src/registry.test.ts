import { describe, expect, it } from 'vitest';
import { PROVIDER_CATALOG } from './catalog.js';
import { createRegistry, ProviderRegistry } from './registry.js';

describe('ProviderRegistry', () => {
  it('charge et valide tout le catalogue', () => {
    const registry = createRegistry(PROVIDER_CATALOG);
    expect(registry.list().length).toBe(PROVIDER_CATALOG.length);
  });

  it('résout par id et par catégorie', () => {
    const registry = createRegistry(PROVIDER_CATALOG);
    expect(registry.get('smartlead')?.category).toBe('email');
    expect(registry.listByCategory('signals').map((m) => m.id)).toContain('francetravail');
  });

  it('rejette un manifest invalide (catégorie inconnue)', () => {
    const registry = new ProviderRegistry();
    expect(() => registry.register({ id: 'x', category: 'nope', labelKey: 'x' })).toThrow();
  });

  it("rejette un doublon d'id", () => {
    const registry = new ProviderRegistry();
    const manifest = { id: 'dup', category: 'email', labelKey: 'providers.smartlead', fields: [] };
    registry.register(manifest);
    expect(() => registry.register(manifest)).toThrow(/déjà enregistré/);
  });
});

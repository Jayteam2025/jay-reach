import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import { ErreurEntree, exiger, valider, type Contexte } from './contexte.js';
import { z } from 'zod';

/** Contexte factice minimal : seul le rôle importe pour ces tests. */
function faux(role: Contexte['role']): Contexte {
  return { ex: { query: vi.fn() }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('contexte', () => {
  it('refuse un rôle insuffisant', () => {
    expect(() => exiger(faux('viewer'), 'operator')).toThrow(ForbiddenError);
  });

  it('laisse passer un rôle suffisant', () => {
    expect(() => exiger(faux('admin'), 'operator')).not.toThrow();
  });

  it('valide une entrée', () => {
    expect(() => valider(z.object({ a: z.number() }), { a: 'x' })).toThrow(ErreurEntree);
  });

  it('renvoie la valeur analysée quand l’entrée est valide', () => {
    expect(valider(z.object({ a: z.number() }), { a: 1 })).toEqual({ a: 1 });
  });
});

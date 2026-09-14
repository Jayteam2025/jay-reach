import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Contexte } from './contexte.js';
import { ecrireReglage, lireConsommationDuJour, lireReglages } from './plafonds.js';

/** Contexte factice : `rows` associe un motif (regex, insensible à la casse) au résultat renvoyé par `query`. */
function faux(rows: Record<string, unknown[]>): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  });
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };
}

describe('plafonds', () => {
  it('lit les défauts quand aucune ligne', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [] }));
    expect(r.scoring_par_jour).toBe(300);
    expect(r.fuseau).toBe('Europe/Paris');
  });

  it('préfère la ligne en base', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'scoring_par_jour', value: 120 }] }));
    expect(r.scoring_par_jour).toBe(120);
  });

  it('refuse l’écriture à un opérateur', async () => {
    await expect(ecrireReglage({ ...faux({}), role: 'operator' }, { cle: 'scoring_par_jour', valeur: 10 })).rejects.toThrow(ForbiddenError);
  });

  it('écrit un réglage valide en tant qu’admin', async () => {
    const ctx = faux({});
    await ecrireReglage(ctx, { cle: 'scoring_par_jour', valeur: 10 });
    expect(ctx.ex.query).toHaveBeenCalledWith(expect.stringMatching(/insert into organization_settings/i), expect.any(Array));
  });

  it('mesure la consommation du jour', async () => {
    const ctx = faux({
      'from organization_settings': [],
      scored_today: [{ n: 12 }],
      enrich_today: [{ n: 3 }],
      'from actions': [{ n: 32 }],
      'from senders': [{ plafond: 90 }],
    });
    const c = await lireConsommationDuJour(ctx);
    expect(c.scoring).toEqual({ utilise: 12, plafond: 300 });
    expect(c.enrichissement).toEqual({ utilise: 3, plafond: 30 });
    expect(c.envois).toEqual({ utilise: 32, plafond: 90 });
  });
});

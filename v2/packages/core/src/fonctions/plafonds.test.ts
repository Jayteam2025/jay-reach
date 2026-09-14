import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ecrireReglage, lireConsommationDuJour, lireReglages, schemaEcrireReglage } from './plafonds.js';

/**
 * Contexte factice : `rows` associe un motif (regex, insensible à la casse) au résultat renvoyé par `query`.
 * `query` reste un `vi.fn` (les tests vérifient parfois les arguments reçus) ; le cast est nécessaire car
 * `Executeur['query']` est générique en `T` et un mock, lui, s'infère toujours sur un type concret.
 */
function faux(rows: Record<string, unknown[]>): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
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

  it('accepte une chaîne numérique en base pour une clé numérique (valeur saisie via l’écran)', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'scoring_par_jour', value: '120' }] }));
    expect(r.scoring_par_jour).toBe(120);
  });

  it('ignore une chaîne non numérique en base pour une clé numérique (repli sur le défaut)', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'scoring_par_jour', value: 'abc' }] }));
    expect(r.scoring_par_jour).toBe(300);
  });

  it('ignore un objet en base pour une clé numérique', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'score_min_defaut', value: {} }] }));
    expect(r.score_min_defaut).toBe(70);
  });

  it('ignore un tableau en base pour une clé numérique', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'score_min_defaut', value: [1, 2] }] }));
    expect(r.score_min_defaut).toBe(70);
  });

  it('ignore un booléen en base pour une clé numérique', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'score_min_defaut', value: true }] }));
    expect(r.score_min_defaut).toBe(70);
  });

  it('ignore null en base pour une clé numérique', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'score_min_defaut', value: null }] }));
    expect(r.score_min_defaut).toBe(70);
  });

  it('ignore un nombre en base pour la clé fuseau (texte attendu)', async () => {
    const r = await lireReglages(faux({ 'from organization_settings': [{ key: 'fuseau', value: 42 }] }));
    expect(r.fuseau).toBe('Europe/Paris');
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
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const sqlEnvois = appels.map((call) => String(call[0])).find((sql) => /from actions/i.test(sql));
    expect(sqlEnvois).toMatch(/channel = 'email'/);
  });
});

describe('schemaEcrireReglage', () => {
  it('refuse une chaîne pour une clé numérique', () => {
    const r = schemaEcrireReglage.safeParse({ cle: 'scoring_par_jour', valeur: 'dix' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('scoring_par_jour');
  });

  it('refuse un nombre pour une clé texte (fuseau)', () => {
    const r = schemaEcrireReglage.safeParse({ cle: 'fuseau', valeur: 42 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('fuseau');
  });

  it('accepte un nombre pour une clé numérique', () => {
    expect(schemaEcrireReglage.safeParse({ cle: 'scoring_par_jour', valeur: 10 }).success).toBe(true);
  });

  it('accepte une chaîne pour la clé texte (fuseau)', () => {
    expect(schemaEcrireReglage.safeParse({ cle: 'fuseau', valeur: 'Europe/Paris' }).success).toBe(true);
  });
});

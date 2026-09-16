import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import {
  CLES_REGLAGES,
  ecrireReglage,
  lireConsommationDuJour,
  lireReglages,
  lireReglagesDetail,
  plafondEnrichissementDuJour,
  schemaEcrireReglage,
} from './plafonds.js';

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

describe('plafondEnrichissementDuJour (R78, tour de correction 1 de la tâche 17)', () => {
  it('applique la ligne organization_settings.enrichissements_par_jour quand elle existe', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: 'enrichissements_par_jour', value: 12 }] });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(12);
  });

  it('sans ligne organization_settings, retombe sur credentials.config.daily_cap (ancien réglage v1)', async () => {
    const ctx = faux({
      'from organization_settings': [],
      'jr:plafond_enrichissement_credentials': [{ config: { daily_cap: '45' } }],
    });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(45);
  });

  it('sans organization_settings ni credentials, retombe sur le défaut (30, aucun ENRICH_DAILY_CAP dans l’environnement de test)', async () => {
    const ctx = faux({ 'from organization_settings': [], 'jr:plafond_enrichissement_credentials': [] });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(30);
  });

  it('ignore un config.daily_cap non numérique dans credentials (repli sur le défaut)', async () => {
    const ctx = faux({
      'from organization_settings': [],
      'jr:plafond_enrichissement_credentials': [{ config: { daily_cap: 'abc' } }],
    });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(30);
  });

  it('ne consulte PAS credentials quand la ligne organization_settings existe déjà (pas de dépense inutile)', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: 'enrichissements_par_jour', value: 12 }] });
    await plafondEnrichissementDuJour(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /jr:plafond_enrichissement_credentials/i.test(String(a[0])))).toBe(false);
  });

  it('ne lit `organization_settings` qu’une seule fois, même quand le repli credentials se déclenche', async () => {
    const ctx = faux({ 'from organization_settings': [], 'jr:plafond_enrichissement_credentials': [{ config: { daily_cap: 45 } }] });
    await plafondEnrichissementDuJour(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelsReglages = appels.filter((a) => /from organization_settings/i.test(String(a[0])));
    expect(appelsReglages).toHaveLength(1);
  });

  it('lireConsommationDuJour applique EXACTEMENT le même plafond (les deux boutons « Chercher l’email » partagent la même source)', async () => {
    const ctx = faux({
      'from organization_settings': [],
      'jr:plafond_enrichissement_credentials': [{ config: { daily_cap: 45 } }],
      scored_today: [{ n: 0 }],
      enrich_today: [{ n: 7 }],
      'from actions': [{ n: 0 }],
      'from senders': [{ plafond: 0 }],
    });
    const consommation = await lireConsommationDuJour(ctx);
    const plafondDirect = await plafondEnrichissementDuJour(ctx);
    expect(consommation.enrichissement.plafond).toBe(45);
    expect(consommation.enrichissement.plafond).toBe(plafondDirect);
  });
});

describe('lireReglagesDetail (tâche 21, écran Réglages › Plafonds)', () => {
  it('rend une entrée par clé de CLES_REGLAGES, avec le défaut et le repli quand aucune ligne n’existe', async () => {
    const ctx = faux({ 'from organization_settings': [] });
    const detail = await lireReglagesDetail(ctx);
    expect(detail).toHaveLength(CLES_REGLAGES.length);
    const scoring = detail.find((d) => d.cle === 'scoring_par_jour');
    expect(scoring).toEqual({
      cle: 'scoring_par_jour',
      valeur: 300,
      defaut: 300,
      repli: 'SCORE_DAILY_CAP',
      modifiePar: null,
      modifieLe: null,
    });
    const scoreMin = detail.find((d) => d.cle === 'score_min_defaut');
    expect(scoreMin?.repli).toBeNull();
  });

  it('porte la valeur, l’auteur et la date de la ligne organization_settings quand elle existe', async () => {
    const ctx = faux({
      'from organization_settings': [
        { key: 'age_max_offres_jours', value: 45, updated_at: '2026-09-10T08:00:00.000Z', nom: 'Jean-Baptiste' },
      ],
    });
    const detail = await lireReglagesDetail(ctx);
    const age = detail.find((d) => d.cle === 'age_max_offres_jours');
    expect(age).toEqual({
      cle: 'age_max_offres_jours',
      valeur: 45,
      defaut: 14,
      repli: null,
      modifiePar: 'Jean-Baptiste',
      modifieLe: '2026-09-10T08:00:00.000Z',
    });
  });

  it('joint auth.users pour résoudre l’auteur (nom affiché, pas un id technique)', async () => {
    const ctx = faux({ 'from organization_settings': [] });
    await lireReglagesDetail(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /left join auth\.users/i.test(String(a[0])))).toBe(true);
  });

  it('accepte des `reglages` déjà lus (un seul appel restant : la jointure d’audit)', async () => {
    const ctx = faux({ 'from organization_settings': [] });
    const reglages = await lireReglages(ctx);
    (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mockClear();
    const detail = await lireReglagesDetail(ctx, reglages);
    expect(detail.find((d) => d.cle === 'scoring_par_jour')?.valeur).toBe(300);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.filter((a) => /from organization_settings/i.test(String(a[0])))).toHaveLength(1);
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

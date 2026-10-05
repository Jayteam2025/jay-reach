import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import {
  CLES_REGLAGES,
  ecrireReglage,
  fuseauDeLOrganisation,
  jourCourantDansFuseau,
  lireConsommationDuJour,
  lireReglages,
  lireReglagesDetail,
  plafondDuJour,
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

  it('la borne de la jauge d’envois revient en timestamptz avant comparaison (I5, revue finale) : le second `at time zone` manquait, la borne retombait sur minuit UTC', async () => {
    const ctx = faux({
      'from organization_settings': [],
      scored_today: [{ n: 0 }],
      enrich_today: [{ n: 0 }],
      'from actions': [{ n: 0 }],
      'from senders': [{ plafond: 90 }],
    });
    await lireConsommationDuJour(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const sqlEnvois = appels.map((call) => String(call[0])).find((sql) => /from actions/i.test(sql));
    // La borne revient en `timestamptz` par un `::date::timestamp at time zone` — jamais un
    // `::date at time zone` nu, qui résout le mauvais opérateur et repart du fuseau de la
    // SESSION (mesuré sur la base OSS le 18/09 : 6 lignes affichées contre 47 réelles).
    expect(sqlEnvois).toMatch(/\$2::date::timestamp at time zone \$3/);
    expect(sqlEnvois).toMatch(/\(\$2::date \+ 1\)::timestamp at time zone \$3/);
    expect(sqlEnvois).not.toMatch(/::date at time zone/);
  });

  it('#118 : scoring et enrichissement se remettent à zéro à minuit heure de l’organisation, pas à minuit UTC', async () => {
    vi.useFakeTimers();
    // 23:30 UTC le 14/01 = 00:30 le 15/01 à Paris : les deux fuseaux désignent un jour différent.
    vi.setSystemTime(new Date('2026-01-14T23:30:00.000Z'));
    try {
      const ctx = faux({
        'from organization_settings': [],
        scored_today: [{ n: 0 }],
        enrich_today: [{ n: 0 }],
        'from actions': [{ n: 0 }],
        'from senders': [{ plafond: 90 }],
      });
      await lireConsommationDuJour(ctx);
      const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const appelScoring = appels.find((a) => /scored_today/i.test(String(a[0])));
      const appelEnrich = appels.find((a) => /enrich_today/i.test(String(a[0])));
      expect(appelScoring?.[1]).toEqual(['org-1', '2026-01-15']);
      expect(appelEnrich?.[1]).toEqual(['org-1', '2026-01-15']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('jourCourantDansFuseau (#118)', () => {
  it('sous TZ=UTC (process), un jour Europe/Paris après minuit local reste au bon jour', () => {
    // 23:30 UTC le 14/01 = 00:30 le 15/01 à Paris.
    const instant = new Date('2026-01-14T23:30:00.000Z');
    expect(jourCourantDansFuseau('Europe/Paris', instant)).toBe('2026-01-15');
    expect(jourCourantDansFuseau('UTC', instant)).toBe('2026-01-14');
  });

  it('par défaut (sans instant), utilise l’heure courante', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00.000Z'));
    try {
      expect(jourCourantDansFuseau('Europe/Paris')).toBe('2026-09-17');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fuseauDeLOrganisation (#118, worker sans Contexte)', () => {
  it('lit le fuseau réglé en base', async () => {
    const ex = faux({ 'from organization_settings': [{ value: 'Europe/Paris' }] }).ex;
    await expect(fuseauDeLOrganisation(ex, 'org-1')).resolves.toBe('Europe/Paris');
  });

  it('retombe sur le défaut (Europe/Paris) sans ligne en base', async () => {
    const ex = faux({ 'from organization_settings': [] }).ex;
    await expect(fuseauDeLOrganisation(ex, 'org-1')).resolves.toBe('Europe/Paris');
  });

  it('ignore une valeur vide ou du mauvais type, retombe sur le défaut', async () => {
    const ex = faux({ 'from organization_settings': [{ value: '' }] }).ex;
    await expect(fuseauDeLOrganisation(ex, 'org-1')).resolves.toBe('Europe/Paris');
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
      'jr:plafond_du_jour_credentials': [{ config: { daily_cap: '45' } }],
    });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(45);
  });

  it('sans organization_settings ni credentials, retombe sur le défaut (30, aucun ENRICH_DAILY_CAP dans l’environnement de test)', async () => {
    const ctx = faux({ 'from organization_settings': [], 'jr:plafond_du_jour_credentials': [] });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(30);
  });

  it('ignore un config.daily_cap non numérique dans credentials (repli sur le défaut)', async () => {
    const ctx = faux({
      'from organization_settings': [],
      'jr:plafond_du_jour_credentials': [{ config: { daily_cap: 'abc' } }],
    });
    await expect(plafondEnrichissementDuJour(ctx)).resolves.toBe(30);
  });

  it('ne consulte PAS credentials quand la ligne organization_settings existe déjà (pas de dépense inutile)', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: 'enrichissements_par_jour', value: 12 }] });
    await plafondEnrichissementDuJour(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /jr:plafond_du_jour_credentials/i.test(String(a[0])))).toBe(false);
  });

  it('ne lit `organization_settings` qu’une seule fois, même quand le repli credentials se déclenche', async () => {
    const ctx = faux({ 'from organization_settings': [], 'jr:plafond_du_jour_credentials': [{ config: { daily_cap: 45 } }] });
    await plafondEnrichissementDuJour(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelsReglages = appels.filter((a) => /from organization_settings/i.test(String(a[0])));
    expect(appelsReglages).toHaveLength(1);
  });

  it('lireConsommationDuJour applique EXACTEMENT le même plafond (les deux boutons « Chercher l’email » partagent la même source)', async () => {
    const ctx = faux({
      'from organization_settings': [],
      'jr:plafond_du_jour_credentials': [{ config: { daily_cap: 45 } }],
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

describe('plafondDuJour (R83, relecture tâche 21 : une seule source de vérité pour le moteur et l’écran)', () => {
  it('applique la ligne organization_settings de la clé demandée', async () => {
    const ex = faux({ 'from organization_settings': [{ value: 120 }] }).ex;
    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(120);
  });

  it('scoring_par_jour retombe sur credentials.config.daily_cap du fournisseur anthropic (repli historique, généralisé de R78)', async () => {
    const ex = faux({
      'from organization_settings': [],
      'jr:plafond_du_jour_credentials': [{ config: { daily_cap: 250 } }],
    }).ex;
    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(250);
  });

  it('sans organization_settings ni credentials, retombe sur le défaut (300 pour scoring_par_jour, aucun SCORE_DAILY_CAP dans l’environnement de test)', async () => {
    const ex = faux({ 'from organization_settings': [], 'jr:plafond_du_jour_credentials': [] }).ex;
    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(300);
  });

  it('utilisable avec un simple Executeur, sans construire de Contexte — exactement ce qu’expose un Pool pg côté worker', async () => {
    // Aucun `Contexte` ici (pas de rôle, pas d'utilisateur) : `plafondDuJour` ne prend que
    // `ex`/`organisationId`/`cle`, la même signature que `apps/worker/src/producer.ts` et
    // `traitements.ts` lui passent avec leur `Pool` pg brut.
    const ex: Executeur = {
      query: vi.fn(async () => ({ rows: [{ value: 77 }], rowCount: 1 })) as unknown as Executeur['query'],
    };
    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(77);
  });

  it('la valeur écrite par ecrireReglage est celle que plafondDuJour applique ensuite (aucun cache) — même chemin que le worker', async () => {
    // Petit magasin en mémoire qui imite `organization_settings` : `ecrireReglage` y écrit,
    // `plafondDuJour` y relit — la même table, dans le même ordre, que ce qu'observe le moteur
    // en production (aucune connexion ni cache intermédiaire entre les deux).
    const lignes = new Map<string, unknown>();
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (/insert into organization_settings/i.test(sql)) {
        const [, cle, valeurJson] = params as [string, string, string];
        lignes.set(cle, JSON.parse(valeurJson));
        return { rows: [], rowCount: 1 };
      }
      if (/select value from organization_settings/i.test(sql)) {
        const [, cle] = params as [string, string];
        return lignes.has(cle) ? { rows: [{ value: lignes.get(cle) }], rowCount: 1 } : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ex: Executeur = { query };
    const ctx: Contexte = { ex, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(300); // rien en base : défaut
    await ecrireReglage(ctx, { cle: 'scoring_par_jour', valeur: 120 });
    await expect(plafondDuJour(ex, 'org-1', 'scoring_par_jour')).resolves.toBe(120); // relu juste après l'écriture, sans détour
  });
});

describe('lireReglagesDetail (tâche 21, écran Réglages › Plafonds)', () => {
  // I7 (Important, revue finale du 14/09) : cette lecture expose le nom de
  // l'auteur de chaque réglage et n'avait aucun contrôle de rôle.
  it('refuse un rôle insuffisant (aucun rôle)', async () => {
    const ctx: Contexte = { ...faux({}), role: null };
    await expect(lireReglagesDetail(ctx)).rejects.toThrow(ForbiddenError);
  });

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

  it('revue F5 (relecture) : refuse un fuseau qui n’est pas un identifiant IANA réel', () => {
    const r = schemaEcrireReglage.safeParse({ cle: 'fuseau', valeur: 'Paris' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('Paris');
  });

  it('revue F5 (relecture) : accepte un autre identifiant IANA valide que le défaut', () => {
    expect(schemaEcrireReglage.safeParse({ cle: 'fuseau', valeur: 'Pacific/Kiritimati' }).success).toBe(true);
  });
});

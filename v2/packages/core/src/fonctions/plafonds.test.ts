import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import { ErreurEntree } from './contexte.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { HARD_CAP_7_DAYS } from '../linkedin/pacing.js';
import { SEUIL_MINUTES_PAR_ACTION } from './aujourdhui.js';
import {
  CLES_REGLAGES,
  ageMaxEnrichissementJours,
  resoudreAgeMaxEnrichissement,
  RYTHMES,
  ecrireReglage,
  ecrireRythme,
  ErreurRythme,
  lireRythme,
  fuseauDeLOrganisation,
  jourCourantDansFuseau,
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  compterVisitesProfilLinkedIn,
  lireConsommationDuJour,
  lireFuseauLinkedIn,
  lirePlafondLinkedIn,
  tracerRequeteLinkedIn,
  tracerRequeteMessagerie,
  tracerResolutionProfil,
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

describe('plafonds LinkedIn', () => {
  it('lirePlafondLinkedIn prefere la valeur en base a la variable d environnement', async () => {
    vi.stubEnv('LINKEDIN_POSTS_DAILY_CAP', '9');
    try {
      const ctx = faux({ 'from organization_settings': [{ value: 5 }] });
      expect(await lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour')).toBe(5);
      const sans = faux({ 'from organization_settings': [] });
      expect(await lirePlafondLinkedIn(sans, 'linkedin_posts_par_jour')).toBe(9);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('lirePlafondLinkedIn : defauts 3 par jour et 60 par heure', async () => {
    const ctx = faux({});
    expect(await lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour')).toBe(3);
    expect(await lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure')).toBe(60);
  });

  it('compterRequetesLinkedIn compte sur l horodatage de chaque requete, pas sur le demarrage du passage', async () => {
    const ctx = faux({ 'from linkedin_requetes': [{ n: 1 }] });
    const veille = new Date('2026-10-03T22:00:00Z');
    const minuit = new Date('2026-10-04T22:00:00Z');
    const lendemain = new Date('2026-10-05T22:00:00Z');
    await compterRequetesLinkedIn(ctx, veille, minuit);
    await compterRequetesLinkedIn(ctx, minuit, lendemain);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]][];
    for (const [sql] of appels) {
      expect(sql).toMatch(/requested_at/);
      expect(sql).not.toMatch(/source_runs|started_at/);
    }
    expect(appels[0]![1]).toEqual(['org-1', veille, minuit]);
    expect(appels[1]![1]).toEqual(['org-1', minuit, lendemain]);
  });

  it('compterPostsLinkedInDuJour compte les posts reellement ouverts, pas les lignes de passage', async () => {
    const ctx = faux({ 'from source_runs': [{ n: 2 }] });
    expect(await compterPostsLinkedInDuJour(ctx, '2026-10-05', 'Europe/Paris', 'run-courant')).toBe(2);
    const [sql, params] = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    // Tous les types LinkedIn, pas le seul collecteur d'origine : ce plafond protege le
    // COMPTE, et un type branche plus tard lui echapperait (voir le harnais, controle 18c).
    expect(sql).toMatch(/sourceType' like 'linkedin%'/);
    expect(sql).not.toMatch(/linkedin_post_engagers/);
    expect(sql).toContain('$2::date::timestamp at time zone $3');
    expect(sql).toContain('($2::date + 1)::timestamp at time zone $3');
    expect(params).toEqual(['org-1', '2026-10-05', 'Europe/Paris', 'run-courant']);
  });

  it('tracerRequeteLinkedIn refuse un passage d une autre organisation', async () => {
    const ctx = faux({});
    await expect(tracerRequeteLinkedIn(ctx, 'run-etranger')).rejects.toThrow(/introuvable/);
  });

  it('tracerRequeteMessagerie trace une requete de nature messagerie, sans origine, pour cette organisation', async () => {
    const ctx = faux({});
    await tracerRequeteMessagerie(ctx);
    const [sql, params] = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into linkedin_requetes/);
    expect(sql).not.toMatch(/source_run_id|action_queue_id|post_id/);
    expect(params).toEqual(['org-1', 'messagerie']);
  });

  it('tracerResolutionProfil trace une visite de profil de la releve : nature propre, sans origine, pour cette organisation', async () => {
    const ctx = faux({});
    await tracerResolutionProfil(ctx);
    const [sql, params] = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/insert into linkedin_requetes/);
    expect(sql).not.toMatch(/source_run_id|action_queue_id|post_id/);
    expect(params).toEqual(['org-1', 'resolution_profil']);
  });

  it('compterVisitesProfilLinkedIn compte les visites de la collecte ET les resolutions de la releve', async () => {
    const ctx = faux({ 'jr:linkedin_visites_profil_compter': [{ n: 7 }] });
    const depuis = new Date('2026-10-20T00:00:00Z');
    expect(await compterVisitesProfilLinkedIn(ctx, depuis)).toBe(7);
    const [sql, params] = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/kind in \('profil', 'resolution_profil'\)/);
    expect(params).toEqual(['org-1', depuis]);
  });
});

describe('fuseau du jour LinkedIn', () => {
  it('lireFuseauLinkedIn lit le fuseau de linkedin_settings, pour cette organisation', async () => {
    const ctx = faux({ 'from linkedin_settings': [{ timezone: 'Europe/Brussels' }] });
    expect(await lireFuseauLinkedIn(ctx)).toBe('Europe/Brussels');
    const [sql, params] = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/where organization_id = \$1/);
    expect(params).toEqual(['org-1']);
  });

  it('lireFuseauLinkedIn sans ligne : le defaut de la table (Europe/Paris)', async () => {
    expect(await lireFuseauLinkedIn(faux({}))).toBe('Europe/Paris');
  });
});

describe('schemaEcrireReglage — la fenetre de validation des posts doit depasser le delai d anciennete', () => {
  /**
   * Point de vigilance 4 du lot « accroche du post ». Les personnes qui ont reagi a un post sont
   * collectees le jour ou il est decouvert, et la purge d anciennete les efface au bout de
   * `SIGNAL_MAX_AGE_DAYS` (14 par defaut). Une fenetre egale ou plus courte laisserait l ecran
   * annoncer une echeance pendant que la purge a deja tout emporte : la branche d epargne
   * n epargnerait jamais rien, avec l air de fonctionner.
   */
  const CLE = 'linkedin_fenetre_validation_post_jours';
  const ANCIENNETE = 14;

  afterEach(() => {
    delete process.env.SIGNAL_MAX_AGE_DAYS;
  });

  it('refuse une valeur egale au delai d anciennete', () => {
    const r = schemaEcrireReglage.safeParse({ cle: CLE, valeur: ANCIENNETE });
    expect(r.success).toBe(false);
  });

  it('refuse une valeur sous le delai, et le message dit pourquoi', () => {
    const r = schemaEcrireReglage.safeParse({ cle: CLE, valeur: 3 });
    expect(r.success).toBe(false);
    const message = r.success ? '' : (r.error.issues[0]?.message ?? '');
    expect(message).toContain(String(ANCIENNETE));
    expect(message).toMatch(/anciennet/i);
    expect(message).toMatch(/effac/i);
  });

  it('accepte le premier jour au-dessus du delai, et le defaut de 28', () => {
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: ANCIENNETE + 1 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 28 }).success).toBe(true);
  });

  it('suit SIGNAL_MAX_AGE_DAYS quand la variable est posee : le seuil n est pas la constante 14', () => {
    process.env.SIGNAL_MAX_AGE_DAYS = '45';
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 28 }).success).toBe(false);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 46 }).success).toBe(true);
  });

  it('une valeur illisible de SIGNAL_MAX_AGE_DAYS retombe sur 14, elle ne desactive pas la garde', () => {
    process.env.SIGNAL_MAX_AGE_DAYS = 'beaucoup';
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: ANCIENNETE }).success).toBe(false);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: ANCIENNETE + 1 }).success).toBe(true);
  });

  it('le defaut declare depasse bien le delai d anciennete par defaut', () => {
    const defaut = CLES_REGLAGES.find((r) => r.cle === CLE);
    expect(defaut?.defaut).toBe(28);
    expect(Number(defaut?.defaut)).toBeGreaterThan(ANCIENNETE);
    expect(defaut?.env).toBe('LINKEDIN_POST_REVIEW_WINDOW_DAYS');
  });
});

describe('linkedin_releve_intervalle_min — intervalle de relève', () => {
  const CLE = 'linkedin_releve_intervalle_min';

  it('écrit et relit l’intervalle de relève, refuse 4 et 1441', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: CLE, value: 15 }] });
    await ecrireReglage(ctx, { cle: CLE, valeur: 15 });
    expect(ctx.ex.query).toHaveBeenCalledWith(expect.stringMatching(/insert into organization_settings/i), expect.any(Array));
    expect((await lireReglages(ctx))[CLE]).toBe(15);

    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 4 }).success).toBe(false);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 1441 }).success).toBe(false);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 5 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 1440 }).success).toBe(true);
  });

  it('le défaut est de 30 minutes', async () => {
    expect((await lireReglages(faux({ 'from organization_settings': [] })))[CLE]).toBe(30);
  });
});

describe('linkedin_attente_acceptation_jours — attente de l’acceptation d’une invitation', () => {
  const CLE = 'linkedin_attente_acceptation_jours';

  it('le défaut est de 7 jours et aucune variable d’environnement ne le porte', async () => {
    expect((await lireReglages(faux({ 'from organization_settings': [] })))[CLE]).toBe(7);
    expect(CLES_REGLAGES.find((r) => r.cle === CLE)?.env).toBeUndefined();
  });

  it('écrit et relit la valeur réglée à l’écran', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: CLE, value: 10 }] });
    await ecrireReglage(ctx, { cle: CLE, valeur: 10 });
    expect(ctx.ex.query).toHaveBeenCalledWith(expect.stringMatching(/insert into organization_settings/i), expect.any(Array));
    expect((await lireReglages(ctx))[CLE]).toBe(10);
  });

  it('accepte 0 (ne pas attendre) et 90, refuse 91 et une chaîne', () => {
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 0 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 90 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 91 }).success).toBe(false);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: '7' }).success).toBe(false);
  });
});

describe('enrichissement_age_max_jours : âge du signal pour acheter une adresse', () => {
  const CLE = 'enrichissement_age_max_jours';
  const env = process.env.SIGNAL_MAX_AGE_DAYS;
  afterEach(() => {
    if (env === undefined) delete process.env.SIGNAL_MAX_AGE_DAYS;
    else process.env.SIGNAL_MAX_AGE_DAYS = env;
  });

  it('le défaut est 14, et SIGNAL_MAX_AGE_DAYS n’est que le repli de la ligne absente', async () => {
    delete process.env.SIGNAL_MAX_AGE_DAYS;
    expect(CLES_REGLAGES.find((r) => r.cle === CLE)).toEqual({ cle: CLE, defaut: 14, env: 'SIGNAL_MAX_AGE_DAYS' });
    expect((await lireReglages(faux({ 'from organization_settings': [] })))[CLE]).toBe(14);
    process.env.SIGNAL_MAX_AGE_DAYS = '21';
    expect((await lireReglages(faux({ 'from organization_settings': [] })))[CLE]).toBe(21);
    // La ligne de l'organisation l'emporte sur l'environnement.
    expect((await lireReglages(faux({ 'from organization_settings': [{ key: CLE, value: 5 }] })))[CLE]).toBe(5);
  });

  it('borne de 1 jour à la rétention réelle des signaux (SIGNAL_MAX_AGE_DAYS, 14 par défaut)', () => {
    delete process.env.SIGNAL_MAX_AGE_DAYS;
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 1 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 14 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 0 }).success).toBe(false);
    const trop = schemaEcrireReglage.safeParse({ cle: CLE, valeur: 15 });
    expect(trop.success).toBe(false);
    expect(trop.success ? '' : trop.error.issues[0]?.message).toMatch(/entre 1 et 14 jours/);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: '7' }).success).toBe(false);
  });

  it('la borne haute suit la rétention quand la variable est posée', () => {
    process.env.SIGNAL_MAX_AGE_DAYS = '30';
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 30 }).success).toBe(true);
    expect(schemaEcrireReglage.safeParse({ cle: CLE, valeur: 31 }).success).toBe(false);
  });

  it('resoudreAgeMaxEnrichissement : repli si absent, invalide ou sous 1 ; borné à la rétention', () => {
    expect(resoudreAgeMaxEnrichissement(undefined, 14)).toBe(14);
    expect(resoudreAgeMaxEnrichissement('abc', 14)).toBe(14);
    expect(resoudreAgeMaxEnrichissement(0, 14)).toBe(14);
    expect(resoudreAgeMaxEnrichissement(-3, 14)).toBe(14);
    expect(resoudreAgeMaxEnrichissement(3, 14)).toBe(3);
    expect(resoudreAgeMaxEnrichissement('5', 14)).toBe(5);
    expect(resoudreAgeMaxEnrichissement(60, 14)).toBe(14);
  });

  it('ageMaxEnrichissementJours lit la ligne de l’organisation, filtrée par organisation', async () => {
    const ctx = faux({ 'jr:age_max_enrichissement': [{ value: 4 }] });
    expect(await ageMaxEnrichissementJours(ctx.ex, 'org-1', 14)).toBe(4);
    expect(ctx.ex.query).toHaveBeenCalledWith(expect.stringMatching(/organization_id = \$1/), ['org-1']);
    expect(await ageMaxEnrichissementJours(faux({}).ex, 'org-1', 14)).toBe(14);
  });
});

describe('schemaEcrireReglage — les plafonds d envoi LinkedIn sont bornes', () => {
  /**
   * Le moteur rabote ces deux plafonds a HARD_CAP_7_DAYS. Sans borne a l'ecriture,
   * l'ecran acceptait 400, affichait 400, et 200 partaient : le reglage visible
   * mentait sur ce qui part. La colonne `linkedin_settings.weekly_cap` portait cette
   * garde par un `check`, perdue en demenageant dans `organization_settings`.
   */
  it.each(['linkedin_invitations_par_semaine', 'linkedin_messages_par_semaine'] as const)(
    '%s refuse une valeur au-dessus de la borne appliquee par le moteur',
    (cle) => {
      const r = schemaEcrireReglage.safeParse({ cle, valeur: HARD_CAP_7_DAYS + 1 });
      expect(r.success).toBe(false);
    },
  );

  it.each(['linkedin_invitations_par_semaine', 'linkedin_messages_par_semaine'] as const)(
    '%s accepte exactement la borne',
    (cle) => {
      expect(schemaEcrireReglage.safeParse({ cle, valeur: HARD_CAP_7_DAYS }).success).toBe(true);
    },
  );

  it('les autres plafonds ne sont pas bornes par cette regle', () => {
    expect(schemaEcrireReglage.safeParse({ cle: 'scoring_par_jour', valeur: HARD_CAP_7_DAYS + 500 }).success).toBe(true);
  });
});


/**
 * Pool à état : `organization_settings` et `linkedin_settings` sont de vraies tables en mémoire, lues
 * et écrites par les requêtes du code. Rien n'est préparé à la main pour la branche visée : l'état
 * lu par `lireRythme` est celui que `ecrireRythme` a réellement posé. `echecSurInsert` fait échouer
 * la N-ième écriture (1-based), pour le cas de l'écriture partielle.
 */
function poolRythme(opts: { role?: Contexte['role']; echecSurInsert?: number; echecLectureHeures?: boolean; reglages?: Record<string, unknown>; heures?: { from: number; to: number; days: number[] } } = {}) {
  const reglages = new Map<string, unknown>(Object.entries(opts.reglages ?? {}));
  let heures = opts.heures ? { ...opts.heures, tz: 'Europe/Lisbonne' } : undefined;
  const sqls: { sql: string; params: unknown[] }[] = [];
  let inserts = 0;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    sqls.push({ sql, params });
    if (/insert into/i.test(sql)) {
      inserts += 1;
      if (opts.echecSurInsert === inserts) throw new Error('écriture refusée');
    }
    if (opts.echecLectureHeures && /from linkedin_settings/i.test(sql)) throw new Error('connexion refusée par la base');
    if (/from organization_settings/i.test(sql)) {
      const rows = [...reglages].map(([key, value]) => ({ key, value }));
      return { rows, rowCount: rows.length };
    }
    if (/insert into organization_settings/i.test(sql)) {
      reglages.set(params[1] as string, JSON.parse(params[2] as string));
      return { rows: [], rowCount: 1 };
    }
    if (/from linkedin_settings/i.test(sql)) {
      return heures
        ? { rows: [{ send_from_hour: heures.from, send_to_hour: heures.to, send_days: heures.days, timezone: heures.tz }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/insert into linkedin_settings/i.test(sql)) {
      heures = { from: params[1] as number, to: params[2] as number, days: params[3] as number[], tz: params[4] as string };
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: opts.role ?? 'admin' };
  return { ctx, sqls, reglages, heures: () => heures };
}

describe('le rythme en trois crans', () => {
  const CRANS = Object.keys(RYTHMES) as (keyof typeof RYTHMES)[];

  it('expose exactement prudent, normal, soutenu avec les valeurs de la spec', () => {
    expect(RYTHMES).toEqual({
      prudent: { invitations: 50, messages: 100, debutHeure: 9, finHeure: 18, jours: [1, 2, 3, 4, 5] },
      normal: { invitations: 100, messages: 200, debutHeure: 9, finHeure: 18, jours: [1, 2, 3, 4, 5] },
      soutenu: { invitations: 150, messages: 200, debutHeure: 8, finHeure: 19, jours: [1, 2, 3, 4, 5] },
    });
  });

  it.each(CRANS)('le cran %s ne dépasse pas HARD_CAP_7_DAYS', (cran) => {
    expect(RYTHMES[cran].invitations).toBeLessThanOrEqual(HARD_CAP_7_DAYS);
    expect(RYTHMES[cran].messages).toBeLessThanOrEqual(HARD_CAP_7_DAYS);
  });

  it.each(CRANS)('le cran %s laisse au moins le seuil de minutes par action (formule de l’alerte fenêtre trop étroite)', (cran) => {
    const r = RYTHMES[cran];
    const plafondQuotidien = (hebdo: number): number => Math.max(1, Math.ceil(Math.min(hebdo, HARD_CAP_7_DAYS) / Math.max(1, r.jours.length)));
    const actionsParJour = plafondQuotidien(r.invitations) + plafondQuotidien(r.messages);
    const minutesParAction = ((r.finHeure - r.debutHeure) * 60) / actionsParJour;
    expect(minutesParAction).toBeGreaterThanOrEqual(SEUIL_MINUTES_PAR_ACTION);
  });

  it.each(CRANS)('écrire le cran %s pose les quatre valeurs, fuseau existant conservé', async (cran) => {
    const p = poolRythme({ heures: { from: 10, to: 12, days: [6, 7] } });
    await ecrireRythme(p.ctx, cran);
    expect(p.reglages.get('linkedin_invitations_par_semaine')).toBe(RYTHMES[cran].invitations);
    expect(p.reglages.get('linkedin_messages_par_semaine')).toBe(RYTHMES[cran].messages);
    expect(p.heures()).toEqual({ from: RYTHMES[cran].debutHeure, to: RYTHMES[cran].finHeure, days: RYTHMES[cran].jours, tz: 'Europe/Lisbonne' });
  });

  it('écrire « normal » inscrit explicitement les valeurs en base, même si elles égalent les défauts', async () => {
    const p = poolRythme();
    await ecrireRythme(p.ctx, 'normal');
    expect(p.reglages.get('linkedin_invitations_par_semaine')).toBe(100);
    expect(p.reglages.get('linkedin_messages_par_semaine')).toBe(200);
    expect(p.heures()).toMatchObject({ from: 9, to: 18, days: [1, 2, 3, 4, 5] });
  });

  it.each(CRANS)('lire rend %s quand les quatre valeurs correspondent', async (cran) => {
    const p = poolRythme();
    await ecrireRythme(p.ctx, cran);
    expect(await lireRythme(p.ctx)).toBe(cran);
  });

  it('une organisation qui n’a rien réglé applique les valeurs du cran normal et lit « normal »', async () => {
    expect(await lireRythme(poolRythme().ctx)).toBe('normal');
  });

  it.each([
    ['les invitations', async (p: ReturnType<typeof poolRythme>) => ecrireReglage(p.ctx, { cle: 'linkedin_invitations_par_semaine', valeur: 101 })],
    ['les messages', async (p: ReturnType<typeof poolRythme>) => ecrireReglage(p.ctx, { cle: 'linkedin_messages_par_semaine', valeur: 199 })],
  ])('lire rend « personnalisé » dès que %s ont été changés à la main', async (_nom, changer) => {
    const p = poolRythme();
    await ecrireRythme(p.ctx, 'prudent');
    await changer(p);
    expect(await lireRythme(p.ctx)).toBe('personnalise');
  });

  it.each([
    ['le début', { from: 10, to: 18, days: [1, 2, 3, 4, 5] }],
    ['la fin', { from: 9, to: 17, days: [1, 2, 3, 4, 5] }],
    ['les jours', { from: 9, to: 18, days: [1, 2, 3, 4] }],
  ])('lire rend « personnalisé » quand %s de la fenêtre diffère', async (_nom, heures) => {
    const p = poolRythme({ heures, reglages: { linkedin_invitations_par_semaine: 100, linkedin_messages_par_semaine: 200 } });
    expect(await lireRythme(p.ctx)).toBe('personnalise');
  });

  it('les jours sont comparés sans tenir compte de l’ordre', async () => {
    const p = poolRythme({ heures: { from: 9, to: 18, days: [5, 3, 1, 2, 4] } });
    expect(await lireRythme(p.ctx)).toBe('normal');
  });

  it('refuse un rôle sous admin sans aucune requête, lecture comprise', async () => {
    const p = poolRythme({ role: 'operator' });
    await expect(ecrireRythme(p.ctx, 'soutenu')).rejects.toBeInstanceOf(ForbiddenError);
    expect(p.sqls).toHaveLength(0);
  });

  it.each(['turbo', 'personnalise'])('refuse le cran « %s » en erreur d’entrée, sans aucune requête', async (cran) => {
    const p = poolRythme();
    await expect(ecrireRythme(p.ctx, cran as never)).rejects.toBeInstanceOf(ErreurEntree);
    expect(p.sqls).toHaveLength(0);
  });

  it('chaque requête filtre ou écrit par organization_id, dans le texte du SQL', async () => {
    const p = poolRythme();
    await ecrireRythme(p.ctx, 'soutenu');
    await lireRythme(p.ctx);
    const lectures = p.sqls.filter((s) => /^\s*select/i.test(s.sql));
    expect(lectures.length).toBeGreaterThan(0);
    for (const l of lectures) expect(l.sql).toMatch(/where\s+organization_id\s*=\s*\$1/i);
    const ecritures = p.sqls.filter((s) => /insert into/i.test(s.sql));
    expect(ecritures).toHaveLength(3);
    for (const e of ecritures) expect(e.sql).toMatch(/\(\s*organization_id\b/i);
    for (const s of p.sqls) expect(s.params[0]).toBe('org-1');
  });

  describe('écriture partielle', () => {
    it('si la fenêtre échoue après les deux plafonds : message « en partie », sans texte de base, cause conservée', async () => {
      const p = poolRythme({ echecSurInsert: 3 });
      const err = await ecrireRythme(p.ctx, 'prudent').then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ErreurRythme);
      const e = err as ErreurRythme;
      expect(e.ecrites).toBe(2);
      expect(e.message).toMatch(/qu'en partie/);
      expect(e.message).toMatch(/Réessayez/);
      expect(e.message).not.toMatch(/écriture refusée/);
      expect((e.cause as Error).message).toBe('écriture refusée');
      // Rien n'est annulé : les deux plafonds de prudent sont posés, la fenêtre n'a pas été écrite.
      expect(p.reglages.get('linkedin_invitations_par_semaine')).toBe(50);
      expect(p.reglages.get('linkedin_messages_par_semaine')).toBe(100);
      expect(p.heures()).toBeUndefined();
    });

    it('si la lecture du fuseau échoue : « rien n’a changé », sans texte de base, et aucune écriture', async () => {
      const p = poolRythme({ echecLectureHeures: true });
      const err = await ecrireRythme(p.ctx, 'prudent').then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ErreurRythme);
      const e = err as ErreurRythme;
      expect(e.ecrites).toBe(0);
      expect(e.message).toMatch(/rien n'a changé/);
      expect(e.message).not.toMatch(/connexion/);
      expect(p.sqls.filter((s) => /insert into/i.test(s.sql))).toHaveLength(0);
    });

    it('si la première écriture échoue : message « rien n’a changé », distinct du partiel', async () => {
      const p = poolRythme({ echecSurInsert: 1 });
      const err = await ecrireRythme(p.ctx, 'prudent').then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(ErreurRythme);
      const e = err as ErreurRythme;
      expect(e.ecrites).toBe(0);
      expect(e.message).toMatch(/rien n'a changé/);
      expect(e.message).not.toMatch(/partie/);
      expect(p.reglages.size).toBe(0);
    });

    it('un cran dont la fenêtre diffère, interrompu avant elle, se lit « personnalisé »', async () => {
      const p = poolRythme({ echecSurInsert: 3, heures: { from: 9, to: 18, days: [1, 2, 3, 4, 5] } });
      await expect(ecrireRythme(p.ctx, 'soutenu')).rejects.toBeInstanceOf(ErreurRythme);
      expect(await lireRythme(p.ctx)).toBe('personnalise');
    });

    it('un cran interrompu dont la fenêtre déjà posée est la sienne se lit comme ce cran (valeurs appliquées)', async () => {
      const p = poolRythme({ echecSurInsert: 3 });
      await expect(ecrireRythme(p.ctx, 'prudent')).rejects.toBeInstanceOf(ErreurRythme);
      expect(await lireRythme(p.ctx)).toBe('prudent');
    });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import {
  rejouerActionsEmailEnAttente,
  rejouerActionsLinkedInEnAttente,
  mettreEnPauseActionsLinkedInOrphelines,
  REJEU_ACTIONS_EMAIL_MS,
  traiterDiscover,
  traiterJob,
  traiterTick,
  consommerLesFiles,
  ecouterLesFiles,
  FILES_BRANCHEES,
  FILES_AVEC_NAVIGATEUR,
  libelleSourceRun,
  libelleScoringBatch,
  libelleEnrichmentBatch,
  journaliserScoringBatch,
  journaliserEnrichmentBatch,
  type Contexte,
} from './traitements.js';
import { deterministicUuid, currentBucket } from './ids.js';
import type { DiscoverJob } from './handlers/discover.js';
import type { ScoreSummary } from './handlers/score.js';
import { adzunaScraper } from '@jay-reach/providers/signals';
import type { ScrapedSignal } from '@jay-reach/providers/signals';

// Le connecteur Adzuna ferait un vrai appel HTTP : mocké pour ne tester ici
// que le journal d'activité (tâche 6), pas le scraping lui-même.
vi.mock('@jay-reach/providers/signals', () => ({
  adzunaScraper: {
    fetch: vi.fn(async () => {
      throw new Error(
        'Adzuna indisponible : https://api.adzuna.com/v1/api/jobs/fr/search/1?app_id=id-test&app_key=secret123',
      );
    }),
  },
  franceTravailScraper: { fetch: vi.fn() },
  apifyScraper: { fetch: vi.fn() },
}));

const ACTION_ID = 'action-en-attente-1';
const ORG_ID = 'org-1';

function ligneActionEnAttente(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action_id: ACTION_ID,
    organization_id: ORG_ID,
    enrollment_id: 'enrollment-1',
    step_id: 'etape-1',
    sender_id: 'sender-1',
    contact_id: 'contact-1',
    campaign_id: 'campagne-1',
    template_parent_id: 'gabarit-famille-1',
    locale: null,
    ...overrides,
  };
}

/** Pool factice : renvoie toujours les mêmes lignes, quelle que soit la requête. */
function creerPoolFactice(rows: unknown[]): Pool {
  return { query: vi.fn(async () => ({ rows, rowCount: rows.length })) } as unknown as Pool;
}

function creerContexteFactice(rows: unknown[]): { ctx: Contexte; insert: ReturnType<typeof vi.fn> } {
  const insert = vi.fn(async () => undefined);
  const boss = { insert } as unknown as PgBoss;
  const pool = creerPoolFactice(rows);
  return { ctx: { pool, boss }, insert };
}

describe('rejouerActionsEmailEnAttente', () => {
  it('une action en attente produit exactement un job actions.dispatch', async () => {
    const { ctx, insert } = creerContexteFactice([ligneActionEnAttente()]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    const lot = insert.mock.calls[0]![0] as { name: string; id: string; data: unknown }[];
    expect(lot).toHaveLength(1);
    const bucket = currentBucket(REJEU_ACTIONS_EMAIL_MS);
    expect(lot[0]!.name).toBe('actions.dispatch');
    expect(lot[0]!.id).toBe(deterministicUuid('dispatch-rejeu', ACTION_ID, bucket));
    expect(lot[0]!.data).toEqual({
      organizationId: ORG_ID,
      channel: 'email',
      actionId: ACTION_ID,
      email: {
        enrollmentId: 'enrollment-1',
        contactId: 'contact-1',
        stepId: 'etape-1',
        campaignId: 'campagne-1',
        templateParentId: 'gabarit-famille-1',
        senderId: 'sender-1',
        locale: null,
      },
    });
  });

  it('aucune action retournée par la requête (trop récente) ne produit aucun job', async () => {
    const { ctx, insert } = creerContexteFactice([]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('la requête filtre sur l’inscription active/completed et l’absence de suppression email (C1)', async () => {
    // Le pool factice de ce fichier renvoie toujours les mêmes lignes, quelle
    // que soit la requête : il ne peut donc pas rejouer le filtrage réel de
    // Postgres. On vérifie ici que le garde-fou est bien dans la requête —
    // et le test juste au-dessus (« aucune action retournée… ») couvre déjà
    // le cas où ce filtre exclut la ligne : la fonction ne produit alors
    // aucun job, exactement le scénario d'une inscription `replied`.
    const { ctx } = creerContexteFactice([ligneActionEnAttente()]);

    await rejouerActionsEmailEnAttente(ctx);

    const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain(`e.status in ('active', 'completed')`);
    expect(sql).toMatch(/not exists[\s\S]*from suppressions/i);
    expect(sql).toMatch(/scope = 'email'/);
    expect(sql).toMatch(/sup\.value = c\.email/);
  });

  it('le balayage réenfile une action d’une inscription completed (hotfix dernier email, 11/09)', async () => {
    // Même limite du pool factice que le test C1 ci-dessus : il ne filtre pas
    // réellement par statut, donc ce test documente et vérifie que la requête
    // autorise `completed` dans son filtre — sans quoi le dernier email d'une
    // séquence, dont l'inscription passe à `completed` avant l'envoi (voir
    // `sequence.ts`), ne serait jamais repris par ce balayage.
    const { ctx, insert } = creerContexteFactice([ligneActionEnAttente()]);

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
    const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain(`e.status in ('active', 'completed')`);
  });

  it('deux passages dans le même seau produisent le même id de job', async () => {
    const { ctx: ctx1, insert: insert1 } = creerContexteFactice([ligneActionEnAttente()]);
    const { ctx: ctx2, insert: insert2 } = creerContexteFactice([ligneActionEnAttente()]);

    await rejouerActionsEmailEnAttente(ctx1);
    await rejouerActionsEmailEnAttente(ctx2);

    const id1 = (insert1.mock.calls[0]![0] as { id: string }[])[0]!.id;
    const id2 = (insert2.mock.calls[0]![0] as { id: string }[])[0]!.id;
    expect(id1).toBe(id2);
  });

  /**
   * Pool factice AVEC ÉTAT, dédié au défaut F14 : contrairement à
   * `creerPoolFactice` de ce fichier (qui renvoie toujours les mêmes lignes
   * quelle que soit la requête), celui-ci décide RÉELLEMENT selon le SQL
   * produit — la ligne n'est renvoyée que si la requête ne filtre PAS sur
   * `camp.status = 'active'` (correctif annulé : comportement d'avant, la
   * ligne repart inconditionnellement) OU que la campagne modélisée est bien
   * `active`. Sans le correctif, les tests « brouillon »/« en pause »
   * ci-dessous verraient l'action réenfilée quand même et rougiraient.
   */
  function creerContexteCampagneStatut(statutCampagne: string): { ctx: Contexte; insert: ReturnType<typeof vi.fn> } {
    const insert = vi.fn(async () => undefined);
    const boss = { insert } as unknown as PgBoss;
    const query = vi.fn(async (sql: string) => {
      const filtreCampagneActive = /camp\.status\s*=\s*'active'/i.test(sql);
      const renvoyer = !filtreCampagneActive || statutCampagne === 'active';
      return { rows: renvoyer ? [ligneActionEnAttente()] : [], rowCount: renvoyer ? 1 : 0 };
    });
    const pool = { query } as unknown as Pool;
    return { ctx: { pool, boss }, insert };
  }

  it('campagne en brouillon ou en pause (F14) : l’action reste en attente, aucun job réenfilé', async () => {
    const { ctx: ctxBrouillon, insert: insertBrouillon } = creerContexteCampagneStatut('draft');
    const { ctx: ctxPause, insert: insertPause } = creerContexteCampagneStatut('paused');

    const rejoueesBrouillon = await rejouerActionsEmailEnAttente(ctxBrouillon);
    const rejoueesPause = await rejouerActionsEmailEnAttente(ctxPause);

    expect(rejoueesBrouillon).toBe(0);
    expect(insertBrouillon).not.toHaveBeenCalled();
    expect(rejoueesPause).toBe(0);
    expect(insertPause).not.toHaveBeenCalled();
  });

  it('campagne active (F14, non-régression) : l’action réenfilée normalement', async () => {
    const { ctx, insert } = creerContexteCampagneStatut('active');

    const rejouees = await rejouerActionsEmailEnAttente(ctx);

    expect(rejouees).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

describe('rejouerActionsLinkedInEnAttente', () => {
  const ligneLinkedIn = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    action_id: ACTION_ID,
    organization_id: ORG_ID,
    enrollment_id: 'enrollment-1',
    template_parent_id: null,
    channel: 'linkedin_message',
    contact_id: 'contact-1',
    signal_id: 'signal-1',
    linkedin_url: 'https://www.linkedin.com/in/jeanne',
    ...overrides,
  });

  it('une action jamais enfilée produit un job de la forme du tick, au seau de rejeu', async () => {
    const { ctx, insert } = creerContexteFactice([ligneLinkedIn()]);

    const rejouees = await rejouerActionsLinkedInEnAttente(ctx);

    expect(rejouees).toBe(1);
    const lot = insert.mock.calls[0]![0] as { name: string; id: string; data: unknown }[];
    expect(lot).toHaveLength(1);
    expect(lot[0]!.name).toBe('actions.dispatch');
    expect(lot[0]!.id).toBe(deterministicUuid('dispatch-rejeu', ACTION_ID, currentBucket(REJEU_ACTIONS_EMAIL_MS)));
    expect(lot[0]!.data).toEqual({
      organizationId: ORG_ID,
      channel: 'linkedin_message',
      actionId: ACTION_ID,
      linkedin: {
        linkedinUrl: 'https://www.linkedin.com/in/jeanne',
        actionId: ACTION_ID,
        contactId: 'contact-1',
        signalId: 'signal-1',
        messageBody: null,
      },
    });
  });

  it('aucune ligne éligible : aucun job', async () => {
    const { ctx, insert } = creerContexteFactice([]);
    expect(await rejouerActionsLinkedInEnAttente(ctx)).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('la requête porte tous les garde-fous (le pool factice ne filtre pas, on lit le SQL)', async () => {
    const { ctx } = creerContexteFactice([]);
    await rejouerActionsLinkedInEnAttente(ctx);
    const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string;
    expect(sql).toContain(`a.channel in ('linkedin_invite', 'linkedin_message')`);
    expect(sql).toContain(`a.status = 'scheduled'`);
    expect(sql).toContain('a.dispatched_at is null');
    expect(sql).toContain(`a.created_at < now() - interval '2 minutes'`);
    expect(sql).toContain('org.sending_paused_at is null');
    expect(sql).toContain(`e.status in ('active', 'completed')`);
    expect(sql).toContain(`camp.status = 'active'`);
    expect(sql).toMatch(/not exists[\s\S]*from linkedin_action_queue/i);
    expect(sql).toMatch(/scope = 'linkedin'/);
    // Normalisée des DEUX côtés depuis la migration 20261008170000 : une opposition posée
    // sous une autre graphie (barre finale, www., paramètres de suivi) bloque la même
    // personne. Le harnais pg-verify le prouve sur du SQL réel (contrôles 65 à 71).
    expect(sql).toMatch(/app\.url_linkedin_normalisee\(sup\.value\) = app\.url_linkedin_normalisee\(c\.linkedin_url\)/);
    expect(sql).toContain('limit 200');
  });
});

describe('libelleSourceRun (journal, tâche 6)', () => {
  it('nomme le connecteur et compte les offres lues/retenues', () => {
    expect(libelleSourceRun('adzuna', 58, 6)).toEqual({
      libelle: 'Passage Adzuna : 58 offre(s) lue(s), 6 retenue(s)',
      detail: '52 offre(s) déjà connue(s) ignorée(s).',
    });
  });

  it('ne pose pas de detail quand rien n’a été ignoré', () => {
    expect(libelleSourceRun('francetravail', 10, 10)).toEqual({
      libelle: 'Passage France Travail : 10 offre(s) lue(s), 10 retenue(s)',
    });
  });

  it('retombe sur l’id brut pour un connecteur non répertorié', () => {
    expect(libelleSourceRun('inconnu', 1, 1).libelle).toContain('Passage inconnu :');
  });

  it('distingue les offres écartées pour âge des doublons déjà connus (I3)', () => {
    expect(libelleSourceRun('adzuna', 10, 6, 3)).toEqual({
      libelle: 'Passage Adzuna : 10 offre(s) lue(s), 6 retenue(s)',
      detail: '1 offre(s) déjà connue(s) ignorée(s). 3 offre(s) trop ancienne(s) écartée(s).',
    });
  });

  it('tout écarté pour âge, aucun doublon : pas de mention de « déjà connue »', () => {
    expect(libelleSourceRun('adzuna', 5, 2, 3)).toEqual({
      libelle: 'Passage Adzuna : 5 offre(s) lue(s), 2 retenue(s)',
      detail: '3 offre(s) trop ancienne(s) écartée(s).',
    });
  });
});

describe('libelleScoringBatch (journal, tâche 6)', () => {
  it('compte les signaux notés et retenus, sans detail sans auto-apprentissage', () => {
    expect(libelleScoringBatch({ scored: 12, qualified: 3, learned: 0 })).toEqual({
      libelle: 'Scoring : 12 signal(aux) noté(s), 3 retenu(s) au-dessus du seuil',
    });
  });

  it('ajoute un detail quand la blacklist de cabinets a appris', () => {
    expect(libelleScoringBatch({ scored: 12, qualified: 3, learned: 2 })).toEqual({
      libelle: 'Scoring : 12 signal(aux) noté(s), 3 retenu(s) au-dessus du seuil',
      detail: '2 entreprise(s) appris(e)(s) comme cabinet(s) de recrutement.',
    });
  });
});

describe('libelleEnrichmentBatch (journal, tâche 6 ; libellé ajusté au tour de correction 1, R24)', () => {
  it('nomme l’entreprise et compte emails trouvés sur contacts réellement traités', () => {
    // R24 : le 2e argument est le nombre de contacts réellement passés dans le
    // lot (`contacts.length`), jamais `maxContacts` — ce qui a été demandé au
    // FullEnrich n'est pas ce qui a été mesuré.
    expect(libelleEnrichmentBatch('Acme', 10, 3)).toEqual({
      libelle: 'Enrichissement Acme : 3 email(s) trouvé(s) sur 10 contact(s) traité(s)',
      detail: '1 crédit FullEnrich consommé.',
    });
  });
});

describe('traiterDiscover — journal d’activité (tâche 6)', () => {
  const JOB: DiscoverJob = {
    organizationId: 'org-1',
    sourceId: 'source-1',
    provider: 'adzuna',
    keywords: ['développeur'],
  };

  interface Reponse {
    readonly rows: unknown[];
    readonly rowCount: number;
  }
  interface Gestionnaire {
    readonly motif: RegExp;
    readonly repondre: () => Reponse;
  }

  function ligne(rows: unknown[] = []): Reponse {
    return { rows, rowCount: rows.length };
  }

  function creerPoolGestionnaires(gestionnaires: Gestionnaire[]): { pool: Pool; appels: { sql: string; values: unknown[] }[] } {
    const appels: { sql: string; values: unknown[] }[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push({ sql, values });
      const trouve = gestionnaires.find((g) => g.motif.test(sql));
      if (!trouve) {
        throw new Error(`requete non prevue par le test :\n${sql}`);
      }
      return trouve.repondre();
    });
    return { pool: { query } as unknown as Pool, appels };
  }

  it("une collecte en échec écrit engine_error, nettoyé, puis relance l'erreur", async () => {
    process.env.ADZUNA_APP_ID = 'id-test';
    process.env.ADZUNA_APP_KEY = 'cle-test';
    const { pool, appels } = creerPoolGestionnaires([
      { motif: /select config from credentials/i, repondre: () => ligne([]) },
      { motif: /insert into source_runs/i, repondre: () => ligne([{ id: 'run-1' }]) },
      { motif: /update source_runs/i, repondre: () => ligne([]) },
      { motif: /insert into audit_events/i, repondre: () => ligne([]) },
    ]);
    const boss = { insert: vi.fn(async () => undefined) } as unknown as PgBoss;

    await expect(traiterDiscover({ pool, boss }, JOB)).rejects.toThrow();

    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    const journal = appels.find((a) => /insert into audit_events/i.test(a.sql));
    expect(journal).toBeDefined();
    expect(journal!.values[0]).toBe('org-1');
    expect(journal!.values[2]).toBe('engine');
    expect(journal!.values[3]).toBeNull();
    expect(journal!.values[4]).toBe('engine_error');
    const diff = JSON.parse(journal!.values[5] as string) as { libelle: string };
    // Ni la clé (`api_key=secret123`) ni l'adresse ne doivent fuiter dans le journal.
    expect(diff.libelle).not.toContain('secret123');
    expect(diff.libelle).toContain('Adzuna indisponible');
  });

  function signalOffre(company: string, title: string, location: string, postedDate?: string): ScrapedSignal {
    return {
      signal_type: 'job_posting',
      source: 'adzuna',
      source_url: `https://api.adzuna.com/v1/job/${company}-${title}`,
      raw_content: '{}',
      extracted_data: {
        company_name: company,
        job_title: title,
        location,
        ...(postedDate !== undefined ? { posted_date: postedDate } : {}),
      },
    };
  }

  it('une collecte réussie écrit source_run avec les bons compteurs (tour de correction 1, point 5)', async () => {
    process.env.ADZUNA_APP_ID = 'id-test';
    process.env.ADZUNA_APP_KEY = 'cle-test';
    vi.mocked(adzunaScraper.fetch).mockResolvedValueOnce({
      signals: [
        signalOffre('Acme', 'Développeur', 'Paris'),
        signalOffre('Beta', 'Commercial', 'Lyon'),
        signalOffre('Gamma', 'Designer', 'Nantes'),
      ],
      errors: [],
      duration_ms: 120,
    });
    const { pool, appels } = creerPoolGestionnaires([
      { motif: /select config from credentials/i, repondre: () => ligne([]) },
      { motif: /insert into source_runs/i, repondre: () => ligne([{ id: 'run-2' }]) },
      // I3 : défaut d'organisation lu par `plafondDuJour` — aucune des offres
      // du test n'a de `posted_date`, donc jamais écartée quelle que soit
      // cette valeur (14 par défaut, faute de ligne).
      { motif: /from organization_settings where organization_id = \$1 and key = \$2/i, repondre: () => ligne([]) },
      // Simule Postgres qui écarte une des trois offres comme déjà connue
      // (fingerprint récent) : 3 lues, 2 retenues — le mock ne rejoue pas le
      // vrai filtre SQL, seul le nombre de lignes rendues compte ici.
      {
        motif: /insert into signals/i,
        repondre: () => ligne([{ id: 'signal-1', company_hint: null }, { id: 'signal-2', company_hint: null }]),
      },
      { motif: /update source_runs/i, repondre: () => ligne([]) },
      { motif: /insert into audit_events/i, repondre: () => ligne([]) },
    ]);
    const boss = { insert: vi.fn(async () => undefined) } as unknown as PgBoss;

    await traiterDiscover({ pool, boss }, JOB);

    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    const journal = appels.find((a) => /insert into audit_events/i.test(a.sql));
    expect(journal).toBeDefined();
    expect(journal!.values[0]).toBe('org-1');
    expect(journal!.values[2]).toBe('source');
    expect(journal!.values[3]).toBe('source-1');
    expect(journal!.values[4]).toBe('source_run');
    const diff = JSON.parse(journal!.values[5] as string) as { libelle: string; detail?: string };
    expect(diff.libelle).toBe('Passage Adzuna : 3 offre(s) lue(s), 2 retenue(s)');
    expect(diff.detail).toBe('1 offre(s) déjà connue(s) ignorée(s).');
  });

  it('écarte une offre trop ancienne AVANT insertion, et le journal la compte séparément (I3)', async () => {
    process.env.ADZUNA_APP_ID = 'id-test';
    process.env.ADZUNA_APP_KEY = 'cle-test';
    vi.mocked(adzunaScraper.fetch).mockResolvedValueOnce({
      signals: [
        signalOffre('Acme', 'Développeur', 'Paris', '2000-01-01T00:00:00.000Z'), // très ancienne
        signalOffre('Beta', 'Commercial', 'Lyon'), // sans date : jamais écartée
      ],
      errors: [],
      duration_ms: 90,
    });
    const { pool, appels } = creerPoolGestionnaires([
      { motif: /select config from credentials/i, repondre: () => ligne([]) },
      { motif: /insert into source_runs/i, repondre: () => ligne([{ id: 'run-3' }]) },
      // Défaut d'organisation réglé à 14 jours (au lieu du repli sans ligne) :
      // l'offre de l'an 2000 est écartée quelle que soit la date d'exécution du test.
      {
        motif: /from organization_settings where organization_id = \$1 and key = \$2/i,
        repondre: () => ligne([{ value: 14 }]),
      },
      { motif: /insert into signals/i, repondre: () => ligne([{ id: 'signal-1', company_hint: null }]) },
      { motif: /update source_runs/i, repondre: () => ligne([]) },
      { motif: /insert into audit_events/i, repondre: () => ligne([]) },
    ]);
    const boss = { insert: vi.fn(async () => undefined) } as unknown as PgBoss;

    await traiterDiscover({ pool, boss }, JOB);

    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    // Un seul tuple envoyé à l'insertion (3 paramètres fixes + 7) : l'offre
    // ancienne n'a jamais atteint la requête SQL.
    const insert = appels.find((a) => /insert into signals/i.test(a.sql));
    expect(insert).toBeDefined();
    expect(insert!.values).toHaveLength(3 + 7);

    const journal = appels.find((a) => /insert into audit_events/i.test(a.sql));
    const diff = JSON.parse(journal!.values[5] as string) as { libelle: string; detail?: string };
    expect(diff.libelle).toBe('Passage Adzuna : 2 offre(s) lue(s), 1 retenue(s)');
    expect(diff.detail).toBe('1 offre(s) trop ancienne(s) écartée(s).');
  });
});

/** Fixture minimale d'un `ScoreSummary` complet, seuls `scored`/`qualified`/`learned` variant selon le test. */
function scoreSummary(overrides: Partial<ScoreSummary> = {}): ScoreSummary {
  return {
    considered: 0,
    prefiltered: 0,
    scored: 0,
    qualified: 0,
    discarded: 0,
    learned: 0,
    skippedNoPrompt: false,
    ...overrides,
  };
}

describe('journaliserScoringBatch (journal, tâche 6, tour de correction 1 — point 5)', () => {
  it("écrit scoring_batch avec entityType 'engine' et entityId null", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
    const pool = { query } as unknown as Pool;

    await journaliserScoringBatch(pool, 'org-1', scoreSummary({ scored: 12, qualified: 3 }));

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, valeurs] = query.mock.calls[0]!;
    expect(sql).toMatch(/insert into audit_events/i);
    const v = valeurs as unknown[];
    expect(v[0]).toBe('org-1');
    expect(v[2]).toBe('engine');
    expect(v[3]).toBeNull();
    expect(v[4]).toBe('scoring_batch');
    const diff = JSON.parse(v[5] as string) as { libelle: string };
    expect(diff.libelle).toBe('Scoring : 12 signal(aux) noté(s), 3 retenu(s) au-dessus du seuil');
  });

  it("n'échoue jamais si l'écriture échoue", async () => {
    const query = vi.fn(async () => {
      throw new Error('panne base');
    });
    const pool = { query } as unknown as Pool;

    await expect(
      journaliserScoringBatch(pool, 'org-1', scoreSummary({ scored: 1 })),
    ).resolves.toBeUndefined();
  });
});

describe('journaliserEnrichmentBatch (journal, tâche 6, tour de correction 1 — points 4 et 5)', () => {
  it("écrit enrichment_batch avec entityType 'engine', entityId null, et le libellé ajusté (R24)", async () => {
    const query = vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as unknown[], rowCount: 0 }));
    const pool = { query } as unknown as Pool;

    await journaliserEnrichmentBatch(pool, 'org-1', 'Acme', 10, 3);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, valeurs] = query.mock.calls[0]!;
    expect(sql).toMatch(/insert into audit_events/i);
    const v = valeurs as unknown[];
    expect(v[0]).toBe('org-1');
    expect(v[2]).toBe('engine');
    expect(v[3]).toBeNull();
    expect(v[4]).toBe('enrichment_batch');
    const diff = JSON.parse(v[5] as string) as { libelle: string; detail: string };
    expect(diff.libelle).toBe('Enrichissement Acme : 3 email(s) trouvé(s) sur 10 contact(s) traité(s)');
    expect(diff.detail).toBe('1 crédit FullEnrich consommé.');
  });

  it("n'échoue jamais si l'écriture échoue", async () => {
    const query = vi.fn(async () => {
      throw new Error('panne base');
    });
    const pool = { query } as unknown as Pool;

    await expect(journaliserEnrichmentBatch(pool, 'org-1', 'Acme', 10, 3)).resolves.toBeUndefined();
  });
});

describe('file linkedin.envoi (tache 6)', () => {
  it('est branchee', () => {
    expect(FILES_BRANCHEES).toContain('linkedin.envoi');
  });

  it('sans JAY_REACH_LINKEDIN, rien n est touche : ni base, ni navigateur', async () => {
    // `FILES_BRANCHEES` est aussi parcouru par `consommerLesFiles`, que la route cron de
    // Vercel appelle : un environnement sans navigateur, ou la garde doit etre la
    // premiere instruction du handler, avant meme la reparation des lignes coincees.
    vi.stubEnv('JAY_REACH_LINKEDIN', '');
    try {
      const { ctx } = creerContexteFactice([]);
      await traiterJob(ctx, 'linkedin.envoi', { organizationId: ORG_ID });
      expect(ctx.pool.query).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('avec JAY_REACH_LINKEDIN, le job atteint le handler d envoi', async () => {
    vi.stubEnv('JAY_REACH_LINKEDIN', '1');
    try {
      const { ctx } = creerContexteFactice([]);
      await traiterJob(ctx, 'linkedin.envoi', { organizationId: ORG_ID });
      const sql = (ctx.pool.query as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).join('\n');
      expect(sql).toContain('linkedin_action_queue');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('consommerLesFiles (route cron de Vercel, sans navigateur)', () => {
  it('ne prend jamais un job des files qui exigent un navigateur', async () => {
    // Le handler sortirait sans rien faire, mais `fetch` puis `complete` marquerait le job termine :
    // en `retryLimit: 0`, l'occasion d'envoi serait detruite en silence.
    const fetch = vi.fn(async () => []);
    const ctx = { pool: creerPoolFactice([]), boss: { fetch, complete: vi.fn(), fail: vi.fn() } as unknown as PgBoss } as Contexte;
    await consommerLesFiles(ctx);
    const files = (fetch.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(files).not.toContain('linkedin.envoi');
    expect(files).not.toContain('linkedin.collecte');
    expect(files).toContain('sources.discover');
    expect(files.length).toBe(FILES_BRANCHEES.length - FILES_AVEC_NAVIGATEUR.length);
  });

  it('les files a navigateur sont bien branchees pour le worker', () => {
    for (const f of FILES_AVEC_NAVIGATEUR) expect(FILES_BRANCHEES).toContain(f);
  });
});

describe('ecouterLesFiles : une file fautive ne tait que son canal', () => {
  it('ne consomme pas les files ignorees et consomme toutes les autres', async () => {
    const work = vi.fn(async () => 'w');
    const ctx = { pool: creerPoolFactice([]), boss: { work } as unknown as PgBoss } as Contexte;
    await ecouterLesFiles(ctx, { ignorer: ['linkedin.envoi'] });
    const files = (work.mock.calls as unknown as [string][]).map((c) => c[0]);
    expect(files).not.toContain('linkedin.envoi');
    expect(files).toContain('actions.dispatch');
    expect(files).toContain('linkedin.collecte');
  });

  it('sans file ignoree, tout est consomme, linkedin.envoi comprise', async () => {
    const work = vi.fn(async () => 'w');
    const ctx = { pool: creerPoolFactice([]), boss: { work } as unknown as PgBoss } as Contexte;
    await ecouterLesFiles(ctx);
    expect((work.mock.calls as unknown as [string][]).map((c) => c[0])).toContain('linkedin.envoi');
  });
});

describe('mettreEnPauseActionsLinkedInOrphelines', () => {
  /** Pool factice : la première requête (le balayage) rend `orphelines`, les suivantes ne trouvent rien à arrêter. */
  function poolEnregistreur(orphelines: unknown[]): { pool: Pool; sqls: string[] } {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      sqls.push(sql);
      const rows = sqls.length === 1 ? orphelines : [];
      return { rows, rowCount: rows.length };
    });
    return { pool: { query } as unknown as Pool, sqls };
  }

  it('ne cherche que les actions LinkedIn encore scheduled dont la ligne de file est terminale, sans rien réenfiler', async () => {
    const { pool, sqls } = poolEnregistreur([]);
    await mettreEnPauseActionsLinkedInOrphelines({ pool });
    const balayage = sqls[0] ?? '';
    expect(balayage).toMatch(/q\.status = 'failed'/);
    expect(balayage).toMatch(/a\.status in \('scheduled', 'approved'\)/);
    // Invariant « jamais deux envois » : ce balayage ne fait que lire, il ne rejoue rien.
    expect(balayage).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(sqls).toHaveLength(1);
  });

  it('applique le geste de pause à chaque ligne trouvée, mais n\'écrit jamais dans la file', async () => {
    const { pool, sqls } = poolEnregistreur([
      { queue_id: 'q-1', organization_id: ORG_ID, error_code: 'resultat_indetermine', error_message: 'indéterminé' },
    ]);
    const arretees = await mettreEnPauseActionsLinkedInOrphelines({ pool });
    expect(arretees).toBe(0); // le double ne rend aucune action à arrêter : la lecture du geste est vide
    expect(sqls).toHaveLength(2);
    expect(sqls.some((q) => /linkedin_action_queue\s+set|insert into linkedin_action_queue/i.test(q))).toBe(false);
  });
});

describe('traiterTick — rattrapage LinkedIn', () => {
  it('chaque tick passe le balayage des envois LinkedIn terminaux', async () => {
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      sqls.push(sql);
      return { rows: [], rowCount: 0 };
    });
    const boss = { insert: vi.fn(async () => undefined) } as unknown as PgBoss;
    await traiterTick({ pool: { query } as unknown as Pool, boss });
    expect(sqls.some((q) => q.includes('jr:linkedin_orphelines'))).toBe(true);
  });
});

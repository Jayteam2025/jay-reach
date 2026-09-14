import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import {
  rejouerActionsEmailEnAttente,
  REJEU_ACTIONS_EMAIL_MS,
  traiterDiscover,
  libelleSourceRun,
  libelleScoringBatch,
  libelleEnrichmentBatch,
  type Contexte,
} from './traitements.js';
import { deterministicUuid, currentBucket } from './ids.js';
import type { DiscoverJob } from './handlers/discover.js';

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

describe('libelleEnrichmentBatch (journal, tâche 6)', () => {
  it('nomme l’entreprise et compte contacts trouvés sur demandés', () => {
    expect(libelleEnrichmentBatch('Acme', 10, 3)).toEqual({
      libelle: 'Enrichissement Acme : 3 contact(s) trouvé(s) sur 10 demandé(s)',
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
});

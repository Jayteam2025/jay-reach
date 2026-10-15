import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import { enqueueDiscoverForActiveSources, enqueueRequestedRuns, enqueueEnrollments, LIMITE_JOURNAL_RETENUES } from './producer.js';

/**
 * R72 : une source n'est due que si elle est active, son rattachement à un
 * fournisseur (`source_providers`) est actif, ET au moins une campagne qui la
 * rattache (`campaign_sources`) est `active`. Plutôt que de renvoyer des
 * lignes câblées à la main (ce que ferait un simple motif/réponse), cette
 * fabrique REJOUE la jointure et le filtre `exists (...)` de la vraie requête
 * à partir d'une petite base factice — pour vérifier la RÈGLE elle-même
 * (« liée seulement à draft/paused → pas due »), pas seulement que la
 * fonction boucle sur ce qu'on lui donne.
 */
interface SourceFactice {
  id: string;
  organizationId: string;
  isActive: boolean;
  config: unknown;
  providers: { id: string; providerId: string; isActive: boolean }[];
  /** Statuts des campagnes qui rattachent cette source via `campaign_sources`. */
  statutsCampagnes: string[];
}

function creerPoolFactice(sources: SourceFactice[]): { pool: Pool; appels: string[] } {
  const appels: string[] = [];
  const query = vi.fn(async (sql: string) => {
    appels.push(sql);
    if (/from sources s\s+join source_providers sp/i.test(sql)) {
      // Rejoue : is_active des deux côtés + exists une campagne active.
      const rows: Array<{ id: string; organization_id: string; provider_id: string; source_provider_id: string; config: unknown }> = [];
      for (const s of sources) {
        if (!s.isActive) continue;
        const due = s.statutsCampagnes.includes('active');
        if (!due) continue;
        for (const p of s.providers) {
          if (!p.isActive) continue;
          rows.push({ id: s.id, organization_id: s.organizationId, provider_id: p.providerId, source_provider_id: p.id, config: s.config });
        }
      }
      return { rows, rowCount: rows.length };
    }
    throw new Error(`requête non prévue par le test :\n${sql}`);
  });
  return { pool: { query } as unknown as Pool, appels };
}

/** `enqueueDiscoverForActiveSources` enfile par `insert` (id déterministe), `enqueueRequestedRuns` par `send` (brief producer.ts : deux jobs demandés de suite ne doivent pas être dédupliqués). */
function fauxBoss(): { boss: PgBoss; insert: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> } {
  const insert = vi.fn(async () => undefined);
  const send = vi.fn(async () => undefined);
  return { boss: { insert, send } as unknown as PgBoss, insert, send };
}

const CONFIG_OK = { keywords: ['directeur commercial'] };

function source(overrides: Partial<SourceFactice>): SourceFactice {
  return {
    id: 'src-1',
    organizationId: 'org-1',
    isActive: true,
    config: CONFIG_OK,
    providers: [{ id: 'sp-1', providerId: 'adzuna', isActive: true }],
    statutsCampagnes: [],
    ...overrides,
  };
}

describe('enqueueDiscoverForActiveSources (R72)', () => {
  it('une source liée à une campagne active est due', async () => {
    const { pool } = creerPoolFactice([source({ statutsCampagnes: ['active'] })]);
    const { boss, insert } = fauxBoss();
    const n = await enqueueDiscoverForActiveSources(boss, pool);
    expect(n).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('une source liée seulement à des campagnes draft/paused n’est pas due', async () => {
    const { pool } = creerPoolFactice([source({ statutsCampagnes: ['draft', 'paused'] })]);
    const { boss, insert } = fauxBoss();
    const n = await enqueueDiscoverForActiveSources(boss, pool);
    expect(n).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('une source sans aucune campagne rattachée (orpheline) n’est pas due', async () => {
    const { pool } = creerPoolFactice([source({ statutsCampagnes: [] })]);
    const { boss, insert } = fauxBoss();
    const n = await enqueueDiscoverForActiveSources(boss, pool);
    expect(n).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it('une source liée à une campagne active ET une en brouillon reste due', async () => {
    const { pool } = creerPoolFactice([source({ statutsCampagnes: ['draft', 'active'] })]);
    const { boss, insert } = fauxBoss();
    const n = await enqueueDiscoverForActiveSources(boss, pool);
    expect(n).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it('la requête filtre bien sur `campaign_sources`/`campaigns.status` (garde contre une régression qui retirerait le filtre)', async () => {
    const { pool, appels } = creerPoolFactice([source({ statutsCampagnes: ['active'] })]);
    const { boss } = fauxBoss();
    await enqueueDiscoverForActiveSources(boss, pool);
    expect(appels).toHaveLength(1);
    expect(appels[0]).toMatch(/campaign_sources/i);
    expect(appels[0]).toMatch(/c\.status\s*=\s*'active'/i);
  });
});

describe('enqueueRequestedRuns (R72)', () => {
  /**
   * Fabrique dédiée : la première requête (UPDATE ... RETURNING) rejoue le
   * sous-select `has_active_campaign` à partir de `demandes`, la seconde
   * (`source_providers`) rend les rattachements de la source demandée.
   */
  function creerPoolDemandes(
    demandes: Array<{
      id: string;
      organizationId: string;
      config: unknown;
      aCampagneActive: boolean;
      providers?: { id: string; providerId: string }[];
    }>,
  ): { pool: Pool; appels: string[] } {
    const appels: string[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push(sql);
      if (/^update sources s/i.test(sql.trim())) {
        const rows = demandes.map((d) => ({
          id: d.id,
          organization_id: d.organizationId,
          config: d.config,
          has_active_campaign: d.aCampagneActive,
        }));
        return { rows, rowCount: rows.length };
      }
      if (/from source_providers where source_id/i.test(sql)) {
        const sourceId = values[0];
        const d = demandes.find((x) => x.id === sourceId);
        const rows = (d?.providers ?? []).map((p) => ({ id: p.id, provider_id: p.providerId }));
        return { rows, rowCount: rows.length };
      }
      throw new Error(`requête non prévue par le test :\n${sql}`);
    });
    return { pool: { query } as unknown as Pool, appels };
  }

  it('une demande sur une source sans campagne active est ignorée et journalisée sans nom ni config', async () => {
    const avertissements: unknown[][] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      avertissements.push(args);
    });
    const { pool } = creerPoolDemandes([
      { id: 'src-orpheline', organizationId: 'org-1', config: { keywords: ['secret client'] }, aCampagneActive: false },
    ]);
    const { boss, send } = fauxBoss();

    const n = await enqueueRequestedRuns(boss, pool);

    expect(n).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(avertissements).toHaveLength(1);
    const [message] = avertissements[0]!;
    expect(String(message)).toMatch(/aucune campagne active/i);
    expect(String(message)).not.toContain('secret client');
    expect(String(message)).not.toContain('src-orpheline');
    spy.mockRestore();
  });

  it('une demande sur une source avec campagne active est enfilée normalement', async () => {
    const { pool } = creerPoolDemandes([
      {
        id: 'src-ok',
        organizationId: 'org-1',
        config: { keywords: ['directeur commercial'] },
        aCampagneActive: true,
        providers: [{ id: 'sp-1', providerId: 'adzuna' }],
      },
    ]);
    const { boss, send } = fauxBoss();

    const n = await enqueueRequestedRuns(boss, pool);

    expect(n).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('enqueueEnrollments (revue F5, point 1, tour de correction 2)', () => {
  const ORG_ID = 'org-1';
  const CAMPAIGN_ID = 'campagne-1';
  const CONTACT_ID = 'contact-1';
  const SIGNAL_ID = 'signal-1';

  interface Appel {
    readonly sql: string;
    readonly values: unknown[];
  }

  /** Motifs des requêtes d'`enqueueEnrollments`. */
  // Testé AVANT `CANDIDATS` : le décompte des personnes retenues par la garde du post partage
  // la population de la requête de candidats (`sqlPairesEligibles`), donc il porte lui aussi
  // « from contacts ct ». Seul son marqueur les distingue.
  const RETENUES_POST = /jr:enroll_retenues_post/i;
  const CANDIDATS = /from contacts ct/i;
  const CAPS = /select id, daily_cap from campaigns where id = any/i;
  const FUSEAU_ORGANISATION = /from organization_settings where organization_id = \$1 and key = 'fuseau'/i;
  const ENTREES_DU_JOUR = /from enrollments\s+where campaign_id/i;

  function creerPoolFactice(
    dailyCap: number | null,
    entreesDuJour: number,
    retenues: unknown[] = [],
  ): { pool: Pool; appels: Appel[] } {
    const appels: Appel[] = [];
    const query = vi.fn(async (sql: string, values: unknown[] = []) => {
      appels.push({ sql, values });
      if (RETENUES_POST.test(sql)) return { rows: retenues, rowCount: retenues.length };
      if (CANDIDATS.test(sql)) {
        return {
          rows: [{ organization_id: ORG_ID, campaign_id: CAMPAIGN_ID, contact_id: CONTACT_ID, signal_id: SIGNAL_ID }],
          rowCount: 1,
        };
      }
      if (CAPS.test(sql)) return { rows: [{ id: CAMPAIGN_ID, daily_cap: dailyCap }], rowCount: 1 };
      if (FUSEAU_ORGANISATION.test(sql)) return { rows: [{ value: 'Pacific/Kiritimati' }], rowCount: 1 };
      if (ENTREES_DU_JOUR.test(sql)) return { rows: [{ n: String(entreesDuJour) }], rowCount: 1 };
      throw new Error(`requête non prévue par le test :\n${sql}`);
    });
    return { pool: { query } as unknown as Pool, appels };
  }

  /**
   * Sans cette trace, une campagne qui retient TOUTE sa population est indistinguable d'une
   * campagne sans candidat : `enqueueEnrollments` ne rend qu'un total enfilé, et le pré-filtre
   * écarte les paires avant que `enrollContact` n'ait l'occasion de journaliser. Le motif
   * compte autant que le nombre — c'est lui qui dit à l'opérateur quoi faire.
   */
  it('journalise, campagne par campagne, combien de personnes la garde du post retient et pourquoi', async () => {
    const { pool, appels } = creerPoolFactice(null, 0, [
      { campaign_id: CAMPAIGN_ID, paires: 12, attente: 7, sans_post: 3, inexploitable: 2 },
    ]);
    const { boss } = fauxBoss();
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await enqueueEnrollments(boss, pool);

    const compte = appels.find((a) => RETENUES_POST.test(a.sql));
    expect(compte).toBeDefined();
    // La même population que la requête de candidats, garde INVERSÉE : sinon le décompte
    // annoncerait des personnes que la production n'aurait de toute façon pas prises.
    expect(compte!.sql).toContain('from contacts ct');
    expect(compte!.sql).toMatch(/and not \(not exists/);
    // BORNÉE comme l'enfilage l'est : une trace ne doit pas pouvoir coûter plus que le travail
    // qu'elle commente. C'était la seule requête du lot sans `limit`.
    expect(compte!.sql).toMatch(/limit \$1/);
    expect(compte!.values).toEqual([LIMITE_JOURNAL_RETENUES]);
    expect(avertissements).toHaveBeenCalledWith(
      `[enroll] campagne ${CAMPAIGN_ID} : 12 personne(s) retenue(s) par la validation du post ` +
        '(7 en attente de validation, 3 sans post, 2 fiche inexploitable)',
    );
  });

  it('dit « au moins » quand la borne de lecture est atteinte : jamais un chiffre qu on ne mesure pas', async () => {
    const { pool } = creerPoolFactice(null, 0, [
      { campaign_id: CAMPAIGN_ID, paires: LIMITE_JOURNAL_RETENUES, attente: 900, sans_post: 50, inexploitable: 50 },
    ]);
    const { boss } = fauxBoss();
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await enqueueEnrollments(boss, pool);

    expect(avertissements).toHaveBeenCalledWith(expect.stringContaining('au moins 1000 personne(s) retenue(s)'));
  });

  it('ne journalise rien quand la garde ne retient personne', async () => {
    const { pool } = creerPoolFactice(null, 0, [
      { campaign_id: CAMPAIGN_ID, paires: 0, attente: 0, sans_post: 0, inexploitable: 0 },
    ]);
    const { boss } = fauxBoss();
    const avertissements = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await enqueueEnrollments(boss, pool);

    expect(avertissements).not.toHaveBeenCalledWith(expect.stringContaining('validation du post'));
  });

  it('le pré-filtre de plafond ET le comptage qui suit lisent le jour de l’organisation, jamais celui du serveur', async () => {
    const { pool, appels } = creerPoolFactice(5, 2);
    const { boss, insert } = fauxBoss();

    const n = await enqueueEnrollments(boss, pool);

    const candidats = appels.find((a) => CANDIDATS.test(a.sql));
    expect(candidats).toBeDefined();
    expect(candidats!.sql).toMatch(
      /date_trunc\('day', now\(\) at time zone coalesce\(\(select tz\.name from pg_timezone_names tz where tz\.name = ofz\.value/i,
    );
    expect(candidats!.sql).not.toContain("date_trunc('day', now())");

    const requeteFuseau = appels.find((a) => FUSEAU_ORGANISATION.test(a.sql));
    expect(requeteFuseau).toBeDefined();
    expect(requeteFuseau!.values).toEqual([ORG_ID]);

    const requeteCompte = appels.find((a) => ENTREES_DU_JOUR.test(a.sql));
    expect(requeteCompte).toBeDefined();
    expect(requeteCompte!.sql).toMatch(/started_at >= date_trunc\('day', now\(\) at time zone \$2\) at time zone \$2/i);
    expect(requeteCompte!.values).toEqual([CAMPAIGN_ID, 'Pacific/Kiritimati']);

    // Plafond 5, 2 déjà comptées : la place est encore disponible.
    expect(n).toBe(1);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});

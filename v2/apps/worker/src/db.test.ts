import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { ScrapedSignal } from '@jay-reach/providers/signals';
import { insertSignals, enqueueLinkedInAction } from './db.js';

const NOW = new Date('2026-09-17T00:00:00.000Z');
const JOURS = 24 * 60 * 60 * 1000;

function offre(id: string, postedDate: string | null): ScrapedSignal {
  return {
    signal_type: 'job_posting',
    source: 'adzuna',
    source_url: `https://exemple.fr/${id}`,
    raw_content: '{}',
    extracted_data: {
      company_name: 'Acme',
      job_title: 'Technicien',
      location: 'Lyon',
      posted_date: postedDate,
    },
  };
}

interface Appel {
  readonly sql: string;
  readonly values: unknown[];
}

/** Pool factice : accepte n'importe quel `insert into signals` et renvoie autant
 * de lignes que de tuples envoyés (une par offre non écartée avant l'insertion). */
function creerPoolFactice(): { pool: Pool; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    appels.push({ sql, values });
    if (/insert into signals/i.test(sql)) {
      const n = Math.round((values.length - 3) / 7);
      return {
        rows: Array.from({ length: n }, (_, i) => ({ id: `signal-${i}`, company_hint: null })),
        rowCount: n,
      };
    }
    throw new Error(`requete non prevue par le test :\n${sql}`);
  });
  return { pool: { query } as unknown as Pool, appels };
}

describe('insertSignals — âge maximal des offres (I3)', () => {
  it('écarte à l’insertion une offre plus vieille que ageMaxJours, et la compte séparément', async () => {
    const vieille = offre('vieille', new Date(NOW.getTime() - 20 * JOURS).toISOString());
    const recente = offre('recente', new Date(NOW.getTime() - 5 * JOURS).toISOString());
    const { pool, appels } = creerPoolFactice();

    const { inserted, ecartesAge } = await insertSignals(pool, 'org-1', 'source-1', 'adzuna', [vieille, recente], 14, NOW);

    expect(ecartesAge).toBe(1);
    expect(inserted).toHaveLength(1);
    const insert = appels.find((a) => /insert into signals/i.test(a.sql));
    expect(insert).toBeDefined();
    // 3 paramètres fixes + 7 par tuple envoyé : un seul tuple (l'offre récente).
    expect(insert!.values).toHaveLength(3 + 7);
  });

  it('une source réglée à 30 jours garde une offre de 20 jours', async () => {
    const offre20j = offre('vingt-jours', new Date(NOW.getTime() - 20 * JOURS).toISOString());
    const { pool } = creerPoolFactice();

    const { inserted, ecartesAge } = await insertSignals(pool, 'org-1', 'source-1', 'adzuna', [offre20j], 30, NOW);

    expect(ecartesAge).toBe(0);
    expect(inserted).toHaveLength(1);
  });

  it('offre sans date de publication : jamais écartée', async () => {
    const sansDate = offre('sans-date', null);
    const { pool } = creerPoolFactice();

    const { inserted, ecartesAge } = await insertSignals(pool, 'org-1', 'source-1', 'adzuna', [sansDate], 14, NOW);

    expect(ecartesAge).toBe(0);
    expect(inserted).toHaveLength(1);
  });

  it('toutes les offres trop vieilles : aucune requête d’insertion, tout compté en écarté', async () => {
    const vieille1 = offre('v1', new Date(NOW.getTime() - 40 * JOURS).toISOString());
    const vieille2 = offre('v2', new Date(NOW.getTime() - 50 * JOURS).toISOString());
    const { pool, appels } = creerPoolFactice();

    const { inserted, ecartesAge } = await insertSignals(pool, 'org-1', 'source-1', 'adzuna', [vieille1, vieille2], 14, NOW);

    expect(ecartesAge).toBe(2);
    expect(inserted).toHaveLength(0);
    expect(appels.some((a) => /insert into signals/i.test(a.sql))).toBe(false);
  });
});

describe('enqueueLinkedInAction — methode par defaut', () => {
  it('sans methode, la ligne est creee pour le serveur : la seule que la reclamation prenne', async () => {
    const query = vi.fn(async (_sql: string, _valeurs: unknown[]) => ({ rows: [{ id: 'q-1' }], rowCount: 1 }));
    await enqueueLinkedInAction({ query } as unknown as Pool, {
      organizationId: 'org-1',
      kind: 'invite',
      linkedinUrl: 'https://www.linkedin.com/in/x',
    });
    expect(query.mock.calls[0]?.[1][6]).toBe('serveur');
  });

  it('ne laisse plus ecrire une ligne que personne ne reclamerait', () => {
    const job: Parameters<typeof enqueueLinkedInAction>[1] = {
      organizationId: 'org-1',
      kind: 'invite',
      linkedinUrl: 'https://www.linkedin.com/in/x',
      // @ts-expect-error `extension_auto` n'est plus une methode d'ecriture
      method: 'extension_auto',
    };
    expect(job.method).toBe('extension_auto');
  });
});

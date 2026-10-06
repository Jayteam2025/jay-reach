import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { RETENTION_PERSONNES_NON_CONTACTEES_JOURS } from '@jay-reach/core';
import { ecarterEngageur } from './post-engagement.js';
import { purgerEngageursPerimes } from './retention-purge.js';

/**
 * Pool factice : il ne prouve que l'enchaînement des décisions (quelle durée est
 * passée à la base, ce que la fonction qui détruit exécute ou s'interdit). Le SQL
 * lui-même, avec de vraies dates, est exécuté sur Postgres par
 * test/pg-verify/linkedin-retention.sh.
 */
function poolFactice(opts: { candidats: Array<{ id: string; organization_id: string; juge: boolean }>; contactes?: Set<string> }) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const reponse = (sqlTexte: string, p: unknown[]) => {
    if (/from signals s\s+where s\.kind = 'post_engagement'/i.test(sqlTexte)) return { rows: opts.candidats, rowCount: opts.candidats.length };
    if (/as contacte/i.test(sqlTexte)) return { rows: [{ contacte: opts.contactes?.has(String(p[1])) ?? false }], rowCount: 1 };
    if (/delete from signals/i.test(sqlTexte)) return { rows: [{ source_run_id: 'run-1' }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  };
  const query = vi.fn(async (s: string, p: unknown[] = []) => {
    sql.push(s);
    params.push(p);
    return reponse(s, p);
  });
  const client = { query, release: vi.fn() };
  return { pool: { query, connect: vi.fn(async () => client) } as unknown as Pool, sql, params };
}

describe('retention.purge', () => {
  it('un post_engagement jamais contacte est efface au bout de 90 jours', async () => {
    const m = poolFactice({ candidats: [{ id: 'signal-1', organization_id: 'org-1', juge: false }] });
    const bilan = await purgerEngageursPerimes(m.pool);
    // La durée vient de la constante que la mention de Réglages › LinkedIn affiche.
    expect(RETENTION_PERSONNES_NON_CONTACTEES_JOURS).toBe(90);
    const selection = m.params[m.sql.findIndex((s) => /from signals s\s+where s\.kind = 'post_engagement'/i.test(s))];
    expect(selection?.[0]).toBe(RETENTION_PERSONNES_NON_CONTACTEES_JOURS);
    expect(m.sql.some((s) => /delete from signals/i.test(s))).toBe(true);
    expect(bilan).toEqual({ candidats: 1, effaces: 1, conserves: 0 });
  });

  it("un post_engagement contacte n'est jamais efface", async () => {
    // Même si l'appelant le désigne (sélection erronée), la fonction qui détruit refuse.
    const m = poolFactice({
      candidats: [{ id: 'signal-1', organization_id: 'org-1', juge: true }],
      contactes: new Set(['signal-1']),
    });
    const bilan = await purgerEngageursPerimes(m.pool);
    expect(m.sql.some((s) => /delete from (signals|contacts)/i.test(s))).toBe(false);
    expect(bilan).toEqual({ candidats: 1, effaces: 0, conserves: 1 });
  });

  it('ecarterEngageur conserve une personne contactee, sans rien effacer', async () => {
    const m = poolFactice({ candidats: [], contactes: new Set(['signal-9']) });
    const issue = await ecarterEngageur(m.pool, 'org-1', 'signal-9', { juge: false });
    expect(issue).toBe('conserve');
    expect(m.sql.some((s) => /delete from/i.test(s))).toBe(false);
  });
});

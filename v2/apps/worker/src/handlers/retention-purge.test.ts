import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import { INTERVALLE_PURGE_MAX_MS, RETENTION_PERSONNES_NON_CONTACTEES_JOURS } from '@jay-reach/core';
import { ecarterEngageur } from './post-engagement.js';
import { cadencePurge, purgerEngageursPerimes, traiterRetentionPurge } from './retention-purge.js';

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
    if (/for update/i.test(sqlTexte) && /from signals/i.test(sqlTexte)) return { rows: [{ external_id: 'post:urn' }], rowCount: 1 };
    if (/for update/i.test(sqlTexte)) return { rows: [], rowCount: 0 };
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
    expect(bilan).toEqual({ candidats: 1, effaces: 1, conserves: 0, absents: 0, memoiresEffacees: 0 });
  });

  it("un post_engagement contacte n'est jamais efface", async () => {
    // Même si l'appelant le désigne (sélection erronée), la fonction qui détruit refuse.
    const m = poolFactice({
      candidats: [{ id: 'signal-1', organization_id: 'org-1', juge: true }],
      contactes: new Set(['signal-1']),
    });
    const bilan = await purgerEngageursPerimes(m.pool);
    expect(m.sql.some((s) => /delete from (signals|contacts)/i.test(s))).toBe(false);
    expect(bilan).toEqual({ candidats: 1, effaces: 0, conserves: 1, absents: 0, memoiresEffacees: 0 });
  });

  it('la memoire d ecart a la meme borne que les personnes', async () => {
    const m = poolFactice({ candidats: [] });
    await purgerEngageursPerimes(m.pool);
    const i = m.sql.findIndex((x) => /delete from linkedin_engageurs_ecartes/i.test(x));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(m.params[i]?.[0]).toBe(RETENTION_PERSONNES_NON_CONTACTEES_JOURS);
  });

  it('ecarterEngageur conserve une personne contactee, sans rien effacer', async () => {
    const m = poolFactice({ candidats: [], contactes: new Set(['signal-9']) });
    const issue = await ecarterEngageur(m.pool, 'org-1', 'signal-9', { juge: false });
    expect(issue).toBe('conserve');
    expect(m.sql.some((s) => /delete from/i.test(s))).toBe(false);
  });
});

describe('statut de la purge pour l ecran', () => {
  const identite = { instanceId: 'worker', hostname: 'h', version: 'v', startedAt: new Date() };
  const statuts = (m: ReturnType<typeof poolFactice>) =>
    m.params.filter((_, i) => /last_purge_at/i.test(m.sql[i] ?? '')).map((p) => p[4]);

  it('un passage reussi ecrit last_purge_at sans erreur', async () => {
    const m = poolFactice({ candidats: [] });
    await traiterRetentionPurge(m.pool, identite);
    expect(statuts(m)).toEqual([null]);
  });

  it('un echec est enregistre (nom de l erreur seulement), puis relance', async () => {
    const m = poolFactice({ candidats: [] });
    const base = (m.pool as unknown as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query;
    (m.pool as unknown as { query: unknown }).query = vi.fn(async (s: string, p: unknown[] = []) => {
      if (/from signals s\s+where s\.kind/i.test(s)) throw new TypeError('connexion postgresql://u:secret@hote/db');
      return base(s, p);
    });
    await expect(traiterRetentionPurge(m.pool, identite)).rejects.toThrow(TypeError);
    expect(statuts(m)).toEqual(['TypeError']);
    expect(JSON.stringify(m.params)).not.toContain('secret');
  });

  it('une panne d ecriture du statut ne fait pas echouer la purge', async () => {
    const m = poolFactice({ candidats: [] });
    const base = (m.pool as unknown as { query: (s: string, p?: unknown[]) => Promise<unknown> }).query;
    (m.pool as unknown as { query: unknown }).query = vi.fn(async (s: string, p: unknown[] = []) => {
      if (/last_purge_at/i.test(s)) throw new Error('colonne absente');
      return base(s, p);
    });
    await expect(traiterRetentionPurge(m.pool, identite)).resolves.toBeDefined();
  });
});

describe('cadencePurge : la borne dont depend l alerte de l ecran Moteur', () => {
  it('absente ou illisible : le maximum', () => {
    expect(cadencePurge(undefined)).toBe(INTERVALLE_PURGE_MAX_MS);
    expect(cadencePurge('')).toBe(INTERVALLE_PURGE_MAX_MS);
    expect(cadencePurge('abc')).toBe(INTERVALLE_PURGE_MAX_MS);
  });
  it('sous le plafond : respectee', () => {
    expect(cadencePurge('600000')).toBe(600_000);
  });
  it('au-dessus du plafond : ramenee au plafond', () => {
    expect(cadencePurge(String(INTERVALLE_PURGE_MAX_MS * 5))).toBe(INTERVALLE_PURGE_MAX_MS);
  });
  it('sous une minute (ou negative) : le maximum, pas une rafale de jobs', () => {
    expect(cadencePurge('5')).toBe(INTERVALLE_PURGE_MAX_MS);
    expect(cadencePurge('-1')).toBe(INTERVALLE_PURGE_MAX_MS);
  });
});

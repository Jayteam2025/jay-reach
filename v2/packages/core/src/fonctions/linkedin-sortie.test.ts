import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { verifierSortie } from './linkedin-sortie.js';

interface Appel {
  sql: string;
  params: unknown[];
}

/** Contexte factice : consigne chaque requête. */
function faux(): { ctx: Contexte; appels: Appel[] } {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    return { rows: [{}], rowCount: 1 };
  }) as unknown as Executeur['query'];
  return { ctx: { ex: { query }, organisationId: 'org-1', utilisateurId: null, role: null }, appels };
}

const blocage = (appels: Appel[]) => appels.find((a) => /status\s*=\s*'bloquee'/i.test(a.sql));

afterEach(() => vi.restoreAllMocks());

describe('verifierSortie', () => {
  it("rend ok quand l'IP correspond", async () => {
    const { ctx, appels } = faux();
    const r = await verifierSortie(ctx, '203.0.113.7', async () => ({ ip: '203.0.113.7' }));
    expect(r.ok).toBe(true);
    expect(r.sortie.ip).toBe('203.0.113.7');
    expect(blocage(appels)).toBeUndefined();
  });

  it("bloque la session avec le motif sortie_inattendue quand l'IP diffère", async () => {
    const { ctx, appels } = faux();
    const r = await verifierSortie(ctx, '203.0.113.7', async () => ({ ip: '198.51.100.9' }));
    expect(r.ok).toBe(false);
    expect(r.sortie.ip).toBe('198.51.100.9');
    const b = blocage(appels);
    expect(b).toBeDefined();
    expect(b!.params).toContain('sortie_inattendue');
  });

  it("rend ok quand l'attendue est nulle (première connexion)", async () => {
    const { ctx, appels } = faux();
    const r = await verifierSortie(ctx, null, async () => ({ ip: '198.51.100.9' }));
    expect(r.ok).toBe(true);
    expect(blocage(appels)).toBeUndefined();
  });

  it("rend ok quand l'operateur et le pays manquent", async () => {
    const { ctx } = faux();
    const r = await verifierSortie(ctx, '203.0.113.7', async () => ({ ip: '203.0.113.7' }));
    expect(r.ok).toBe(true);
    expect(r.sortie.operateur).toBeUndefined();
    expect(r.sortie.pays).toBeUndefined();
  });

  it("ne laisse jamais fuiter l'URL du proxy", async () => {
    const { ctx, appels } = faux();
    const journaux = [vi.spyOn(console, 'log'), vi.spyOn(console, 'warn'), vi.spyOn(console, 'error')];
    const url = 'http://u:motdepasse@proxy.example:8000';
    const levee = await verifierSortie(ctx, '203.0.113.7', async () => {
      throw new Error(`connect ECONNREFUSED ${url}`);
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(levee).toBeInstanceOf(Error);
    const consigne = JSON.stringify([
      appels,
      journaux.map((j) => j.mock.calls),
      levee instanceof Error ? [levee.message, levee.stack, String(levee.cause)] : levee,
    ]);
    expect(consigne).not.toContain('motdepasse');
    expect(consigne).not.toContain('proxy.example');
  });

  it('ne bloque pas la session quand la relève échoue', async () => {
    const { ctx, appels } = faux();
    await expect(
      verifierSortie(ctx, '203.0.113.7', async () => {
        throw new Error('echo indisponible');
      }),
    ).rejects.toThrow('Relève de la sortie LinkedIn impossible');
    // La sortie n'est pas établie : aucun constat « sortie inattendue » à écrire.
    expect(blocage(appels)).toBeUndefined();
    expect(appels).toHaveLength(0);
  });
});

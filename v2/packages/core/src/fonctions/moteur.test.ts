import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ForbiddenError } from '../roles.js';
import type { Contexte } from './contexte.js';
import { INTERVALLE_TICK_MS, lireEtatMoteur } from './moteur.js';

/** Même fabrique de contexte factice que plafonds.test.ts : un motif (regex) par requête attendue. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'admin'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('lireEtatMoteur', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(lireEtatMoteur(faux({}, null))).rejects.toThrow(ForbiddenError);
  });


  it('est en marche quand le dernier tour date de moins de 15 minutes', async () => {
    const dernierTour = new Date(Date.now() - 2 * 60_000).toISOString();
    const ctx = faux({
      'jr:engine_status': [{ version: '8beb1fd', last_tick_at: dernierTour, last_error: null }],
      'jr:engine_errors': [{ n: 0 }],
    });
    const etat = await lireEtatMoteur(ctx);
    expect(etat.enMarche).toBe(true);
    expect(etat.dernierPassage).toBe(dernierTour);
    expect(etat.prochainPassage).toBe(new Date(new Date(dernierTour).getTime() + INTERVALLE_TICK_MS).toISOString());
    expect(etat.version).toBe('8beb1fd');
    expect(etat.derniereErreur).toBeNull();
    expect(etat.erreursDepuisMinuit).toBe(0);
  });

  it('est arrêté quand le dernier tour date de plus de 15 minutes', async () => {
    const dernierTour = new Date(Date.now() - 20 * 60_000).toISOString();
    const ctx = faux({
      'jr:engine_status': [{ version: 'abc', last_tick_at: dernierTour, last_error: 'SalesBlink a répondu 429' }],
      'jr:engine_errors': [{ n: 3 }],
    });
    const etat = await lireEtatMoteur(ctx);
    expect(etat.enMarche).toBe(false);
    expect(etat.derniereErreur).toBe('SalesBlink a répondu 429');
    expect(etat.erreursDepuisMinuit).toBe(3);
  });

  it("est arrêté et sans passage quand le moteur n'a jamais tourné", async () => {
    const ctx = faux({});
    const etat = await lireEtatMoteur(ctx);
    expect(etat.enMarche).toBe(false);
    expect(etat.dernierPassage).toBeNull();
    expect(etat.prochainPassage).toBeNull();
    expect(etat.version).toBeNull();
    expect(etat.derniereErreur).toBeNull();
  });

  it("le compteur d'erreurs filtre sur action = 'engine_error' (un scoring_batch ou un enrichment_batch du jour ne compte pas, tâche 6 — R22)", async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:engine_status/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/jr:engine_errors/i.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    // Cast au point d'assignation seulement : garder `query` sans le cast pour
    // conserver `.mock` (TS2339 sinon, le cast en `Executeur['query']` efface le type mock de vitest).
    const ctx: Contexte = {
      ex: { query: query as unknown as Executeur['query'] },
      organisationId: 'org-1',
      utilisateurId: 'user-1',
      role: 'admin',
    };

    await lireEtatMoteur(ctx);

    const appelErreurs = query.mock.calls.find(([sql]) => /jr:engine_errors/i.test(sql));
    expect(appelErreurs).toBeDefined();
    const sql = appelErreurs![0] as string;
    expect(sql).toContain("entity_type = 'engine'");
    expect(sql).toContain("action = 'engine_error'");
  });

  it("ne renvoie jamais hostname ni instance_id, même présents en base", async () => {
    const ctx = faux({
      'jr:engine_status': [
        { version: 'x', last_tick_at: new Date().toISOString(), last_error: null, hostname: 'vps-prod-secret', instance_id: 'worker-1' },
      ],
    });
    const etat = await lireEtatMoteur(ctx);
    expect(etat).not.toHaveProperty('hostname');
    expect(etat).not.toHaveProperty('instance_id');
  });
});

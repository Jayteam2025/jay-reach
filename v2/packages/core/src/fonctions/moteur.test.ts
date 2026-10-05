import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ForbiddenError } from '../roles.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree } from './contexte.js';
import {
  INTERVALLE_TICK_MS,
  lireEtatMoteur,
  basculerPauseEnvoi,
  lireEtatPauseEnvoi,
  lireReglageReleve,
  listerErreursRecentes,
  listerTaches,
  lancerTache,
} from './moteur.js';

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

  it(
    "compte « depuis minuit » dans le fuseau de l'organisation, jamais celui du serveur " +
      '(date_trunc(\'day\', now()) seul comptait depuis minuit UTC)',
    async () => {
      const appels: { text: string }[] = [];
      const query = vi.fn(async (text: string) => {
        appels.push({ text });
        if (/from organization_settings/i.test(text)) return { rows: [{ key: 'fuseau', value: 'Europe/Paris' }], rowCount: 1 };
        if (/jr:engine_errors/i.test(text)) return { rows: [{ n: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }) as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

      await lireEtatMoteur(ctx);

      const requete = appels.find((a) => /jr:engine_errors/i.test(a.text))!.text;
      expect(requete).toMatch(/date_trunc\('day', now\(\) at time zone \$2\) at time zone \$2/);
      expect(requete).not.toContain("date_trunc('day', now())");
    },
  );

  it('accepte des réglages déjà lus (même motif que lireConsommationDuJour) : pas de second appel à organization_settings', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/from organization_settings/i.test(sql)) throw new Error('organization_settings ne devait pas être relu');
      if (/jr:engine_errors/i.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await expect(lireEtatMoteur(ctx, { fuseau: 'Europe/Paris' } as Parameters<typeof lireEtatMoteur>[1])).resolves.toBeDefined();
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

/** Fabrique un `Executeur` factice où `query` est un espion contrôlé directement par le test. */
function fauxExecuteur(query: Executeur['query'], role: Contexte['role'] = 'admin'): Contexte {
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('basculerPauseEnvoi', () => {
  it('refuse un rôle inférieur à admin', async () => {
    const ctx = fauxExecuteur(vi.fn(), 'operator');
    await expect(basculerPauseEnvoi(ctx, { pause: true })).rejects.toThrow(ForbiddenError);
  });

  it('refuse une entrée dont `pause` n’est pas un booléen', async () => {
    const ctx = fauxExecuteur(vi.fn(), 'admin');
    await expect(basculerPauseEnvoi(ctx, { pause: 'oui' })).rejects.toThrow(ErreurEntree);
  });

  it('pose sending_paused_at et journalise sending_paused quand on active la pause', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/update organizations/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx = fauxExecuteur(query, 'admin');

    await basculerPauseEnvoi(ctx, { pause: true });

    const appelUpdate = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([sql]) =>
      /update organizations/i.test(sql as string),
    );
    expect(appelUpdate).toBeDefined();
    expect(String(appelUpdate![0])).toMatch(/sending_paused_at\s*=\s*now\(\)/i);
    expect(appelUpdate![0]).toContain('sending_paused_at is null');

    const appelJournal = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([sql]) =>
      /insert into audit_events/i.test(sql as string),
    );
    expect(appelJournal).toBeDefined();
    expect(appelJournal![1]).toEqual(expect.arrayContaining(['sending_paused']));
  });

  it('lève la pause, efface le motif et journalise sending_resumed', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/update organizations/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx = fauxExecuteur(query, 'owner');

    await basculerPauseEnvoi(ctx, { pause: false });

    const appelUpdate = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([sql]) =>
      /update organizations/i.test(sql as string),
    );
    expect(String(appelUpdate![0])).toMatch(/sending_paused_at\s*=\s*null/i);
    expect(String(appelUpdate![0])).toMatch(/sending_paused_reason\s*=\s*null/i);

    const appelJournal = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([sql]) =>
      /insert into audit_events/i.test(sql as string),
    );
    expect(appelJournal![1]).toEqual(expect.arrayContaining(['sending_resumed']));
  });

  it("n'écrit aucun événement si l'état ne change pas (déjà dans l'état demandé)", async () => {
    const query = vi.fn(async (sql: string) => {
      if (/update organizations/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx = fauxExecuteur(query, 'admin');

    await basculerPauseEnvoi(ctx, { pause: true });

    const appelJournal = (query as unknown as { mock: { calls: unknown[][] } }).mock.calls.find(([sql]) =>
      /insert into audit_events/i.test(sql as string),
    );
    expect(appelJournal).toBeUndefined();
  });
});

describe('lireEtatPauseEnvoi', () => {
  it('refuse un contexte sans rôle', async () => {
    const ctx = fauxExecuteur(vi.fn(async () => ({ rows: [], rowCount: 0 })), null);
    await expect(lireEtatPauseEnvoi(ctx)).rejects.toThrow(ForbiddenError);
  });

  it("l'organisation n'a jamais été mise en pause : rien de courant, aucune dernière pause", async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:moteur_pause_etat/i.test(sql)) return { rows: [{ sending_paused_at: null, sending_paused_reason: null }], rowCount: 1 };
      if (/jr:moteur_pause_historique/i.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 0 };
    });
    const ctx = fauxExecuteur(query as unknown as Executeur['query'], 'viewer');

    const etat = await lireEtatPauseEnvoi(ctx);

    expect(etat).toEqual({ actif: false, depuis: null, motif: null, depuisQui: null, dernierePause: null });
  });

  it('en pause actuellement : `actif` et `depuis` reflètent organizations, la dernière pause reste la fenêtre déjà refermée', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:moteur_pause_etat/i.test(sql))
        return { rows: [{ sending_paused_at: '2026-09-16T14:20:00.000Z', sending_paused_reason: 'import douteux' }], rowCount: 1 };
      if (/jr:moteur_pause_historique/i.test(sql))
        return {
          rows: [
            { created_at: '2026-09-16T14:20:00.000Z', action: 'sending_paused', acteur_nom: 'Claire Moreau' },
            { created_at: '2026-09-11T16:05:00.000Z', action: 'sending_resumed', acteur_nom: 'Claire Moreau' },
            { created_at: '2026-09-11T14:20:00.000Z', action: 'sending_paused', acteur_nom: 'Claire Moreau' },
          ],
          rowCount: 3,
        };
      return { rows: [], rowCount: 0 };
    });
    const ctx = fauxExecuteur(query as unknown as Executeur['query'], 'viewer');

    const etat = await lireEtatPauseEnvoi(ctx);

    expect(etat.actif).toBe(true);
    expect(etat.depuis).toBe('2026-09-16T14:20:00.000Z');
    expect(etat.motif).toBe('import douteux');
    expect(etat.depuisQui).toBe('Claire Moreau');
    expect(etat.dernierePause).toEqual({
      depuis: '2026-09-11T14:20:00.000Z',
      jusqua: '2026-09-11T16:05:00.000Z',
      parQui: 'Claire Moreau',
    });
  });
});

describe('listerErreursRecentes', () => {
  it('refuse un contexte sans rôle', async () => {
    const ctx = fauxExecuteur(vi.fn(async () => ({ rows: [], rowCount: 0 })), null);
    await expect(listerErreursRecentes(ctx)).rejects.toThrow(ForbiddenError);
  });

  it('lit les erreurs moteur des 7 derniers jours, du plus récent au plus ancien', async () => {
    const lignes = [
      { created_at: '2026-09-16T08:12:00.000Z', diff: { libelle: 'SalesBlink a répondu 429', detail: 'nouvel essai réussi à 08:17' } },
      { created_at: '2026-09-11T00:00:00.000Z', diff: { libelle: 'FullEnrich : délai dépassé sur 1 contact' } },
    ];
    const query = vi.fn(async (sql: string) => {
      if (/jr:moteur_erreurs_recentes/i.test(sql)) return { rows: lignes, rowCount: lignes.length };
      return { rows: [], rowCount: 0 };
    });
    const ctx = fauxExecuteur(query as unknown as Executeur['query'], 'viewer');

    const erreurs = await listerErreursRecentes(ctx);

    expect(erreurs).toEqual([
      { quand: lignes[0]!.created_at, libelle: 'SalesBlink a répondu 429', detail: 'nouvel essai réussi à 08:17' },
      { quand: lignes[1]!.created_at, libelle: 'FullEnrich : délai dépassé sur 1 contact', detail: null },
    ]);
    const appel = query.mock.calls.find(([sql]) => /jr:moteur_erreurs_recentes/i.test(sql));
    expect(String(appel![0])).toContain("entity_type = 'engine'");
    expect(String(appel![0])).toContain("action = 'engine_error'");
    expect(String(appel![0])).toMatch(/interval\s*'7 days'/i);
  });
});

describe('listerTaches', () => {
  it('refuse un contexte sans rôle', async () => {
    const ctx = fauxExecuteur(vi.fn(async () => ({ rows: [], rowCount: 0 })), null);
    await expect(listerTaches(ctx)).rejects.toThrow(ForbiddenError);
  });

  it('agrège les compteurs des cinq tâches, sources seule marquée lançable', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:moteur_taches_sources/i.test(sql)) return { rows: [{ n: 3, dernier: '2026-09-16T09:00:00.000Z' }], rowCount: 1 };
      if (/jr:moteur_taches_scoring/i.test(sql)) return { rows: [{ n: 136 }], rowCount: 1 };
      if (/jr:moteur_taches_enrichissement/i.test(sql)) return { rows: [{ n: 2 }], rowCount: 1 };
      if (/jr:moteur_taches_releve/i.test(sql)) return { rows: [{ provider: 'salesblink', last_run_at: '2026-09-16T10:44:00.000Z', cursor_ms: 1700000000000 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx = fauxExecuteur(query, 'viewer');

    const taches = await listerTaches(ctx);

    expect(taches.sources).toEqual({ lancable: true, actives: 3, dernierPassage: '2026-09-16T09:00:00.000Z' });
    expect(taches.scoring).toEqual({ lancable: false, enAttente: 136 });
    expect(taches.enrichissement).toEqual({ lancable: false, enAttente: 2 });
    expect(taches.releve).toEqual({ lancable: false, dernierPassage: '2026-09-16T10:44:00.000Z' });
  });

  it('point 4 (tour de correction 5) : compte les sources actives de toute l’organisation, pas seulement celles d’une campagne active', async () => {
    const queryMock = vi.fn(async (sql: string) => {
      if (/jr:moteur_taches_sources/i.test(sql)) return { rows: [{ n: 5, dernier: '2026-09-17T14:34:00.000Z' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const query = queryMock as unknown as Executeur['query'];
    const ctx = fauxExecuteur(query, 'viewer');

    const taches = await listerTaches(ctx);

    expect(taches.sources).toEqual({ lancable: true, actives: 5, dernierPassage: '2026-09-17T14:34:00.000Z' });
    const appel = queryMock.mock.calls.find(([sql]) => /jr:moteur_taches_sources/i.test(String(sql)));
    // La restriction « campagne active » reste le comportement de `lancerTache` (un besoin
    // différent : quoi déclencher) — cette carte, elle, dit l'état de toutes les sources actives.
    expect(String(appel![0])).not.toMatch(/campaign_sources/i);
    expect(String(appel![0])).not.toMatch(/c\.status\s*=\s*'active'/i);
  });
});

describe('lireReglageReleve (point 4, tour de correction 5 : carte « Relève des réponses »)', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(lireReglageReleve(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('lit la fréquence réglée dans Fournisseurs › SalesBlink (origine "reglee")', async () => {
    const ctx = faux({ 'jr:moteur_reglage_releve': [{ config: { sync_interval_min: '10' } }] });
    await expect(lireReglageReleve(ctx)).resolves.toEqual({ minutes: 10, origine: 'reglee' });
  });

  it('sans SalesBlink configuré, retombe sur le défaut (5 min, origine "defaut") — jamais "réglé par l’environnement"', async () => {
    const ctx = faux({ 'jr:moteur_reglage_releve': [] });
    await expect(lireReglageReleve(ctx)).resolves.toEqual({ minutes: 5, origine: 'defaut' });
  });

  it('une valeur vide en base compte comme non réglée (défaut, pas 0 minute)', async () => {
    const ctx = faux({ 'jr:moteur_reglage_releve': [{ config: { sync_interval_min: '' } }] });
    await expect(lireReglageReleve(ctx)).resolves.toEqual({ minutes: 5, origine: 'defaut' });
  });

  it('une valeur hors bornes est ramenée à la borne, mais reste "reglee" (l’opérateur l’a bien saisie)', async () => {
    const ctx = faux({ 'jr:moteur_reglage_releve': [{ config: { sync_interval_min: '999' } }] });
    await expect(lireReglageReleve(ctx)).resolves.toEqual({ minutes: 60, origine: 'reglee' });
  });
});

describe('lancerTache', () => {
  it('refuse un rôle inférieur à operator', async () => {
    const ctx = fauxExecuteur(vi.fn(), 'viewer');
    await expect(lancerTache(ctx, { tache: 'sources' })).rejects.toThrow(ForbiddenError);
  });

  it('refuse une tâche inconnue', async () => {
    const ctx = fauxExecuteur(vi.fn(), 'operator');
    await expect(lancerTache(ctx, { tache: 'catchup' })).rejects.toThrow(ErreurEntree);
  });

  it('ne déclenche que les sources actives rattachées à une campagne active (R72), et journalise', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/update sources/i.test(sql)) return { rows: [], rowCount: 3 };
      return { rows: [], rowCount: 0 };
    });
    const ctx = fauxExecuteur(query as unknown as Executeur['query'], 'operator');

    const resultat = await lancerTache(ctx, { tache: 'sources' });

    expect(resultat).toEqual({ sourcesDeclenchees: 3 });
    const appelUpdate = query.mock.calls.find(([sql]) => /update sources/i.test(sql));
    expect(String(appelUpdate![0])).toMatch(/run_requested_at\s*=\s*now\(\)/i);
    expect(String(appelUpdate![0])).toContain("c.status = 'active'");
    expect(String(appelUpdate![0])).toContain('s.is_active = true');

    const appelJournal = query.mock.calls.find(([sql]) => /insert into audit_events/i.test(sql));
    expect(appelJournal).toBeDefined();
  });
});

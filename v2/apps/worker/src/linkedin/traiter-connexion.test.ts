import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { MessageConnexion } from '@jay-reach/core';
import type { DependancesWeb } from './dependances-web.js';
import { ErreurDelaiCode } from './dependances-web.js';
import { oublierConnexionsEnCours, traiterMessageConnexion } from './traiter-connexion.js';
import {
  SQL_ACCUSER_RECEPTION,
  SQL_CLORE_SI_EN_COURS,
  SQL_LIRE_DEMANDE_A_TRAITER,
  SQL_LIRE_ISSUE,
} from './traiter-connexion-sql.js';

// Orchestration seulement. Le SQL est prouvé par exécution réelle : test/pg-verify/linkedin-connexion-actions.sh.

const DEMANDE = '11111111-1111-4111-8111-111111111111';
const ORG = 'org-1';
const SECRETS = { identifiant: 'alex.secret@exemple.fr', motDePasse: 'Mot-de-passe-très-secret-42' };
const message: MessageConnexion = { type: 'secrets', demandeId: DEMANDE, organizationId: ORG, ...SECRETS };

interface Appel {
  sql: string;
  params: unknown[];
}

function fauxPool(enCours = true, orgDeLaDemande = ORG) {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (sql === SQL_LIRE_DEMANDE_A_TRAITER) {
      return { rows: [{ organization_id: orgDeLaDemande, demandee_par: 'user-1', en_cours: enCours }] };
    }
    if (sql === SQL_LIRE_ISSUE) return { rows: [{ statut: 'echec', motif: 'erreur_interne' }] };
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, appels };
}

function fausseDependances() {
  const livrerCode = vi.fn();
  const d = {
    contexte: async () => ({ ex: { query: vi.fn() }, organisationId: ORG, utilisateurId: null, role: null }),
    livrerCode,
    vider: async () => undefined,
  } as unknown as DependancesWeb;
  return { d, livrerCode };
}

let erreurs: string[];
beforeEach(() => {
  oublierConnexionsEnCours();
  erreurs = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void erreurs.push(a.join(' ')));
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe('traiterMessageConnexion : secrets', () => {
  it('accuse réception, conduit la connexion avec la mécanique du terminal, puis journalise l’issue', async () => {
    const { pool, appels } = fauxPool();
    const { d } = fausseDependances();
    const connecter = vi.fn(async () => 0);
    await traiterMessageConnexion(pool, message, { connecter, dependances: () => d });
    expect(connecter).toHaveBeenCalledTimes(1);
    const sqls = appels.map((a) => a.sql);
    expect(sqls.indexOf(SQL_ACCUSER_RECEPTION)).toBeLessThan(sqls.indexOf(SQL_CLORE_SI_EN_COURS));
    expect(sqls.some((s) => s.includes('audit_events'))).toBe(true);
  });

  it('ignore une demande close, expirée ou d’une autre organisation, sans ouvrir de navigateur', async () => {
    for (const [enCours, org] of [[false, ORG], [true, 'autre-org']] as const) {
      const { pool } = fauxPool(enCours, org);
      const connecter = vi.fn(async () => 0);
      await traiterMessageConnexion(pool, message, { connecter, dependances: () => fausseDependances().d });
      expect(connecter).not.toHaveBeenCalled();
    }
  });

  it('test_une_exception_inattendue_clot_la_demande_en_erreur_interne_sans_rien_fuiter', async () => {
    const { pool, appels } = fauxPool();
    const connecter = vi.fn(async () => {
      throw new Error(`Chromium a planté avec ${SECRETS.motDePasse}`);
    });
    await traiterMessageConnexion(pool, message, { connecter, dependances: () => fausseDependances().d });
    const clore = appels.find((a) => a.sql === SQL_CLORE_SI_EN_COURS);
    expect(clore?.params).toEqual([DEMANDE, 'erreur_interne']);
    // Ni le journal du worker ni la base n'ont vu le texte de l'exception.
    expect(erreurs.join('\n')).not.toContain(SECRETS.motDePasse);
    expect(JSON.stringify(appels)).not.toContain(SECRETS.motDePasse);
    expect(JSON.stringify(appels)).not.toContain(SECRETS.identifiant);
  });

  it('un délai de code se clôt en delai, pas en erreur_interne', async () => {
    const { pool, appels } = fauxPool();
    const connecter = vi.fn(async () => {
      throw new ErreurDelaiCode();
    });
    await traiterMessageConnexion(pool, message, { connecter, dependances: () => fausseDependances().d });
    expect(appels.find((a) => a.sql === SQL_CLORE_SI_EN_COURS)?.params).toEqual([DEMANDE, 'delai']);
  });

  it('une connexion qui rend sans avoir posé d’issue ne laisse pas la demande en cours', async () => {
    const { pool, appels } = fauxPool();
    await traiterMessageConnexion(pool, message, { connecter: async () => 1, dependances: () => fausseDependances().d });
    expect(appels.some((a) => a.sql === SQL_CLORE_SI_EN_COURS)).toBe(true);
  });

  it('une seconde connexion pendant une première est ignorée (un seul navigateur)', async () => {
    const { pool } = fauxPool();
    let liberer: () => void = () => undefined;
    const bloquee = new Promise<number>((r) => (liberer = () => r(0)));
    const connecter = vi.fn(() => bloquee);
    const premiere = traiterMessageConnexion(pool, message, { connecter, dependances: () => fausseDependances().d });
    await vi.waitFor(() => expect(connecter).toHaveBeenCalledTimes(1));
    await traiterMessageConnexion(pool, { ...message, demandeId: '22222222-2222-4222-8222-222222222222' }, { connecter, dependances: () => fausseDependances().d });
    expect(connecter).toHaveBeenCalledTimes(1);
    liberer();
    await premiere;
  });
});

describe('traiterMessageConnexion : code et déconnexion', () => {
  it('livre le code à la connexion en cours de CETTE demande et de cette organisation seulement', async () => {
    const { pool } = fauxPool();
    const { d, livrerCode } = fausseDependances();
    let liberer: () => void = () => undefined;
    const bloquee = new Promise<number>((r) => (liberer = () => r(0)));
    const premiere = traiterMessageConnexion(pool, message, { connecter: () => bloquee, dependances: () => d });
    await vi.waitFor(() => expect(erreurs).toEqual([]));
    await vi.waitFor(async () => {
      await traiterMessageConnexion(pool, { type: 'code', demandeId: DEMANDE, organizationId: ORG, code: '918273' });
      expect(livrerCode).toHaveBeenCalledWith('918273');
    });
    livrerCode.mockClear();
    await traiterMessageConnexion(pool, { type: 'code', demandeId: DEMANDE, organizationId: 'autre', code: '1' });
    await traiterMessageConnexion(pool, { type: 'code', demandeId: 'inconnue', organizationId: ORG, code: '1' });
    expect(livrerCode).not.toHaveBeenCalled();
    liberer();
    await premiere;
  });

  it('un code sans connexion en cours est ignoré sans lever', async () => {
    const { pool } = fauxPool();
    await expect(
      traiterMessageConnexion(pool, { type: 'code', demandeId: DEMANDE, organizationId: ORG, code: '918273' }),
    ).resolves.toBeUndefined();
  });

  it('deconnexion appelle la fonction deconnecter du terminal', async () => {
    const { pool } = fauxPool();
    const deconnecter = vi.fn(async () => 0);
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter });
    expect(deconnecter).toHaveBeenCalledTimes(1);
    const ctx = (deconnecter.mock.calls[0] as unknown as [{ organisationId: string }])[0];
    expect(ctx.organisationId).toBe(ORG);
  });
});

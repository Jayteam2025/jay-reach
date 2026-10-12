import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { MessageConnexion } from '@jay-reach/core';
import type { DependancesWeb } from './dependances-web.js';
import { ErreurDelaiCode } from './dependances-web.js';
import { oublierConnexionsEnCours, reprendreDeconnexionsEnAttente, traiterMessageConnexion } from './traiter-connexion.js';
import {
  SQL_ACCUSER_RECEPTION,
  SQL_CLORE_SI_EN_COURS,
  SQL_DECONNEXIONS_EN_ATTENTE,
  SQL_LIRE_DECONNEXION,
  SQL_LIRE_DEMANDE_A_TRAITER,
  SQL_LIRE_ISSUE,
  SQL_POSER_DECONNEXION,
  SQL_SOLDER_DECONNEXION,
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

function fauxPool(enCours = true, orgDeLaDemande = ORG, accuses = 1, statutFinal = 'echec') {
  const appels: Appel[] = [];
  // L'intention de déconnexion persistée : `null` = aucune.
  const etat: { intention: string | null } = { intention: null };
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (sql === SQL_POSER_DECONNEXION) etat.intention ??= '2026-10-12 10:00:00.123456+00';
    if (sql === SQL_LIRE_DECONNEXION) return { rows: etat.intention ? [{ demandee_at: etat.intention }] : [] };
    if (sql === SQL_DECONNEXIONS_EN_ATTENTE) return { rows: etat.intention ? [{ organization_id: ORG }] : [] };
    if (sql === SQL_SOLDER_DECONNEXION) {
      if (etat.intention && params[1] === etat.intention) etat.intention = null;
      return { rows: [] };
    }
    if (sql === SQL_LIRE_DEMANDE_A_TRAITER) {
      return { rows: [{ organization_id: orgDeLaDemande, demandee_par: 'user-1', en_cours: enCours }] };
    }
    if (sql === SQL_LIRE_ISSUE) return { rows: [{ statut: statutFinal, motif: 'erreur_interne' }] };
    if (sql === SQL_ACCUSER_RECEPTION) return { rows: [], rowCount: accuses };
    return { rows: [] };
  });
  return { pool: { query } as unknown as pg.Pool, appels, etat };
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

describe('traiterMessageConnexion : cas limites', () => {
  it('un accusé qui ne touche aucune ligne (demande annulée entre-temps) ne pilote rien', async () => {
    const { pool } = fauxPool(true, ORG, 0);
    const connecter = vi.fn(async () => 0);
    await traiterMessageConnexion(pool, message, { connecter, dependances: () => fausseDependances().d });
    expect(connecter).not.toHaveBeenCalled();
  });

  it('une seconde demande pendant une connexion est close en verrou_occupe, pas laissée sans état', async () => {
    const { pool, appels } = fauxPool();
    let liberer: () => void = () => undefined;
    const bloquee = new Promise<number>((r) => (liberer = () => r(0)));
    const premiere = traiterMessageConnexion(pool, message, { connecter: () => bloquee, dependances: () => fausseDependances().d });
    await vi.waitFor(() => expect(appels.some((a) => a.sql === SQL_ACCUSER_RECEPTION)).toBe(true));
    const autre = '22222222-2222-4222-8222-222222222222';
    await traiterMessageConnexion(pool, { ...message, demandeId: autre }, { connecter: async () => 0, dependances: () => fausseDependances().d });
    expect(appels.find((a) => a.sql === SQL_CLORE_SI_EN_COURS && a.params[0] === autre)?.params).toEqual([autre, 'verrou_occupe']);
    liberer();
    await premiere;
  });

  it('une réussite ignorée parce que la demande a été annulée révoque la session', async () => {
    const { pool } = fauxPool(true, ORG, 1, 'echec');
    const bloquer = vi.fn(async () => undefined);
    await traiterMessageConnexion(pool, message, { connecter: async () => 0, dependances: () => fausseDependances().d, bloquer });
    expect(bloquer).toHaveBeenCalledWith(expect.anything(), 'revoquee');
  });

  it('une réussite enregistrée ne révoque rien, ni un échec ordinaire', async () => {
    const bloquer = vi.fn(async () => undefined);
    await traiterMessageConnexion(fauxPool(true, ORG, 1, 'reussi').pool, message, { connecter: async () => 0, dependances: () => fausseDependances().d, bloquer });
    await traiterMessageConnexion(fauxPool(true, ORG, 1, 'echec').pool, message, { connecter: async () => 1, dependances: () => fausseDependances().d, bloquer });
    expect(bloquer).not.toHaveBeenCalled();
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

  it('deconnexion pose l intention, appelle deconnecter du terminal, et la solde quand elle reussit', async () => {
    const { pool, appels, etat } = fauxPool();
    const deconnecter = vi.fn(async () => 0);
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter });
    expect(deconnecter).toHaveBeenCalledTimes(1);
    const ctx = (deconnecter.mock.calls[0] as unknown as [{ organisationId: string }])[0];
    expect(ctx.organisationId).toBe(ORG);
    expect(etat.intention).toBeNull();
    const issue = appels.find((a) => a.sql.includes('audit_events'));
    expect(JSON.parse(String(issue?.params[5]))).toMatchObject({ statut: 'reussi' });
  });

  it('un code retour 1 (cookies non effaces) ne solde PAS l intention et est consigne en echec', async () => {
    const { pool, appels, etat } = fauxPool();
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter: async () => 1 });
    expect(etat.intention).not.toBeNull();
    expect(appels.some((a) => a.sql === SQL_SOLDER_DECONNEXION)).toBe(false);
    const issue = appels.find((a) => a.sql.includes('audit_events'));
    expect(JSON.parse(String(issue?.params[5]))).toMatchObject({ statut: 'echec' });
  });

  it('une deconnexion qui leve ne solde pas non plus l intention', async () => {
    const { pool, etat } = fauxPool();
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, {
      deconnecter: async () => {
        throw new Error('panne');
      },
    });
    expect(etat.intention).not.toBeNull();
  });

  it('une deconnexion arrivee PENDANT une connexion est persistee, puis jouee a sa fin, jamais en parallele', async () => {
    const { pool, etat } = fauxPool();
    const { d } = fausseDependances();
    const ordre: string[] = [];
    let liberer: () => void = () => undefined;
    const bloquee = new Promise<number>((r) => (liberer = () => r(0)));
    const deconnecter = vi.fn(async () => {
      ordre.push('deconnecter');
      return 0;
    });
    const premiere = traiterMessageConnexion(pool, message, {
      connecter: async () => {
        ordre.push('connecter debut');
        const code = await bloquee;
        ordre.push('connecter fin');
        return code;
      },
      dependances: () => d,
      deconnecter,
    });
    await vi.waitFor(() => expect(ordre).toEqual(['connecter debut']));
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter });
    expect(deconnecter).not.toHaveBeenCalled();
    expect(etat.intention).not.toBeNull(); // durable AVANT d'être jouée
    liberer();
    await premiere;
    expect(ordre).toEqual(['connecter debut', 'connecter fin', 'deconnecter']);
    expect(etat.intention).toBeNull();
  });

  it('une intention laissee par un worker arrete est rejouee au demarrage', async () => {
    const { pool, etat } = fauxPool();
    etat.intention = '2026-10-12 09:00:00.654321+00';
    const deconnecter = vi.fn(async () => 0);
    expect(await reprendreDeconnexionsEnAttente(pool, { deconnecter })).toBe(1);
    expect(deconnecter).toHaveBeenCalledTimes(1);
    expect(etat.intention).toBeNull();
    expect(await reprendreDeconnexionsEnAttente(pool, { deconnecter })).toBe(0);
  });

  it('la connexion ne touche pas l intention de deconnexion : le solde revient a connecter, sur succes seulement', async () => {
    const { pool, etat } = fauxPool();
    etat.intention = '2026-10-12 08:00:00.5+00';
    const { d } = fausseDependances();
    await traiterMessageConnexion(pool, message, { connecter: async () => 1, dependances: () => d });
    expect(etat.intention).not.toBeNull();
  });

  it('une deconnexion demandee PENDANT une deconnexion en cours est rejouee ensuite, et le rejeu s arrete', async () => {
    const { pool, etat } = fauxPool();
    etat.intention = '2026-10-12 08:00:00.1+00';
    let appels = 0;
    const deconnecter = vi.fn(async () => {
      appels += 1;
      if (appels === 1) {
        // Arrive pendant la première : horodatage renouvelé, et le message est ignoré (une seule à la fois).
        etat.intention = '2026-10-12 08:00:09.9+00';
        await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter });
      }
      return 0;
    });
    await reprendreDeconnexionsEnAttente(pool, { deconnecter });
    expect(deconnecter).toHaveBeenCalledTimes(2);
    expect(etat.intention).toBeNull();
  });

  it('un echec ne reboucle pas', async () => {
    const { pool } = fauxPool();
    const deconnecter = vi.fn(async () => 1);
    await traiterMessageConnexion(pool, { type: 'deconnexion', demandeId: DEMANDE, organizationId: ORG }, { deconnecter });
    expect(deconnecter).toHaveBeenCalledTimes(1);
  });
});

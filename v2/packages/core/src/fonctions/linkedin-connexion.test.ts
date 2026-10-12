import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ForbiddenError } from '../roles.js';
import type { Contexte } from './contexte.js';
import {
  annulerConnexion,
  demanderConnexion,
  demanderDeconnexion,
  ErreurAucunCodeAttendu,
  ErreurConnexionEnCours,
  ErreurFormulaireFerme,
  ErreurTransmissionConnexion,
  lireDemandeEnCours,
  repondreDefi,
} from './linkedin-connexion.js';
import {
  SQL_ANNULER,
  SQL_ATTEND_UN_CODE,
  SQL_CREER_DEMANDE,
  SQL_ECHEC_TRANSMISSION,
  SQL_FORMULAIRE_FERME,
  SQL_LIRE_DEMANDE,
  SQL_POSER_WORKER_ABSENT,
} from './linkedin-connexion-sql.js';
import { lireMessageConnexion } from './linkedin-canal.js';

// Ces tests vérifient l'ORCHESTRATION (quelle requête, dans quel ordre, avec quels paramètres).
// Le SQL lui-même est prouvé par exécution réelle : test/pg-verify/linkedin-connexion-actions.sh.

const ORG = 'org-1';
const UTILISATEUR = 'user-1';
const DEMANDE = '11111111-1111-4111-8111-111111111111';
const IDENTIFIANT = 'alex.secret@exemple.fr';
const MOT_DE_PASSE = 'Mot-de-passe-très-secret-42';
const CODE = '918273';

let ancienne: string | undefined;
beforeEach(() => {
  ancienne = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = 'a'.repeat(64);
});
afterEach(() => {
  if (ancienne === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ancienne;
});

type Reponse = { rows: unknown[]; rowCount?: number } | Error;
interface Appel {
  sql: string;
  params: unknown[];
}

/** Contexte factice : `reponses` associe un texte SQL exact (la constante du code) à sa réponse. */
function faux(reponses: Record<string, Reponse> = {}, role: Contexte['role'] = 'admin') {
  const appels: Appel[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    const r = reponses[sql];
    if (r instanceof Error) throw r;
    if (r) return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
    if (sql.includes('pg_notify') && reponses.NOTIFY instanceof Error) throw reponses.NOTIFY;
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  const ctx: Contexte = { ex: { query }, organisationId: ORG, utilisateurId: UTILISATEUR, role };
  return { ctx, appels };
}

const creation: Record<string, Reponse> = { [SQL_CREER_DEMANDE]: { rows: [{ id: DEMANDE }] } };
const notifies = (appels: Appel[]) => appels.filter((a) => a.sql.includes('pg_notify'));

describe('demanderConnexion', () => {
  it('test_un_viewer_ne_peut_pas_demander_une_connexion', async () => {
    for (const role of ['viewer', 'operator', null] as const) {
      const { ctx, appels } = faux(creation, role);
      await expect(demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE })).rejects.toThrow(
        ForbiddenError,
      );
      expect(appels).toHaveLength(0);
    }
  });

  it('refuse une entrée invalide sans rien écrire ni émettre, et sans citer la valeur', async () => {
    const { ctx, appels } = faux(creation);
    const erreur = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: '' }).catch((e: unknown) => e);
    expect(erreur).toBeInstanceOf(Error);
    expect(JSON.stringify(erreur)).not.toContain(IDENTIFIANT);
    expect(appels).toHaveLength(0);
  });

  it('test_une_seconde_demande_simultanee_rend_une_erreur_lisible', async () => {
    // L'index unique partiel refuse la seconde insertion : Postgres lève 23505.
    const contrainte = Object.assign(
      new Error('duplicate key value violates unique constraint "linkedin_connexion_une_seule_en_cours"'),
      { code: '23505' },
    );
    const { ctx, appels } = faux({ [SQL_CREER_DEMANDE]: contrainte });
    const erreur = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE }).catch(
      (e: unknown) => e,
    );
    expect(erreur).toBeInstanceOf(ErreurConnexionEnCours);
    expect((erreur as Error).message).toBe('Une connexion est déjà en cours.');
    expect((erreur as Error).message).not.toMatch(/duplicate|constraint|linkedin_connexion/i);
    expect(notifies(appels)).toHaveLength(0);
  });

  it('une autre erreur de base remonte telle quelle (pas confondue avec « déjà en cours »)', async () => {
    const { ctx } = faux({ [SQL_CREER_DEMANDE]: Object.assign(new Error('connexion perdue'), { code: '57P01' }) });
    await expect(demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE })).rejects.toThrow(
      'connexion perdue',
    );
  });

  it('test_trois_echecs_ferment_le_formulaire_un_quart_d_heure', async () => {
    const rouvreA = new Date('2026-10-12T10:15:00Z');
    const { ctx, appels } = faux({ ...creation, [SQL_FORMULAIRE_FERME]: { rows: [{ ferme: true, rouvre_a: rouvreA }] } });
    const erreur = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE }).catch(
      (e: unknown) => e,
    );
    expect(erreur).toBeInstanceOf(ErreurFormulaireFerme);
    expect((erreur as ErreurFormulaireFerme).rouvreA).toEqual(rouvreA);
    // Rien n'est créé, rien n'est émis : la fermeture est contrôlée AVANT l'insertion.
    expect(appels.some((a) => a.sql === SQL_CREER_DEMANDE)).toBe(false);
    expect(notifies(appels)).toHaveLength(0);
  });

  it('formulaire ouvert : crée la demande puis émet, dans cet ordre', async () => {
    const { ctx, appels } = faux({ ...creation, [SQL_FORMULAIRE_FERME]: { rows: [{ ferme: false, rouvre_a: null }] } });
    const r = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE });
    expect(r).toEqual({ demandeId: DEMANDE });
    const ordre = appels.map((a) =>
      a.sql === SQL_CREER_DEMANDE ? 'creer' : a.sql.includes('pg_notify') ? 'notify' : a.sql.includes('audit_events') ? 'audit' : 'autre',
    );
    expect(ordre.indexOf('creer')).toBeLessThan(ordre.indexOf('notify'));
    expect(appels.find((a) => a.sql === SQL_CREER_DEMANDE)?.params).toEqual([ORG, UTILISATEUR]);
  });

  it('un message qui ne part pas ferme la demande tout de suite et ne remonte pas la cause', async () => {
    const { ctx, appels } = faux({ ...creation, NOTIFY: new Error(`clé ${MOT_DE_PASSE}`) });
    const erreur = await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE }).catch(
      (e: unknown) => e,
    );
    expect(erreur).toBeInstanceOf(ErreurTransmissionConnexion);
    expect((erreur as Error).message).not.toContain(MOT_DE_PASSE);
    expect(appels.find((a) => a.sql === SQL_ECHEC_TRANSMISSION)?.params).toEqual([DEMANDE]);
  });

  it('test_chaque_tentative_laisse_une_ligne_d_audit_sans_secret', async () => {
    const { ctx, appels } = faux(creation);
    await demanderConnexion(ctx, { identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE });
    const audits = appels.filter((a) => a.sql.includes('audit_events'));
    expect(audits).toHaveLength(1);
    // qui (acteur), quelle organisation, quelle demande, quelle action.
    expect(audits[0]!.params.slice(0, 5)).toEqual([ORG, UTILISATEUR, 'sender', null, 'linkedin.connexion_demandee']);
    expect(String(audits[0]!.params[5])).toContain(DEMANDE);
    // Aucun secret dans AUCUNE requête, hors la charge chiffrée du pg_notify (qui, elle, ne le contient pas en clair).
    for (const a of appels) {
      const texte = JSON.stringify([a.sql, a.params]);
      expect(texte).not.toContain(IDENTIFIANT);
      expect(texte).not.toContain(MOT_DE_PASSE);
    }
    // Et la charge chiffrée, elle, se déchiffre bien en ce qui a été saisi (le secret ne s'est pas perdu en route).
    const charge = String(notifies(appels)[0]!.params[1]);
    const recu = await lireMessageConnexion(charge);
    expect(recu).toMatchObject({ type: 'secrets', identifiant: IDENTIFIANT, motDePasse: MOT_DE_PASSE });
  });
});

describe('lireDemandeEnCours', () => {
  it('test_une_demande_sans_reponse_du_worker_bascule_en_worker_absent_apres_quinze_secondes', async () => {
    const ligne = { id: DEMANDE, statut: 'echec', motif: 'worker_absent', etape: null, created_at: new Date(), expires_at: new Date() };
    const { ctx, appels } = faux({ [SQL_LIRE_DEMANDE]: { rows: [ligne] } });
    const d = await lireDemandeEnCours(ctx);
    // La bascule est posée AVANT la lecture, pour l'organisation de l'appelant.
    expect(appels.map((a) => a.sql)).toEqual([SQL_POSER_WORKER_ABSENT, SQL_LIRE_DEMANDE]);
    expect(appels[0]!.params).toEqual([ORG]);
    expect(d).toMatchObject({ id: DEMANDE, statut: 'echec', motif: 'worker_absent' });
    // Le seuil de quinze secondes et la condition « sans accusé » sont dans le SQL, prouvés par le harnais.
    expect(SQL_POSER_WORKER_ABSENT).toContain("interval '15 seconds'");
  });

  it('rend null quand il n’y a rien à montrer', async () => {
    const { ctx } = faux();
    expect(await lireDemandeEnCours(ctx)).toBeNull();
  });

  it('un viewer peut lire', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(lireDemandeEnCours(ctx)).resolves.toBeNull();
  });
});

describe('repondreDefi', () => {
  it('refuse un viewer', async () => {
    const { ctx, appels } = faux({}, 'viewer');
    await expect(repondreDefi(ctx, DEMANDE, CODE)).rejects.toThrow(ForbiddenError);
    expect(appels).toHaveLength(0);
  });

  it('refuse quand la demande n’attend pas de code, sans rien émettre', async () => {
    const { ctx, appels } = faux();
    await expect(repondreDefi(ctx, DEMANDE, CODE)).rejects.toThrow(ErreurAucunCodeAttendu);
    expect(notifies(appels)).toHaveLength(0);
  });

  it('émet le code chiffré, et ne l’écrit nulle part en clair', async () => {
    const { ctx, appels } = faux({ [SQL_ATTEND_UN_CODE]: { rows: [{ id: DEMANDE }] } });
    await repondreDefi(ctx, DEMANDE, CODE);
    expect(appels[0]!.params).toEqual([DEMANDE, ORG]);
    const n = notifies(appels);
    expect(n).toHaveLength(1);
    for (const a of appels) expect(JSON.stringify([a.sql, a.params])).not.toContain(CODE);
    expect(await lireMessageConnexion(String(n[0]!.params[1]))).toMatchObject({ type: 'code', demandeId: DEMANDE, code: CODE });
  });

  it('refuse un code qui n’a pas la forme d’un code, et un identifiant de demande qui n’est pas un uuid', async () => {
    const { ctx } = faux({ [SQL_ATTEND_UN_CODE]: { rows: [{ id: DEMANDE }] } });
    await expect(repondreDefi(ctx, DEMANDE, '12 34')).rejects.toThrow('Entrée invalide');
    await expect(repondreDefi(ctx, 'pas-un-uuid', CODE)).rejects.toThrow('Entrée invalide');
  });
});

describe('annulerConnexion', () => {
  it('refuse un viewer', async () => {
    const { ctx } = faux({}, 'viewer');
    await expect(annulerConnexion(ctx, DEMANDE)).rejects.toThrow(ForbiddenError);
  });

  it('pose l’annulation pour l’organisation de l’appelant et journalise', async () => {
    const { ctx, appels } = faux({ [SQL_ANNULER]: { rows: [{ id: DEMANDE }] } });
    await annulerConnexion(ctx, DEMANDE);
    expect(appels[0]).toMatchObject({ sql: SQL_ANNULER, params: [DEMANDE, ORG] });
    expect(appels.some((a) => a.params.includes('linkedin.connexion_annulee'))).toBe(true);
  });

  it('une demande déjà terminée : sans erreur et sans ligne de journal', async () => {
    const { ctx, appels } = faux();
    await annulerConnexion(ctx, DEMANDE);
    expect(appels).toHaveLength(1);
  });
});

describe('demanderDeconnexion', () => {
  it('refuse un viewer, émet un message deconnexion pour un admin', async () => {
    const refus = faux({}, 'viewer');
    await expect(demanderDeconnexion(refus.ctx)).rejects.toThrow(ForbiddenError);
    const { ctx, appels } = faux();
    await demanderDeconnexion(ctx);
    const n = notifies(appels);
    expect(n).toHaveLength(1);
    expect(await lireMessageConnexion(String(n[0]!.params[1]))).toMatchObject({ type: 'deconnexion', organizationId: ORG });
    expect(appels.some((a) => a.params.includes('linkedin.deconnexion_demandee'))).toBe(true);
  });
});

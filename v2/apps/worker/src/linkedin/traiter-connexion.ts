/**
 * Ce que le worker fait d'un message reçu sur le canal chiffré de connexion LinkedIn (lot 5, spec §8).
 *
 *  - `secrets`     : conduit la connexion avec la fonction EXISTANTE du terminal (`connecter`), derrière
 *                    `dependancesWeb` ; le code, plus tard, arrive par `code` ;
 *  - `code`        : remis à la connexion en cours de cette demande (`livrerCode`) ;
 *  - `deconnexion` : `deconnecter`, la fonction du terminal (la tâche 6 l'enrichira).
 *
 * Aucune exception n'est journalisée ni écrite en base : seul son NOM l'est. Une exception qui n'est
 * ni un délai de code ni une demande interrompue clôt la demande en `echec / erreur_interne`, pour
 * que l'écran ne reste pas figé un quart d'heure.
 */
import { ecrireEvenement, type Contexte, type MessageConnexion } from '@jay-reach/core';
import type pg from 'pg';
import { connecter, deconnecter, pilotageReel, type Dependances } from '../cli/linkedin.js';
import {
  dependancesWeb,
  ErreurDelaiCode,
  ErreurDemandeInterrompue,
  type DependancesWeb,
} from './dependances-web.js';
import {
  SQL_ACCUSER_RECEPTION,
  SQL_CLORE_SI_EN_COURS,
  SQL_LIRE_DEMANDE_A_TRAITER,
  SQL_LIRE_ISSUE,
} from './traiter-connexion-sql.js';

interface LigneAtraiter {
  organization_id: string;
  demandee_par: string;
  en_cours: boolean;
}

export interface OptionsTraitement {
  /** Remplaçables en test : la mécanique du terminal et les dépendances web. */
  connecter?: (ctx: Contexte, d: Dependances) => Promise<number>;
  deconnecter?: (ctx: Contexte, d: Dependances) => Promise<number>;
  dependances?: (demandeId: string, secrets: { identifiant: string; motDePasse: string }, pool: pg.Pool) => DependancesWeb;
  env?: Record<string, string | undefined>;
}

/** Connexions en cours dans CE processus : demande -> organisation et dépendances (pour livrer le code). */
const enCours = new Map<string, { organisationId: string; dependances: DependancesWeb }>();

const nomErreur = (e: unknown): string => (e instanceof Error ? e.name : 'erreur');

/** Motif de clôture pour une exception : jamais son texte. */
function motifDe(e: unknown): 'delai' | 'erreur_interne' {
  return e instanceof ErreurDelaiCode ? 'delai' : 'erreur_interne';
}

async function journaliserIssue(pool: pg.Pool, organisationId: string, demandeePar: string, demandeId: string): Promise<void> {
  try {
    const r = await pool.query<{ statut: string; motif: string | null }>(SQL_LIRE_ISSUE, [demandeId]);
    const issue = r.rows[0];
    if (!issue) return;
    await ecrireEvenement(pool, {
      organisationId,
      entityType: 'sender',
      entityId: null,
      action: 'linkedin.connexion_terminee',
      actorId: demandeePar,
      diff: {
        libelle: issue.statut === 'reussi' ? 'Compte LinkedIn connecté' : 'Connexion du compte LinkedIn échouée',
        demandeId,
        statut: issue.statut,
        motif: issue.motif,
      },
    });
  } catch (e) {
    console.error(`[traiter-connexion] journal non écrit (${nomErreur(e)})`);
  }
}

async function conduireConnexion(
  pool: pg.Pool,
  message: Extract<MessageConnexion, { type: 'secrets' }>,
  options: OptionsTraitement,
): Promise<void> {
  const { demandeId, organizationId } = message;
  const lue = await pool.query<LigneAtraiter>(SQL_LIRE_DEMANDE_A_TRAITER, [demandeId]);
  const demande = lue.rows[0];
  // Demande inconnue, close, expirée, ou d'une autre organisation que celle du message : on ne pilote rien.
  if (!demande || !demande.en_cours || demande.organization_id !== organizationId) {
    console.error('[traiter-connexion] message ignoré (demande absente, close ou d’une autre organisation)');
    return;
  }
  if (enCours.has(demandeId) || enCours.size > 0) {
    console.error('[traiter-connexion] message ignoré (une connexion est déjà conduite par ce worker)');
    return;
  }

  const fabrique = options.dependances ?? ((id, s, p) => dependancesWeb(id, s, p, { env: options.env }));
  const dependances = fabrique(demandeId, { identifiant: message.identifiant, motDePasse: message.motDePasse }, pool);
  enCours.set(demandeId, { organisationId: organizationId, dependances });
  let motifRepli: 'delai' | 'erreur_interne' | null = null;
  try {
    await pool.query(SQL_ACCUSER_RECEPTION, [demandeId]);
    const ctx = await dependances.contexte();
    await (options.connecter ?? connecter)(ctx, dependances);
  } catch (e) {
    // Une annulation n'est pas une panne : l'état est déjà `echec / annulee`.
    if (!(e instanceof ErreurDemandeInterrompue)) {
      motifRepli = motifDe(e);
      console.error(`[traiter-connexion] connexion interrompue (${nomErreur(e)})`);
    }
  } finally {
    enCours.delete(demandeId);
    await dependances.vider();
    // Quoi qu'il se soit passé (exception, ou retour sans motif posé), plus rien ne reste « en cours ».
    await pool
      .query(SQL_CLORE_SI_EN_COURS, [demandeId, motifRepli ?? 'erreur_interne'])
      .catch((e: unknown) => console.error(`[traiter-connexion] clôture impossible (${nomErreur(e)})`));
    await journaliserIssue(pool, organizationId, demande.demandee_par, demandeId);
  }
}

async function conduireDeconnexion(
  pool: pg.Pool,
  organisationId: string,
  options: OptionsTraitement,
): Promise<void> {
  if (enCours.size > 0) {
    console.error('[traiter-connexion] déconnexion ignorée (une connexion est en cours)');
    return;
  }
  const d: Dependances = {
    env: options.env ?? process.env,
    ecrire: (ligne) => console.log(ligne),
    contexte: async () => ({ ex: pool, organisationId, utilisateurId: null, role: null }),
    ...pilotageReel,
    // Aucune saisie : la déconnexion n'interroge personne.
    demander: () => Promise.reject(new Error('invite_inattendue')),
    demanderMasque: () => Promise.reject(new Error('invite_inattendue')),
  };
  try {
    await (options.deconnecter ?? deconnecter)(await d.contexte(), d);
  } catch (e) {
    console.error(`[traiter-connexion] déconnexion échouée (${nomErreur(e)})`);
  }
}

/** Point d'entrée de l'écoute : ne lève jamais (une exception ici ne doit pas tuer le worker). */
export async function traiterMessageConnexion(
  pool: pg.Pool,
  message: MessageConnexion,
  options: OptionsTraitement = {},
): Promise<void> {
  try {
    switch (message.type) {
      case 'secrets':
        await conduireConnexion(pool, message, options);
        return;
      case 'code': {
        const c = enCours.get(message.demandeId);
        if (c && c.organisationId === message.organizationId) c.dependances.livrerCode(message.code);
        else console.error('[traiter-connexion] code ignoré (aucune connexion en cours pour cette demande)');
        return;
      }
      case 'deconnexion':
        await conduireDeconnexion(pool, message.organizationId, options);
        return;
    }
  } catch (e) {
    console.error(`[traiter-connexion] message abandonné (${nomErreur(e)})`);
  }
}

/** Vide l'état du processus (tests). */
export function oublierConnexionsEnCours(): void {
  enCours.clear();
}

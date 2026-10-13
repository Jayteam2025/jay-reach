/**
 * Ce que le worker fait d'un message reçu sur le canal chiffré de connexion LinkedIn (lot 5, spec §8).
 *
 *  - `secrets`     : conduit la connexion avec la fonction EXISTANTE du terminal (`connecter`), derrière
 *                    `dependancesWeb` ; le code, plus tard, arrive par `code` ;
 *  - `code`        : remis à la connexion en cours de cette demande (`livrerCode`) ;
 *  - `deconnexion` : `deconnecter`, la fonction du terminal (efface aussi les cookies et désactive l'expéditeur) ; si une connexion est en cours, elle est différée à sa fin.
 *
 * Aucune exception n'est journalisée ni écrite en base : seul son NOM l'est. Une exception qui n'est
 * ni un délai de code ni une demande interrompue clôt la demande en `echec / erreur_interne`, pour
 * que l'écran ne reste pas figé un quart d'heure.
 */
import { bloquerSessionLinkedIn, desactiverExpediteurLinkedIn, ecrireEvenement, type Contexte, type MessageConnexion } from '@jay-reach/core';
import type pg from 'pg';
import { connecter, deconnecter, pilotageReel, type Dependances } from './pilotage.js';
import {
  dependancesWeb,
  ErreurDelaiCode,
  ErreurDemandeInterrompue,
  type DependancesWeb,
} from './dependances-web.js';
import {
  SQL_ACCUSER_RECEPTION,
  SQL_CLORE_ORPHELINES,
  SQL_CLORE_SI_EN_COURS,
  SQL_DECONNEXIONS_EN_ATTENTE,
  SQL_LIRE_DECONNEXION,
  SQL_LIRE_DEMANDE_A_TRAITER,
  SQL_LIRE_ISSUE,
  SQL_POSER_DECONNEXION,
  SQL_SOLDER_DECONNEXION,
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
  bloquer?: (ctx: Contexte, motif: 'revoquee') => Promise<void>;
  desactiver?: (ctx: Contexte) => Promise<number>;
  env?: Record<string, string | undefined>;
}

/** Connexions en cours dans CE processus : demande -> organisation et dépendances (pour livrer le code). */
const enCours = new Map<string, { organisationId: string; dependances: DependancesWeb }>();

/** Une déconnexion pilote le navigateur : une à la fois dans ce processus. */
let deconnexionEnCours = false;

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

/**
 * `connecter` active la session AVANT d'écrire « Session LinkedIn active. » : une annulation posée entre les
 * deux fait ignorer la réussite (l'écran dit « annulée ») alors que la session est active en base. L'utilisateur
 * a renoncé : on révoque, pour que ce qu'il voit soit ce qui est vrai. Se reconnaît à : la mécanique a rendu 0
 * (session activée) et pourtant la demande n'est pas `reussi`.
 */
async function revoquerSiAnnuleeTropTard(
  pool: pg.Pool,
  demandeId: string,
  codeRetour: number | null,
  ctx: Contexte | null,
  options: OptionsTraitement,
): Promise<void> {
  if (codeRetour !== 0 || !ctx) return;
  try {
    const r = await pool.query<{ statut: string }>(SQL_LIRE_ISSUE, [demandeId]);
    if (r.rows[0]?.statut === 'reussi') return;
    await (options.bloquer ?? bloquerSessionLinkedIn)(ctx, 'revoquee');
    // Invariant « session active ⇔ expéditeur actif » : comme `connecter` et `deconnecter`, on désactive aussi l'expéditeur.
    await (options.desactiver ?? desactiverExpediteurLinkedIn)(ctx);
    console.error('[traiter-connexion] annulation tardive : session révoquée');
  } catch (e) {
    console.error(`[traiter-connexion] révocation impossible (${nomErreur(e)})`);
  }
}

/** Au démarrage : aucune demande ne survit à un redémarrage du worker, on clôt les orphelines. */
export async function cloreDemandesOrphelines(pool: pg.Pool): Promise<number> {
  try {
    const r = await pool.query(SQL_CLORE_ORPHELINES);
    if (r.rowCount) console.log(`[traiter-connexion] ${r.rowCount} demande(s) de connexion orpheline(s) closes au démarrage`);
    return r.rowCount ?? 0;
  } catch (e) {
    console.error(`[traiter-connexion] orphelines non closes (${nomErreur(e)})`);
    return 0;
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
  if (enCours.has(demandeId)) {
    console.error('[traiter-connexion] message ignoré (cette demande est déjà conduite)');
    return;
  }
  // L'accusé de réception d'abord : `pg_notify` diffuse à TOUS les écouteurs, un seul worker doit piloter. Exactement
  // une ligne : la demande était `demandee` et sans accusé. Sinon un autre worker l'a prise, ou elle a été annulée
  // ou close entre-temps : on ne touche à rien (ni état, ni motif), la demande n'est pas la nôtre.
  const accuse = await pool.query(SQL_ACCUSER_RECEPTION, [demandeId]);
  if (accuse.rowCount !== 1) {
    console.error('[traiter-connexion] message ignoré (demande non accusée par ce worker)');
    return;
  }
  if (enCours.size > 0) {
    // Un seul navigateur par processus. La demande est à nous (accusée) : l'écran doit le savoir, sans état écrit
    // elle finirait en `worker_absent` alors que le worker est bien là.
    console.error('[traiter-connexion] message ignoré (une autre connexion est déjà conduite par ce worker)');
    await pool
      .query(SQL_CLORE_SI_EN_COURS, [demandeId, 'verrou_occupe'])
      .catch((e: unknown) => console.error(`[traiter-connexion] clôture impossible (${nomErreur(e)})`));
    return;
  }

  const fabrique = options.dependances ?? ((id, s, p) => dependancesWeb(id, s, p, { env: options.env }));
  const dependances = fabrique(demandeId, { identifiant: message.identifiant, motDePasse: message.motDePasse }, pool);
  enCours.set(demandeId, { organisationId: organizationId, dependances });
  let motifRepli: 'delai' | 'erreur_interne' | null = null;
  let codeRetour: number | null = null;
  let ctxConnexion: Contexte | null = null;
  try {
    ctxConnexion = await dependances.contexte();
    codeRetour = await (options.connecter ?? connecter)(ctxConnexion, dependances);
  } catch (e) {
    // Une annulation n'est pas une panne : l'état est déjà `echec / annulee`.
    if (!(e instanceof ErreurDemandeInterrompue)) {
      motifRepli = motifDe(e);
      console.error(`[traiter-connexion] connexion interrompue (${nomErreur(e)})`);
    }
  } finally {
    try {
      await dependances.vider();
      await revoquerSiAnnuleeTropTard(pool, demandeId, codeRetour, ctxConnexion, options);
      // Quoi qu'il se soit passé (exception, ou retour sans motif posé), plus rien ne reste « en cours ».
      await pool
        .query(SQL_CLORE_SI_EN_COURS, [demandeId, motifRepli ?? 'erreur_interne'])
        .catch((e: unknown) => console.error(`[traiter-connexion] clôture impossible (${nomErreur(e)})`));
      await journaliserIssue(pool, organizationId, demande.demandee_par, demandeId);
    } finally {
      // Le verrou du processus ne tombe qu'ici : une déconnexion ou une seconde demande arrivée pendant le
      // nettoyage voit encore la connexion en cours, au lieu de piloter le navigateur en même temps.
      enCours.delete(demandeId);
    }
    // Une déconnexion demandée pendant la connexion (intention persistée) se joue maintenant : la dernière
    // volonté exprimée l'emporte, et elle survit à un arrêt du worker (reprise au démarrage).
    await reprendreDeconnexion(pool, organizationId, options);
  }
}

/**
 * Joue la déconnexion en attente de l'organisation, si elle l'est. L'intention n'est soldée que si `deconnecter`
 * a RÉUSSI (code 0 : cookies effacés) : un échec la laisse en place, le démarrage suivant la reprendra. Le
 * résultat est consigné au journal d'audit (`linkedin.deconnexion_terminee`), sans secret : statut et code.
 */
const PROFONDEUR_MAX_REJEU = 5;

async function reprendreDeconnexion(
  pool: pg.Pool,
  organisationId: string,
  options: OptionsTraitement,
  profondeur = 0,
): Promise<void> {
  let demandee: unknown;
  try {
    demandee = (await pool.query<{ demandee_at: unknown }>(SQL_LIRE_DECONNEXION, [organisationId])).rows[0]?.demandee_at;
  } catch (e) {
    console.error(`[traiter-connexion] intention de déconnexion illisible (${nomErreur(e)})`);
    return;
  }
  if (demandee === undefined || demandee === null) return;
  if (deconnexionEnCours) return; // celle qui tourne relira l'intention en finissant
  // Un navigateur déjà piloté par une connexion : on n'efface pas ses cookies sous elle. L'intention reste en
  // base, la fin de cette connexion la jouera.
  if (enCours.size > 0) return;
  deconnexionEnCours = true;
  let code = 1;
  try {
    code = await jouerDeconnexion(pool, organisationId, demandee, options);
  } finally {
    deconnexionEnCours = false;
  }
  // Une demande arrivée PENDANT cette déconnexion (elle a renouvelé l'horodatage, donc n'a pas été soldée) :
  // la rejouer maintenant plutôt que la laisser dormir jusqu'au prochain redémarrage. Seulement après un succès,
  // sinon un navigateur en panne bouclerait ; et au plus `profondeur` fois.
  if (code === 0 && profondeur < PROFONDEUR_MAX_REJEU) await reprendreDeconnexion(pool, organisationId, options, profondeur + 1);
}

async function jouerDeconnexion(pool: pg.Pool, organisationId: string, demandee: unknown, options: OptionsTraitement): Promise<number> {

  const d: Dependances = {
    env: options.env ?? process.env,
    ecrire: (ligne) => console.log(ligne),
    contexte: async () => ({ ex: pool, organisationId, utilisateurId: null, role: null }),
    ...pilotageReel,
    // Aucune saisie : la déconnexion n'interroge personne.
    demander: () => Promise.reject(new Error('invite_inattendue')),
    demanderMasque: () => Promise.reject(new Error('invite_inattendue')),
  };
  let code = 1;
  try {
    code = await (options.deconnecter ?? deconnecter)(await d.contexte(), d);
  } catch (e) {
    console.error(`[traiter-connexion] déconnexion échouée (${nomErreur(e)})`);
  }
  try {
    if (code === 0) await pool.query(SQL_SOLDER_DECONNEXION, [organisationId, demandee]);
    else console.error('[traiter-connexion] déconnexion NON aboutie : le compte peut rester joignable, reprise au prochain démarrage');
    await ecrireEvenement(pool, {
      organisationId,
      entityType: 'sender',
      entityId: null,
      action: 'linkedin.deconnexion_terminee',
      actorId: null,
      diff: {
        libelle: code === 0 ? 'Compte LinkedIn déconnecté' : 'Déconnexion du compte LinkedIn non aboutie',
        statut: code === 0 ? 'reussi' : 'echec',
      },
    });
  } catch (e) {
    console.error(`[traiter-connexion] issue de déconnexion non écrite (${nomErreur(e)})`);
  }
  return code;
}

/** Au démarrage : toute déconnexion demandée et non aboutie est rejouée (le message d'origine est perdu). */
export async function reprendreDeconnexionsEnAttente(pool: pg.Pool, options: OptionsTraitement = {}): Promise<number> {
  try {
    const r = await pool.query<{ organization_id: string }>(SQL_DECONNEXIONS_EN_ATTENTE);
    for (const { organization_id } of r.rows) await reprendreDeconnexion(pool, organization_id, options);
    return r.rows.length;
  } catch (e) {
    console.error(`[traiter-connexion] déconnexions en attente non reprises (${nomErreur(e)})`);
    return 0;
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
        // D'abord durable, ensuite jouée : si un navigateur est déjà piloté, la fin de cette connexion s'en charge.
        await pool.query(SQL_POSER_DECONNEXION, [message.organizationId]);
        if (enCours.size > 0) console.error('[traiter-connexion] déconnexion différée (une connexion est en cours)');
        else await reprendreDeconnexion(pool, message.organizationId, options);
        return;
    }
  } catch (e) {
    console.error(`[traiter-connexion] message abandonné (${nomErreur(e)})`);
  }
}

/** Vide l'état du processus (tests). */
export function oublierConnexionsEnCours(): void {
  enCours.clear();
  deconnexionEnCours = false;
}

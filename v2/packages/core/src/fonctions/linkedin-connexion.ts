/**
 * Connexion du compte LinkedIn depuis l'écran (lot 5, spec §7 et §8) : les cinq fonctions que
 * l'écran (et plus tard le MCP) appellent. Le geste est TOUJOURS réservé à `admin`.
 *
 * Le mot de passe ne s'écrit nulle part ici : il part chiffré par `emettreMessageConnexion`, qui
 * porte déjà le contrôle du rôle et de l'organisation. La table d'état ne reçoit que des valeurs
 * de listes fermées (statut, motif, étape), jamais le texte d'une exception.
 */
import { z } from 'zod';
import { ecrireEvenement } from '../journal.js';
import { exiger, valider, type Contexte } from './contexte.js';
import { emettreMessageConnexion } from './linkedin-canal.js';
import {
  SQL_ANNULER,
  SQL_ATTEND_UN_CODE,
  SQL_CREER_DEMANDE,
  SQL_ECHEC_TRANSMISSION,
  SQL_EXPIRER_DE_L_ORGANISATION,
  SQL_FORMULAIRE_FERME,
  SQL_LIRE_DEMANDE,
  SQL_POSER_WORKER_ABSENT,
} from './linkedin-connexion-sql.js';
import { ForbiddenError } from '../roles.js';

export type StatutConnexion = 'demandee' | 'navigateur_ouvert' | 'code_demande' | 'reussi' | 'echec';
export type MotifConnexion =
  | 'sortie_inattendue'
  | 'sortie_serveur'
  | 'verrou_occupe'
  | 'refuse'
  | 'defi'
  | 'delai'
  | 'worker_absent'
  | 'trop_essais'
  | 'annulee'
  | 'erreur_interne';
export type EtapeConnexion =
  | 'sortie_controlee'
  | 'navigateur_ouvert'
  | 'identifiants_transmis'
  | 'code_demande'
  | 'session_active';

export interface Demande {
  id: string;
  statut: StatutConnexion;
  motif: MotifConnexion | null;
  etape: EtapeConnexion | null;
  creeeLe: Date;
  expireLe: Date;
}

/** Une demande est déjà en cours (l'index unique l'a refusée) : message lisible, jamais l'erreur de contrainte. */
export class ErreurConnexionEnCours extends Error {
  constructor() {
    super('Une connexion est déjà en cours.');
    this.name = 'ErreurConnexionEnCours';
  }
}

/** Trois échecs d'affilée : le formulaire est fermé jusqu'à `rouvreA`. */
export class ErreurFormulaireFerme extends Error {
  constructor(public readonly rouvreA: Date) {
    super('Trois échecs de suite : le formulaire est fermé un quart d’heure.');
    this.name = 'ErreurFormulaireFerme';
  }
}

/** Aucun code n'est attendu pour cette demande (terminée, expirée, ou pas encore au défi). */
export class ErreurAucunCodeAttendu extends Error {
  constructor() {
    super('Aucun code n’est attendu pour cette demande.');
    this.name = 'ErreurAucunCodeAttendu';
  }
}

/** Le message chiffré n'a pas pu partir. Le détail (clé absente, base) n'est pas remonté. */
export class ErreurTransmissionConnexion extends Error {
  constructor() {
    super('La demande n’a pas pu être transmise au serveur.');
    this.name = 'ErreurTransmissionConnexion';
  }
}

const schemaConnexion = z.object({
  identifiant: z.string().trim().min(1).max(320),
  // Jamais de trim : un mot de passe est pris tel quel.
  motDePasse: z.string().min(1).max(256),
});
const schemaId = z.string().uuid();
const schemaCode = z.string().trim().regex(/^[0-9A-Za-z]{4,12}$/);

interface LigneDemande {
  id: string;
  statut: StatutConnexion;
  motif: MotifConnexion | null;
  etape: EtapeConnexion | null;
  created_at: Date;
  expires_at: Date;
}

/** Le journal ne fait jamais échouer le geste (même règle que `ecrireEvenement`). */
async function journaliser(
  ctx: Contexte,
  action: 'linkedin.connexion_demandee' | 'linkedin.connexion_annulee' | 'linkedin.deconnexion_demandee',
  demandeId: string | null,
  libelle: string,
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'sender',
      entityId: null,
      action,
      actorId: ctx.utilisateurId,
      diff: { libelle, demandeId },
    });
  } catch {
    console.warn(`[linkedin-connexion] journal non écrit (${action})`);
  }
}

function violationUnique(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === '23505';
}

/**
 * Crée la demande puis envoie les secrets chiffrés au worker. Refuse si le formulaire est fermé
 * (trois échecs) ou si une demande est déjà en cours, y compris quand deux onglets arrivent
 * ensemble : l'index unique tranche, et sa violation devient `ErreurConnexionEnCours`.
 */
export async function demanderConnexion(ctx: Contexte, entree: unknown): Promise<{ demandeId: string }> {
  exiger(ctx, 'admin');
  const { identifiant, motDePasse } = valider(schemaConnexion, entree);
  if (!ctx.utilisateurId) throw new ForbiddenError('admin', ctx.role);

  await ctx.ex.query(SQL_EXPIRER_DE_L_ORGANISATION, [ctx.organisationId]);
  const fermeture = await ctx.ex.query<{ ferme: boolean | null; rouvre_a: Date | null }>(SQL_FORMULAIRE_FERME, [
    ctx.organisationId,
  ]);
  const f = fermeture.rows[0];
  if (f?.ferme === true && f.rouvre_a) throw new ErreurFormulaireFerme(f.rouvre_a);

  let demandeId: string;
  try {
    const r = await ctx.ex.query<{ id: string }>(SQL_CREER_DEMANDE, [ctx.organisationId, ctx.utilisateurId]);
    const id = r.rows[0]?.id;
    if (!id) throw new ErreurTransmissionConnexion();
    demandeId = id;
  } catch (e) {
    if (violationUnique(e)) throw new ErreurConnexionEnCours();
    throw e;
  }

  await journaliser(ctx, 'linkedin.connexion_demandee', demandeId, 'Connexion du compte LinkedIn demandée');
  try {
    await emettreMessageConnexion(ctx, {
      type: 'secrets',
      demandeId,
      organizationId: ctx.organisationId,
      identifiant,
      motDePasse,
    });
  } catch {
    // Pas de worker joignable ou clé absente : la demande se ferme tout de suite, l'écran n'attend pas.
    await ctx.ex.query(SQL_ECHEC_TRANSMISSION, [demandeId]).catch(() => undefined);
    throw new ErreurTransmissionConnexion();
  }
  return { demandeId };
}

/**
 * La demande en cours, ou celle qui vient de finir. Si elle est restée `demandee` sans accusé du
 * worker plus de quinze secondes, c'est ICI qu'elle passe en `echec / worker_absent` : le worker,
 * par définition, n'est pas là pour le dire, et la purge ne passerait qu'à l'expiration.
 */
export async function lireDemandeEnCours(ctx: Contexte): Promise<Demande | null> {
  exiger(ctx, 'viewer');
  await ctx.ex.query(SQL_POSER_WORKER_ABSENT, [ctx.organisationId]);
  const r = await ctx.ex.query<LigneDemande>(SQL_LIRE_DEMANDE, [ctx.organisationId]);
  const l = r.rows[0];
  if (!l) return null;
  return { id: l.id, statut: l.statut, motif: l.motif, etape: l.etape, creeeLe: l.created_at, expireLe: l.expires_at };
}

/** Remet le code saisi à l'écran au navigateur qui attend, par le même canal chiffré. Le code n'est jamais écrit. */
export async function repondreDefi(ctx: Contexte, demandeId: string, code: string): Promise<void> {
  exiger(ctx, 'admin');
  const id = valider(schemaId, demandeId);
  const codeValide = valider(schemaCode, code);
  const attend = await ctx.ex.query(SQL_ATTEND_UN_CODE, [id, ctx.organisationId]);
  if (attend.rows.length === 0) throw new ErreurAucunCodeAttendu();
  try {
    await emettreMessageConnexion(ctx, {
      type: 'code',
      demandeId: id,
      organizationId: ctx.organisationId,
      code: codeValide,
    });
  } catch {
    throw new ErreurTransmissionConnexion();
  }
}

/**
 * Pose `echec / annulee`. Le worker relit l'état entre ses étapes et s'arrête. Sans effet (et sans
 * erreur) si la demande est déjà terminée ou n'appartient pas à l'organisation.
 */
export async function annulerConnexion(ctx: Contexte, demandeId: string): Promise<void> {
  exiger(ctx, 'admin');
  const id = valider(schemaId, demandeId);
  const r = await ctx.ex.query(SQL_ANNULER, [id, ctx.organisationId]);
  if (r.rows.length > 0) await journaliser(ctx, 'linkedin.connexion_annulee', id, 'Connexion du compte LinkedIn annulée');
}

/** Demande la déconnexion au worker (message `deconnexion`, sans ligne d'état : il n'y a rien à suivre). */
export async function demanderDeconnexion(ctx: Contexte): Promise<void> {
  exiger(ctx, 'admin');
  const demandeId = globalThis.crypto.randomUUID();
  try {
    await emettreMessageConnexion(ctx, { type: 'deconnexion', demandeId, organizationId: ctx.organisationId });
  } catch {
    throw new ErreurTransmissionConnexion();
  }
  await journaliser(ctx, 'linkedin.deconnexion_demandee', demandeId, 'Déconnexion du compte LinkedIn demandée');
}

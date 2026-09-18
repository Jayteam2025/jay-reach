/**
 * Fiche contact (tiroir, depuis toute table de la campagne, spec §6.10) :
 * lecture assemblée (`lireFiche`) et trois actions d'opérateur (`ajouterNote`,
 * `nePlusContacter`, `chercherEmail`). Même socle que `campagnes.ts` (spec
 * « une fonction, deux façades »).
 *
 * `lireFiche` réutilise `CASE_STATUT_DERIVE`/`FROM_POPULATION_CAMPAGNE`
 * (`campagnes.ts`) plutôt que d'écrire une seconde version des règles de
 * statut : les deux doivent toujours s'accorder sur ce qu'est « en séquence »,
 * « à répondu », etc.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurEntree, ErreurIntrouvable } from './contexte.js';
import { ecrireEvenement, type ActionJournal } from '../journal.js';
import { dansUneTransaction } from '../transaction.js';
import { LIVE_STATUSES } from '../inbox/record-reply.js';
import { jourCourantDansFuseau, lireConsommationDuJour, lireReglages } from './plafonds.js';
import { comparerInstantsDesc } from '../temps.js';
import {
  CASE_STATUT_DERIVE,
  etapeAffichee,
  FROM_POPULATION_CAMPAGNE,
  marqueBoite,
  motifPauseDe,
  type ContactCampagne,
  type Evenement,
  type StatutContactCampagne,
} from './campagnes.js';

// ---------------------------------------------------------------------------
// Erreurs métier propres (R73 : `ErreurEntree` est réservée à la validation
// du socle, toute autre erreur porte un nom propre).
// ---------------------------------------------------------------------------

/** Un geste d'enrichissement (`chercherEmail`) refusé pour une raison métier — jamais une entrée invalide. */
export class ErreurEnrichissementImpossible extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurEnrichissementImpossible';
  }
}

/** Statuts d'inscription « en cours » (même trois valeurs que `LIVE_STATUSES` de `inbox/record-reply.ts`, ici côté JS pour classer une étape). */
const STATUTS_INSCRIPTION_VIVANTE = new Set(['active', 'paused', 'paused_absence']);

// ---------------------------------------------------------------------------
// Types produits
// ---------------------------------------------------------------------------

export type EmailStatut = 'unknown' | 'valid' | 'risky' | 'invalid' | 'disposable' | 'role';

export interface FicheContact {
  readonly id: string;
  readonly prenom: string | null;
  readonly nom: string | null;
  readonly poste: string | null;
  readonly entreprise: string | null;
  readonly ville: string | null;
  readonly photoUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly email: string | null;
  readonly emailStatut: EmailStatut;
  /**
   * Aucune colonne de téléphone n'existe encore dans le schéma (`contacts`,
   * vérifié dans `supabase/migrations`) — toujours `null` pour l'instant. La
   * maquette montre un lien « Chercher » pour ce champ, mais aucune fonction
   * ne le rend (hors périmètre de cette tâche, qui ne porte que sur l'email).
   */
  readonly telephone: string | null;
}

export interface FichePourquoi {
  readonly providerId: string | null;
  readonly titre: string | null;
  readonly date: string | null;
  readonly url: string | null;
  /** Extrait de l'offre d'origine, si le `raw` du signal en porte un (`description`) — `null` sinon, jamais une erreur. */
  readonly extrait: string | null;
}

export interface FicheScore {
  readonly valeur: number;
  /** `signals.score_reason` — `null` si la colonne est vide pour ce signal. */
  readonly explication: string | null;
}

export type EtatEtapeSequence = 'faite' | 'en_cours' | 'a_venir';

export interface FicheEtape {
  /** 1-based (cohérent avec `ContactCampagne.etape`, `campagnes.ts`). */
  readonly position: number;
  readonly etat: EtatEtapeSequence;
}

export interface FicheBoite {
  readonly identite: string;
  readonly marque: 'outlook' | 'gmail' | null;
}

export interface FichePause {
  /** Motif brut (`stop_reason`, ou `'absence'` pour un `paused_absence` sans motif propre) — `libelleMotifPause` (apps/web) le traduit à l'écran. */
  readonly motif: string;
  /** `enrollments.resume_at` — `null` sauf une pause d'absence datée. */
  readonly repriseLe: string | null;
  readonly inscriptionId: string;
}

export interface FicheSequence {
  readonly etapes: FicheEtape[];
  /** Boîte du dernier envoi connu de cette inscription — `null` si rien n'est encore parti. */
  readonly boite: FicheBoite | null;
  /** Inscription en pause (T29, R93) — `null` pour une inscription vivante (`active`) ou déjà terminée/arrêtée. */
  readonly pause: FichePause | null;
  /**
   * `enrollments.next_action_at` (F11) — non `null` seulement pour une inscription `active`
   * (`pause` alors nul) : une inscription en pause, arrêtée ou terminée n'a pas de « prochain
   * message » à annoncer, `pause` porte déjà sa propre échéance (`repriseLe`).
   */
  readonly prochainMessageLe: string | null;
}

/**
 * Nommé `MessageFicheContact` — et non `MessageFil`, déjà exporté par
 * `reception.ts` (tâche 16, forme plus riche : expéditeur/destinataire,
 * objet, `repondDepuis`) — pour ne pas entrer en collision d'export (même
 * geste que `CampagneListeResume`/`CampagneResume`, voir le commentaire dans
 * `campagnes.ts`). Sert uniquement au résumé compact de la fiche (« Ce qu'on
 * s'est dit »), pas au fil complet de la Réception.
 */
export interface MessageFicheContact {
  readonly id: string;
  readonly direction: 'in' | 'out';
  readonly corps: string | null;
  readonly quand: string | null;
}

export interface Note {
  readonly id: string;
  readonly texte: string;
  readonly quand: string;
  /** `null` si l'auteur n'a ni nom complet ni email exploitable (compte supprimé) — jamais une erreur. */
  readonly auteurNom: string | null;
}

export interface FicheCampagne {
  readonly id: string;
  readonly nom: string;
}

export interface Fiche {
  readonly contact: FicheContact;
  readonly statut: StatutContactCampagne;
  readonly score: FicheScore | null;
  readonly pourquoi: FichePourquoi | null;
  /** `null` sans inscription dans la campagne demandée (pas encore contacté, ou aucune `campagneId` fournie). */
  readonly sequence: FicheSequence | null;
  readonly echanges: MessageFicheContact[];
  /** Fil le plus récent du contact, pour le lien « Ouvrir dans la Réception » — `null` sans échange. */
  readonly filId: string | null;
  readonly notes: Note[];
  readonly historique: Evenement[];
  readonly campagnes: FicheCampagne[];
}

export const schemaLireFiche = z.object({
  contactId: z.string().uuid(),
  campagneId: z.string().uuid().optional(),
});

// ---------------------------------------------------------------------------
// lireFiche
// ---------------------------------------------------------------------------

interface LigneContactBrut {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  email_status: EmailStatut;
  linkedin_url: string | null;
  photo_url: string | null;
  account_id: string | null;
  source_signal_id: string | null;
  status: 'active' | 'left_company' | 'do_not_contact';
  entreprise: string | null;
  ville: string | null;
}

interface LigneSignalBrut {
  id: string;
  score: number | null;
  score_reason: string | null;
  title: string | null;
  provider_id: string | null;
  occurred_at: string | null;
  url: string | null;
  raw: unknown;
}

/** Extrait de l'offre d'origine, best-effort : `raw.description`, tronqué — jamais d'exception sur un `raw` inattendu. */
function extraitDeSignal(raw: unknown): string | null {
  try {
    const objet = typeof raw === 'string' ? (JSON.parse(raw) as unknown) : raw;
    const description = (objet as { description?: unknown } | null)?.description;
    if (typeof description === 'string' && description.trim() !== '') {
      return description.trim().slice(0, 400);
    }
  } catch {
    // `raw` non exploitable : pas d'extrait, jamais une erreur pour un champ secondaire.
  }
  return null;
}

function pourquoiDeSignal(signal: LigneSignalBrut | null): FichePourquoi | null {
  if (!signal) return null;
  return {
    providerId: signal.provider_id ?? null,
    titre: signal.title ?? null,
    date: signal.occurred_at ?? null,
    url: signal.url ?? null,
    extrait: extraitDeSignal(signal.raw),
  };
}

function scoreDeSignal(signal: LigneSignalBrut | null): FicheScore | null {
  if (!signal || signal.score == null) return null;
  return { valeur: signal.score, explication: signal.score_reason ?? null };
}

/** Statut minimal, sans inscription ni signal qualifié pour une campagne : population insuffisante pour `CASE_STATUT_DERIVE`. */
function statutMinimal(ligne: LigneContactBrut): StatutContactCampagne {
  if (ligne.status === 'do_not_contact') return 'ne_plus_contacter';
  if (!ligne.email || ligne.email_status !== 'valid') return 'sans_email';
  return 'a_contacter';
}

export async function lireFiche(ctx: Contexte, entree: unknown): Promise<Fiche> {
  exiger(ctx, 'viewer');
  const { contactId, campagneId } = valider(schemaLireFiche, entree);

  const contactRes = await ctx.ex.query<LigneContactBrut>(
    `select c.id, c.first_name, c.last_name, c.job_title, c.email, c.email_status,
            c.linkedin_url, c.photo_url, c.account_id, c.source_signal_id, c.status,
            ac.name as entreprise, ac.city as ville
       from contacts c /* jr:fiche_contact */
       left join accounts ac on ac.id = c.account_id
      where c.id = $1 and c.organization_id = $2`,
    [contactId, ctx.organisationId],
  );
  const ligne = contactRes.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Contact');

  let statut: StatutContactCampagne = statutMinimal(ligne);
  let signal: LigneSignalBrut | null = null;
  let currentStep: number | null = null;
  let enrollmentStatus: string | null = null;
  let enrollmentId: string | null = null;
  let stopReason: string | null = null;
  let resumeAt: string | null = null;
  let nextActionAt: string | null = null;

  if (campagneId) {
    const res = await ctx.ex.query<{
      statut: StatutContactCampagne;
      enrollment_id: string | null;
      current_step: number | null;
      e_status: string | null;
      stop_reason: string | null;
      resume_at: string | null;
      next_action_at: string | null;
      signal_id: string | null;
      score: number | null;
      score_reason: string | null;
      title: string | null;
      provider_id: string | null;
      occurred_at: string | null;
      url: string | null;
      raw: unknown;
    }>(
      `select ${CASE_STATUT_DERIVE} as statut, e.enrollment_id, e.current_step, e.status as e_status,
              e.stop_reason, e.resume_at, e.next_action_at,
              s.id as signal_id, s.score, s.score_reason, s.title, s.provider_id, s.occurred_at, s.url, s.raw
         ${FROM_POPULATION_CAMPAGNE}
        where c.id = $2 /* jr:fiche_statut_campagne */`,
      [campagneId, contactId],
    );
    const r = res.rows[0];
    if (r) {
      statut = r.statut;
      currentStep = r.current_step;
      enrollmentStatus = r.e_status;
      enrollmentId = r.enrollment_id;
      stopReason = r.stop_reason;
      resumeAt = r.resume_at;
      nextActionAt = r.next_action_at;
      if (r.signal_id) {
        signal = {
          id: r.signal_id,
          score: r.score,
          score_reason: r.score_reason,
          title: r.title,
          provider_id: r.provider_id,
          occurred_at: r.occurred_at,
          url: r.url,
          raw: r.raw,
        };
      }
    }
  } else if (ligne.source_signal_id) {
    // Pas de campagne précisée (ouverture depuis une table globale, tâche 18) :
    // le signal d'origine du contact, sans le filtre « qualifié pour cette
    // campagne » de `FROM_POPULATION_CAMPAGNE` (il n'y a pas de campagne à
    // qualifier contre).
    const r = await ctx.ex.query<LigneSignalBrut>(
      `select id, score, score_reason, title, provider_id, occurred_at, url, raw
         from signals /* jr:fiche_signal_direct */
        where id = $1 and organization_id = $2`,
      [ligne.source_signal_id, ctx.organisationId],
    );
    signal = r.rows[0] ?? null;
  }

  // Séquence : seulement s'il existe une inscription réelle dans la campagne demandée.
  let sequence: FicheSequence | null = null;
  if (campagneId && enrollmentId) {
    // M9 (Mineur, revue finale du 14/09) : le contact est vérifié plus haut,
    // mais `campagneId` vient tel quel de l'appelant — sans cette jointure,
    // une campagne d'une autre organisation aurait rendu son propre nombre
    // d'étapes de séquence (aligné sur le correctif I1, `campagnes.ts`).
    const etapesRes = await ctx.ex.query<{ position: number }>(
      `select ss.position from sequence_steps ss /* jr:fiche_etapes */
         join campaigns camp on camp.id = ss.campaign_id and camp.organization_id = $2
        where ss.campaign_id = $1
        order by ss.position asc`,
      [campagneId, ctx.organisationId],
    );
    const enrollmentVivante = enrollmentStatus !== null && STATUTS_INSCRIPTION_VIVANTE.has(enrollmentStatus);
    const etapes: FicheEtape[] = etapesRes.rows.map((e) => ({
      position: e.position + 1,
      etat:
        currentStep == null || e.position > currentStep
          ? 'a_venir'
          : e.position < currentStep
            ? 'faite'
            : enrollmentVivante
              ? 'en_cours'
              : 'a_venir',
    }));

    const boiteRes = await ctx.ex.query<{ identity: string; inbox_provider: string | null }>(
      `select s.identity, s.inbox_provider
         from actions a /* jr:fiche_boite */
         join senders s on s.id = a.sender_id
        where a.enrollment_id = $1 and a.sender_id is not null
        order by a.created_at desc
        limit 1`,
      [enrollmentId],
    );
    const b = boiteRes.rows[0];
    sequence = {
      etapes,
      boite: b ? { identite: b.identity, marque: marqueBoite(b.identity, b.inbox_provider) } : null,
      pause:
        statut === 'en_pause'
          ? { motif: motifPauseDe(enrollmentStatus, stopReason), repriseLe: resumeAt, inscriptionId: enrollmentId! }
          : null,
      prochainMessageLe: statut === 'en_sequence' ? nextActionAt : null,
    };
  }

  // Échanges : tous les fils du contact (email, LinkedIn…), messages fusionnés par date.
  // `last_message_at` (`threads`, `timestamptz`) revient de `pg` comme un objet
  // `Date`, pas une chaîne : le type de la ligne brute le reflète, `comparerInstantsDesc`
  // compare l'un ou l'autre. Départage par id de fil (desc) : aucun `order by` SQL ici,
  // le tri est entièrement en mémoire.
  const filsRes = await ctx.ex.query<{ id: string; last_message_at: string | Date | null }>(
    `select id, last_message_at from threads /* jr:fiche_fils */ where contact_id = $1 and organization_id = $2`,
    [contactId, ctx.organisationId],
  );
  const fils = filsRes.rows;
  const filId =
    fils.length > 0
      ? [...fils].sort((a, b) => comparerInstantsDesc(a.last_message_at, b.last_message_at) || b.id.localeCompare(a.id))[0]!.id
      : null;

  let echanges: MessageFicheContact[] = [];
  if (fils.length > 0) {
    const messagesRes = await ctx.ex.query<{ id: string; direction: 'in' | 'out'; body: string | null; sent_at: string | null }>(
      `select id, direction, body, sent_at
         from thread_messages /* jr:fiche_messages */
        where thread_id = any($1::uuid[])
        order by sent_at asc nulls last
        limit 50`,
      [fils.map((f) => f.id)],
    );
    echanges = messagesRes.rows.map((m) => ({ id: m.id, direction: m.direction, corps: m.body, quand: m.sent_at }));
  }

  const notesRes = await ctx.ex.query<{ id: string; body: string; created_at: string; auteur_nom: string | null }>(
    `select cn.id, cn.body, cn.created_at,
            coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as auteur_nom
       from contact_notes cn /* jr:fiche_notes */
       left join auth.users u on u.id = cn.author_id
      where cn.contact_id = $1
      order by cn.created_at desc`,
    [contactId],
  );
  const notes: Note[] = notesRes.rows.map((r) => ({ id: r.id, texte: r.body, quand: r.created_at, auteurNom: r.auteur_nom }));

  const historiqueRes = await ctx.ex.query<{
    id: string;
    created_at: string;
    action: ActionJournal;
    diff: { libelle?: string; detail?: string } | null;
  }>(
    `select id, created_at, action, diff
       from audit_events /* jr:fiche_historique */
      where organization_id = $1 and entity_type = 'contact' and entity_id = $2
      order by created_at desc
      limit 100`,
    [ctx.organisationId, contactId],
  );
  const historique: Evenement[] = historiqueRes.rows.map((r) => ({
    id: r.id,
    quand: r.created_at,
    type: r.action,
    libelle: r.diff?.libelle ?? '',
    detail: r.diff?.detail ?? null,
  }));

  const campagnesRes = await ctx.ex.query<{ id: string; nom: string }>(
    `select distinct c.id, c.name as nom
       from campaigns c /* jr:fiche_campagnes */
       join enrollments e on e.campaign_id = c.id
      where e.contact_id = $1 and e.organization_id = $2
      order by c.name asc`,
    [contactId, ctx.organisationId],
  );

  return {
    contact: {
      id: ligne.id,
      prenom: ligne.first_name,
      nom: ligne.last_name,
      poste: ligne.job_title,
      entreprise: ligne.entreprise,
      ville: ligne.ville,
      photoUrl: ligne.photo_url,
      linkedinUrl: ligne.linkedin_url,
      email: ligne.email,
      emailStatut: ligne.email_status,
      telephone: null,
    },
    statut,
    score: scoreDeSignal(signal),
    pourquoi: pourquoiDeSignal(signal),
    sequence,
    echanges,
    filId,
    notes,
    historique,
    campagnes: campagnesRes.rows,
  };
}

// ---------------------------------------------------------------------------
// ajouterNote
// ---------------------------------------------------------------------------

export const schemaAjouterNote = z.object({
  contactId: z.string().uuid(),
  texte: z.string().min(1).max(4000),
});

async function ecrireEvenementContact(ctx: Contexte, action: ActionJournal, contactId: string, libelle: string): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'contact',
      entityId: contactId,
      action,
      diff: { libelle },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn(`[journal] ${action}`, err);
  }
}

export async function ajouterNote(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'operator');
  const { contactId, texte } = valider(schemaAjouterNote, entree);

  const contactRes = await ctx.ex.query<{ id: string }>(
    `select id from contacts /* jr:note_contact */ where id = $1 and organization_id = $2`,
    [contactId, ctx.organisationId],
  );
  if (contactRes.rowCount === 0) throw new ErreurIntrouvable('Contact');

  const res = await ctx.ex.query<{ id: string }>(
    `insert into contact_notes (contact_id, author_id, body) /* jr:note_creer */
     values ($1, $2, $3)
     returning id`,
    [contactId, ctx.utilisateurId, texte],
  );
  const id = res.rows[0]!.id;

  await ecrireEvenementContact(ctx, 'contact.note_added', contactId, 'Note ajoutée par l’opérateur.');

  return { id };
}

// ---------------------------------------------------------------------------
// nePlusContacter
// ---------------------------------------------------------------------------

export const schemaNePlusContacter = z.object({ contactId: z.string().uuid() });

/**
 * Trois effets EN UNE TRANSACTION (`dansUneTransaction`, R47/R69) : statut du
 * contact, suppression de son email (s'il en a un), inscriptions vivantes de
 * TOUTES ses campagnes arrêtées — plus, comme `ecarterDuneCampagne`
 * (`file-du-jour.ts`), les envois pas encore partis de ces inscriptions
 * annulés : un contact marqué « ne plus contacter » ne doit pas recevoir un
 * email déjà programmé avant que le tick suivant ne s'en aperçoive.
 */
export async function nePlusContacter(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { contactId } = valider(schemaNePlusContacter, entree);

  await dansUneTransaction(ctx.ex, async (tx) => {
    const contactRes = await tx.query<{ id: string; email: string | null }>(
      `select id, email from contacts /* jr:dnc_contact */ where id = $1 and organization_id = $2`,
      [contactId, ctx.organisationId],
    );
    const contact = contactRes.rows[0];
    if (!contact) throw new ErreurIntrouvable('Contact');

    await tx.query(
      `update contacts set status = 'do_not_contact' /* jr:dnc_statut */ where id = $1 and organization_id = $2`,
      [contactId, ctx.organisationId],
    );

    if (contact.email) {
      await tx.query(
        `insert into suppressions (organization_id, scope, value, reason, origin) /* jr:dnc_suppression */
         select $1, 'email', $2, 'operator_do_not_contact', 'manual'
         where not exists (
           select 1 from suppressions where organization_id = $1 and scope = 'email' and value = $2
         )`,
        [ctx.organisationId, contact.email],
      );
    }

    const inscriptionsRes = await tx.query<{ id: string }>(
      `update enrollments /* jr:dnc_inscriptions */
          set status = 'stopped', ended_at = now(), stop_reason = coalesce(stop_reason, 'operator_do_not_contact')
        where organization_id = $1 and contact_id = $2 and status in ${LIVE_STATUSES}
       returning id`,
      [ctx.organisationId, contactId],
    );
    const idsInscriptions = inscriptionsRes.rows.map((r) => r.id);
    if (idsInscriptions.length > 0) {
      await tx.query(
        `update actions /* jr:dnc_actions */
            set status = 'skipped', error = coalesce(error, 'operator_do_not_contact')
          where enrollment_id = any($1::uuid[]) and organization_id = $2 and status in ('scheduled', 'pending_approval')`,
        [idsInscriptions, ctx.organisationId],
      );
    }
  });

  await ecrireEvenementContact(ctx, 'contact.marked_do_not_contact', contactId, 'Contact marqué « ne plus contacter » par l’opérateur.');
}

// ---------------------------------------------------------------------------
// chercherEmail
// ---------------------------------------------------------------------------

export const schemaChercherEmail = z.object({ contactId: z.string().uuid() });

interface LignePersona {
  id: string;
  name: string;
  title_patterns: string[] | null;
}

/**
 * Reprend le corps d'`enrichirMaintenant` (`apps/web/app/actions/enrichir.ts`,
 * tâche 8) : même file d'enrichissement d'entreprise (`enfiler_enrichissement`,
 * déterministe par compte+persona — redemander ne double pas la dépense),
 * mêmes garde-fous (entreprise déjà enrichie, job déjà en file). Deux
 * différences : l'entrée est un `contactId` (pas un `signalId` : un contact de
 * la fiche peut ne pas en avoir), et le plafond passe par
 * `lireConsommationDuJour` (spec de cette tâche) plutôt que par le RPC
 * `consume_provider_credit` — réservé à `service_role` (grants de la
 * migration `provider_daily_usage`), que la connexion directe de
 * `packages/core` n'emprunte jamais ; la décrémentation reproduit ici la même
 * garde atomique (upsert du jour, puis update conditionné par le plafond).
 */
export async function chercherEmail(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { contactId } = valider(schemaChercherEmail, entree);

  const contactRes = await ctx.ex.query<{ id: string; account_id: string | null; persona_id: string | null; source_signal_id: string | null }>(
    `select id, account_id, persona_id, source_signal_id from contacts /* jr:chercher_email_contact */ where id = $1 and organization_id = $2`,
    [contactId, ctx.organisationId],
  );
  const contact = contactRes.rows[0];
  if (!contact) throw new ErreurIntrouvable('Contact');
  if (!contact.account_id) {
    throw new ErreurEnrichissementImpossible('Ce contact n’est rattaché à aucune entreprise : rien à enrichir.');
  }

  const accountRes = await ctx.ex.query<{ id: string; name: string; domain: string | null; country: string | null; enriched_at: string | null }>(
    `select id, name, domain, country, enriched_at from accounts /* jr:chercher_email_compte */ where id = $1 and organization_id = $2`,
    [contact.account_id, ctx.organisationId],
  );
  const compte = accountRes.rows[0];
  if (!compte) throw new ErreurIntrouvable('Entreprise');
  if (compte.enriched_at) {
    throw new ErreurEnrichissementImpossible(`${compte.name} a déjà été enrichie. Ses contacts sont dans Contacts.`);
  }

  let persona: LignePersona | undefined;
  if (contact.persona_id) {
    const r = await ctx.ex.query<LignePersona>(
      `select id, name, title_patterns from personas /* jr:chercher_email_persona_contact */
        where id = $1 and organization_id = $2 and coalesce(array_length(title_patterns, 1), 0) > 0`,
      [contact.persona_id, ctx.organisationId],
    );
    persona = r.rows[0];
  }
  if (!persona) {
    const r = await ctx.ex.query<LignePersona>(
      `select id, name, title_patterns from personas /* jr:chercher_email_persona_active */
        where organization_id = $1 and is_active and coalesce(array_length(title_patterns, 1), 0) > 0
        order by name asc
        limit 1`,
      [ctx.organisationId],
    );
    persona = r.rows[0];
  }
  if (!persona) {
    throw new ErreurEnrichissementImpossible('Aucune persona active avec des intitulés de poste. Renseignez-en une d’abord.');
  }

  const dejaRes = await ctx.ex.query<{ deja: boolean }>(
    `select enrichissement_deja_en_file($1, $2) as deja /* jr:chercher_email_deja_en_file */`,
    [compte.id, persona.id],
  );
  if (dejaRes.rows[0]?.deja === true) {
    throw new ErreurEnrichissementImpossible(`${compte.name} est déjà en file d’enrichissement. Ses contacts arriveront dans Contacts.`);
  }

  // #118 (tour de correction 5) : la même journée que le worker (`app.consume_provider_credit`,
  // appelé avec le jour de l'organisation) et l'écran (`lireConsommationDuJour`) — sinon ce
  // décompte manuel écrirait sur une ligne `usage_date` différente de celle que les deux autres
  // lisent, désynchronisant le plafond entre minuit UTC et minuit heure de l'organisation.
  const reglages = await lireReglages(ctx);
  const jour = jourCourantDansFuseau(String(reglages.fuseau));
  const plafonds = await lireConsommationDuJour(ctx, reglages);
  const plafond = plafonds.enrichissement.plafond;
  if (plafond <= 0) {
    throw new ErreurEnrichissementImpossible('L’enrichissement est en pause (plafond à 0). Relevez-le dans Fournisseurs pour enrichir.');
  }
  if (plafonds.enrichissement.utilise >= plafond) {
    throw new ErreurEnrichissementImpossible(`Plafond du jour atteint (${plafond} par jour). Relevez-le dans Fournisseurs, ou réessayez demain.`);
  }

  // Décompte atomique du crédit (le plafond a pu être atteint entre-temps par
  // un autre appel) : même garde que `app.consume_provider_credit` — upsert du
  // compteur du jour, puis update conditionné par le plafond, en SQL direct.
  await ctx.ex.query(
    `insert into provider_daily_usage (organization_id, provider_id, usage_date, used, daily_cap) /* jr:chercher_email_credit_upsert */
       values ($1, 'fullenrich', $3::date, 0, $2)
     on conflict (organization_id, provider_id, usage_date) do update set daily_cap = excluded.daily_cap`,
    [ctx.organisationId, plafond, jour],
  );
  const majRes = await ctx.ex.query<{ used: number }>(
    `update provider_daily_usage /* jr:chercher_email_credit_maj */
        set used = used + 1, updated_at = now()
      where organization_id = $1 and provider_id = 'fullenrich' and usage_date = $2::date
        and used + 1 <= daily_cap
      returning used`,
    [ctx.organisationId, jour],
  );
  if (majRes.rowCount === 0) {
    throw new ErreurEnrichissementImpossible(`Plafond du jour atteint (${plafond} par jour). Relevez-le dans Fournisseurs, ou réessayez demain.`);
  }

  await ctx.ex.query(
    `select enfiler_enrichissement($1, $2, $3, $4, $5, $6, $7, $8) /* jr:chercher_email_enfiler */`,
    [ctx.organisationId, compte.id, compte.name, compte.domain, compte.country, persona.id, persona.title_patterns, contact.source_signal_id],
  );
}

// ---------------------------------------------------------------------------
// Contacts globale (spec §6.11, tâche 18) : `listerContacts` (onglet « Tous
// les contacts »), `listerEntreprises` (onglet « Entreprises »),
// `listerClientsEtExclusions` + `ajouterSuppression`/`ajouterAListe` (onglet
// « Clients et exclusions »), `exporterCsv` (bouton Export des deux
// premiers). Même socle « une fonction, deux façades » que `campagnes.ts`.
// ---------------------------------------------------------------------------

/** Même convention que `campagnes.ts` (copie locale volontaire d'un petit utilitaire, voir son commentaire « Petits utilitaires partagés »). */
function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

/** Copie locale de `motifRecherche` (`campagnes.ts`) — même raison : pas de couplage cross-fichier pour un utilitaire d'une ligne. */
function motifRecherche(recherche: string | undefined): string | null {
  if (!recherche) return null;
  return `%${recherche.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Même ligne que `ContactCampagne` (`campagnes.ts`, tâche 10) plus la campagne d'origine — toujours renseignée ici (contrairement à `LigneTableContacts.campagneId?`, optionnel côté web), une ligne globale vient toujours d'exactement une campagne. */
export interface ContactGlobal extends ContactCampagne {
  readonly campagneId: string;
  readonly campagneNom: string;
}

export const schemaListerContactsGlobal = z.object({
  filtre: z
    .enum(['tous', 'a_contacter', 'sans_email', 'en_pause', 'en_sequence', 'a_repondu', 'interesse', 'ecarte', 'termine', 'rebond', 'ne_plus_contacter'])
    .default('tous'),
  campagneId: z.string().uuid().optional(),
  source: z.enum(['adzuna', 'francetravail', 'linkedin', 'manuel']).optional(),
  email: z.enum(['verifie', 'a_trouver']).optional(),
  recherche: z.string().max(80).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});

const TAILLE_PAGE_CONTACTS_GLOBAL = 50;

/**
 * Plafond mémoire du calcul global (`listerContacts` ET `exporterCsv`, qui
 * partagent `collecterContactsGlobaux` — et `listerClientsEtExclusions`, même
 * plafond réutilisé tel quel, tour de correction 1) : au-delà, l'opérateur
 * doit filtrer (campagne, recherche…) plutôt que de tout charger en mémoire
 * d'un coup. Même valeur que le plafond de lignes de l'export CSV (spec §6.11).
 */
const LIMITE_CONTACTS_GLOBAL = 5000;

/** Un de plus que `LIMITE_CONTACTS_GLOBAL` : collecter jusque-là (pas jusqu'au plafond pile) permet de distinguer « il y en a exactement 5000 » (rien de coupé) de « il y en a plus » (`tronque`), sans requête `count(*)` supplémentaire par campagne. */
const LIMITE_COLLECTE_GLOBALE = LIMITE_CONTACTS_GLOBAL + 1;

interface LigneContactGlobalBrut {
  signal_id: string | null;
  contact_id: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  email: string | null;
  entreprise: string | null;
  current_step: number | null;
  statut: StatutContactCampagne;
  score: number | null;
  pourquoi: string | null;
  provider_id: string | null;
  /** `coalesce(s.occurred_at, e.started_at)`, `timestamptz` : `pg` le renvoie en objet `Date`, pas une chaîne. */
  quand: string | Date | null;
  enrollment_id: string | null;
  e_status: string | null;
  stop_reason: string | null;
  resume_at: string | null;
  next_action_at: string | null;
}

/** Campagnes ciblées par `listerContacts`/`exporterCsv` : une seule (filtre `campagneId`) ou toutes celles de l'organisation. */
async function campagnesCiblees(ctx: Contexte, campagneId: string | undefined): Promise<{ id: string; nom: string }[]> {
  if (campagneId) {
    const r = await ctx.ex.query<{ id: string; nom: string }>(
      `select id, name as nom from campaigns /* jr:contacts_globale_campagne_unique */ where id = $1 and organization_id = $2`,
      [campagneId, ctx.organisationId],
    );
    return r.rows;
  }
  const r = await ctx.ex.query<{ id: string; nom: string }>(
    `select id, name as nom from campaigns /* jr:contacts_globale_campagnes */ where organization_id = $1 order by name asc`,
    [ctx.organisationId],
  );
  return r.rows;
}

type FiltresContactsGlobal = Omit<z.infer<typeof schemaListerContactsGlobal>, 'page'>;

/**
 * Population « toutes campagnes » : rejoue `CASE_STATUT_DERIVE`/
 * `FROM_POPULATION_CAMPAGNE` (exportés par `campagnes.ts`, tâche 10) UNE FOIS
 * PAR CAMPAGNE de l'organisation (`$1` = son id, exactement comme
 * `listerContactsCampagne`), puis fusionne et trie en mémoire — plutôt que de
 * généraliser ces requêtes à un `$1` = organisation : `FROM_POPULATION_CAMPAGNE`
 * suppose une seule campagne (la lecture d'inscription en LATERAL la
 * présuppose), la réécrire aurait dupliqué sa logique de statut au lieu de la
 * réutiliser telle quelle. Coût : une requête de lignes + une de comptage
 * d'étapes par campagne — acceptable à l'échelle d'une organisation
 * autohébergée (quelques campagnes), plafonné par `LIMITE_CONTACTS_GLOBAL`.
 */
export interface ResultatContactsGlobaux {
  readonly lignes: ContactGlobal[];
  /** `true` quand la collecte a atteint `LIMITE_CONTACTS_GLOBAL` (5 000) — davantage de contacts existent que ceux renvoyés. */
  readonly tronque: boolean;
}

async function collecterContactsGlobaux(ctx: Contexte, filtres: FiltresContactsGlobal): Promise<ResultatContactsGlobaux> {
  const { filtre, campagneId, source, email, recherche } = filtres;
  const campagnes = await campagnesCiblees(ctx, campagneId);
  if (campagnes.length === 0) return { lignes: [], tronque: false };

  const motif = motifRecherche(recherche);
  const toutes: (ContactGlobal & { quand: string | Date | null })[] = [];

  for (const campagne of campagnes) {
    if (toutes.length >= LIMITE_COLLECTE_GLOBALE) break;

    const res = await ctx.ex.query<LigneContactGlobalBrut>(
      `select signal_id, contact_id, first_name, last_name, job_title, email, entreprise, current_step, statut, score, pourquoi, provider_id, quand,
              enrollment_id, e_status, stop_reason, resume_at, next_action_at
         from (
           select
             s.id as signal_id,
             c.id as contact_id,
             c.first_name, c.last_name, c.job_title, c.email,
             coalesce(ac.name, s.company_hint) as entreprise,
             e.current_step,
             s.score,
             s.title as pourquoi,
             s.provider_id,
             coalesce(s.occurred_at, e.started_at) as quand,
             e.enrollment_id, e.status as e_status, e.stop_reason, e.resume_at, e.next_action_at,
             ${CASE_STATUT_DERIVE} as statut
           ${FROM_POPULATION_CAMPAGNE}
         ) x /* jr:lignes_contacts_globale */
        where ($2 = 'tous' or statut = $2)
          and ($3::text is null or first_name ilike $3 or last_name ilike $3 or entreprise ilike $3)
          and ($4::text is null or provider_id = $4 or ($4 = 'manuel' and signal_id is null))
          and ($5::text is null or ($5 = 'verifie' and email is not null) or ($5 = 'a_trouver' and email is null))
        order by quand desc nulls last, contact_id desc`,
      [campagne.id, filtre, motif, source ?? null, email ?? null],
    );
    if (res.rows.length === 0) continue;

    const totalEtapesRes = await ctx.ex.query<{ n: number }>(
      `select count(*)::int as n from sequence_steps /* jr:total_etapes_campagne */ where campaign_id = $1`,
      [campagne.id],
    );
    const totalEtapes = totalEtapesRes.rows[0]?.n ?? 0;

    for (const r of res.rows) {
      toutes.push({
        signalId: r.signal_id,
        contactId: r.contact_id,
        nom: nomComplet(r.first_name, r.last_name),
        poste: r.job_title,
        entreprise: r.entreprise,
        email: r.email,
        statut: r.statut,
        etape: etapeAffichee(r.current_step, totalEtapes),
        score: r.score,
        pourquoi: r.pourquoi,
        inscriptionId: r.enrollment_id,
        motifPause: r.statut === 'en_pause' ? motifPauseDe(r.e_status, r.stop_reason) : null,
        repriseLe: r.statut === 'en_pause' ? r.resume_at : null,
        prochainMessageLe: r.statut === 'en_sequence' ? r.next_action_at : null,
        // Onglet Contacts GLOBAL (mélange campagnes à sources et à liste, point 2) : la
        // colonne d'intitulé de poste d'une liste n'a de sens que sur la page d'UNE
        // campagne (`listerContactsCampagne`), jamais ici.
        intitulePosteListe: null,
        campagneId: campagne.id,
        campagneNom: campagne.nom,
        quand: r.quand,
      });
      if (toutes.length >= LIMITE_COLLECTE_GLOBALE) break;
    }
  }

  // `quand` (`timestamptz`, cf. `LigneContactGlobalBrut`) : `comparerInstantsDesc`
  // accepte chaîne ou `Date`. Départage par `contactId` (desc), même critère que
  // le `order by quand desc nulls last, contact_id desc` de chaque requête par
  // campagne — nécessaire ici car cette fusion mélange plusieurs campagnes.
  toutes.sort((a, b) => comparerInstantsDesc(a.quand, b.quand) || (b.contactId ?? '').localeCompare(a.contactId ?? ''));
  const tronque = toutes.length > LIMITE_CONTACTS_GLOBAL;
  const bornees = tronque ? toutes.slice(0, LIMITE_CONTACTS_GLOBAL) : toutes;
  return { lignes: bornees.map(({ quand: _quand, ...reste }) => reste), tronque };
}

export async function listerContacts(
  ctx: Contexte,
  entree: unknown,
): Promise<{ total: number; lignes: ContactGlobal[]; tronque: boolean }> {
  exiger(ctx, 'viewer');
  const { page, ...filtres } = valider(schemaListerContactsGlobal, entree);

  const { lignes: toutes, tronque } = await collecterContactsGlobaux(ctx, filtres);
  const debut = (page - 1) * TAILLE_PAGE_CONTACTS_GLOBAL;
  return { total: toutes.length, lignes: toutes.slice(debut, debut + TAILLE_PAGE_CONTACTS_GLOBAL), tronque };
}

// ---------------------------------------------------------------------------
// listerEntreprises
// ---------------------------------------------------------------------------

const TAILLE_PAGE_ENTREPRISES = 50;

export const schemaListerEntreprises = z.object({
  recherche: z.string().max(80).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
});

export interface EntrepriseLigne {
  readonly id: string;
  readonly nom: string;
  /**
   * `accounts.naf_code` brut — aucune table de correspondance NAF → libellé
   * sectoriel n'existe dans ce dépôt (vérifié : ni migration ni fixture).
   * Afficher un secteur inventé (ex. « Logiciel ») violerait la règle « ne
   * jamais afficher un chiffre/une donnée que Jay Reach ne mesure pas
   * réellement » — le code brut, ou `null`, plutôt qu'une traduction fictive.
   */
  readonly secteur: string | null;
  readonly effectif: number | null;
  readonly ville: string | null;
  readonly domaine: string | null;
  readonly linkedinUrl: string | null;
  readonly contactsConnus: number;
}

export async function listerEntreprises(
  ctx: Contexte,
  entree: unknown,
): Promise<{ total: number; lignes: EntrepriseLigne[] }> {
  exiger(ctx, 'viewer');
  const { recherche, page } = valider(schemaListerEntreprises, entree);
  const motif = motifRecherche(recherche);

  const totalRes = await ctx.ex.query<{ n: number }>(
    `select count(*)::int as n from accounts /* jr:total_entreprises */
      where organization_id = $1 and ($2::text is null or name ilike $2)`,
    [ctx.organisationId, motif],
  );
  const total = totalRes.rows[0]?.n ?? 0;

  const res = await ctx.ex.query<{
    id: string;
    name: string;
    naf_code: string | null;
    headcount: number | null;
    city: string | null;
    domain: string | null;
    linkedin_url: string | null;
    contacts_connus: number;
  }>(
    `select a.id, a.name, a.naf_code, a.headcount, a.city, a.domain, a.linkedin_url,
            (select count(*)::int from contacts c where c.account_id = a.id) as contacts_connus
       from accounts a /* jr:lignes_entreprises */
      where a.organization_id = $1 and ($2::text is null or a.name ilike $2)
      order by a.name asc
      limit $3 offset $4`,
    [ctx.organisationId, motif, TAILLE_PAGE_ENTREPRISES, (page - 1) * TAILLE_PAGE_ENTREPRISES],
  );

  return {
    total,
    lignes: res.rows.map((r) => ({
      id: r.id,
      nom: r.name,
      secteur: r.naf_code,
      effectif: r.headcount,
      ville: r.city,
      domaine: r.domain,
      linkedinUrl: r.linkedin_url,
      contactsConnus: r.contacts_connus,
    })),
  };
}

// ---------------------------------------------------------------------------
// listerClientsEtExclusions, ajouterSuppression, ajouterAListe
// ---------------------------------------------------------------------------

export type TypeClientExclusion = 'client' | 'email' | 'domaine' | 'linkedin';

export interface LigneClientExclusion {
  readonly id: string;
  readonly type: TypeClientExclusion;
  readonly valeur: string;
  readonly raison: string | null;
  readonly quand: string;
}

/** `suppressions.scope` → libellé de type de la table fusionnée — `account`/`postal` n'y figurent pas (spec §6.11 : email, domaine, LinkedIn seulement ; `account` est le miroir des clients importés, déjà couvert par la branche `customer_list_entries`). */
const TYPE_DEPUIS_SCOPE: Partial<Record<string, TypeClientExclusion>> = {
  email: 'email',
  domain: 'domaine',
  linkedin: 'linkedin',
};

export interface ResultatClientsEtExclusions {
  readonly lignes: LigneClientExclusion[];
  /** `true` quand `customer_list_entries` OU `suppressions` (email/domaine/linkedin) dépasse `LIMITE_CONTACTS_GLOBAL` (5 000) pour l'organisation — même plafond que `listerContacts` (tour de correction 1, Important 2 de la relecture). */
  readonly tronque: boolean;
}

export async function listerClientsEtExclusions(ctx: Contexte, entree: unknown): Promise<ResultatClientsEtExclusions> {
  exiger(ctx, 'viewer');
  valider(z.object({}), entree);

  const [totalClientsRes, totalExclusionsRes, clientsRes, exclusionsRes] = await Promise.all([
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n from customer_list_entries /* jr:total_clients_entreprises */ where organization_id = $1`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n from suppressions /* jr:total_exclusions */
        where organization_id = $1 and scope in ('email', 'domain', 'linkedin')`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ id: string; domain: string | null; raw_name: string | null; siren: string | null; created_at: string }>(
      `select id, domain, raw_name, siren, created_at
         from customer_list_entries /* jr:clients_entreprises */
        where organization_id = $1
        order by created_at desc
        limit $2`,
      [ctx.organisationId, LIMITE_CONTACTS_GLOBAL],
    ),
    ctx.ex.query<{ id: string; scope: string; value: string; reason: string | null; created_at: string }>(
      `select id, scope, value, reason, created_at
         from suppressions /* jr:exclusions */
        where organization_id = $1 and scope in ('email', 'domain', 'linkedin')
        order by created_at desc
        limit $2`,
      [ctx.organisationId, LIMITE_CONTACTS_GLOBAL],
    ),
  ]);

  const totalClients = totalClientsRes.rows[0]?.n ?? 0;
  const totalExclusions = totalExclusionsRes.rows[0]?.n ?? 0;
  const tronque = totalClients > LIMITE_CONTACTS_GLOBAL || totalExclusions > LIMITE_CONTACTS_GLOBAL;

  const clients: LigneClientExclusion[] = clientsRes.rows.map((r) => ({
    id: r.id,
    type: 'client',
    valeur: r.domain ?? r.raw_name ?? r.siren ?? '—',
    raison: null,
    quand: r.created_at,
  }));

  const exclusions: LigneClientExclusion[] = exclusionsRes.rows.flatMap((r) => {
    const type = TYPE_DEPUIS_SCOPE[r.scope];
    return type ? [{ id: r.id, type, valeur: r.value, raison: r.reason, quand: r.created_at }] : [];
  });

  return { lignes: [...clients, ...exclusions], tronque };
}

export const schemaAjouterSuppression = z.object({
  scope: z.enum(['email', 'domain', 'linkedin']),
  value: z.string().trim().min(1).max(320),
  reason: z.string().trim().max(500).optional(),
});

/**
 * Ajoute une suppression manuelle (encart « Ne plus contacter » de l'onglet
 * Clients et exclusions). Rôle operator — même niveau que l'écriture de
 * `suppressions` dans `nePlusContacter` et que la policy RLS de la table
 * (`supabase/migrations/20260817120100_rls.sql`, `suppressions` écrite en
 * operator+). Casse ignorée pour email/domaine (comparaison déjà `lower()`
 * dans `CASE_STATUT_DERIVE`) ; conservée pour un identifiant LinkedIn (une
 * URL est sensible à la casse sur son chemin).
 */
export async function ajouterSuppression(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { scope, value, reason } = valider(schemaAjouterSuppression, entree);
  const valeur = scope === 'linkedin' ? value : value.toLowerCase();

  await ctx.ex.query(
    `insert into suppressions (organization_id, scope, value, reason, origin) /* jr:contacts_ajouter_suppression */
     select $1, $2, $3, $4, 'manual'
     where not exists (
       select 1 from suppressions where organization_id = $1 and scope = $2 and value = $3
     )`,
    [ctx.organisationId, scope, valeur, reason ?? null],
  );
}

export const schemaAjouterAListe = z.object({
  domaine: z.string().trim().min(1).max(253),
});

const NOM_LISTE_MANUELLE = 'Ajouts manuels';

/** Domaine à partir d'une saisie libre (« Ajouter un domaine » — pas « ou email » : voir le doc d'`ajouterAListe`, seul le domaine sert au rapprochement). Une adresse email collée garde son domaine ; un protocole/`www.`/chemin sont retirés — même esprit que `normDomain` (`apps/web/app/actions/customers.ts`, import CSV existant), copié ici plutôt qu'importé depuis `apps/web` (packages/core ne dépend jamais de `apps/web`). */
function normaliserDomaine(saisie: string): string {
  let s = saisie.trim().toLowerCase();
  const arobase = s.indexOf('@');
  if (arobase !== -1) s = s.slice(arobase + 1);
  return s
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

/**
 * Ajoute un domaine à la liste clients (encart « Clients Jay »| onglet
 * Clients et exclusions) : une ligne `customer_list_entries` dans une liste
 * manuelle unique par organisation (créée au premier ajout), puis les
 * comptes déjà connus sur ce domaine sont marqués clients — le trigger
 * `enforce_customer_exclusion` (migration `20260817120500_customer_exclusion.sql`)
 * pose alors la suppression de portée compte. Transactionnel (même motif que
 * `nePlusContacter`) : la ligne, le compteur de la liste et le marquage des
 * comptes avancent ensemble.
 *
 * Rôle ADMIN — ÉCART assumé avec le plan de tâche (qui indique « operator »
 * pour `ajouterAListe`) : la policy RLS d'écriture de `customer_lists` ET de
 * `customer_list_entries` exige admin+ (`supabase/migrations/20260817120100_rls.sql`
 * l. 94-96 ; `20260817120500_customer_exclusion.sql`, policies `customer_list_entries_write`).
 * `ctx.ex` porte la session RÉELLE de l'utilisateur (pas `service_role` — voir
 * le commentaire de `chercherEmail` ci-dessus) : un appel en operator serait
 * rejeté par PostgreSQL, quoi que dise l'application. Le rôle DB fait foi.
 */
export async function ajouterAListe(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'admin');
  const { domaine: saisie } = valider(schemaAjouterAListe, entree);
  const domaine = normaliserDomaine(saisie);
  if (!domaine) throw new ErreurEntree({ formErrors: ['Domaine vide.'] });

  return dansUneTransaction(ctx.ex, async (tx) => {
    const existante = await tx.query<{ id: string }>(
      `select id from customer_lists /* jr:contacts_liste_manuelle_existante */
        where organization_id = $1 and name = $2
        order by created_at asc limit 1`,
      [ctx.organisationId, NOM_LISTE_MANUELLE],
    );
    let listeId = existante.rows[0]?.id;
    if (!listeId) {
      const creee = await tx.query<{ id: string }>(
        `insert into customer_lists (organization_id, name, source) /* jr:contacts_liste_manuelle_creer */
         values ($1, $2, 'csv') returning id`,
        [ctx.organisationId, NOM_LISTE_MANUELLE],
      );
      listeId = creee.rows[0]!.id;
    }

    const inseree = await tx.query<{ id: string }>(
      `insert into customer_list_entries (customer_list_id, organization_id, domain) /* jr:contacts_liste_manuelle_ajouter */
       values ($1, $2, $3) returning id`,
      [listeId, ctx.organisationId, domaine],
    );

    await tx.query(
      `update customer_lists set entries_count = entries_count + 1 /* jr:contacts_liste_manuelle_compteur */ where id = $1`,
      [listeId],
    );

    await tx.query(
      `update accounts set is_customer = true /* jr:contacts_liste_manuelle_marquer_comptes */
        where organization_id = $1 and domain = $2 and is_customer is distinct from true`,
      [ctx.organisationId, domaine],
    );

    return { id: inseree.rows[0]!.id };
  });
}

// ---------------------------------------------------------------------------
// exporterCsv
// ---------------------------------------------------------------------------

export const schemaExporterCsv = schemaListerContactsGlobal.omit({ page: true });

const ENTETES_CSV = ['Nom', 'Poste', 'Entreprise', 'Email', 'État', 'Étape', 'Campagne', 'Score', 'Pourquoi lui'];

/** Libellés français bruts (pas de `t()` : `packages/core` ne dépend pas de next-intl — même parti pris que les messages d'erreur métier de ce fichier, ex. `ErreurEnrichissementImpossible`). Mêmes mots que `fr.json` (`campagne.contacts.status.*`). */
const LIBELLES_STATUT_CSV: Record<StatutContactCampagne, string> = {
  a_contacter: 'À contacter',
  sans_email: 'Sans email',
  en_pause: 'En pause',
  en_sequence: 'En séquence',
  a_repondu: 'A répondu',
  interesse: 'Intéressé',
  ecarte: 'Écarté',
  termine: 'Terminé',
  rebond: 'Rebond',
  ne_plus_contacter: 'Ne plus contacter',
};

/** Un champ CSV entre guillemets, guillemets internes doublés (RFC 4180) — toujours entre guillemets, pas seulement quand un `;` ou un `"` est présent : plus simple à vérifier, jamais faux. */
function champCsv(valeur: string | number | null): string {
  const brut = valeur === null || valeur === undefined ? '' : String(valeur);
  return `"${brut.replace(/"/g, '""')}"`;
}

function ligneCsv(champs: (string | number | null)[]): string {
  return champs.map(champCsv).join(';');
}

/**
 * Export CSV de l'onglet « Tous les contacts » (spec §6.11) : mêmes filtres
 * que `listerContacts` (sans pagination), plafonné par
 * `collecterContactsGlobaux` à `LIMITE_CONTACTS_GLOBAL` (5 000) lignes.
 * UTF-8 avec BOM (Excel ouvre proprement les caractères accentués),
 * séparateur `;` (convention française), fin de ligne CRLF (RFC 4180).
 */
export async function exporterCsv(ctx: Contexte, entree: unknown): Promise<string> {
  exiger(ctx, 'viewer');
  const filtres = valider(schemaExporterCsv, entree);
  const { lignes } = await collecterContactsGlobaux(ctx, filtres);

  const corps = lignes.map((l) =>
    ligneCsv([
      l.nom,
      l.poste,
      l.entreprise,
      l.email,
      LIBELLES_STATUT_CSV[l.statut],
      l.etape,
      l.campagneNom,
      l.score,
      l.pourquoi,
    ]),
  );

  return '\uFEFF' + [ligneCsv(ENTETES_CSV), ...corps].join('\r\n');
}

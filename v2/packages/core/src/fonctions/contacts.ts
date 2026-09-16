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
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { ecrireEvenement, type ActionJournal } from '../journal.js';
import { dansUneTransaction } from '../transaction.js';
import { LIVE_STATUSES } from '../inbox/record-reply.js';
import { lireConsommationDuJour } from './plafonds.js';
import {
  CASE_STATUT_DERIVE,
  FROM_POPULATION_CAMPAGNE,
  marqueBoite,
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

export interface FicheSequence {
  readonly etapes: FicheEtape[];
  /** Boîte du dernier envoi connu de cette inscription — `null` si rien n'est encore parti. */
  readonly boite: FicheBoite | null;
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

  if (campagneId) {
    const res = await ctx.ex.query<{
      statut: StatutContactCampagne;
      enrollment_id: string | null;
      current_step: number | null;
      e_status: string | null;
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
    const etapesRes = await ctx.ex.query<{ position: number }>(
      `select position from sequence_steps /* jr:fiche_etapes */ where campaign_id = $1 order by position asc`,
      [campagneId],
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
    };
  }

  // Échanges : tous les fils du contact (email, LinkedIn…), messages fusionnés par date.
  const filsRes = await ctx.ex.query<{ id: string; last_message_at: string | null }>(
    `select id, last_message_at from threads /* jr:fiche_fils */ where contact_id = $1 and organization_id = $2`,
    [contactId, ctx.organisationId],
  );
  const fils = filsRes.rows;
  const filId =
    fils.length > 0
      ? [...fils].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''))[0]!.id
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

  const plafonds = await lireConsommationDuJour(ctx);
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
       values ($1, 'fullenrich', current_date, 0, $2)
     on conflict (organization_id, provider_id, usage_date) do update set daily_cap = excluded.daily_cap`,
    [ctx.organisationId, plafond],
  );
  const majRes = await ctx.ex.query<{ used: number }>(
    `update provider_daily_usage /* jr:chercher_email_credit_maj */
        set used = used + 1, updated_at = now()
      where organization_id = $1 and provider_id = 'fullenrich' and usage_date = current_date
        and used + 1 <= daily_cap
      returning used`,
    [ctx.organisationId],
  );
  if (majRes.rowCount === 0) {
    throw new ErreurEnrichissementImpossible(`Plafond du jour atteint (${plafond} par jour). Relevez-le dans Fournisseurs, ou réessayez demain.`);
  }

  await ctx.ex.query(
    `select enfiler_enrichissement($1, $2, $3, $4, $5, $6, $7, $8) /* jr:chercher_email_enfiler */`,
    [ctx.organisationId, compte.id, compte.name, compte.domain, compte.country, persona.id, persona.title_patterns, contact.source_signal_id],
  );
}

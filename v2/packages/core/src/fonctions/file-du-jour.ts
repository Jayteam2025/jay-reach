/**
 * Actions d'opérateur sur un envoi précis de la file du jour (tâche 10, lot 2)
 * : reporter, écarter un contact d'une campagne, approuver/rejeter un envoi
 * en attente d'approbation, et relire l'email tel qu'il partira. Même socle
 * que `campagnes.ts` (spec « une fonction, deux façades ») : rôle `operator`
 * pour toute écriture, `viewer` pour la lecture, journal en `try/catch`
 * (un journal qui échoue ne doit jamais faire échouer l'action elle-même).
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { ErreurConflit } from './campagnes.js';
import { ecrireEvenement } from '../journal.js';
import { shiftIntoBusinessHours, type BusinessHours } from '../sequencer/scheduling.js';
import { renderTemplate, lireValeursContact } from '../messages/index.js';
import type { EtatEnvoi } from './aujourdhui.js';

export const schemaActionId = z.object({ actionId: z.string().uuid() });

// ---------------------------------------------------------------------------
// Petits utilitaires locaux (copies volontairement isolées de leurs
// équivalents dans `apps/worker/src/handlers/sequence.ts`, qui reste hors de
// portée de `packages/core` — ce paquet ne dépend pas de `pg`/du worker).
// ---------------------------------------------------------------------------

/** Heures ouvrées d'un expéditeur (`senders.business_hours`), ou le défaut de la spec (9-18, lun-ven). */
function heuresOuvreesDe(brut: unknown): BusinessHours {
  const h = brut as { startHour?: unknown; endHour?: unknown; days?: unknown } | null;
  const start = typeof h?.startHour === 'number' ? h.startHour : 9;
  const end = typeof h?.endHour === 'number' ? h.endHour : 18;
  const days =
    Array.isArray(h?.days) && h.days.length > 0
      ? (h.days as unknown[]).map(Number).filter((d) => d >= 1 && d <= 7)
      : [1, 2, 3, 4, 5];
  return { startHour: start, endHour: end, days };
}

/** Décalage du fuseau d'un expéditeur, en minutes, à l'instant considéré (change avec l'heure d'été). */
function decalageFuseauMinutes(timezone: string | null, instant: Date): number {
  if (!timezone) return 0;
  try {
    const local = new Date(instant.toLocaleString('en-US', { timeZone: timezone }));
    const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
    return Math.round((local.getTime() - utc.getTime()) / 60000);
  } catch {
    return 0;
  }
}

async function ecrireEvenementEnvoi(
  ctx: Contexte,
  action: 'action_rescheduled' | 'action_skipped' | 'action_approved' | 'action_rejected' | 'action_retried',
  contactId: string | null,
  libelle: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'contact',
      entityId: contactId,
      action,
      diff: { libelle, ...detail },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn(`[journal] ${action}`, err);
  }
}

// ---------------------------------------------------------------------------
// reporterEnvoi
// ---------------------------------------------------------------------------

interface LigneEnvoiAReporter {
  id: string;
  scheduled_for: string | null;
  dispatch_after: string | null;
  sender_id: string | null;
  contact_id: string | null;
}

/**
 * Reporte un envoi programmé d'un jour, recalé dans la prochaine fenêtre
 * d'envoi de son expéditeur (heures ouvrées + fuseau, `sequencer/scheduling.ts`).
 * `dispatch_after` conserve son écart avec `scheduled_for` (le lead time du
 * canal, posé au tick — `LEAD_TIME_HEURES`, `sequence.ts`).
 */
export async function reporterEnvoi(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<LigneEnvoiAReporter>(
    `select a.id, a.scheduled_for, a.dispatch_after, a.sender_id, e.contact_id
       from actions a /* jr:reporter_lire */
       join enrollments e on e.id = a.enrollment_id
      where a.id = $1 and a.organization_id = $2 and a.status in ('scheduled', 'pending_approval')`,
    [actionId, ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Envoi');

  let sender: { timezone: string | null; business_hours: unknown } | undefined;
  if (ligne.sender_id) {
    const senderRes = await ctx.ex.query<{ timezone: string | null; business_hours: unknown }>(
      `select timezone, business_hours from senders /* jr:reporter_expediteur */ where id = $1`,
      [ligne.sender_id],
    );
    sender = senderRes.rows[0];
  }

  const maintenant = new Date();
  const base = new Date(ligne.scheduled_for ?? ligne.dispatch_after ?? maintenant.toISOString());
  const plusUnJour = base.getTime() + 24 * 3600_000;
  const decale = shiftIntoBusinessHours(
    plusUnJour,
    heuresOuvreesDe(sender?.business_hours),
    decalageFuseauMinutes(sender?.timezone ?? null, maintenant),
  );

  // `dispatch_after` recule (ou avance) du même écart que `scheduled_for` par
  // rapport à sa valeur d'origine — le lead time du canal (`applyLeadTime`,
  // `scheduling.ts`) ne doit pas changer de sens à cause d'un report.
  const ecartMs =
    ligne.dispatch_after && ligne.scheduled_for
      ? new Date(ligne.dispatch_after).getTime() - new Date(ligne.scheduled_for).getTime()
      : 0;

  // Filtre d'organisation ET de statut repris ici (pas seulement à la lecture,
  // `jr:reporter_lire`) : sans lui, un `id` deviné d'une autre organisation, ou
  // une action qui aurait changé d'état entre la lecture et l'écriture, serait
  // modifiée quand même (tour de correction 1, A1).
  const ecriture = await ctx.ex.query(
    `update actions /* jr:reporter_ecrire */
        set scheduled_for = $2, dispatch_after = $3
      where id = $1 and organization_id = $4 and status in ('scheduled', 'pending_approval')`,
    [actionId, new Date(decale).toISOString(), new Date(decale + ecartMs).toISOString(), ctx.organisationId],
  );
  if (ecriture.rowCount === 0) throw new ErreurIntrouvable('Envoi');

  await ecrireEvenementEnvoi(ctx, 'action_rescheduled', ligne.contact_id, 'Envoi reporté d’un jour par l’opérateur.');
}

// ---------------------------------------------------------------------------
// ecarterDuneCampagne
// ---------------------------------------------------------------------------

export const schemaEcarterDuneCampagne = z.object({
  contactId: z.string().uuid(),
  campagneId: z.string().uuid(),
});

/**
 * Écarte un contact d'une campagne : marque « discarded » le signal d'origine
 * qui le rattache à cette campagne (cas d'un contact jamais encore inscrit —
 * `a_contacter`/`sans_email`), arrête toute inscription active/en pause
 * (`stopped`) et annule les envois pas encore partis (`scheduled`/
 * `pending_approval` → `skipped`). Idempotent : rejouable sans effet de bord
 * si le contact est déjà écarté.
 */
export async function ecarterDuneCampagne(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { contactId, campagneId } = valider(schemaEcarterDuneCampagne, entree);

  const campagneRes = await ctx.ex.query<{ id: string }>(
    `select id from campaigns /* jr:ecarter_campagne */ where id = $1 and organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  if (campagneRes.rowCount === 0) throw new ErreurIntrouvable('Campagne');

  // Signal d'origine du contact : écarté seulement s'il nourrit bien cette campagne
  // (une de ses sources reliées) — un contact peut avoir un signal d'origine
  // rattaché à une autre campagne, jamais touché ici.
  await ctx.ex.query(
    `update signals /* jr:ecarter_signal */
        set status = 'discarded', discard_reason = coalesce(discard_reason, 'operator_skip')
      where organization_id = $3
        and id = (select source_signal_id from contacts where id = $1 and organization_id = $3)
        and status <> 'discarded'
        and exists (select 1 from campaign_sources cs where cs.campaign_id = $2 and cs.source_id = signals.source_id)`,
    [contactId, campagneId, ctx.organisationId],
  );

  const inscriptionsRes = await ctx.ex.query<{ id: string }>(
    `update enrollments /* jr:ecarter_inscriptions */
        set status = 'stopped', ended_at = now(), stop_reason = coalesce(stop_reason, 'operator_skip')
      where organization_id = $3 and contact_id = $1 and campaign_id = $2
        and status in ('active', 'paused', 'paused_absence')
      returning id`,
    [contactId, campagneId, ctx.organisationId],
  );
  const idsInscriptions = inscriptionsRes.rows.map((r) => r.id);
  if (idsInscriptions.length > 0) {
    // `organization_id` repris ici aussi (A2, tour de correction 1) : les
    // `id` d'inscriptions viennent de la requête précédente, déjà filtrée par
    // organisation, mais jamais d'`update`/`delete` sur `actions` ou
    // `enrollments` sans ce filtre direct (règle A3 du même tour).
    await ctx.ex.query(
      `update actions /* jr:ecarter_actions */
          set status = 'skipped', error = coalesce(error, 'operator_skip')
        where enrollment_id = any($1::uuid[]) and organization_id = $2 and status in ('scheduled', 'pending_approval')`,
      [idsInscriptions, ctx.organisationId],
    );
  }

  await ecrireEvenementEnvoi(ctx, 'action_skipped', contactId, 'Contact écarté de la campagne.', { campagneId });
}

// ---------------------------------------------------------------------------
// relancerEnvoi (R34, tour de correction 1)
// ---------------------------------------------------------------------------

/**
 * Relance un envoi échoué : ne s'applique qu'à une action `failed` de
 * l'organisation, la repasse `scheduled` (reprise par le prochain passage du
 * moteur), efface l'ancienne erreur et reprogramme `scheduled_for` à
 * maintenant.
 *
 * M3 (Mineur, revue finale du 14/09) : exclut une action qui porte déjà une
 * preuve d'envoi (`payload->>'message_id'`, posée par la relève une fois
 * SalesBlink confirmé) — la rejouer doublerait le message (issue #114). Si
 * l'action existe mais porte cette preuve, `ErreurConflit` plutôt
 * qu'`ErreurIntrouvable`, pour ne pas dire à tort qu'il n'y a rien à
 * relancer.
 */
export async function relancerEnvoi(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<{ contact_id: string | null }>(
    `update actions a /* jr:relancer_envoi */
        set status = 'scheduled', scheduled_for = now(), error = null
       from enrollments e
      where a.id = $1 and a.organization_id = $2 and a.enrollment_id = e.id and a.status = 'failed'
        and (a.payload ->> 'message_id') is null
      returning e.contact_id`,
    [actionId, ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) {
    const dejaParti = await ctx.ex.query<{ id: string }>(
      `select id from actions /* jr:relancer_deja_parti */
        where id = $1 and organization_id = $2 and status = 'failed' and (payload ->> 'message_id') is not null`,
      [actionId, ctx.organisationId],
    );
    if ((dejaParti.rowCount ?? 0) > 0) throw new ErreurConflit('Cet envoi est déjà parti.');
    throw new ErreurIntrouvable('Envoi en échec');
  }

  await ecrireEvenementEnvoi(ctx, 'action_retried', ligne.contact_id, 'Envoi relancé.');
}

// ---------------------------------------------------------------------------
// approuverEnvoi / rejeterEnvoi
// ---------------------------------------------------------------------------

/**
 * Valide un envoi en attente d'approbation (`pending_approval` → `approved`,
 * partira au prochain passage du moteur). Réutilisé par la façade historique
 * `apps/web/app/actions/approvals.ts` (`setActionApproval`), qui appelait
 * jusqu'ici Supabase directement.
 */
export async function approuverEnvoi(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<{ contact_id: string | null }>(
    `update actions a /* jr:approuver_envoi */
        set status = 'approved', approved_at = now(), approved_by = $3
       from enrollments e
      where a.id = $1 and a.organization_id = $2 and a.enrollment_id = e.id and a.status = 'pending_approval'
      returning e.contact_id`,
    [actionId, ctx.organisationId, ctx.utilisateurId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Envoi en attente d’approbation');

  await ecrireEvenementEnvoi(ctx, 'action_approved', ligne.contact_id, 'Envoi validé par l’opérateur.');
}

/** Rejette un envoi en attente d'approbation (`pending_approval` → `cancelled`, ne partira jamais). */
export async function rejeterEnvoi(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<{ contact_id: string | null }>(
    `update actions a /* jr:rejeter_envoi */
        set status = 'cancelled'
       from enrollments e
      where a.id = $1 and a.organization_id = $2 and a.enrollment_id = e.id and a.status = 'pending_approval'
      returning e.contact_id`,
    [actionId, ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Envoi en attente d’approbation');

  await ecrireEvenementEnvoi(ctx, 'action_rejected', ligne.contact_id, 'Envoi rejeté par l’opérateur.');
}

// ---------------------------------------------------------------------------
// apercuEnvoi
// ---------------------------------------------------------------------------

/**
 * `pourquoi` : signal d'origine de l'inscription (`signals.title`/
 * `score_reason`) — `null` pour une inscription sans signal (R36).
 */
export interface ApercuEnvoi {
  readonly objet: string;
  readonly corps: string;
  readonly expediteur: string | null;
  /** Adresse complète du destinataire — jamais masquée dans un écran de relecture (R38). */
  readonly destinataire: string | null;
  /** Variables non résolues (C5) : `renderTemplate(...).missing` de l'objet et du corps, dédoublonnées. Non vide → l'envoi sera bloqué tant qu'elles manquent. */
  readonly variablesManquantes: string[];
  readonly contactNom: string;
  readonly contactPoste: string | null;
  readonly contactEntreprise: string | null;
  readonly score: number | null;
  readonly pourquoi: { titre: string; detail: string | null } | null;
  /** 1-based (`sequence_steps.position` part de 0, même conversion que `campagnes.ts`/`aujourdhui.ts`). */
  readonly etapePosition: number;
  readonly etapeNom: string;
  /** ISO de `actions.scheduled_for` — `null` si jamais programmé. */
  readonly heurePrevue: string | null;
  /** Statut réel de l'action (`actions.status`), pour que le tiroir n'affiche les boutons d'action que sur un envoi pas encore parti (R39). */
  readonly statut: EtatEnvoi;
}

interface LigneActionApercu {
  id: string;
  status: EtatEnvoi;
  scheduled_for: string | null;
  contact_id: string;
  campaign_id: string;
  template_parent_id: string | null;
  position: number | null;
  locale: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  entreprise: string | null;
  expediteur: string | null;
  score: number | null;
  signal_titre: string | null;
  score_reason: string | null;
}

interface LigneGabarit {
  body: string;
  subject: string | null;
  name: string;
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

/** « Premier email » pour la première étape (position 0), « Relance » ensuite — vocabulaire de la maquette, quel que soit le canal. */
function nomEtape(position: number): string {
  return position === 0 ? 'Premier email' : 'Relance';
}

/**
 * Rend l'email tel qu'il partira, pour la relecture avant envoi (tiroir
 * « Relire avant envoi »). Même construction des valeurs que le worker
 * (`lireValeursContact`, R32) : jamais un aperçu qui diverge de l'envoi réel.
 * Résolution de gabarit volontairement simplifiée par rapport au worker
 * (`resolveTemplate`, `apps/worker/src/handlers/message-values.ts`) : la
 * dernière version active pour la langue du contact, sans reproduire le
 * blocage `missing_locale` — un aperçu qui affiche un gabarit par défaut
 * reste préférable à un aperçu vide (les variables non résolues restent
 * signalées, `variablesManquantes`, C5).
 */
export async function apercuEnvoi(ctx: Contexte, entree: unknown): Promise<ApercuEnvoi> {
  exiger(ctx, 'viewer');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<LigneActionApercu>(
    `select a.id, a.status, a.scheduled_for, e.contact_id, e.campaign_id, st.template_parent_id, st.position,
            c.locale, c.first_name, c.last_name, c.job_title,
            coalesce(ac.name, sig.company_hint) as entreprise,
            s.identity as expediteur,
            sig.score, sig.title as signal_titre, sig.score_reason
       from actions a /* jr:apercu_lire */
       join enrollments e on e.id = a.enrollment_id
       left join sequence_steps st on st.id = a.step_id
       left join contacts c on c.id = e.contact_id
       left join senders s on s.id = a.sender_id
       left join signals sig on sig.id = e.signal_id
       left join accounts ac on ac.id = coalesce(sig.account_id, c.account_id)
      where a.id = $1 and a.organization_id = $2`,
    [actionId, ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Envoi');

  const contact = await lireValeursContact(ctx.ex, ctx.organisationId, ligne.contact_id, ligne.campaign_id);

  let gabarit: LigneGabarit | undefined;
  if (ligne.template_parent_id) {
    const gabaritRes = await ctx.ex.query<LigneGabarit>(
      // Préfère la version active de la langue du contact ; à défaut, repli sur
      // la version active la plus récente, toute langue confondue (`ORDER BY`,
      // pas un filtre `WHERE` — un filtre exclurait ce repli).
      `select body, subject, name from message_templates /* jr:apercu_gabarit */
        where (id = $1 or parent_id = $1) and is_active
        order by (locale = $2) desc, version desc
        limit 1`,
      [ligne.template_parent_id, ligne.locale ?? contact?.locale ?? null],
    );
    gabarit = gabaritRes.rows[0];
  }

  const valeurs = contact?.valeurs ?? {};
  const renduObjet = gabarit ? renderTemplate(gabarit.subject ?? gabarit.name, valeurs) : { text: '', missing: [] };
  const renduCorps = gabarit ? renderTemplate(gabarit.body, valeurs) : { text: '', missing: [] };
  const variablesManquantes = [...new Set([...renduObjet.missing, ...renduCorps.missing])];

  const position = ligne.position ?? 0;

  return {
    objet: renduObjet.text,
    corps: renduCorps.text,
    expediteur: ligne.expediteur,
    destinataire: contact?.email ?? null,
    variablesManquantes,
    contactNom: nomComplet(ligne.first_name, ligne.last_name),
    contactPoste: ligne.job_title,
    contactEntreprise: ligne.entreprise,
    score: ligne.score,
    pourquoi: ligne.signal_titre ? { titre: ligne.signal_titre, detail: ligne.score_reason } : null,
    etapePosition: position + 1,
    etapeNom: nomEtape(position),
    heurePrevue: ligne.scheduled_for,
    statut: ligne.status,
  };
}

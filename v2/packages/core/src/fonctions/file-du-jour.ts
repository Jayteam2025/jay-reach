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
import { ecrireEvenement } from '../journal.js';
import { shiftIntoBusinessHours, type BusinessHours } from '../sequencer/scheduling.js';
import { renderTemplate, lireValeursContact } from '../messages/index.js';

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

/** Masque un email à l'affichage (relecture avant envoi) : partie locale tronquée + domaine en clair. */
export function masquerEmail(email: string): string {
  const arobase = email.indexOf('@');
  if (arobase <= 0) return email;
  const locale = email.slice(0, arobase);
  const domaine = email.slice(arobase + 1);
  const visible = locale.slice(0, Math.min(2, locale.length));
  return `${visible}…@${domaine}`;
}

async function ecrireEvenementEnvoi(
  ctx: Contexte,
  action: 'action_rescheduled' | 'action_skipped' | 'action_approved' | 'action_rejected',
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

  await ctx.ex.query(
    `update actions /* jr:reporter_ecrire */ set scheduled_for = $2, dispatch_after = $3 where id = $1`,
    [actionId, new Date(decale).toISOString(), new Date(decale + ecartMs).toISOString()],
  );

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
    await ctx.ex.query(
      `update actions /* jr:ecarter_actions */
          set status = 'skipped', error = coalesce(error, 'operator_skip')
        where enrollment_id = any($1::uuid[]) and status in ('scheduled', 'pending_approval')`,
      [idsInscriptions],
    );
  }

  await ecrireEvenementEnvoi(ctx, 'action_skipped', contactId, 'Contact écarté de la campagne.', { campagneId });
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

export interface ApercuEnvoi {
  readonly objet: string;
  readonly corps: string;
  readonly expediteur: string | null;
  readonly destinataireMasque: string | null;
}

interface LigneActionApercu {
  id: string;
  contact_id: string;
  campaign_id: string;
  template_parent_id: string | null;
  locale: string | null;
  expediteur: string | null;
}

interface LigneGabarit {
  body: string;
  subject: string | null;
  name: string;
}

/**
 * Rend l'email tel qu'il partira, pour la relecture avant envoi (tiroir
 * « Relire avant envoi »). Même construction des valeurs que le worker
 * (`lireValeursContact`, R32) : jamais un aperçu qui diverge de l'envoi réel.
 * Résolution de gabarit volontairement simplifiée par rapport au worker
 * (`resolveTemplate`, `apps/worker/src/handlers/message-values.ts`) : la
 * dernière version active pour la langue du contact, sans reproduire le
 * blocage `missing_locale` — un aperçu qui affiche un gabarit par défaut
 * reste préférable à un aperçu vide.
 */
export async function apercuEnvoi(ctx: Contexte, entree: unknown): Promise<ApercuEnvoi> {
  exiger(ctx, 'viewer');
  const { actionId } = valider(schemaActionId, entree);

  const res = await ctx.ex.query<LigneActionApercu>(
    `select a.id, e.contact_id, e.campaign_id, st.template_parent_id, c.locale, s.identity as expediteur
       from actions a /* jr:apercu_lire */
       join enrollments e on e.id = a.enrollment_id
       left join sequence_steps st on st.id = a.step_id
       left join contacts c on c.id = e.contact_id
       left join senders s on s.id = a.sender_id
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
  const objet = gabarit ? renderTemplate(gabarit.subject ?? gabarit.name, valeurs).text : '';
  const corps = gabarit ? renderTemplate(gabarit.body, valeurs).text : '';

  return {
    objet,
    corps,
    expediteur: ligne.expediteur,
    destinataireMasque: contact?.email ? masquerEmail(contact.email) : null,
  };
}

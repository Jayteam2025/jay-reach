/**
 * Envoi effectif d'un email de séquence, par SalesBlink (lot 3 : « SalesBlink
 * comme simple transport email »). Jay Reach rend le texte (gabarit +
 * variables) et séquence les étapes ; SalesBlink envoie et relève les
 * réponses.
 *
 * Le tick (`sequence.ts`) ne fait que décider l'éligibilité et transmettre des
 * références (`DispatchJob.email`) : tout le reste — rendu, résolution des
 * objets SalesBlink (séquence, liste), choix du mode d'envoi — a lieu ici, au
 * moment d'envoyer, pas au tick.
 *
 * Aucune clé, en-tête `Authorization` ni URL complète ne doit jamais figurer
 * dans un log ou une erreur stockée : `ErreurSalesBlink` ne porte que `code`,
 * `statut`, et un message déjà tronqué à 200 caractères.
 */
import type { Pool } from 'pg';
import {
  renderTemplate,
  deciderModeEnvoi,
  sortDErreur,
  corpsPourSalesBlink,
  objetPourSalesBlink,
  type ModeEnvoi,
} from '@jay-reach/core';
import {
  ErreurSalesBlink,
  creerGabaritNeutre,
  creerListe,
  creerSequenceEtape,
  activerEtPlanifier,
  pousserLeads,
  repondreDansLeFil,
  type LeadSalesBlink,
} from '@jay-reach/providers/outreach';
import { resolveProviderCredentials } from '../credentials.js';
import { getCredentialConfig } from '../db.js';
import { lirePlafondFournisseur } from '../producer.js';
import { buildMessageValues, chargerLigneInscription, resolveTemplate } from './message-values.js';
import type { DispatchJob } from './dispatch.js';

export const SALESBLINK_PROVIDER = 'salesblink';

/**
 * Borne supérieure d'un `int` Postgres (`daily_cap`). Sert de plafond « sans
 * limite » : `app.consume_provider_credit` refuse tout crédit quand le
 * plafond est nul ou négatif, donc un plafond réellement illimité doit rester
 * un entier positif — celui-ci n'est jamais atteint en pratique.
 */
const PLAFOND_SALESBLINK_ILLIMITE = 2_147_483_647;

const NOM_GABARIT_NEUTRE = 'Jay Reach · gabarit neutre';

/** Client SalesBlink minimal requis par cet envoi — injectable pour les tests. */
export interface ClientSalesBlink {
  readonly creerGabaritNeutre: typeof creerGabaritNeutre;
  readonly creerListe: typeof creerListe;
  readonly creerSequenceEtape: typeof creerSequenceEtape;
  readonly activerEtPlanifier: typeof activerEtPlanifier;
  readonly pousserLeads: typeof pousserLeads;
  readonly repondreDansLeFil: typeof repondreDansLeFil;
}

const clientSalesBlinkReel: ClientSalesBlink = {
  creerGabaritNeutre,
  creerListe,
  creerSequenceEtape,
  activerEtPlanifier,
  pousserLeads,
  repondreDansLeFil,
};

interface SenderRow {
  readonly id: string;
  readonly identity: string;
  readonly provider_ref: string | null;
  readonly provider_state: {
    readonly sending_enabled?: boolean;
    readonly receiving_enabled?: boolean;
    readonly connected?: boolean;
    readonly health_score?: number;
  } | null;
  readonly timezone: string | null;
  readonly business_hours: unknown;
}

/** Nom des jours au sens de l'API SalesBlink, dans l'ordre ISO (1 = lundi). */
const JOURS_SALESBLINK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

interface BusinessHoursBrutes {
  readonly startHour?: unknown;
  readonly endHour?: unknown;
  readonly days?: unknown;
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Traduit les heures ouvrées d'un expéditeur (`senders.business_hours`,
 * `{ startHour, endHour, days }` ISO 1-7) vers `emailSendingHours` de
 * SalesBlink : sept entrées nommées `Monday`…`Sunday`, `fromTime`/`toTime` en
 * `HH:00`. Valeur nulle ou invalide → défaut lundi-vendredi 9h-18h.
 */
export function heuresEnvoiSalesBlink(
  businessHours: unknown,
): { name: string; enabled: boolean; fromTime: string; toTime: string }[] {
  const brut = (businessHours ?? null) as BusinessHoursBrutes | null;
  const startHour = typeof brut?.startHour === 'number' ? brut.startHour : 9;
  const endHour = typeof brut?.endHour === 'number' ? brut.endHour : 18;
  const days =
    Array.isArray(brut?.days) && brut.days.length > 0
      ? (brut.days as unknown[]).map((d) => Number(d))
      : [1, 2, 3, 4, 5];
  const fromTime = `${deuxChiffres(startHour)}:00`;
  const toTime = `${deuxChiffres(endHour)}:00`;
  return JOURS_SALESBLINK.map((name, index) => ({
    name,
    enabled: days.includes(index + 1),
    fromTime,
    toTime,
  }));
}

/**
 * Bloque une action : elle ne repart jamais toute seule (contrairement à un
 * envoi laissé `pending`), il faut corriger la cause. Même forme que le
 * blocage du tick (`sequence.ts`), pour que l'écran des actions bloquées
 * traite les deux uniformément.
 */
async function bloquerAction(
  pool: Pool,
  actionId: string,
  blockReason: string,
  extraPayload: Record<string, unknown> = {},
): Promise<void> {
  await pool.query(
    `update actions set status = 'blocked', block_reason = $2,
            payload = coalesce(payload, '{}'::jsonb) || $3::jsonb
      where id = $1`,
    [actionId, blockReason, JSON.stringify(extraPayload)],
  );
}

/**
 * Gabarit neutre de l'organisation : un seul par organisation, mémorisé dans
 * `credentials.config.template_id` (table `credentials`, provider
 * `salesblink`) plutôt que recréé à chaque étape. L'upsert ne retient jamais
 * un `template_id` que l'organisation a déjà : deux envois concurrents pour
 * deux étapes différentes de la même organisation peuvent chacun croire
 * devoir en créer un — celui déjà mémorisé gagne, l'autre reste orphelin chez
 * SalesBlink mais inoffensif.
 */
async function gabaritNeutreDeLOrganisation(
  pool: Pool,
  organizationId: string,
  cle: string,
  client: ClientSalesBlink,
): Promise<string> {
  const config = await getCredentialConfig(pool, organizationId, SALESBLINK_PROVIDER);
  const existant = config?.template_id;
  if (existant) return existant;

  const cree = await client.creerGabaritNeutre(NOM_GABARIT_NEUTRE, '', cle);
  const res = await pool.query<{ template_id: string | null }>(
    `insert into credentials (organization_id, provider_id, config)
       values ($1, $2, jsonb_build_object('template_id', $3::text))
     on conflict (organization_id, provider_id) do update
       set config = jsonb_set(
             coalesce(credentials.config, '{}'::jsonb),
             '{template_id}',
             to_jsonb(coalesce(credentials.config ->> 'template_id', $3::text))
           )
     returning config ->> 'template_id' as template_id`,
    [organizationId, SALESBLINK_PROVIDER, cree],
  );
  return res.rows[0]?.template_id ?? cree;
}

interface ObjetsEtape {
  readonly sequenceId: string;
  readonly listId: string;
}

interface SenderPourSalesBlink {
  readonly providerRef: string;
  readonly timezone: string | null;
  readonly businessHours: unknown;
}

/**
 * Séquence et liste SalesBlink d'une étape email d'une campagne — créées au
 * premier envoi, réutilisées ensuite (`email_transport_bindings`).
 *
 * L'insertion `on conflict … do nothing` puis relecture rend la création sûre
 * entre deux envois concurrents pour la même étape (deux contacts différents
 * du même pas de séquence) : les deux peuvent créer une séquence/liste chez
 * SalesBlink, mais une seule ligne survit en base et les deux convergent sur
 * ses identifiants.
 */
export async function assurerObjetsEtape(
  pool: Pool,
  organizationId: string,
  campaignId: string,
  stepId: string,
  sender: SenderPourSalesBlink,
  cle: string,
  client: ClientSalesBlink = clientSalesBlinkReel,
): Promise<ObjetsEtape> {
  const existant = await pool.query<{ sequence_id: string; list_id: string }>(
    `select sequence_id, list_id from email_transport_bindings
      where organization_id = $1 and campaign_id = $2 and step_id = $3`,
    [organizationId, campaignId, stepId],
  );
  const ligne = existant.rows[0];
  if (ligne) {
    return { sequenceId: ligne.sequence_id, listId: ligne.list_id };
  }

  const templateId = await gabaritNeutreDeLOrganisation(pool, organizationId, cle, client);

  const campagne = await pool.query<{ name: string }>(`select name from campaigns where id = $1`, [campaignId]);
  const etape = await pool.query<{ position: number }>(`select position from sequence_steps where id = $1`, [
    stepId,
  ]);
  const numeroEtape = (etape.rows[0]?.position ?? 0) + 1;
  const nom = `Jay Reach · ${campagne.rows[0]?.name ?? campaignId} · étape ${numeroEtape}`;

  const listId = await client.creerListe(nom, cle);
  const sequenceId = await client.creerSequenceEtape(
    {
      nom,
      idBoite: sender.providerRef,
      idListe: listId,
      idGabarit: templateId,
      fuseau: sender.timezone ?? 'Europe/Paris',
      heures: heuresEnvoiSalesBlink(sender.businessHours),
    },
    cle,
  );
  await client.activerEtPlanifier(sequenceId, cle);

  const insere = await pool.query<{ sequence_id: string; list_id: string }>(
    `insert into email_transport_bindings (organization_id, campaign_id, step_id, sequence_id, list_id, template_id)
       values ($1, $2, $3, $4, $5, $6)
     on conflict (organization_id, campaign_id, step_id) do nothing
     returning sequence_id, list_id`,
    [organizationId, campaignId, stepId, sequenceId, listId, templateId],
  );
  if (insere.rows[0]) {
    return { sequenceId: insere.rows[0].sequence_id, listId: insere.rows[0].list_id };
  }
  // Course perdue : un autre envoi a inséré la ligne entre-temps. On se range
  // derrière lui plutôt que de garder nos propres identifiants.
  const relu = await pool.query<{ sequence_id: string; list_id: string }>(
    `select sequence_id, list_id from email_transport_bindings
      where organization_id = $1 and campaign_id = $2 and step_id = $3`,
    [organizationId, campaignId, stepId],
  );
  const gagnant = relu.rows[0];
  if (!gagnant) {
    throw new Error(`email_transport_bindings introuvable après course pour l'étape ${stepId}`);
  }
  return { sequenceId: gagnant.sequence_id, listId: gagnant.list_id };
}

interface EnvoiAnterieur {
  readonly message_id: string | null;
  readonly subject: string | null;
}

/** Message d'erreur générique stocké en base : jamais le corps brut de SalesBlink. */
function messageErreurGenerique(err: ErreurSalesBlink): string {
  const statut = err.statut !== null ? ` ${err.statut}` : '';
  return `Envoi SalesBlink en échec (${err.code}${statut}) : ${err.message}`;
}

/**
 * Envoie l'email d'une action de séquence par SalesBlink. `client` est
 * injectable pour les tests (Pool factice + client factice) ; en production,
 * c'est le client HTTP réel de `@jay-reach/providers/outreach`.
 */
export async function envoyerEmailSalesBlink(
  ctx: { readonly pool: Pool; readonly encryptionKey?: string | undefined },
  job: DispatchJob,
  client: ClientSalesBlink = clientSalesBlinkReel,
): Promise<void> {
  const { pool, encryptionKey } = ctx;
  const email = job.email;
  const actionId = job.actionId;
  if (!email || !actionId) {
    throw new Error('dispatch email SalesBlink : payload email/actionId manquant');
  }

  // 1. Clé.
  const credentials = await resolveProviderCredentials(pool, job.organizationId, SALESBLINK_PROVIDER, {
    encryptionKey,
  });
  const cle = credentials?.api_key;
  if (!cle) {
    console.warn(`[email-salesblink] SalesBlink non configuré pour l’org ${job.organizationId} — job ignoré`);
    return;
  }

  // 2. Expéditeur.
  if (!email.senderId) {
    await bloquerAction(pool, actionId, 'sender_unbound');
    console.warn(`[email-salesblink] action ${actionId} bloquée : aucun expéditeur lié`);
    return;
  }
  const senderRes = await pool.query<SenderRow>(
    `select id, identity, provider_ref, provider_state, timezone, business_hours from senders where id = $1`,
    [email.senderId],
  );
  const sender = senderRes.rows[0];
  if (!sender || !sender.provider_ref) {
    await bloquerAction(pool, actionId, 'sender_unbound');
    console.warn(`[email-salesblink] action ${actionId} bloquée : expéditeur non lié à SalesBlink`);
    return;
  }
  if (sender.provider_state?.sending_enabled === false) {
    // Transitoire, pas un blocage : la relève des boîtes reconnecte
    // l'expéditeur et le prochain tick rejouera cette action.
    console.warn(`[email-salesblink] action ${actionId} en attente : envoi désactivé chez ${sender.identity}`);
    return;
  }

  // 3. Plafond fournisseur.
  const plafond = await lirePlafondFournisseur(pool, job.organizationId, SALESBLINK_PROVIDER, PLAFOND_SALESBLINK_ILLIMITE);
  const credit = await pool.query<{ ok: boolean }>(`select app.consume_provider_credit($1, $2, $3, $4) as ok`, [
    job.organizationId,
    SALESBLINK_PROVIDER,
    plafond,
    1,
  ]);
  if (credit.rows[0]?.ok !== true) {
    console.warn(`[email-salesblink] action ${actionId} en attente : plafond SalesBlink atteint (${plafond}/jour)`);
    return;
  }

  // 4. Rendu.
  const ligne = await chargerLigneInscription(pool, email.enrollmentId);
  if (!ligne || !ligne.email) {
    console.warn(`[email-salesblink] action ${actionId} : inscription ${email.enrollmentId} sans adresse`);
    return;
  }
  if (!email.templateParentId) {
    await bloquerAction(pool, actionId, 'missing_template');
    console.warn(`[email-salesblink] action ${actionId} bloquée : aucun gabarit assigné à l’étape`);
    return;
  }
  const resolved = await resolveTemplate(pool, email.templateParentId, email.locale);
  if (resolved.missingLocale) {
    await bloquerAction(pool, actionId, 'missing_locale');
    console.warn(`[email-salesblink] action ${actionId} bloquée : langue manquante`);
    return;
  }
  if (resolved.body === null) {
    await bloquerAction(pool, actionId, 'missing_template');
    console.warn(`[email-salesblink] action ${actionId} bloquée : gabarit introuvable`);
    return;
  }
  const valeurs = buildMessageValues(ligne);
  const renduCorps = renderTemplate(resolved.body, valeurs);
  const renduObjet = renderTemplate(resolved.subject ?? resolved.name ?? '', valeurs);
  const manquantes = [...new Set([...renduCorps.missing, ...renduObjet.missing])];
  if (manquantes.length > 0) {
    // Même motif que pour LinkedIn et le courrier (`sequence.ts`) : jamais un
    // `{{champ}}` littéral envoyé (CLAUDE.md #2).
    await bloquerAction(pool, actionId, 'missing_variable', { missingVariables: manquantes });
    console.warn(`[email-salesblink] action ${actionId} bloquée : variable(s) manquante(s)`);
    return;
  }
  const corps = corpsPourSalesBlink(renduCorps.text);
  const objet = objetPourSalesBlink(renduObjet.text);

  // 5. Mode d'envoi.
  const precedentes = await pool.query<EnvoiAnterieur>(
    `select payload ->> 'message_id' as message_id, payload ->> 'subject' as subject
       from actions
      where enrollment_id = $1 and channel = 'email' and status in ('dispatched', 'delivered')
      order by created_at asc`,
    [email.enrollmentId],
  );
  const envoisAnterieurs = precedentes.rows.map((r) => ({ messageId: r.message_id, objet: r.subject ?? '' }));

  const actionActuelle = await pool.query<{ mode_force: string | null }>(
    `select payload ->> 'mode_force' as mode_force from actions where id = $1`,
    [actionId],
  );
  const modeForce = actionActuelle.rows[0]?.mode_force ?? null;

  let mode: ModeEnvoi;
  if (modeForce === 'relance_repli') {
    // Posé par la relève des réponses quand une relance en file d'attente a
    // trop vieilli (délai max dépassé) : on force le repli plutôt que de
    // laisser `deciderModeEnvoi` retenter le fil d'origine.
    const premierEnvoi = envoisAnterieurs[0];
    mode = { mode: 'relance_repli', objet: `Re: ${premierEnvoi?.objet ?? objet}` };
  } else {
    mode = deciderModeEnvoi({ envoisAnterieurs });
  }

  try {
    let payloadSucces: Record<string, unknown>;
    if (mode.mode === 'relance') {
      const { idTache } = await client.repondreDansLeFil(mode.messageId, corps, cle);
      payloadSucces = {
        subject: objet,
        body: corps,
        mode: 'relance',
        reply_task_id: idTache,
        email: ligne.email.toLowerCase(),
      };
    } else {
      const objetEnvoye = mode.mode === 'relance_repli' ? mode.objet : objet;
      const objets = await assurerObjetsEtape(
        pool,
        job.organizationId,
        email.campaignId,
        email.stepId,
        { providerRef: sender.provider_ref, timezone: sender.timezone, businessHours: sender.business_hours },
        cle,
        client,
      );
      const lead: LeadSalesBlink = {
        email: ligne.email,
        jr_subject: objetEnvoye,
        jr_body: corps,
        jr_action_id: actionId,
        ...(ligne.first_name ? { first_name: ligne.first_name } : {}),
        ...(ligne.last_name ? { last_name: ligne.last_name } : {}),
        ...(ligne.company_name ? { company_name: ligne.company_name } : {}),
      };
      await client.pousserLeads(objets.listId, [lead], cle);
      payloadSucces = {
        subject: objetEnvoye,
        body: corps,
        mode: mode.mode,
        sequence_id: objets.sequenceId,
        list_id: objets.listId,
        email: ligne.email.toLowerCase(),
        message_id: null,
      };
    }

    // 7. Succès.
    await pool.query('select app.mark_action_dispatched($1)', [actionId]);
    await pool.query(
      `update actions set provider_ref = $2,
              payload = (coalesce(payload, '{}'::jsonb) - 'mode_force') || $3::jsonb
        where id = $1`,
      [actionId, sender.provider_ref, JSON.stringify(payloadSucces)],
    );
    console.log(`[email-salesblink] action ${actionId} envoyée (${mode.mode})`);
  } catch (err) {
    // 8. Erreur SalesBlink : nouvel essai ou échec définitif selon le code et
    // le nombre d'essais déjà comptés. Toute autre erreur (SQL, bug) remonte
    // telle quelle — pg-boss applique alors son propre backoff sur le job.
    if (!(err instanceof ErreurSalesBlink)) throw err;

    const essaisRes = await pool.query<{ essais: string | null }>(
      `select payload ->> 'essais' as essais from actions where id = $1`,
      [actionId],
    );
    const essais = Number(essaisRes.rows[0]?.essais ?? 0) || 0;
    const sort = sortDErreur(err.code, essais);
    if (sort === 'reessayer') {
      await pool.query(
        `update actions set payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('essais', $2::int)
          where id = $1`,
        [actionId, essais + 1],
      );
      console.warn(`[email-salesblink] action ${actionId} : nouvel essai après erreur ${err.code}`);
      return;
    }
    // Le crédit consommé au 3. n'est pas remboursé (fonction atomique,
    // irréversible) : un échec après plafond compte quand même dans le quota
    // du jour. Accepté et documenté (brief tâche 5).
    await pool.query(`update actions set status = 'failed', error = $2 where id = $1`, [
      actionId,
      messageErreurGenerique(err),
    ]);
    console.error(`[email-salesblink] action ${actionId} en échec définitif (${err.code})`);
  }
}

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
  assurerFil,
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
import { lirePlafondFournisseur } from '../producer.js';
import { buildMessageValues, chargerLigneInscription, resolveTemplate } from './message-values.js';
import { chargerContraintesSender, mettreInscriptionEnPause, quotaSenderRestant } from './sequence.js';
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

/** Une heure de la journée, bornée à la plage 0-23 ; `null` si la valeur brute n'est pas un nombre. */
function heureBornee(valeur: unknown): number | null {
  if (typeof valeur !== 'number' || !Number.isFinite(valeur)) return null;
  return Math.min(23, Math.max(0, Math.trunc(valeur)));
}

/**
 * Traduit les heures ouvrées d'un expéditeur (`senders.business_hours`,
 * `{ startHour, endHour, days }` ISO 1-7) vers `emailSendingHours` de
 * SalesBlink : sept entrées nommées `Monday`…`Sunday`, `fromTime`/`toTime` en
 * `HH:00`. Valeur nulle ou invalide → défaut lundi-vendredi 9h-18h ; `startHour`
 * et `endHour` sont bornés à 0-23, et une fenêtre qui ne progresse pas
 * (`endHour` ne dépassant pas `startHour`, minor de la revue finale du 11/09 —
 * une valeur 25 produisait `"25:00"`) retombe elle aussi sur le défaut.
 */
export function heuresEnvoiSalesBlink(
  businessHours: unknown,
): { name: string; enabled: boolean; fromTime: string; toTime: string }[] {
  const brut = (businessHours ?? null) as BusinessHoursBrutes | null;
  let startHour = heureBornee(brut?.startHour) ?? 9;
  let endHour = heureBornee(brut?.endHour) ?? 18;
  if (endHour <= startHour) {
    startHour = 9;
    endHour = 18;
  }
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
 * Gabarit neutre de l'organisation : un seul, réutilisé par toutes les
 * étapes. Relu depuis `email_transport_bindings.template_id` plutôt que
 * mémorisé dans `credentials.config` (minor, revue finale du 11/09) : ce
 * champ y était effacé à chaque enregistrement de l'écran Fournisseurs, qui
 * ne renvoie que les champs du catalogue et remplace `config` en entier — un
 * gabarit orphelin de plus chez SalesBlink après chaque sauvegarde suivie
 * d'un envoi. Deux créations concurrentes pour deux étapes différentes,
 * avant qu'aucune liaison n'existe encore, peuvent chacune créer un gabarit :
 * accepté (comme pour la séquence et la liste), sans effet fonctionnel.
 */
async function gabaritNeutreDeLOrganisation(
  pool: Pool,
  organizationId: string,
  cle: string,
  client: ClientSalesBlink,
): Promise<string> {
  const existant = await pool.query<{ template_id: string }>(
    `select template_id from email_transport_bindings
      where organization_id = $1 and template_id is not null
      limit 1`,
    [organizationId],
  );
  const gabarit = existant.rows[0]?.template_id;
  if (gabarit) return gabarit;

  return client.creerGabaritNeutre(NOM_GABARIT_NEUTRE, '', cle);
}

interface ObjetsEtape {
  readonly sequenceId: string;
  readonly listId: string;
}

interface SenderPourSalesBlink {
  readonly id: string;
  readonly identity: string;
  readonly providerRef: string;
  readonly timezone: string | null;
  readonly businessHours: unknown;
}

/**
 * Séquence et liste SalesBlink d'une étape email d'une campagne, PAR
 * EXPÉDITEUR — créées au premier envoi de cette étape pour cet expéditeur,
 * réutilisées ensuite (`email_transport_bindings`, clé étendue à `sender_id`
 * depuis I2, revue finale du 11/09) : sans cette clé, deux expéditeurs email
 * liés à la même étape partageraient la même séquence, donc la même boîte
 * d'envoi chez SalesBlink pour le second.
 *
 * L'insertion `on conflict … do nothing` puis relecture rend la création sûre
 * entre deux envois concurrents pour la même étape ET le même expéditeur
 * (deux contacts différents du même pas de séquence) : les deux peuvent créer
 * une séquence/liste chez SalesBlink, mais une seule ligne survit en base et
 * les deux convergent sur ses identifiants.
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
      where organization_id = $1 and campaign_id = $2 and step_id = $3 and sender_id = $4`,
    [organizationId, campaignId, stepId, sender.id],
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
  // Le nom porte l'identité de l'expéditeur (I2) : une séquence par étape ET
  // par boîte d'envoi, jamais partagée entre deux expéditeurs de la même
  // étape.
  const nom = `Jay Reach · ${campagne.rows[0]?.name ?? campaignId} · étape ${numeroEtape} · ${sender.identity}`;

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
    `insert into email_transport_bindings (organization_id, campaign_id, step_id, sender_id, sequence_id, list_id, template_id)
       values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (organization_id, campaign_id, step_id, sender_id) do nothing
     returning sequence_id, list_id`,
    [organizationId, campaignId, stepId, sender.id, sequenceId, listId, templateId],
  );
  if (insere.rows[0]) {
    return { sequenceId: insere.rows[0].sequence_id, listId: insere.rows[0].list_id };
  }
  // Course perdue : un autre envoi a inséré la ligne entre-temps. On se range
  // derrière lui plutôt que de garder nos propres identifiants.
  const relu = await pool.query<{ sequence_id: string; list_id: string }>(
    `select sequence_id, list_id from email_transport_bindings
      where organization_id = $1 and campaign_id = $2 and step_id = $3 and sender_id = $4`,
    [organizationId, campaignId, stepId, sender.id],
  );
  const gagnant = relu.rows[0];
  if (!gagnant) {
    throw new Error(`email_transport_bindings introuvable après course pour l'étape ${stepId} et l'expéditeur ${sender.id}`);
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

  // 0. État de l'action : un rejeu (relève des actions en attente,
  // `rejouerActionsEmailEnAttente`) ou un job concurrent a pu la faire
  // avancer entre l'enfilement et l'exécution. Seule une action encore
  // `scheduled` doit être traitée — toute autre valeur (dispatched, delivered,
  // blocked, failed, cancelled, skipped) signifie qu'un autre passage s'en est
  // déjà occupé.
  const etatActuel = await pool.query<{ status: string }>(`select status from actions where id = $1`, [actionId]);
  const statut = etatActuel.rows[0]?.status;
  if (statut !== 'scheduled') {
    console.log(`[email-salesblink] action ${actionId} déjà ${statut ?? 'introuvable'} — ignorée`);
    return;
  }

  // 0.5 Défense en profondeur (C1, revue finale du 11/09) : le balayage de
  // rejeu (`rejouerActionsEmailEnAttente`) filtre déjà sur l'inscription
  // active/completed et l'absence de suppression, mais ce gestionnaire ne
  // doit pas dépendre uniquement de ce filtre SQL — un envoi peut aussi
  // arriver ici par un autre chemin, présent ou futur. Sans cette seconde
  // vérification, un prospect qui répond ou se désinscrit pendant qu'un envoi
  // est déjà en file recevrait quand même l'email.
  //
  // `completed` signifie que le tick a fini de planifier la séquence, pas
  // qu'il ne faut plus contacter le prospect : la dernière étape passe
  // l'inscription à `completed` avant même que ce gestionnaire ne s'exécute
  // (hotfix du 11/09 — sans quoi le dernier email d'une séquence n'était
  // jamais envoyé). `paused`/`paused_absence` sont transitoires : on laisse
  // l'action `scheduled` intacte, le balayage de rejeu la reprendra une fois
  // l'inscription active de nouveau. Seuls `stopped`, `replied`, `bounced` ou
  // une inscription introuvable marquent l'action `skipped`.
  const inscriptionRes = await pool.query<{ status: string; email: string | null }>(
    `select en.status, c.email from enrollments en join contacts c on c.id = en.contact_id where en.id = $1`,
    [email.enrollmentId],
  );
  const inscription = inscriptionRes.rows[0];
  if (inscription?.status === 'paused' || inscription?.status === 'paused_absence') {
    console.log(`[email-salesblink] action ${actionId} en attente : inscription en pause`);
    return;
  }
  if (!inscription || (inscription.status !== 'active' && inscription.status !== 'completed')) {
    await pool.query(`update actions set status = 'skipped', error = $2 where id = $1`, [
      actionId,
      'enrollment_inactive',
    ]);
    console.warn(`[email-salesblink] action ${actionId} ignorée : inscription non active`);
    return;
  }
  if (inscription.email) {
    const suppressionRes = await pool.query<{ n: number }>(
      `select count(*)::int as n from suppressions
        where organization_id = $1 and scope = 'email' and value = $2
          and (expires_at is null or expires_at > now())`,
      [job.organizationId, inscription.email],
    );
    if ((suppressionRes.rows[0]?.n ?? 0) > 0) {
      await pool.query(`update actions set status = 'skipped', error = $2 where id = $1`, [actionId, 'suppressed']);
      console.warn(`[email-salesblink] action ${actionId} ignorée : adresse supprimée`);
      return;
    }
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

  // 3. Rendu.
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

  // 4. Mode d'envoi.
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

  // 4.5 Quota de l'expéditeur (I5, revue finale du 11/09) — même contrainte
  // que celle vérifiée au tick (`sequence.ts`), revérifiée ici : tant que les
  // actions partaient dans la minute, le contrôle du tick suffisait, mais le
  // balayage de rejeu peut désormais pousser d'un coup un arriéré accumulé
  // pendant une coupure d'expéditeur, hors du rythme du tick. Épuisé →
  // l'action reste en attente, comme la coupure d'envoi ci-dessus, pas un
  // blocage. `campaigns.daily_cap` gouverne les ENTRÉES en séquence
  // (`enrollContact`), pas les envois : il ne se revérifie pas ici (fix
  // round 2, 11/09 — retiré d'ici où il avait été ajouté par erreur).
  const contraintesSender = await chargerContraintesSender(pool, sender.id);
  if (contraintesSender && quotaSenderRestant(contraintesSender) <= 0) {
    console.warn(`[email-salesblink] action ${actionId} en attente : quota expéditeur épuisé (${sender.identity})`);
    return;
  }

  // 5. Plafond fournisseur — consommé ici, juste avant l'envoi réel : une
  // étape mal rendue (gabarit manquant, langue manquante, variable non
  // résolue) est bloquée plus haut et ne doit jamais coûter une unité du
  // quota quotidien pour un envoi qui n'aura jamais lieu.
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
        {
          id: sender.id,
          identity: sender.identity,
          providerRef: sender.provider_ref,
          timezone: sender.timezone,
          businessHours: sender.business_hours,
        },
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
    // Fil de discussion (I4, revue finale du 11/09) : le message sortant se
    // pose au moment de l'envoi, avec le corps rendu en texte brut (jamais le
    // HTML transmis à SalesBlink) — sans lui, une réponse relevée plus tard
    // arrive dans un fil qui ne montre que sa moitié. `provider_message_id`
    // reste nul ici ; la relève le pose quand SalesBlink le donne.
    const filId = await assurerFil(pool, job.organizationId, email.contactId, 'email');
    await pool.query(
      `insert into thread_messages (thread_id, direction, body, provider_message_id, raw, sent_at)
         values ($1, 'out', $2, null, $3::jsonb, now())`,
      [filId, renduCorps.text, JSON.stringify({ action_id: actionId, mode: mode.mode, subject: payloadSucces.subject })],
    );
    // Un fil déjà existant (relance dans un fil ouvert par un envoi
    // précédent) n'est pas touché par `assurerFil` : sans cette mise à jour,
    // son `last_message_at` resterait figé à la date du dernier message
    // entrant plutôt que de refléter cette relance sortante.
    await pool.query(`update threads set last_message_at = now() where id = $1`, [filId]);
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
    // Rien n'est parti pour cette étape : l'inscription ne doit pas avancer
    // vers la suivante (le tick l'y avait déjà fait avancer avant l'envoi).
    // Sans cette pause, un email 2 peut partir alors que le mail 1 n'a jamais
    // été envoyé.
    const etapeEnEchec = await pool.query<{ position: number }>(
      `select position from sequence_steps where id = $1`,
      [email.stepId],
    );
    const positionEnEchec = etapeEnEchec.rows[0]?.position;
    if (positionEnEchec !== undefined) {
      await mettreInscriptionEnPause(pool, email.enrollmentId, positionEnEchec, 'salesblink_client_error');
    }
    console.error(`[email-salesblink] action ${actionId} en échec définitif (${err.code})`);
  }
}

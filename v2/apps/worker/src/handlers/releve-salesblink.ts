/**
 * Relève périodique SalesBlink (lot 3 : « SalesBlink comme simple transport
 * email »). SalesBlink ne pousse rien : tout se lit par sondage (`inbox.sync`,
 * toutes les `sync_interval_min` minutes) — envois sortis terminés, réponses,
 * rebonds, désinscriptions, erreurs, tâches de relance en file d'attente, et
 * santé des boîtes d'envoi.
 *
 * `envoyerEmailSalesBlink` (tâche 5) écrit le nécessaire au moment de
 * l'envoi ; cette relève ferme la boucle en relisant ce que SalesBlink a fait
 * depuis le dernier passage (`provider_sync_state.cursor_ms`).
 *
 * Aucune clé, en-tête `Authorization` ni URL complète ne doit jamais figurer
 * dans un log ou une erreur stockée : en cas d'`ErreurSalesBlink`, seuls
 * `code` et `statut` sont conservés dans `provider_sync_state.last_error`.
 */
import type { Pool } from 'pg';
import type PgBoss from 'pg-boss';
import {
  evenementsDepuisEnvois,
  evenementsDepuisRapports,
  curseurSuivant,
  sortDErreur,
  relanceTropVieille,
  traiterEvenementEmail,
  notifyReply,
  normaliserDelaiRelanceMax,
  normaliserIntervalleReleve,
  type EvenementEmail,
} from '@jay-reach/core';
import {
  listerEnvoisSortis,
  listerReponses,
  listerRapports,
  listerTachesReponse,
  santeBoite,
  reconnecterBoite,
  replanifier,
  ErreurSalesBlink,
  type Rapport,
  type EnvoiSorti,
  type SanteBoite,
} from '@jay-reach/providers/outreach';
import { resolveProviderCredentials } from '../credentials.js';
import { deterministicUuid, currentBucket } from '../ids.js';
import { SALESBLINK_PROVIDER } from './email-salesblink.js';

/** Une heure, en millisecondes — fenêtre minimale entre deux notifications d'un même expéditeur déconnecté. */
const UNE_HEURE_MS = 60 * 60 * 1000;
/** Absence de curseur (première relève d'une organisation) : on part de 24 h en arrière. */
const FENETRE_PREMIERE_RELEVE_MS = 24 * 60 * 60 * 1000;

/** Client SalesBlink minimal requis par la relève — injectable pour les tests. */
export interface ClientReleveSalesBlink {
  readonly listerEnvoisSortis: typeof listerEnvoisSortis;
  readonly listerReponses: typeof listerReponses;
  readonly listerRapports: typeof listerRapports;
  readonly listerTachesReponse: typeof listerTachesReponse;
  readonly santeBoite: typeof santeBoite;
  readonly reconnecterBoite: typeof reconnecterBoite;
  readonly replanifier: typeof replanifier;
}

const clientReleveSalesBlinkReel: ClientReleveSalesBlink = {
  listerEnvoisSortis,
  listerReponses,
  listerRapports,
  listerTachesReponse,
  santeBoite,
  reconnecterBoite,
  replanifier,
};

/**
 * Un envoi (premier email) ou une tâche `reply` terminée marque l'action
 * `dispatched` correspondante `delivered`. Même appariement dans les deux cas
 * (organisation, canal email, statut `dispatched`), seule la colonne de
 * rapprochement change : `sequence_id` + `email` pour un premier envoi,
 * `reply_task_id` pour une relance.
 */
async function marquerActionLivreeParSequence(
  pool: Pool,
  org: string,
  p: { readonly sequenceId: string | null; readonly email: string; readonly messageId: string | null; readonly aMs: number },
): Promise<void> {
  await pool.query(
    `update actions set status = 'delivered',
            payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('message_id', $2::text, 'delivered_at', $3::timestamptz)
      where id = (
        select id from actions
         where organization_id = $1 and channel = 'email' and status in ('dispatched')
           and payload ->> 'sequence_id' = $4 and lower(payload ->> 'email') = lower($5)
         order by dispatched_at desc limit 1
      )`,
    [org, p.messageId, new Date(p.aMs).toISOString(), p.sequenceId, p.email],
  );
}

async function marquerActionLivreeParTacheReponse(pool: Pool, org: string, tache: EnvoiSorti): Promise<void> {
  await pool.query(
    `update actions set status = 'delivered',
            payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('message_id', $2::text, 'delivered_at', $3::timestamptz)
      where id = (
        select id from actions
         where organization_id = $1 and channel = 'email' and status = 'dispatched'
           and payload ->> 'reply_task_id' = $4
         order by dispatched_at desc limit 1
      )`,
    [org, tache.messageId, new Date(tache.termineMs ?? Date.now()).toISOString(), tache.id],
  );
}

/** Remet une action `scheduled` : `dispatched_at` et `provider_ref` repartent à zéro, seul le payload est fusionné. */
async function remettreEnAttente(pool: Pool, actionId: string, payloadSupplementaire: Record<string, unknown>): Promise<void> {
  await pool.query(
    `update actions set status = 'scheduled', dispatched_at = null, provider_ref = null,
            payload = coalesce(payload, '{}'::jsonb) || $2::jsonb
      where id = $1`,
    [actionId, JSON.stringify(payloadSupplementaire)],
  );
}

interface ActionEnErreur {
  readonly id: string;
  readonly essais: number;
}

/** Action `dispatched` d'une organisation, rattachée par `sequence_id` + `email` — même appariement que le marquage livré. */
async function actionParSequenceEtEmail(
  pool: Pool,
  org: string,
  sequenceId: string | null,
  email: string,
): Promise<ActionEnErreur | null> {
  const res = await pool.query<{ id: string; essais: string | null }>(
    `select id, payload ->> 'essais' as essais from actions
      where organization_id = $1 and channel = 'email' and status = 'dispatched'
        and payload ->> 'sequence_id' = $2 and lower(payload ->> 'email') = lower($3)
      order by dispatched_at desc limit 1`,
    [org, sequenceId, email],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, essais: Number(row.essais ?? 0) || 0 };
}

/** Action `dispatched` rattachée à une tâche `reply` SalesBlink par son identifiant. */
async function actionParTacheReponse(pool: Pool, org: string, tacheId: string): Promise<ActionEnErreur | null> {
  const res = await pool.query<{ id: string; essais: string | null }>(
    `select id, payload ->> 'essais' as essais from actions
      where organization_id = $1 and channel = 'email' and status = 'dispatched'
        and payload ->> 'reply_task_id' = $2
      order by dispatched_at desc limit 1`,
    [org, tacheId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return { id: row.id, essais: Number(row.essais ?? 0) || 0 };
}

/**
 * Rapports SalesBlink → réponses : `listerReponses` (endpoint `/replies`) ne
 * renvoie que des réponses, contrairement à `listerRapports` (`/reports`,
 * filtré par `message`) — chaque ligne devient donc un événement `repondu`,
 * sans filtrer sur `message`. `id` sert d'identifiant de déduplication
 * (`recordInboundReply` ne réenregistre jamais deux fois le même
 * `providerMessageId`) : sans lui, le même message reviendrait à chaque tour
 * tant qu'il reste dans la fenêtre `depuisMs`.
 */
function versEvenementsRepondus(reponses: Rapport[]): EvenementEmail[] {
  const evenements: EvenementEmail[] = [];
  for (const r of reponses) {
    if (!r.email) continue;
    evenements.push({ type: 'repondu', email: r.email, corps: r.corps ?? '', messageId: r.id || null, aMs: r.horodatageMs });
  }
  return evenements;
}

/** Motif d'échec stocké sur l'action : jamais le corps brut de SalesBlink au-delà de ce qu'a déjà tronqué `evenementsDepuisRapports`. */
function messageEchecRapport(motif: string): string {
  return `Envoi SalesBlink en échec (rapport) : ${motif}`;
}

/** `last_error` ne porte jamais la clé ni le corps de réponse — seulement le code et le statut HTTP. */
function formatErreurSync(err: ErreurSalesBlink): string {
  return err.statut !== null ? `${err.code} ${err.statut}` : err.code;
}

async function enregistrerCurseur(pool: Pool, org: string, cursorMs: number, lastError: string | null): Promise<void> {
  await pool.query(
    `insert into provider_sync_state (organization_id, provider, cursor_ms, last_run_at, last_error)
       values ($1, $2, $3, now(), $4)
     on conflict (organization_id, provider) do update
       set cursor_ms = $3, last_run_at = now(), last_error = $4`,
    [org, SALESBLINK_PROVIDER, cursorMs, lastError],
  );
}

interface SenderLie {
  readonly id: string;
  readonly identity: string;
  readonly provider_ref: string;
  readonly provider_state: { readonly derniere_notification_ms?: number } | null;
}

/**
 * Santé des expéditeurs SalesBlink de l'organisation. Une boîte dont l'envoi
 * est coupé déclenche une seule tentative de reconnexion ; si elle échoue, on
 * ne bloque PAS l'expéditeur (mesuré le 11/09 : la coupure est transitoire et
 * fréquente, et le handler d'envoi laisse déjà les actions en attente) — on
 * se contente de notifier, au plus une fois par heure et par expéditeur, la
 * dernière notification étant mémorisée dans `provider_state` lui-même.
 */
async function relangerSanteExpediteurs(
  pool: Pool,
  org: string,
  cle: string,
  client: ClientReleveSalesBlink,
): Promise<void> {
  const senders = await pool.query<SenderLie>(
    `select id, identity, provider_ref, provider_state from senders
      where organization_id = $1 and kind = 'email' and provider_ref is not null`,
    [org],
  );
  for (const sender of senders.rows) {
    let sante: SanteBoite = await client.santeBoite(sender.provider_ref, cle);
    if (!sante.envoiActif) {
      await client.reconnecterBoite(sender.provider_ref, cle);
      sante = await client.santeBoite(sender.provider_ref, cle);
    }

    const etat: Record<string, unknown> = {
      connectee: sante.connectee,
      envoiActif: sante.envoiActif,
      receptionActive: sante.receptionActive,
      sante: sante.sante,
      derniereErreur: sante.derniereErreur,
      // Champs mirroir lus par le handler d'envoi (`sender.provider_state?.sending_enabled`).
      sending_enabled: sante.envoiActif,
      receiving_enabled: sante.receptionActive,
    };

    if (!sante.envoiActif) {
      const maintenant = Date.now();
      const derniereNotif = sender.provider_state?.derniere_notification_ms ?? 0;
      if (maintenant - derniereNotif > UNE_HEURE_MS) {
        await notifyReply(pool, org, 'Expéditeur email déconnecté', sender.identity);
        etat.derniere_notification_ms = maintenant;
      } else {
        etat.derniere_notification_ms = derniereNotif;
      }
    }

    await pool.query(`update senders set provider_state = $2::jsonb where id = $1`, [sender.id, JSON.stringify(etat)]);
  }
}

/**
 * Relève périodique d'une organisation : envois terminés, réponses, rebonds,
 * désinscriptions, erreurs, tâches de relance en file, santé des boîtes, puis
 * avance du curseur. Toute `ErreurSalesBlink` interrompt le passage : le
 * curseur ne bouge pas et `last_error` retient code + statut (jamais la clé,
 * jamais le corps brut).
 */
export async function releverSalesBlink(
  ctx: { readonly pool: Pool; readonly encryptionKey?: string | undefined },
  data: { readonly organizationId: string },
  client: ClientReleveSalesBlink = clientReleveSalesBlinkReel,
): Promise<void> {
  const { pool, encryptionKey } = ctx;
  const org = data.organizationId;

  const credentials = await resolveProviderCredentials(pool, org, SALESBLINK_PROVIDER, { encryptionKey });
  const cle = credentials?.api_key;
  if (!cle) {
    console.warn(`[releve-salesblink] SalesBlink non configuré pour l’org ${org} — relève ignorée`);
    return;
  }
  const delaiMaxH = normaliserDelaiRelanceMax(credentials.reply_max_delay_h);

  const etatCurseur = await pool.query<{ cursor_ms: string | number | null }>(
    `select cursor_ms from provider_sync_state where organization_id = $1 and provider = $2`,
    [org, SALESBLINK_PROVIDER],
  );
  const departParDefaut = Date.now() - FENETRE_PREMIERE_RELEVE_MS;
  const brut = etatCurseur.rows[0]?.cursor_ms;
  const curseurDepart = brut !== undefined && brut !== null && Number(brut) > 0 ? Number(brut) : departParDefaut;

  let tousEvenements: EvenementEmail[] = [];

  try {
    // 2. Envois sortis terminés : marquent l'action livrée (message_id posé par SalesBlink).
    const envois = await client.listerEnvoisSortis(curseurDepart, cle);
    const evEnvoyes = evenementsDepuisEnvois(envois);
    tousEvenements = tousEvenements.concat(evEnvoyes);
    for (const ev of evEnvoyes) {
      if (ev.type !== 'envoye') continue;
      await marquerActionLivreeParSequence(pool, org, {
        sequenceId: ev.sequenceId,
        email: ev.email,
        messageId: ev.messageId,
        aMs: ev.aMs,
      });
    }

    // 3. Réponses : ouvrent le fil, arrêtent la séquence, notifient (règle n° 9).
    const reponses = await client.listerReponses(curseurDepart, cle);
    const evRepondus = versEvenementsRepondus(reponses);
    tousEvenements = tousEvenements.concat(evRepondus);
    for (const ev of evRepondus) {
      await traiterEvenementEmail(pool, org, ev, 'salesblink');
    }

    // 4. Rebonds et désinscriptions : suppriment l'adresse, arrêtent la séquence.
    const rapportsBounced = await client.listerRapports({ message: 'Bounced', depuisMs: curseurDepart }, cle);
    const evBounced = evenementsDepuisRapports(rapportsBounced);
    tousEvenements = tousEvenements.concat(evBounced);
    for (const ev of evBounced) {
      await traiterEvenementEmail(pool, org, ev, 'salesblink');
    }

    const rapportsUnsub = await client.listerRapports({ message: 'Unsubscribed', depuisMs: curseurDepart }, cle);
    const evUnsub = evenementsDepuisRapports(rapportsUnsub);
    tousEvenements = tousEvenements.concat(evUnsub);
    for (const ev of evUnsub) {
      await traiterEvenementEmail(pool, org, ev, 'salesblink');
    }

    // 5. Erreurs de séquence : nouvel essai (et replanification de la séquence
    // — SalesBlink ne rejoue pas seul un email tombé pendant une coupure
    // d'expéditeur) ou échec définitif selon `sortDErreur`.
    const rapportsErreur = await client.listerRapports({ message: 'Error', depuisMs: curseurDepart }, cle);
    const evErreurs = evenementsDepuisRapports(rapportsErreur);
    tousEvenements = tousEvenements.concat(evErreurs);
    const sequencesReplanifiees = new Set<string>();
    for (const ev of evErreurs) {
      if (ev.type !== 'erreur') continue;
      const action = await actionParSequenceEtEmail(pool, org, ev.sequenceId, ev.email);
      if (!action) continue;
      if (sortDErreur('serveur', action.essais) === 'reessayer') {
        await remettreEnAttente(pool, action.id, { essais: action.essais + 1 });
        if (ev.sequenceId && !sequencesReplanifiees.has(ev.sequenceId)) {
          sequencesReplanifiees.add(ev.sequenceId);
          await client.replanifier(ev.sequenceId, cle);
          await pool.query(
            `update email_transport_bindings set last_replanned_at = now()
              where organization_id = $1 and sequence_id = $2`,
            [org, ev.sequenceId],
          );
        }
      } else {
        await pool.query(`update actions set status = 'failed', error = $2 where id = $1`, [
          action.id,
          messageEchecRapport(ev.motif),
        ]);
      }
    }

    // 6. Tâches de relance (`reply`) en file chez SalesBlink : terminées →
    // livrées ; en erreur → repli immédiat, sans attendre le délai (mesuré le
    // 11/09 : une tâche en erreur n'est jamais rejouée par SalesBlink) ; trop
    // vieilles → repli forcé et notification.
    const taches = await client.listerTachesReponse(cle);
    const maintenant = Date.now();
    for (const tache of taches) {
      if (tache.termine) {
        await marquerActionLivreeParTacheReponse(pool, org, tache);
        continue;
      }
      if (tache.erreur) {
        const action = await actionParTacheReponse(pool, org, tache.id);
        if (!action) continue;
        if (sortDErreur('serveur', action.essais) === 'reessayer') {
          await remettreEnAttente(pool, action.id, { essais: action.essais + 1 });
        } else {
          await remettreEnAttente(pool, action.id, { mode_force: 'relance_repli' });
        }
        continue;
      }
      if (tache.planifieMs !== null && relanceTropVieille(tache.planifieMs, maintenant, delaiMaxH)) {
        const action = await actionParTacheReponse(pool, org, tache.id);
        if (!action) continue;
        await remettreEnAttente(pool, action.id, { mode_force: 'relance_repli' });
        await notifyReply(pool, org, 'Relance en retard', 'Relance en retard, renvoyée en nouvel email.');
      }
    }

    // 7. Santé des expéditeurs liés à l'organisation.
    await relangerSanteExpediteurs(pool, org, cle, client);

    // 8. Curseur : avance au maximum des horodatages des événements du passage.
    const nouveauCurseur = curseurSuivant(tousEvenements, curseurDepart);
    await enregistrerCurseur(pool, org, nouveauCurseur, null);
  } catch (err) {
    if (err instanceof ErreurSalesBlink) {
      await enregistrerCurseur(pool, org, curseurDepart, formatErreurSync(err));
      console.error(`[releve-salesblink] org ${org} : erreur SalesBlink (${err.code})`);
      return;
    }
    throw err;
  }
}

interface CredentialRow {
  readonly organization_id: string;
  readonly config: { readonly sync_interval_min?: string } | null;
}

/**
 * Enfile un `inbox.sync` par organisation ayant une clé SalesBlink configurée,
 * dédupliqué par fenêtre (`sync_interval_min` de l'organisation, réglable à
 * l'écran Fournisseurs — jamais lu dans l'environnement). Appelé par un
 * minuteur de 60 s (`index.ts`) : `produire()` tourne toutes les 15 minutes,
 * trop lâche pour un intervalle par défaut de 5 minutes.
 */
export async function enqueueReleveSalesBlink(boss: PgBoss, pool: Pool): Promise<number> {
  const res = await pool.query<CredentialRow>(`select organization_id, config from credentials where provider_id = $1`, [
    SALESBLINK_PROVIDER,
  ]);
  let enqueued = 0;
  for (const row of res.rows) {
    const intervalMin = normaliserIntervalleReleve(row.config?.sync_interval_min);
    const bucket = currentBucket(intervalMin * 60_000);
    await boss.insert([
      {
        name: 'inbox.sync',
        id: deterministicUuid('releve-salesblink', row.organization_id, bucket),
        data: { organizationId: row.organization_id },
      },
    ]);
    enqueued += 1;
  }
  return enqueued;
}

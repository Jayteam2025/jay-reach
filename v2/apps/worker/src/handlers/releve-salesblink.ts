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
 * Fenêtre bornée (revue du 11/09) : un curseur unique avancé au max des
 * horodatages de tous les flux peut sauter un événement en retard sur l'un
 * d'eux si un autre flux, plus rapide, a poussé le curseur plus loin. Chaque
 * passage traite donc une fenêtre fermée `[depuis, jusqua)` d'au plus une
 * heure (`FENETRE_RELEVE_MAX_MS`), avec deux minutes de retard de sécurité
 * (`RETARD_SECURITE_MS`) sur le bord le plus récent — un retard de plusieurs
 * heures se rattrape par tranches d'une heure, un passage à la fois, sans
 * rien sauter. Le curseur n'avance QUE jusqu'à `jusqua`, jamais au-delà (I1,
 * revue finale du 11/09) : `completed_time` d'un envoi peut tomber après la
 * fin de la fenêtre demandée à l'API (`/inbox` ne le documente même pas comme
 * filtre), et faire avancer le curseur sur cet horodatage sauterait tout ce
 * qui vit dans l'intervalle — une réponse, un rebond — au passage suivant.
 *
 * Budget d'appels par passage (fenêtre non saturée) : 6 GET fixes (les cinq
 * flux datés — envois, réponses, rebonds, désinscriptions, erreurs — plus les
 * tâches `reply`), plus jusqu'à 4 pages supplémentaires par flux daté si sa
 * liste dépasse cent éléments (`PAGES_MAX_PAR_DEFAUT` de
 * `packages/providers`), plus un appel de santé par expéditeur SalesBlink lié
 * (et un second, exceptionnel, après une reconnexion).
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
  sortDErreur,
  relanceTropVieille,
  traiterEvenementEmail,
  notifier,
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
  PAGES_MAX_PAR_DEFAUT,
  TAILLE_PAGE_RAPPORTS,
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
/** Largeur maximale d'une fenêtre de relève : un retard se rattrape par tranches d'une heure. */
export const FENETRE_RELEVE_MAX_MS = 60 * 60 * 1000;
/** Retard de sécurité sur le bord le plus récent de la fenêtre : les tout derniers événements peuvent encore arriver. */
export const RETARD_SECURITE_MS = 2 * 60 * 1000;
/** Un flux dont la page est pleine à ce plafond a probablement plus à dire que ce que la fenêtre a pu lire. */
const SEUIL_SATURATION = PAGES_MAX_PAR_DEFAUT * TAILLE_PAGE_RAPPORTS;

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
  const res = await pool.query<{ id: string }>(
    `update actions set status = 'delivered',
            payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('message_id', $2::text, 'delivered_at', $3::timestamptz)
      where id = (
        select id from actions
         where organization_id = $1 and channel = 'email' and status in ('dispatched')
           and payload ->> 'sequence_id' = $4 and lower(payload ->> 'email') = lower($5)
         order by dispatched_at desc limit 1
      )
      returning id`,
    [org, p.messageId, new Date(p.aMs).toISOString(), p.sequenceId, p.email],
  );
  const actionId = res.rows[0]?.id;
  if (actionId && p.messageId) {
    await poserProviderMessageId(pool, actionId, p.messageId);
  }
}

async function marquerActionLivreeParTacheReponse(pool: Pool, org: string, tache: EnvoiSorti): Promise<void> {
  const res = await pool.query<{ id: string }>(
    `update actions set status = 'delivered',
            payload = coalesce(payload, '{}'::jsonb) || jsonb_build_object('message_id', $2::text, 'delivered_at', $3::timestamptz)
      where id = (
        select id from actions
         where organization_id = $1 and channel = 'email' and status = 'dispatched'
           and payload ->> 'reply_task_id' = $4
         order by dispatched_at desc limit 1
      )
      returning id`,
    [org, tache.messageId, new Date(tache.termineMs ?? Date.now()).toISOString(), tache.id],
  );
  const actionId = res.rows[0]?.id;
  if (actionId && tache.messageId) {
    await poserProviderMessageId(pool, actionId, tache.messageId);
  }
}

/**
 * Pose `provider_message_id` sur le message sortant du fil, une fois
 * SalesBlink le donne à la relève (I4, revue finale du 11/09) — le message
 * lui-même a été écrit sans lui au moment de l'envoi (`email-salesblink.ts`),
 * `raw->>'action_id'` le rattache à l'action qui vient d'être livrée.
 */
async function poserProviderMessageId(pool: Pool, actionId: string, messageId: string): Promise<void> {
  await pool.query(
    `update thread_messages set provider_message_id = $2
      where raw ->> 'action_id' = $1 and provider_message_id is null`,
    [actionId, messageId],
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

/**
 * Une liste dont la longueur atteint pile `PAGES_MAX_PAR_DEFAUT × TAILLE_PAGE_RAPPORTS`
 * a rempli toutes ses pages : la fenêtre est saturée pour ce flux, il en reste
 * peut-être au-delà. On ne bloque pas la relève pour autant (avec une fenêtre
 * d'une heure et cinq cents événements par flux, le cas est irréaliste pour ce
 * produit) — juste une alerte visible : le curseur avance quand même, mais
 * `last_error` porte la marque plutôt que de rester `null`.
 */
function verifierSaturation(org: string, nomFlux: string, longueur: number): string | null {
  if (longueur !== SEUIL_SATURATION) return null;
  console.warn(
    `[releve-salesblink] org ${org} : fenêtre saturée sur le flux « ${nomFlux} » (${longueur} éléments) — le passage suivant reprend là où celui-ci s'arrête`,
  );
  return nomFlux;
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
        await notifier(pool, org, 'sender.disconnected', 'Expéditeur email déconnecté', sender.identity);
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
 * avance du curseur à la fin de la fenêtre traitée. Toute `ErreurSalesBlink`
 * interrompt le passage : le curseur ne bouge pas et `last_error` retient
 * code + statut (jamais la clé, jamais le corps brut).
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

  const etatCurseur = await pool.query<{ cursor_ms: string | number | null; last_error: string | null }>(
    `select cursor_ms, last_error from provider_sync_state where organization_id = $1 and provider = $2`,
    [org, SALESBLINK_PROVIDER],
  );
  const departParDefaut = Date.now() - FENETRE_PREMIERE_RELEVE_MS;
  const brut = etatCurseur.rows[0]?.cursor_ms;
  const curseurDepart = brut !== undefined && brut !== null && Number(brut) > 0 ? Number(brut) : departParDefaut;
  const lastErrorPrecedent = etatCurseur.rows[0]?.last_error ?? null;

  const maintenant = Date.now();
  // Fenêtre fermée [curseurDepart, jusqua) : au plus une heure d'un coup, et
  // jamais plus près du présent que RETARD_SECURITE_MS (les tout derniers
  // événements peuvent encore arriver chez SalesBlink).
  const jusqua = Math.min(maintenant - RETARD_SECURITE_MS, curseurDepart + FENETRE_RELEVE_MAX_MS);
  const fenetreOuverte = jusqua > curseurDepart;

  const fluxSatures: string[] = [];

  try {
    if (fenetreOuverte) {
      // 2. Envois sortis terminés : marquent l'action livrée (message_id posé par SalesBlink).
      const envois = await client.listerEnvoisSortis(curseurDepart, cle, { jusquaMs: jusqua });
      const s1 = verifierSaturation(org, 'envois', envois.length);
      if (s1) fluxSatures.push(s1);
      const evEnvoyes = evenementsDepuisEnvois(envois);
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
      const reponses = await client.listerReponses(curseurDepart, cle, { jusquaMs: jusqua });
      const s2 = verifierSaturation(org, 'reponses', reponses.length);
      if (s2) fluxSatures.push(s2);
      const evRepondus = versEvenementsRepondus(reponses);
      for (const ev of evRepondus) {
        await traiterEvenementEmail(pool, org, ev, 'salesblink');
      }

      // 4. Rebonds et désinscriptions : suppriment l'adresse, arrêtent la séquence.
      const rapportsBounced = await client.listerRapports(
        { message: 'Bounced', depuisMs: curseurDepart, jusquaMs: jusqua },
        cle,
      );
      const s3 = verifierSaturation(org, 'bounced', rapportsBounced.length);
      if (s3) fluxSatures.push(s3);
      const evBounced = evenementsDepuisRapports(rapportsBounced);
      for (const ev of evBounced) {
        await traiterEvenementEmail(pool, org, ev, 'salesblink');
      }

      const rapportsUnsub = await client.listerRapports(
        { message: 'Unsubscribed', depuisMs: curseurDepart, jusquaMs: jusqua },
        cle,
      );
      const s4 = verifierSaturation(org, 'unsubscribed', rapportsUnsub.length);
      if (s4) fluxSatures.push(s4);
      const evUnsub = evenementsDepuisRapports(rapportsUnsub);
      for (const ev of evUnsub) {
        await traiterEvenementEmail(pool, org, ev, 'salesblink');
      }

      // 5. Erreurs de séquence : nouvel essai (et replanification de la séquence
      // — SalesBlink ne rejoue pas seul un email tombé pendant une coupure
      // d'expéditeur) ou échec définitif selon `sortDErreur`.
      const rapportsErreur = await client.listerRapports(
        { message: 'Error', depuisMs: curseurDepart, jusquaMs: jusqua },
        cle,
      );
      const s5 = verifierSaturation(org, 'erreur', rapportsErreur.length);
      if (s5) fluxSatures.push(s5);
      const evErreurs = evenementsDepuisRapports(rapportsErreur);
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
    }

    // 6. Tâches de relance (`reply`) en file chez SalesBlink : terminées →
    // livrées ; en erreur → repli immédiat, sans attendre le délai (mesuré le
    // 11/09 : une tâche en erreur n'est jamais rejouée par SalesBlink) ; trop
    // vieilles → repli forcé et notification. Ce flux n'a pas de fenêtre
    // temporelle (SalesBlink ne le filtre pas par date) : il tourne à chaque
    // passage, même quand la fenêtre datée ci-dessus est encore trop fraîche.
    const { taches, sature: tachesSaturees } = await client.listerTachesReponse(cle);
    if (tachesSaturees) {
      fluxSatures.push('taches_reply');
      console.warn(
        `[releve-salesblink] org ${org} : fenêtre saturée sur le flux « taches_reply » (totalCount dépasse ce qui a été récupéré) — le passage suivant reprend là où celui-ci s'arrête`,
      );
    }
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
        await notifier(pool, org, 'email.reply_late', 'Relance en retard', 'Relance en retard, renvoyée en nouvel email.');
      }
    }

    // 7. Santé des expéditeurs liés à l'organisation — pas de fenêtre non plus.
    await relangerSanteExpediteurs(pool, org, cle, client);

    // 8. Curseur : avance TOUJOURS jusqu'à `jusqua`, jamais au-delà (I1) —
    // fenêtre encore trop fraîche (`!fenetreOuverte`) : les flux datés n'ont
    // pas tourné, rien à avancer. Un passage complet qui se termine proprement
    // efface `last_error` ; un passage à fenêtre trop fraîche ne doit PAS
    // écraser un `last_error` non résolu du passage précédent (minor, revue
    // finale du 11/09) — sauf si les tâches reply ou la santé des boîtes
    // (étapes 6-7, qui tournent quel que soit l'état de la fenêtre) viennent
    // justement de constater une nouvelle saturation.
    if (fenetreOuverte) {
      const lastError = fluxSatures.length > 0 ? `fenetre_saturee:${fluxSatures[0]}` : null;
      await enregistrerCurseur(pool, org, jusqua, lastError);
    } else {
      const lastError = fluxSatures.length > 0 ? `fenetre_saturee:${fluxSatures[0]}` : lastErrorPrecedent;
      await enregistrerCurseur(pool, org, curseurDepart, lastError);
    }
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
 * Enfile un `inbox.sync` par organisation ayant une clé SalesBlink configurée
 * (`status = 'configured'` — minor de la revue finale du 11/09 : une ligne
 * posée par le catalogue mais jamais remplie enfilait quand même un passage
 * toutes les cinq minutes, pour un simple avertissement), dédupliqué par
 * fenêtre (`sync_interval_min` de l'organisation, réglable à l'écran
 * Fournisseurs — jamais lu dans l'environnement). Appelé par un minuteur de
 * 60 s (`index.ts`) : `produire()` tourne toutes les 15 minutes, trop lâche
 * pour un intervalle par défaut de 5 minutes.
 */
export async function enqueueReleveSalesBlink(boss: PgBoss, pool: Pool): Promise<number> {
  const res = await pool.query<CredentialRow>(
    `select organization_id, config from credentials where provider_id = $1 and status = 'configured'`,
    [SALESBLINK_PROVIDER],
  );
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

/**
 * Réponse de l'opérateur à un message LinkedIn, depuis Jay Reach.
 *
 * Elle ne peut pas suivre `repondreAuFil` (transports synchrones qui rendent un identifiant tout
 * de suite) : l'envoi LinkedIn passe par le navigateur du worker, plus tard. La réponse est donc
 * ENFILÉE dans `linkedin_action_queue` avec `origine = 'reponse'`, et écrite dans le fil avec
 * l'état `en_cours` pour que l'opérateur la voie dès qu'il l'a saisie.
 *
 * `origine = 'reponse'` porte les exceptions de `file.ts` : elle passe devant les lignes de
 * séquence, hors fenêtre horaire, hors rythme et hors plafond hebdomadaire, et la garde
 * d'exclusion de la réclamation ne l'arrête pas (on répond à quelqu'un que sa réponse vient
 * d'exclure). L'annulation d'une exclusion l'épargne aussi.
 *
 * Le message du fil a quatre états, tous lisibles dans `thread_messages.raw.etat` :
 *  - `en_cours`   : enfilé, pas parti (`sent_at` nul) ;
 *  - absent       : parti (`marquerReponseEnvoyee` pose `sent_at` et retire la clé) ;
 *  - `echec`      : l'envoi a échoué définitivement, RIEN n'est parti : renvoyer est sûr ;
 *  - `a_verifier` : on ignore si le message est parti (résultat indéterminé) : renvoyer risque un
 *    doublon à un humain. Jamais confondu avec `echec` : l'asymétrie décide (un « à vérifier » sur un
 *    échec réel coûte un coup d'oeil, un « échec » sur un message livré coûte un doublon).
 *
 * Aucun message ne reste `en_cours` quand sa ligne de file est sortie de `pending`/`processing` :
 * `balayerReponsesSansSort` (rejouée à chaque tick par `reparerLignesCoincees`) le date ou le
 * signale, quoi qu'il soit arrivé à l'écriture directe.
 */

/** Code posé sur une ligne dont on ignore si elle est partie (voir `file.ts`). */
export const CODE_RESULTAT_INDETERMINE = 'resultat_indetermine';
import type { Executeur } from '../executeur.js';
import { ErreurReponseImpossible } from '../inbox/erreur-reponse.js';
import { enregistrerMessageSortant } from '../inbox/message-sortant.js';
import { notifier } from '../inbox/record-reply.js';
import { lienProfilDeduit } from '../fonctions/sources.js';
import { dansUneTransaction } from '../transaction.js';
import { normaliserUrnLinkedIn } from './identite.js';

export const EVENEMENT_REPONSE_ECHOUEE = 'linkedin.reponse_echouee';

export async function enfilerReponseLinkedIn(
  ex: Executeur,
  org: string,
  p: { threadId: string; corps: string },
): Promise<{ ligneId: string }> {
  const corps = p.corps.trim();
  if (corps === '') throw new ErreurReponseImpossible('impossible de répondre : le message est vide');

  const fil = await ex.query<{
    channel: string;
    contact_id: string | null;
    linkedin_url: string | null;
    linkedin_provider_id: string | null;
  }>(
    `select t.channel::text as channel, t.contact_id, c.linkedin_url, c.linkedin_provider_id
       from threads t
       left join contacts c on c.id = t.contact_id and c.organization_id = t.organization_id
      where t.id = $2 and t.organization_id = $1`,
    [org, p.threadId],
  );
  const ligne = fil.rows[0];
  if (!ligne) throw new ErreurReponseImpossible('impossible de répondre : fil introuvable');
  if (ligne.channel !== 'linkedin_message') {
    throw new ErreurReponseImpossible("impossible de répondre : ce fil n'est pas un fil LinkedIn");
  }
  // Un contact né d'un message (rattaché par URN) peut n'avoir que l'identifiant : l'adresse se déduit,
  // SEULEMENT si l'identifiant est reconnu comme un membre (jamais une adresse fabriquée sur un texte quelconque).
  const url =
    ligne.linkedin_url ??
    (ligne.linkedin_provider_id && normaliserUrnLinkedIn(ligne.linkedin_provider_id) !== null
      ? lienProfilDeduit(ligne.linkedin_provider_id)
      : null);
  if (!ligne.contact_id || !url) {
    throw new ErreurReponseImpossible("impossible de répondre : l'adresse LinkedIn du contact est inconnue");
  }
  const contactId = ligne.contact_id;

  // Une transaction : une ligne en file sans trace dans le fil enverrait un message que l'opérateur
  // ne verrait pas, et une trace sans ligne annoncerait « en cours » un message qui ne partira jamais.
  return dansUneTransaction(ex, async (tx) => {
    const ins = await tx.query<{ id: string }>(
      `insert into linkedin_action_queue /* jr:linkedin_reponse_enfiler */
         (organization_id, contact_id, linkedin_url, kind, message_body, method, status, origine, scheduled_for)
       values ($1, $2, $3, 'message', $4, 'serveur', 'pending', 'reponse', now())
       returning id`,
      [org, contactId, url, corps],
    );
    const ligneId = ins.rows[0]!.id;
    await enregistrerMessageSortant(tx, {
      organizationId: org,
      contactId,
      channel: 'linkedin_message',
      body: corps,
      etat: 'en_cours',
      raw: { queue_id: ligneId },
    });
    // L'opérateur vient d'agir sur ce fil : il n'attend plus rien de lui.
    await tx.query(`update threads set is_read = true where id = $1 and organization_id = $2`, [p.threadId, org]);
    return { ligneId };
  });
}

/**
 * Le message de la réponse est parti : il porte une date et perd son état. UNE ligne de
 * `thread_messages`, mise à jour sur place, jamais une seconde. Rend false quand la ligne
 * n'est pas une réponse en cours (action de séquence, ou message déjà marqué).
 */
export async function marquerReponseEnvoyee(ex: Executeur, org: string, queueId: string): Promise<boolean> {
  const res = await ex.query(
    `update thread_messages m /* jr:linkedin_reponse_envoyee */
        set sent_at = now(), raw = coalesce(m.raw, '{}'::jsonb) - 'etat'
       from threads t
      where t.id = m.thread_id and t.organization_id = $1
        and m.direction = 'out' and m.raw ->> 'queue_id' = $2 and m.raw ->> 'etat' = 'en_cours'`,
    [org, queueId],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * L'envoi d'une réponse a échoué définitivement. La ligne n'a ni action ni inscription, donc
 * `arreterSequenceDeLaLigne` ne prévient personne : on le fait ici. Le message du fil quitte
 * `en_cours` (`echec`, ou `a_verifier` quand le résultat est indéterminé) et les membres sont
 * notifiés, dans UNE transaction : un message basculé sans notification ne se rattraperait jamais
 * (seul un message `en_cours` bascule). Idempotent : une retentative ne notifie pas deux fois, et une
 * ligne de séquence (jamais `en_cours`) est ignorée. Rend true quand il a notifié.
 */
export async function signalerEchecReponse(
  ex: Executeur,
  org: string,
  queueId: string,
  code: string,
  message: string,
): Promise<boolean> {
  const etat = code === CODE_RESULTAT_INDETERMINE ? 'a_verifier' : 'echec';
  return dansUneTransaction(ex, async (tx) => {
    const res = await tx.query(
      `update thread_messages m /* jr:linkedin_reponse_echec */
          set raw = coalesce(m.raw, '{}'::jsonb) || jsonb_build_object('etat', $4::text, 'code', $3::text)
         from threads t
        where t.id = m.thread_id and t.organization_id = $1
          and m.direction = 'out' and m.raw ->> 'queue_id' = $2 and m.raw ->> 'etat' = 'en_cours'`,
      [org, queueId, code, etat],
    );
    if ((res.rowCount ?? 0) === 0) return false;
    await notifier(
      tx,
      org,
      EVENEMENT_REPONSE_ECHOUEE,
      etat === 'a_verifier' ? 'Réponse LinkedIn à vérifier' : 'Réponse LinkedIn non envoyée',
      message,
    );
    return true;
  });
}

/**
 * Filet : tout message `en_cours` dont la ligne de file n'est plus en route trouve son sort.
 *  - ligne `sent` : la réponse EST partie, mais l'écriture directe du départ a échoué (base
 *    indisponible à cet instant) : le message est daté ici ;
 *  - ligne `failed` / `cancelled` : le signalement direct a échoué (ou n'a pas eu lieu) : le message
 *    passe à `echec` / `a_verifier` et les membres sont notifiés.
 * Idempotent, borné à l'organisation. Rend le nombre de messages réglés.
 */
export async function balayerReponsesSansSort(ex: Executeur, org: string): Promise<number> {
  const parties = await ex.query(
    `update thread_messages m /* jr:linkedin_reponse_balayage_partie */
        set sent_at = coalesce(q.sent_at, now()), raw = coalesce(m.raw, '{}'::jsonb) - 'etat'
       from threads t, linkedin_action_queue q
      where t.id = m.thread_id and t.organization_id = $1
        and q.id::text = m.raw ->> 'queue_id' and q.organization_id = $1 and q.origine = 'reponse' and q.status = 'sent'
        and m.direction = 'out' and m.raw ->> 'etat' = 'en_cours'`,
    [org],
  );
  const mortes = await ex.query<{ id: string; error_code: string | null; error_message: string | null }>(
    `select q.id, q.error_code, q.error_message /* jr:linkedin_reponse_balayage_morte */
       from linkedin_action_queue q
       join thread_messages m on m.raw ->> 'queue_id' = q.id::text and m.direction = 'out' and m.raw ->> 'etat' = 'en_cours'
       join threads t on t.id = m.thread_id and t.organization_id = q.organization_id
      where q.organization_id = $1 and q.origine = 'reponse' and q.status in ('failed', 'cancelled')`,
    [org],
  );
  let regles = parties.rowCount ?? 0;
  for (const l of mortes.rows) {
    const code = l.error_code ?? 'echec';
    const texte = l.error_message ?? 'L’envoi de la réponse a échoué.';
    if (await signalerEchecReponse(ex, org, l.id, code, texte)) regles += 1;
  }
  return regles;
}

/** Existe-t-il un message de réponse `en_cours` dont la ligne de file n'est plus en route ? Sonde du producteur. */
export async function existeReponseSansSort(ex: Executeur, org: string): Promise<boolean> {
  const res = await ex.query<{ existe: boolean }>(
    `select exists (
        select 1 from linkedin_action_queue q /* jr:linkedin_reponse_sans_sort */
          join thread_messages m on m.raw ->> 'queue_id' = q.id::text and m.direction = 'out' and m.raw ->> 'etat' = 'en_cours'
          join threads t on t.id = m.thread_id and t.organization_id = q.organization_id
         where q.organization_id = $1 and q.origine = 'reponse' and q.status in ('sent', 'failed', 'cancelled')
      ) as existe`,
    [org],
  );
  return res.rows[0]?.existe === true;
}

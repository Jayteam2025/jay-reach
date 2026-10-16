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
 * Le message du fil a trois états, tous lisibles dans `thread_messages.raw.etat` :
 *  - `en_cours` : enfilé, pas parti (`sent_at` nul) ;
 *  - absent     : parti (`marquerReponseEnvoyee` pose `sent_at` et retire la clé) ;
 *  - `echec`    : l'envoi a échoué définitivement (`signalerEchecReponse`), il ne partira plus.
 */
import type { Executeur } from '../executeur.js';
import { ErreurReponseImpossible } from '../inbox/erreur-reponse.js';
import { enregistrerMessageSortant } from '../inbox/message-sortant.js';
import { notifier } from '../inbox/record-reply.js';
import { dansUneTransaction } from '../transaction.js';

export const EVENEMENT_REPONSE_ECHOUEE = 'linkedin.reponse_echouee';

export async function enfilerReponseLinkedIn(
  ex: Executeur,
  org: string,
  p: { threadId: string; corps: string },
): Promise<{ ligneId: string }> {
  const corps = p.corps.trim();
  if (corps === '') throw new ErreurReponseImpossible('impossible de répondre : le message est vide');

  const fil = await ex.query<{ channel: string; contact_id: string | null; linkedin_url: string | null }>(
    `select t.channel::text as channel, t.contact_id, c.linkedin_url
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
  if (!ligne.contact_id || !ligne.linkedin_url) {
    throw new ErreurReponseImpossible("impossible de répondre : l'adresse LinkedIn du contact est inconnue");
  }
  const { contact_id: contactId, linkedin_url: url } = ligne;

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
 * `arreterSequenceDeLaLigne` ne prévient personne : on le fait ici. Le message du fil passe à
 * `echec` (il ne reste pas `en_cours` indéfiniment, ce qui mentirait) et les membres sont
 * notifiés. Idempotent : seul un message encore `en_cours` bascule, donc une retentative ne notifie
 * pas deux fois, et une ligne de séquence (jamais `en_cours`) est ignorée. Rend true quand il a notifié.
 */
export async function signalerEchecReponse(
  ex: Executeur,
  org: string,
  queueId: string,
  code: string,
  message: string,
): Promise<boolean> {
  const res = await ex.query(
    `update thread_messages m /* jr:linkedin_reponse_echec */
        set raw = coalesce(m.raw, '{}'::jsonb) || jsonb_build_object('etat', 'echec', 'code', $3::text)
       from threads t
      where t.id = m.thread_id and t.organization_id = $1
        and m.direction = 'out' and m.raw ->> 'queue_id' = $2 and m.raw ->> 'etat' = 'en_cours'`,
    [org, queueId, code],
  );
  if ((res.rowCount ?? 0) === 0) return false;
  await notifier(ex, org, EVENEMENT_REPONSE_ECHOUEE, 'Réponse LinkedIn non envoyée', message);
  return true;
}

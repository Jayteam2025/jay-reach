/**
 * Réponse à un fil de la Réception (lot 3 bis, tâche 3).
 *
 * Le transport n'est jamais choisi par préférence : il est imposé par
 * l'origine du dernier message REÇU du fil. Une boîte relevée par Microsoft
 * Graph (`thread_messages.headers->>'transport' = 'microsoft_graph'`, posé
 * par la relève de la tâche 2) se répond par Graph, dans le même fil de
 * conversation ; tout le reste — aujourd'hui uniquement SalesBlink — se
 * répond via `provider_message_id`, l'identifiant de tâche SalesBlink.
 *
 * Vit dans `packages/core` (pas d'import `pg`) : les deux transports sont
 * injectés par l'appelant, jamais appelés en dur d'ici — un test unitaire
 * peut donc couvrir tout l'algorithme sans réseau ni base réelle.
 */
import type { Executeur } from '../executeur.js';

export type TransportReponse = 'microsoft_graph' | 'salesblink';

/**
 * Erreur d'entrée : le fil ne peut pas recevoir de réponse dans son état
 * actuel (aucun message reçu, ou message reçu sans l'identifiant nécessaire
 * pour lui répondre). Ne porte jamais de secret ni de clé — uniquement un
 * message d'explication destiné à l'opérateur.
 */
export class ErreurEntree extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ErreurEntree';
  }
}

export interface OrigineMessage {
  readonly transport: TransportReponse;
  readonly messageId: string;
  readonly mailbox: string | null;
}

/**
 * Détermine par quel transport répondre à un fil, à partir du dernier message
 * `thread_messages` en direction `in` du fil (filtré par organisation).
 *
 * `null` quand le fil n'a encore reçu aucun message : on ne sait alors pas
 * répondre. Les en-têtes du message (`headers->>'transport'`, posés par la
 * relève Graph de la tâche 2) priment ; leur absence signifie un message venu
 * de SalesBlink, dont l'identifiant de tâche `/inbox` est le seul que
 * `repondreDansLeFil` sache utiliser.
 */
export async function choisirTransport(ex: Executeur, org: string, threadId: string): Promise<OrigineMessage | null> {
  const res = await ex.query<{
    transport: string | null;
    mailbox: string | null;
    graph_message_id: string | null;
    salesblink_inbox_message_id: string | null;
    salesblink_reply_id: string | null;
    provider_message_id: string | null;
  }>(
    `select m.headers ->> 'transport' as transport,
            m.headers ->> 'mailbox' as mailbox,
            m.headers ->> 'graph_message_id' as graph_message_id,
            m.headers ->> 'salesblink_inbox_message_id' as salesblink_inbox_message_id,
            m.headers ->> 'salesblink_reply_id' as salesblink_reply_id,
            m.provider_message_id as provider_message_id
       from thread_messages m
       join threads t on t.id = m.thread_id
      where t.id = $2 and t.organization_id = $1 and m.direction = 'in'
      order by m.sent_at desc nulls last
      limit 1`,
    [org, threadId],
  );
  const dernier = res.rows[0];
  if (!dernier) return null;

  if (dernier.transport === 'microsoft_graph') {
    if (!dernier.graph_message_id) {
      throw new ErreurEntree(
        "impossible de répondre : identifiant Microsoft Graph du message d'origine manquant",
      );
    }
    return { transport: 'microsoft_graph', messageId: dernier.graph_message_id, mailbox: dernier.mailbox };
  }

  // SalesBlink répond sur `/inbox/{messageId}/reply` : l'endpoint n'accepte
  // que l'identifiant d'une tâche `/inbox`, jamais celui d'une ligne du
  // journal `/replies`. La relève pose le premier dans
  // `salesblink_inbox_message_id` dès qu'une tâche a pu être appariée ; sans
  // appariement, elle retombe sur l'identifiant du journal, qu'elle recopie
  // dans `salesblink_reply_id` — le reconnaître ici évite de poster sur une
  // adresse que SalesBlink refusera.
  const identifiantTache = dernier.salesblink_inbox_message_id ?? null;
  if (identifiantTache) {
    return { transport: 'salesblink', messageId: identifiantTache, mailbox: null };
  }
  const identifiant = dernier.provider_message_id;
  if (!identifiant || identifiant === dernier.salesblink_reply_id) {
    throw new ErreurEntree("impossible de répondre : message d'origine inconnu");
  }
  return { transport: 'salesblink', messageId: identifiant, mailbox: null };
}

export interface TransportsReponse {
  readonly graph: (mailbox: string, messageId: string, corpsHtml: string) => Promise<void>;
  readonly salesblink: (messageId: string, corpsHtml: string) => Promise<{ idTache: string }>;
}

export interface ReponseEnvoyee {
  readonly messageId: string;
  readonly transport: TransportReponse;
}

/**
 * Envoie une réponse dans un fil : choisit le transport (`choisirTransport`),
 * l'appelle, puis enregistre le message sortant et remet le fil à jour (lu,
 * horodaté). Les deux transports sont fournis par l'appelant — jamais
 * importés ici — pour rester testable sans réseau.
 */
export async function repondreAuFil(
  ex: Executeur,
  org: string,
  p: { threadId: string; corpsHtml: string },
  transports: TransportsReponse,
): Promise<ReponseEnvoyee> {
  const origine = await choisirTransport(ex, org, p.threadId);
  if (!origine) {
    throw new ErreurEntree("impossible de répondre : message d'origine inconnu");
  }

  let providerMessageId: string | null;
  if (origine.transport === 'microsoft_graph') {
    if (!origine.mailbox) {
      throw new ErreurEntree("impossible de répondre : boîte Microsoft Graph du message d'origine manquante");
    }
    await transports.graph(origine.mailbox, origine.messageId, p.corpsHtml);
    providerMessageId = null;
  } else {
    const { idTache } = await transports.salesblink(origine.messageId, p.corpsHtml);
    providerMessageId = idTache;
  }

  const insere = await ex.query<{ id: string }>(
    `insert into thread_messages (thread_id, direction, body, provider_message_id, headers, sent_at)
     values ($1, 'out', $2, $3, $4::jsonb, now())
     returning id`,
    [p.threadId, p.corpsHtml, providerMessageId, JSON.stringify({ transport: origine.transport })],
  );

  const maj = await ex.query(
    `update threads set last_message_at = now(), is_read = true where id = $1 and organization_id = $2`,
    [p.threadId, org],
  );
  if ((maj.rowCount ?? 0) !== 1) {
    throw new Error('fil introuvable pour la mise à jour (organisation ou identifiant incorrects)');
  }

  return { messageId: insere.rows[0]!.id, transport: origine.transport };
}

function echapperHtml(valeur: string): string {
  return valeur.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Convertit un texte brut saisi dans la zone de réponse en HTML minimal :
 * une ligne vide sépare deux paragraphes (`<p>`), un simple retour à la ligne
 * devient `<br>`. Le texte est échappé avant conversion — aucune balise saisie
 * par l'opérateur n'est jamais interprétée.
 */
export function texteVersHtml(corps: string): string {
  return corps
    .split(/\n{2,}/)
    .map((paragraphe) => `<p>${echapperHtml(paragraphe).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

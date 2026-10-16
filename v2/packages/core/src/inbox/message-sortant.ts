/**
 * Enregistrement d'un message SORTANT dans le fil du contact, quel que soit le canal.
 *
 * Le chemin que l'email SalesBlink suivait seul (`assurerFil` puis insertion en `out`), extrait
 * pour que LinkedIn le partage au lieu de le recopier : sans lui, une réponse arrive dans un fil
 * qui ne montre que sa moitié. `assurerFil` ne touche ni la classification ni l'état de lecture
 * d'un fil existant, et un fil qu'il crée naît lu : rien n'attend l'opérateur tant qu'aucune
 * réponse n'est arrivée.
 *
 * `etat` porte la seule différence entre un message parti et un message que l'opérateur vient de
 * saisir et dont la ligne de file n'est pas encore partie : `en_cours` ne pose pas `sent_at` (il
 * n'a pas de date d'envoi) et marque `raw.etat`.
 */
import type { Executeur } from '../executeur.js';
import { assurerFil, type ReplyChannel } from './record-reply.js';

export interface MessageSortant {
  readonly organizationId: string;
  readonly contactId: string;
  readonly channel: ReplyChannel;
  readonly body: string;
  readonly etat: 'envoye' | 'en_cours';
  /** Métadonnées libres (identifiant d'action, mode...). `etat` y est ajouté pour `en_cours`. */
  readonly raw?: Record<string, unknown>;
}

/** Rend l'identifiant du fil. Non transactionnel, comme l'envoi email : l'appelant décide s'il faut tolérer un échec. */
export async function enregistrerMessageSortant(ex: Executeur, m: MessageSortant): Promise<string> {
  const filId = await assurerFil(ex, m.organizationId, m.contactId, m.channel);
  const enCours = m.etat === 'en_cours';
  await ex.query(
    `insert into thread_messages (thread_id, direction, body, provider_message_id, raw, sent_at)
       values ($1, 'out', $2, null, $3::jsonb, case when $4::boolean then null else now() end)`,
    [filId, m.body, JSON.stringify(enCours ? { ...m.raw, etat: 'en_cours' } : (m.raw ?? {})), enCours],
  );
  // Un fil déjà existant n'est pas touché par `assurerFil` : sans cette mise à jour son
  // `last_message_at` resterait figé à la date du dernier message entrant.
  await ex.query(`update threads set last_message_at = now() where id = $1 and organization_id = $2`, [filId, m.organizationId]);
  return filId;
}

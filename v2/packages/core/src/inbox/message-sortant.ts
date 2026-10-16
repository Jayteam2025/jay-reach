/**
 * Enregistrement d'un message SORTANT dans le fil du contact, quel que soit le canal.
 *
 * Le chemin que l'email SalesBlink suivait seul (`assurerFil` puis insertion en `out`), extrait
 * pour que les canaux le partagent : sans lui, une réponse arrive dans un fil qui ne montre que
 * sa moitié. `assurerFil` ne touche ni la classification ni l'état de lecture
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

/**
 * Met à jour le dernier message d'un fil. Rend le nombre de lignes touchées : 0 si le fil
 * n'appartient pas à l'organisation.
 *
 * Le filtre d'organisation est une défense en profondeur : tant que `enregistrerMessageSortant`
 * n'accepte pas de `threadId` en entrée, l'id vient d'`assurerFil` (borné à l'organisation) et le
 * filtre est inatteignable. Il le devient si quelqu'un ajoute un `threadId` en paramètre (la
 * réponse de l'opérateur, tâche 9, pourrait le faire).
 */
export async function toucherDernierMessage(ex: Executeur, organizationId: string, filId: string): Promise<number> {
  const res = await ex.query(`update threads set last_message_at = now() where id = $1 and organization_id = $2`, [
    filId,
    organizationId,
  ]);
  return res.rowCount ?? 0;
}

/**
 * Rend l'identifiant du fil.
 *
 * Limite connue : `assurerFil` créerait un fil de l'organisation A pour un contact de
 * l'organisation B, rien en base ne liant le contact au fil. Inatteignable aujourd'hui, tous les
 * appelants tirent leur `contactId` d'une requête déjà bornée à l'organisation ; à ne pas oublier
 * pour un futur appelant qui recevrait un `contactId` de l'extérieur.
 *
 * Non transactionnel, comme l'envoi email : l'appelant décide s'il faut tolérer un échec.
 */
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
  await toucherDernierMessage(ex, m.organizationId, filId);
  return filId;
}

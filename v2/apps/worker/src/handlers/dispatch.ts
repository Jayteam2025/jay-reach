/**
 * Handler de la file `actions.dispatch` — routage par canal. L'email part par
 * SalesBlink (`envoyerEmailSalesBlink`, lot 3 : « SalesBlink comme simple
 * transport email »). LinkedIn (invitation/message) n'appelle aucune API
 * d'envoi : l'action est ENFILÉE dans `linkedin_action_queue` et c'est
 * l'extension Chrome qui l'exécute (API Voyager, session de l'utilisateur ;
 * pacing appliqué côté serveur). Les garde-fous et l'approbation sont
 * appliqués en amont (séquenceur).
 */
import type { Pool } from 'pg';
import { enqueueLinkedInAction, type LinkedInActionJob } from '../db.js';

/** Canaux d'envoi routés par le dispatch. */
export type DispatchChannel = 'email' | 'linkedin_invite' | 'linkedin_message';

/**
 * Payload de la file — sans clé d'API : la clé SalesBlink est résolue à
 * l'exécution par le worker (coffre + repli env), jamais dans le job.
 * `channel` absent ⇒ 'email' (compatibilité ascendante).
 */
export interface DispatchJob {
  readonly organizationId: string;
  readonly channel?: DispatchChannel;
  /**
   * Action du séquenceur a l'origine de l'envoi. Sans elle, rien ne permet de
   * marquer l'action comme partie ni d'enregistrer son résultat : la mesure
   * (actions `dispatched`, table `outcomes`, vue `campaign_stats`) restait
   * entièrement vide.
   */
  readonly actionId?: string | null;
  /**
   * Canal email (SalesBlink) : uniquement des références. Le rendu (gabarit,
   * variables) et la résolution des objets SalesBlink (séquence, liste) ont
   * lieu à l'envoi, pas au tick — sans quoi un corps déjà rendu attendrait
   * dans la file pendant que la langue ou les variables auraient pu changer.
   */
  readonly email?: {
    readonly enrollmentId: string;
    readonly contactId: string;
    readonly stepId: string;
    readonly campaignId: string;
    readonly templateParentId: string | null;
    readonly senderId: string | null;
    readonly locale: string | null;
  };
  // Canal LinkedIn.
  readonly linkedin?: {
    readonly linkedinUrl: string;
    readonly actionId?: string | null;
    readonly contactId?: string | null;
    readonly signalId?: string | null;
    readonly messageBody?: string | null;
    readonly method?: 'extension_auto' | 'manual';
  };
}

export function isLinkedInChannel(channel: DispatchChannel | undefined): boolean {
  return channel === 'linkedin_invite' || channel === 'linkedin_message';
}

/** Envoi LinkedIn : enfile l'action pour l'extension (aucun appel réseau ici). */
export async function runLinkedInDispatch(pool: Pool, job: DispatchJob): Promise<string | null> {
  if (!job.linkedin) {
    throw new Error('dispatch LinkedIn : payload linkedin manquant');
  }
  const kind = job.channel === 'linkedin_message' ? 'message' : 'invite';
  const action: LinkedInActionJob = {
    organizationId: job.organizationId,
    kind,
    linkedinUrl: job.linkedin.linkedinUrl,
    contactId: job.linkedin.contactId ?? null,
    signalId: job.linkedin.signalId ?? null,
    messageBody: job.linkedin.messageBody ?? null,
    method: job.linkedin.method ?? 'extension_auto',
    actionId: job.linkedin.actionId ?? job.actionId ?? null,
  };
  return enqueueLinkedInAction(pool, action);
}

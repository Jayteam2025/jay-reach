/**
 * Handler de la file `actions.dispatch` — routage par canal. L'email part via
 * Smartlead (code moteur repris du legacy). LinkedIn (invitation/message)
 * n'appelle aucune API d'envoi : l'action est ENFILÉE dans `linkedin_action_queue`
 * et c'est l'extension Chrome qui l'exécute (API Voyager, session de
 * l'utilisateur ; pacing appliqué côté serveur). Les garde-fous et l'approbation
 * sont appliqués en amont (séquenceur).
 */
import type { Pool } from 'pg';
import {
  addLeadsToCampaign,
  type AddLeadsResponse,
  type SmartleadLead,
} from '@jay-reach/providers/outreach';
import { enqueueLinkedInAction, type LinkedInActionJob } from '../db.js';

/** Canaux d'envoi routés par le dispatch. */
export type DispatchChannel = 'email' | 'linkedin_invite' | 'linkedin_message';

/**
 * Payload de la file — sans clé d'API : la clé Smartlead est résolue à
 * l'exécution par le worker (coffre + repli env), jamais dans le job.
 * `channel` absent ⇒ 'email' (compatibilité ascendante).
 */
export interface DispatchJob {
  readonly organizationId: string;
  readonly channel?: DispatchChannel;
  // Canal email (Smartlead).
  readonly campaignId?: number | string;
  readonly leads?: SmartleadLead[];
  // Canal LinkedIn.
  readonly linkedin?: {
    readonly linkedinUrl: string;
    readonly contactId?: string | null;
    readonly signalId?: string | null;
    readonly messageBody?: string | null;
    readonly method?: 'extension_auto' | 'manual';
  };
}

export function isLinkedInChannel(channel: DispatchChannel | undefined): boolean {
  return channel === 'linkedin_invite' || channel === 'linkedin_message';
}

/** Envoi email : pousse les leads vers la campagne Smartlead. */
export async function runDispatch(job: DispatchJob, apiKey: string): Promise<AddLeadsResponse> {
  if (job.campaignId === undefined || !job.leads) {
    throw new Error('dispatch email : campaignId/leads manquants');
  }
  return addLeadsToCampaign(job.campaignId, job.leads, apiKey);
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
  };
  return enqueueLinkedInAction(pool, action);
}

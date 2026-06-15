/**
 * Client-side helper pour la queue d'enrichissement backend.
 *
 * Remplace l'ancien module `prospect-enrichment-queue.ts` qui faisait tourner
 * la queue dans le navigateur (fragile : onglet en arriere-plan → Chrome
 * throttle, onglet ferme → queue perdue, JWT expire → erreurs silencieuses).
 *
 * Ici la queue vit cote backend (table prospect_enrichment_jobs + workers
 * auto-propages via pg_net). Le client se contente de :
 *   - declencher un job via l'edge function `enqueue-enrichment`
 *   - persister le dernier job_id en localStorage pour pouvoir re-afficher
 *     le progress meme apres un reload
 *   - observer l'etat via useEnrichmentJob()
 */

import { invokeEdgeFunction } from './invokeEdgeFunction';

export interface EnqueueResponse {
  job_id: string;
  total: number;
  concurrency: number;
  status: 'pending';
}

const STORAGE_KEY = 'prospect-enrichment-job-id';

/**
 * Cree un job d'enrichissement backend. Retourne immediatement le job_id,
 * les workers tournent ensuite en arriere-plan jusqu'a la fin (meme si
 * l'onglet ferme).
 */
export async function enqueueEnrichment(
  signalIds: string[],
  concurrency = 5,
): Promise<EnqueueResponse> {
  const res = await invokeEdgeFunction<EnqueueResponse>('enqueue-enrichment', {
    signal_ids: signalIds,
    concurrency,
  });
  persistJobId(res.job_id);
  return res;
}

export function persistJobId(jobId: string): void {
  try { localStorage.setItem(STORAGE_KEY, jobId); } catch { /* storage quota / private mode */ }
}

export function getPersistedJobId(): string | null {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}

export function clearPersistedJobId(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

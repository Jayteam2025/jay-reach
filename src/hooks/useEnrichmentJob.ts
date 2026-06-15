import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  clearPersistedJobId,
  getPersistedJobId,
  persistJobId,
} from '@/lib/prospect-enrichment-job';

/**
 * Etat d'un job d'enrichissement backend. Les champs correspondent aux
 * colonnes de la table prospect_enrichment_jobs.
 */
export interface EnrichmentJobState {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  completed: number;
  failed: number;
  concurrency: number;
  created_at: string;
  completed_at: string | null;
}

export interface UseEnrichmentJobReturn {
  job: EnrichmentJobState | null;
  /** True tant que le job n'est pas en etat terminal. */
  running: boolean;
  /** Demarre le suivi d'un nouveau job (remplace celui en cours). */
  trackJob: (jobId: string) => void;
  /** Efface le job courant (ne supprime pas les rows en DB, juste l'affichage). */
  clear: () => void;
}

/**
 * Poll l'etat d'un job d'enrichissement backend toutes les 2s tant qu'il
 * tourne. Charge automatiquement le dernier job connu depuis localStorage
 * au mount, ce qui permet de re-afficher le progress apres un reload.
 */
export function useEnrichmentJob(): UseEnrichmentJobReturn {
  const [jobId, setJobId] = useState<string | null>(() => getPersistedJobId());
  const [job, setJob] = useState<EnrichmentJobState | null>(null);
  // Ref pour eviter un setState apres unmount (React StrictMode + async effect)
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!jobId) {
      setJob(null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const pollOnce = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('prospect_enrichment_jobs')
        .select('id, status, total, completed, failed, concurrency, created_at, completed_at')
        .eq('id', jobId)
        .maybeSingle();

      if (cancelledRef.current) return false;
      if (error || !data) {
        // Job supprime ou RLS bloque → on arrete et on oublie
        setJob(null);
        return false;
      }

      setJob(data as EnrichmentJobState);
      // Stop le polling des que le job est en etat terminal
      return data.status !== 'completed' && data.status !== 'failed';
    };

    const loop = async () => {
      const shouldContinue = await pollOnce();
      if (!cancelledRef.current && shouldContinue) {
        timeoutId = setTimeout(loop, 2000);
      }
    };
    loop();

    return () => {
      cancelledRef.current = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [jobId]);

  const trackJob = useCallback((id: string) => {
    persistJobId(id);
    setJobId(id);
  }, []);

  const clear = useCallback(() => {
    clearPersistedJobId();
    setJobId(null);
    setJob(null);
  }, []);

  const running = !!job && (job.status === 'pending' || job.status === 'running');

  return { job, running, trackJob, clear };
}

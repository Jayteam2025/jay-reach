import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';

/**
 * Etat par-item d'un job d'enrichissement. Utilise par la modale de suivi
 * live pour afficher l'avancement entreprise par entreprise.
 */
export interface EnrichmentJobItem {
  id: string;
  signal_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  error: string | null;
  attempts: number;
  claimed_at: string | null;
  completed_at: string | null;
  company_name: string | null;
}

/**
 * Poll les items d'un job toutes les 2s tant que le job tourne. Join avec
 * prospect_signals pour recuperer le company_name affichable. Null si
 * jobId est null.
 */
export function useEnrichmentJobItems(jobId: string | null): EnrichmentJobItem[] {
  const [items, setItems] = useState<EnrichmentJobItem[]>([]);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    if (!jobId) {
      setItems([]);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const pollOnce = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('prospect_enrichment_job_items')
        .select('id, signal_id, status, error, attempts, claimed_at, completed_at, prospect_signals!inner(company_name)')
        .eq('job_id', jobId)
        .order('created_at', { ascending: true });

      if (cancelledRef.current) return false;
      if (error) {
        setItems([]);
        return false;
      }

      const mapped: EnrichmentJobItem[] = (data || []).map((row) => {
        const signalRel = row.prospect_signals as unknown as { company_name: string | null } | null;
        return {
          id: row.id as string,
          signal_id: row.signal_id as string,
          status: row.status as EnrichmentJobItem['status'],
          error: row.error as string | null,
          attempts: row.attempts as number,
          claimed_at: row.claimed_at as string | null,
          completed_at: row.completed_at as string | null,
          company_name: signalRel?.company_name ?? null,
        };
      });
      setItems(mapped);

      // Stop polling des que tous les items sont en etat terminal
      const allDone = mapped.length > 0 && mapped.every(i => i.status === 'completed' || i.status === 'failed');
      return !allDone;
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

  return items;
}

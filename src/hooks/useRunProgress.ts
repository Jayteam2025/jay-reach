import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { clearRunId, loadRunId, saveRunId } from '@/lib/prospect-run';

/**
 * Etat du scoring d'un run. Les champs correspondent aux colonnes
 * de la table prospect_batches (batch_type='scoring').
 */
export interface RunScoring {
  status: 'pending' | 'in_progress' | 'ended' | 'failed';
  processed: number;
  total: number;
  failed: number;
}

export interface UseRunProgressReturn {
  runId: string | null;
  scoring: RunScoring | null;
  isDone: boolean;
  trackRun: (runId: string) => void;
  clear: () => void;
}

const POLL_MS = 5000;
const STALE_MS = 30000;

/**
 * Poll prospect_batches (batch_type='scoring') du run toutes les 5s tant que
 * le scoring n'est pas terminé. Charge le dernier run_id depuis localStorage au
 * mount (ré-attachement après reload). Relance poll-batch-reactive une fois si
 * le batch stagne (last_polled_at > 30s).
 */
export function useRunProgress(): UseRunProgressReturn {
  const [runId, setRunId] = useState<string | null>(() => loadRunId());
  const [scoring, setScoring] = useState<RunScoring | null>(null);
  // Ref pour eviter un setState apres unmount (React StrictMode + async effect)
  const cancelledRef = useRef(false);
  const rekickedRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    rekickedRef.current = false;
    if (!runId) {
      setScoring(null);
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const pollOnce = async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('prospect_batches')
        .select('id, status, total, processed_count, failed_count, last_polled_at')
        .eq('run_id', runId)
        .eq('batch_type', 'scoring')
        .maybeSingle();

      if (cancelledRef.current) return false;
      if (error) return true; // transitoire → on retentera
      if (!data) {
        setScoring({
          status: 'pending',
          processed: 0,
          total: 0,
          failed: 0,
        });
        return true;
      }

      const status: RunScoring['status'] =
        data.status === 'ended' ? 'ended' : data.status === 'failed' ? 'failed' : 'in_progress';
      setScoring({
        status,
        processed: data.processed_count ?? 0,
        total: data.total ?? 0,
        failed: data.failed_count ?? 0,
      });
      if (status === 'ended' || status === 'failed') return false;

      const stale =
        data.last_polled_at &&
        Date.now() - new Date(data.last_polled_at).getTime() > STALE_MS;
      if (!rekickedRef.current && stale && data.id) {
        rekickedRef.current = true;
        void invokeEdgeFunction('poll-batch-reactive', { batch_row_id: data.id, attempt: 1 }).catch(
          () => {
            /* best effort */
          },
        );
      }
      return true;
    };

    const loop = async () => {
      const shouldContinue = await pollOnce();
      if (!cancelledRef.current && shouldContinue) {
        timeoutId = setTimeout(loop, POLL_MS);
      }
    };
    loop();

    return () => {
      cancelledRef.current = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [runId]);

  const trackRun = useCallback((id: string) => {
    saveRunId(id);
    setRunId(id);
  }, []);

  const clear = useCallback(() => {
    clearRunId();
    setRunId(null);
    setScoring(null);
  }, []);

  const isDone = scoring?.status === 'ended' || scoring?.status === 'failed';

  return { runId, scoring, isDone, trackRun, clear };
}

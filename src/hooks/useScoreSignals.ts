import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

// =====================================================
// Mutation: Score all raw job postings via Batch API
// =====================================================

interface ScoreSignalsResponse {
  scored: number;
  total: number;
  remaining: number;
}

export function useScoreSignals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (): Promise<ScoreSignalsResponse> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Non authentifié');
      }

      const headers = { Authorization: `Bearer ${session.access_token}` };

      // Helper: lance la passe de justification (réutilisable après batch ou re-clic).
      // Plus d'archivage au scoring : toute la liste scorée reste visible, l'archivage
      // se fait au moment d'« Enrichir la sélection » (le reste part en archive).
      const runJustify = async (scoredCount: number, totalCount: number): Promise<ScoreSignalsResponse> => {
        const { data: { session: justifySession } } = await supabase.auth.getSession();
        if (justifySession?.access_token) {
          await supabase.functions.invoke('score-prospect-signals', {
            body: { justify: true },
            headers: { Authorization: `Bearer ${justifySession.access_token}` },
          });
          queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
        }

        return { scored: scoredCount, total: totalCount, remaining: 0 };
      };

      // 0. Check if all signals already scored (e.g. page was refreshed mid-flow)
      const { count: unscoredNow } = await supabase
        .from('prospect_signals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'raw')
        .eq('signal_type', 'job_posting')
        .is('extracted_data->ai_score', null);

      const { count: totalNow } = await supabase
        .from('prospect_signals')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'raw')
        .eq('signal_type', 'job_posting');

      if ((unscoredNow ?? 0) === 0 && (totalNow ?? 0) > 0) {
        // Déjà tout scoré (ex. page rafraîchie mid-flow) — relancer juste la justification.
        logger.info(`[SCORE] Tout déjà scoré (${totalNow}), passe de justification`);
        return runJustify(totalNow ?? 0, totalNow ?? 0);
      }

      // 1. Submit batch to Anthropic Batch API
      const { data: submitData, error: submitError } = await supabase.functions.invoke(
        'score-prospect-signals',
        { body: {}, headers }
      );

      if (submitError) {
        throw new Error(submitError.message || 'Erreur soumission batch');
      }

      // Provider LLM sans Batch API (openai_compatible) : le scoring a déjà
      // tourné en sync côté edge function, rien à poller.
      if (submitData?.mode === 'sync') {
        logger.info(`[SCORE] Scoring sync terminé: ${submitData.scored}/${submitData.total}`);
        return runJustify(submitData.scored ?? 0, submitData.total ?? 0);
      }

      if (!submitData?.batch_id) {
        return { scored: 0, total: 0, remaining: 0 };
      }

      const { batch_id, total } = submitData;
      logger.info(`[SCORE] Batch soumis: ${batch_id} (${total} offres)`);

      // 2. Poll for batch completion
      const POLL_MS = 10_000;
      const MAX_POLLS = 360;

      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise(r => setTimeout(r, POLL_MS));

        const { data: { session: freshSession } } = await supabase.auth.getSession();
        if (!freshSession?.access_token) throw new Error('Session expirée');

        const { data: checkData, error: checkError } = await supabase.functions.invoke(
          'score-prospect-signals',
          {
            body: { check_batch: batch_id },
            headers: { Authorization: `Bearer ${freshSession.access_token}` },
          }
        );

        if (checkError) {
          logger.warn(`[SCORE] Poll ${i + 1} erreur: ${checkError.message}`);
          continue;
        }

        if (checkData.status === 'ended') {
          logger.info(`[SCORE] Batch terminé: ${checkData.scored} scorés`);
          queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });

          if (checkData.scored > 0) {
            return runJustify(checkData.scored, total);
          }

          return { scored: checkData.scored, total, remaining: 0 };
        }

        // Refresh UI periodically while processing
        if (i % 3 === 0) {
          queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
        }
      }

      throw new Error('Scoring timeout — le batch continue en arrière-plan sur Anthropic');
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      toast({
        description: `${data.scored} offres scorées`,
      });
    },
    onError: (error) => {
      logger.error('[SCORE_SIGNALS] Mutation failed', error);
      toast({
        variant: 'destructive',
        description: error instanceof Error ? error.message : 'Erreur lors du scoring des offres',
      });
    },
  });
}

// =====================================================
// Mutation: Archive non-selected job postings (scores conservés)
// =====================================================

interface ArchiveUnselectedSignalsPayload {
  selectedIds: string[];
}

/**
 * Au clic « Enrichir la sélection » : les sélectionnés partent en enrichissement,
 * et TOUT LE RESTE des offres scorées passe en `archived` (scores conservés,
 * récupérable dans l'onglet Archivés). Remplace l'ancien delete destructif.
 */
export function useArchiveUnselectedSignals() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ selectedIds }: ArchiveUnselectedSignalsPayload) => {
      const { error } = await supabase
        .from('prospect_signals')
        .update({ status: 'archived', archived_at: new Date().toISOString() })
        .eq('status', 'raw')
        .eq('signal_type', 'job_posting')
        .not('id', 'in', `(${selectedIds.join(',')})`);

      if (error) {
        logger.error('[ARCHIVE_SIGNALS] Error archiving unselected', error);
        throw new Error(error.message || "Erreur lors de l'archivage des offres non sélectionnées");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      queryClient.invalidateQueries({ queryKey: ['archived-signals'] });
      queryClient.invalidateQueries({ queryKey: ['archived-signals-count'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-stats'] });
    },
    onError: (error) => {
      logger.error('[ARCHIVE_SIGNALS] Mutation failed', error);
    },
  });
}

// =====================================================
// Mutation: Enrich a single company
// =====================================================

interface EnrichCompanyPayload {
  signalId: string;
}

interface EnrichCompanyResponse {
  company: string;
  company_group_id: string;
  profiles_created: number;
  emails_found: number;
}

export function useEnrichCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ signalId }: EnrichCompanyPayload): Promise<EnrichCompanyResponse> => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Non authentifié');
      }

      const { data, error } = await supabase.functions.invoke('enrich-company', {
        body: { signal_id: signalId },
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) {
        logger.error('[ENRICH_COMPANY] Error enriching company', error);
        throw new Error(error.message || 'Erreur lors de l\'enrichissement');
      }

      return data as EnrichCompanyResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      queryClient.invalidateQueries({ queryKey: ['prospects'] });
    },
    onError: (error) => {
      logger.error('[ENRICH_COMPANY] Mutation failed', error);
      toast({
        variant: 'destructive',
        description: error instanceof Error ? error.message : 'Erreur lors de l\'enrichissement',
      });
    },
  });
}

// =====================================================
// Stubs for unused functions (referenced but not implemented)
// =====================================================

export function useDeleteUnselectedSignals() {
  return useMutation({
    mutationFn: async ({ selectedIds }: { selectedIds: string[] }) => {
      logger.info('[DELETE_UNSELECTED] Not implemented in OSS', { count: selectedIds.length });
      return {};
    },
  });
}

export function useGenerateCompanyMessages() {
  return useMutation({
    mutationFn: async ({ companyGroupId }: { companyGroupId: string }) => {
      logger.info('[GENERATE_MESSAGES] Not implemented in OSS', { companyGroupId });
      return {};
    },
  });
}


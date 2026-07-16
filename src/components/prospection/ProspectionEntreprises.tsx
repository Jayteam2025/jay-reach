import { useState, useMemo, useEffect, useRef, lazy, Suspense } from 'react';
import { useIcpPersonas } from '@/hooks/useIcpPersonas';
import { useProspectionStats } from '@/hooks/useProspectionStats';
import { useTriggerWeeklyCron } from '@/hooks/useWeeklyProspectCron';
import { useRunProgress } from '@/hooks/useRunProgress';
import { RunProgressModal, type ScrapeState } from './RunProgressModal';
import { useEnrichmentJob } from '@/hooks/useEnrichmentJob';
import { useEnrichmentJobItems } from '@/hooks/useEnrichmentJobItems';
import { enqueueEnrichment } from '@/lib/prospect-enrichment-job';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';
import { EnrichmentJobModal } from './EnrichmentJobModal';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Building2, Loader2, ArrowUpDown, Play,
  RefreshCw, Trash2, Upload, X, Wrench, Sparkles, Mail, Archive,
  CheckSquare, Square,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useSubscriptionAccess } from '@/hooks/useSubscriptionAccess';
import { EntrepriseInboxList } from './EntrepriseInboxList';
import { EntrepriseFiche } from './EntrepriseFiche';
import { ScoredSignalDetailSheet } from './ScoredSignalDetailSheet';
import { ProspectSearchBar } from './ProspectSearchBar';
import { useProspectionView } from '@/features/companies/useProspectionView';
import {
  ToolsRow,
  SourceToggleButton,
  ViewToggleButton,
  ScoredSignalsTable,
  ScoreBadge,
} from '@/features/companies/ProspectionListComponents';
import { useArchivedSignals, useArchivedCount } from '@/hooks/useArchivedSignals';
import { useArchiveUnselectedSignals } from '@/hooks/useScoreSignals';
import { useGlobalSmartleadPush } from '@/features/smartlead/useGlobalSmartleadPush';

// Modale d'import lazy : xlsx + mammoth (~550 KB) charges seulement quand
// l'utilisateur ouvre l'import de fichier (Jay Reach 1.5.6).
const ImportProspectsModal = lazy(() =>
  import('./ImportProspectsModal').then((m) => ({ default: m.ImportProspectsModal })));

type PendingAction = 'run' | 'wipe' | 'reenrich' | null;

export function ProspectionEntreprises() {
  const {
    companies,
    scoredSignals,
    jobSignals,
    isLoading,
    acquisitionFilter,
    setAcquisitionFilter,
    searchQuery,
    setSearchQuery,
    setManualView,
    viewState,
    filteredScoredSignals,
    filteredCompanies,
    runFilter,
    setRunFilter,
    sortDir,
    setSortDir,
    enrichedBaseCount,
    lastRunCount,
    recentScoredCount,
    showScoredBanner,
    dismissBanner,
  } = useProspectionView();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [archivedSelectedIds, setArchivedSelectedIds] = useState<Set<string>>(new Set());
  const [archivedSort, setArchivedSort] = useState<'expiration' | 'score'>('expiration');
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [detailSignalId, setDetailSignalId] = useState<string | null>(null);
  // Action en attente de confirmation (AlertDialog shadcn au lieu de
  // window.confirm natif qui se comporte mal avec Radix DropdownMenu).
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const { isAdmin } = useSubscriptionAccess();
  const isAdminUser = isAdmin();

  const queryClient = useQueryClient();
  const { toast } = useToast();

  const archived = useArchivedSignals(viewState === 'archived');
  const archivedCount = useArchivedCount();
  // Liste archivée triée (expiration = purge la plus proche d'abord ; ou score).
  const sortedArchived = useMemo(() => {
    const list = archived.data ? [...archived.data] : [];
    if (archivedSort === 'score') {
      return list.sort((a, b) => (Number(b.ai_score) || 0) - (Number(a.ai_score) || 0));
    }
    return list.sort((a, b) => new Date(a.archived_at).getTime() - new Date(b.archived_at).getTime());
  }, [archived.data, archivedSort]);
  const archiveUnselected = useArchiveUnselectedSignals();

  const triggerCron = useTriggerWeeklyCron();

  // Job d'enrichissement backend — la queue tourne sur Supabase via pg_net,
  // le client se contente de suivre son etat via polling (useEnrichmentJob
  // persiste le job_id en localStorage pour survivre aux reloads).
  const enrichmentJob = useEnrichmentJob();
  const jobItems = useEnrichmentJobItems(enrichmentJob.job?.id ?? null);
  const [modalOpen, setModalOpen] = useState(false);

  const runProgress = useRunProgress();
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [scrapeState, setScrapeState] = useState<ScrapeState>({ status: 'running' });

  const prevRunningRef = useRef(enrichmentJob.running);

  // Ouvre automatiquement la modale quand un job demarre. L'utilisateur peut
  // la reduire — la queue continue en backend dans tous les cas.
  useEffect(() => {
    if (!prevRunningRef.current && enrichmentJob.running) {
      setModalOpen(true);
    }
    if (prevRunningRef.current && !enrichmentJob.running && enrichmentJob.job && enrichmentJob.job.total > 0) {
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      queryClient.invalidateQueries({ queryKey: ['archived-signals'] });
      queryClient.invalidateQueries({ queryKey: ['archived-signals-count'] });
      // Le filtre "Dernier run" doit suivre le job qui vient de finir.
      queryClient.invalidateQueries({ queryKey: ['last-enrichment-run-company-ids'] });
      const { completed, failed } = enrichmentJob.job;
      toast({
        description: `${completed} entreprises enrichies${failed > 0 ? ` (${failed} échecs)` : ''}`,
      });
    }
    prevRunningRef.current = enrichmentJob.running;
  }, [enrichmentJob.running, enrichmentJob.job, queryClient, toast]);

  // Ré-ouvre la modale de run si un run_id non terminé est persisté (reload).
  useEffect(() => {
    if (runProgress.runId && !runProgress.isDone) {
      setScrapeState({ status: 'done' }); // si on recharge, le scrape est forcément fini
      setRunModalOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mutation enqueue : React Query gere le loading state pour qu'un double-clic
  // pendant la creation du job (~1-2s) soit ignore. Avant ce changement, le
  // bouton restait cliquable pendant l'await → l'operateur creait 2 jobs par erreur
  // qui ont enrichi les memes 146 boites deux fois (cramage credits FullEnrich).
  const enqueueMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      const res = await enqueueEnrichment(ids);
      enrichmentJob.trackJob(res.job_id);
      return res;
    },
    onError: (err: unknown) => {
      logger.error('[ProspectionEntreprises] enqueueEnrichment failed', err);
      const msg = err instanceof Error ? err.message : 'Impossible de lancer l\'enrichissement';
      // Erreur HTTP 409 = un job tourne deja → message specifique + ouvre la modale
      if (msg.includes('deja en cours')) {
        toast({ description: 'Un enrichissement tourne deja. Ouvre la fenetre de suivi.' });
        setModalOpen(true);
      } else {
        toast({ variant: 'destructive', description: msg });
      }
    },
  });

  const doFullRun = async () => {
    setScrapeState({ status: 'running' });
    setRunModalOpen(true);
    try {
      const res = await triggerCron.mutateAsync();
      const scrapeStep = res.results.find(r => r.details && 'total_inserted' in r.details);
      const failed = res.results.filter(r => !r.success);
      if (scrapeStep && scrapeStep.success) {
        const details: Record<string, unknown> = scrapeStep.details ?? {};
        setScrapeState({
          status: 'done',
          totalInserted: Number(details.total_inserted ?? 0),
          sources: (details.scrapers as string[]) ?? [],
        });
      } else {
        setScrapeState({ status: 'failed', error: failed.map(f => f.step).join(', ') || 'Scraping en échec' });
      }
      runProgress.trackRun(res.run_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur inconnue';
      setScrapeState({ status: 'failed', error: msg });
    }
  };

  // Bulk push global : pousse tous les leads d'une categorie avec deliverability_status='valid'
  // (toutes entreprises enrichies confondues) sur Smartlead. Le gate revalide chaque envoi.
  const [bulkPushPersonaId, setBulkPushPersonaId] = useState<string | null>(null);
  const bulkPushMutation = useGlobalSmartleadPush(companies);

  // Compte les valid PAS encore pousses sur Smartlead (pour le badge "RH 18").
  // Un prospect deja pousse a smartlead_push_decision='push' set par send-via-smartlead.
  // Stats agreges via RPC (DB COUNT, scalable a 10M+ rows). Remplace les
  // anciens calculs JS sur `companies` qui plantaient silencieusement a >1000
  // profils (limite implicite Supabase JS).
  const { data: prospectionStats } = useProspectionStats();
  const pushCountByPersona = useMemo(
    () => Object.fromEntries(
      (prospectionStats?.push_by_persona ?? []).map((r) => [r.persona_id, r.pushable]),
    ) as Record<string, number>,
    [prospectionStats],
  );

  // Lignes Push Smartlead derivees dynamiquement des personas actifs du workspace.
  // Dé-hardcoding : ciblage par persona_id (plus de mapping slug->target_category Jay).
  const { data: personasData } = useIcpPersonas();
  const personaPushRows = useMemo(() => {
    if (!personasData) return [];
    return personasData
      .filter((p) => p.is_active)
      .map((p) => ({ personaId: p.id, label: p.label, count: pushCountByPersona[p.id] ?? 0 }));
  }, [personasData, pushCountByPersona]);

  // Bouton admin "Vider la DB prospection" : reset total (profils + signaux
  // + batches + logs scraping). Conserve les templates et les filtres ICP.
  // L'operateur l'utilise quand il a fini de traiter toutes ses boites et veut
  // repartir propre avant le prochain run.
  const wipeMutation = useMutation({
    mutationFn: async () => {
      return invokeEdgeFunction<{ deleted: Record<string, number> }>(
        'wipe-prospection-db',
        {}
      );
    },
    onSuccess: (data) => {
      const total = Object.values(data.deleted).reduce((a, b) => a + b, 0);
      toast({ description: `DB prospection videe : ${total} lignes supprimees.` });
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur lors du wipe',
      });
    },
  });

  // Bouton admin : supprime les profils + messages des entreprises actuellement
  // enrichies puis relance le pipeline complet (FullEnrich search + bulk +
  // INSEE + generation messages). Utile apres deploiement d'un nouveau
  // prompt ou d'un nouveau provider d'enrichissement.
  const reenrichAllMutation = useMutation({
    mutationFn: async (opts: { force?: boolean } = {}) => {
      return invokeEdgeFunction<{
        companies: number;
        company_names: string[];
        signal_ids: string[];
        profiles_deleted: number;
      }>('reenrich-companies', opts);
    },
    onSuccess: (data) => {
      if (data.signal_ids.length === 0) {
        toast({ description: 'Aucune entreprise a re-enrichir' });
        return;
      }
      toast({
        description: `Reset ${data.companies} entreprise(s), relance enrichissement…`,
      });
      queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
      queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
      enqueueMutation.mutate(data.signal_ids);
    },
    onError: (err) => {
      toast({
        variant: 'destructive',
        description: err instanceof Error ? err.message : 'Erreur re-enrichissement',
      });
    },
  });

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === scoredSignals.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(scoredSignals.map(s => s.id)));
    }
  };

  const handleEnrichSelection = async () => {
    if (selectedIds.size === 0 || enqueueMutation.isPending || enrichmentJob.running) return;
    const ids = Array.from(selectedIds);
    // On archive tout le reste des offres scorées (scores conservés, récupérable
    // dans l'onglet Archivés), puis on enrichit la sélection.
    await archiveUnselected.mutateAsync({ selectedIds: ids });
    setSelectedIds(new Set());
    enqueueMutation.mutate(ids);
  };

  // --- Sélection multiple dans l'onglet Archivés ---
  const toggleArchivedSelection = (id: string) => {
    setArchivedSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllArchived = () => {
    const ids = (archived.data ?? []).map(s => s.id);
    setArchivedSelectedIds(prev => (prev.size === ids.length ? new Set() : new Set(ids)));
  };

  // Ré-enrichit plusieurs archivés d'un coup (même chemin que handleEnrichOne).
  // Les sélectionnés passent 'matched' → quittent l'onglet à la fin du job.
  const handleReenrichArchivedSelection = () => {
    if (archivedSelectedIds.size === 0 || enqueueMutation.isPending || enrichmentJob.running) return;
    const ids = Array.from(archivedSelectedIds);
    setArchivedSelectedIds(new Set());
    enqueueMutation.mutate(ids);
  };

  // Enrichit une seule boite depuis le Sheet de detail. Cree un job backend
  // d'un seul item — le backend gere identiquement 1 ou 100 signaux.
  const handleEnrichOne = (signalId: string) => {
    if (enqueueMutation.isPending || enrichmentJob.running) return;
    setDetailSignalId(null);
    enqueueMutation.mutate([signalId]);
  };

  const detailSignal = scoredSignals.find(s => s.id === detailSignalId) || null;

  const selectedCompany = companies.find(c => c.company_group_id === selectedCompanyId) || null;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {showScoredBanner && (
        <div className="flex items-center gap-3 rounded-lg border border-violet-500/30 bg-violet-500/5 px-4 py-3">
          <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
          <p className="flex-1 text-sm text-foreground">
            <strong className="text-violet-300">{recentScoredCount}</strong>{' '}
            {recentScoredCount > 1 ? 'nouvelles entreprises scorées' : 'nouvelle entreprise scorée'} dans les dernières 48h, prête{recentScoredCount > 1 ? 's' : ''} à enrichir.
          </p>
          <Button
            size="sm"
            variant="outline"
            className="border-violet-500/40 text-violet-300 hover:bg-violet-500/10 hover:text-violet-200"
            onClick={() => setManualView('scored')}
          >
            Voir les scorées
          </Button>
          <button
            type="button"
            onClick={dismissBanner}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Masquer cette notification"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground title-glow">
          <Building2 className="h-6 w-6" />
          Entreprises
        </h1>

        <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
          {enrichmentJob.running && (
            <Button
              size="sm"
              className="gap-2"
              onClick={() => setModalOpen(true)}
              title="Voir le detail de l'enrichissement"
            >
              <Loader2 className="w-4 h-4 animate-spin" />
              Enrichissement {enrichmentJob.job ? `${enrichmentJob.job.completed + enrichmentJob.job.failed}/${enrichmentJob.job.total}` : ''}
            </Button>
          )}

          {(triggerCron.isPending || (runProgress.runId && !runProgress.isDone)) && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setRunModalOpen(true)}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Run {runProgress.scoring && runProgress.scoring.total > 0 ? `${runProgress.scoring.processed}/${runProgress.scoring.total}` : ''}
            </Button>
          )}

          {viewState === 'scored' && selectedIds.size > 0 && !enrichmentJob.running && (
            <Button
              size="sm"
              className="gap-2 disabled:opacity-70"
              onClick={handleEnrichSelection}
              disabled={enqueueMutation.isPending}
            >
              {enqueueMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <ArrowUpDown className="w-4 h-4" />}
              {enqueueMutation.isPending
                ? 'Lancement...'
                : `Enrichir la sélection (${selectedIds.size})`}
            </Button>
          )}

          {isAdminUser && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setImportModalOpen(true)}
              title="Importer un fichier de prospects (XLSX, CSV, PDF, DOCX, texte collé)"
            >
              <Upload className="w-4 h-4" />
              Importer un fichier
            </Button>
          )}

          <Button
            size="sm"
            className="gap-2"
            onClick={() => setPendingAction('run')}
            disabled={triggerCron.isPending}
            title="Scrape les nouvelles offres (dedup des boites deja traitees) + soumet le scoring Claude. ~30-60 min avant que la liste scoree soit prete."
          >
            {triggerCron.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Lancer un run
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
              >
                <Wrench className="w-3.5 h-3.5" />
                Outils
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-80 p-1.5 bg-popover border-border/60 shadow-xl"
            >
              {/* ─── Section Push Smartlead — en premier car action principale ─── */}
              <div className="px-2 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                Push Smartlead (toutes boites)
              </div>

              {personaPushRows.length === 0 ? (
                <div className="px-2 py-2 text-xs text-muted-foreground/60 italic">
                  Aucun persona actif. Configure-les dans l'onglet "Personas".
                </div>
              ) : (
                personaPushRows.map((row) => (
                  <ToolsRow
                    key={row.personaId}
                    icon={<Mail className="w-3.5 h-3.5 text-emerald-500" />}
                    label={row.label}
                    count={row.count}
                    onSelect={() => setBulkPushPersonaId(row.personaId)}
                    disabled={bulkPushMutation.isPending || row.count === 0}
                    loading={bulkPushMutation.isPending && bulkPushMutation.variables === row.personaId}
                  />
                ))
              )}

              <DropdownMenuSeparator className="my-1.5 bg-border/40" />

              {/* ─── Section Maintenance ─── */}
              <div className="px-2 pt-1 pb-1 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/60">
                Maintenance
              </div>

              <ToolsRow
                icon={<RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />}
                label="Tout re-enrichir"
                onSelect={() => setPendingAction('reenrich')}
                disabled={reenrichAllMutation.isPending || enrichmentJob.running || companies.length === 0}
                loading={reenrichAllMutation.isPending}
              />

              <DropdownMenuSeparator className="my-1.5 bg-border/40" />

              <ToolsRow
                icon={<Trash2 className="w-3.5 h-3.5" />}
                label="Vider la DB prospection"
                onSelect={() => setPendingAction('wipe')}
                disabled={wipeMutation.isPending}
                loading={wipeMutation.isPending}
                destructive
              />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Rangée de KPI (DA maquette) — cartes verre récapitulant l'état du workspace */}
      {prospectionStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: 'Entreprises enrichies', v: prospectionStats.enriched, d: 'boîtes prêtes à contacter' },
            { k: 'Offres scorées', v: prospectionStats.scored, d: 'en attente d’enrichissement' },
            { k: 'Scrapées', v: prospectionStats.scrape_count, d: 'via sources d’offres' },
            { k: 'Importées', v: prospectionStats.import_count, d: 'depuis un fichier' },
          ].map((kpi) => (
            <div key={kpi.k} className="glass rounded-xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{kpi.k}</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">{kpi.v ?? 0}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{kpi.d}</p>
            </div>
          ))}
        </div>
      )}

      {/* Barre de filtres & vues (regroupée : vues + source + run + recherche) */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {/* Vues : Scorées / Enrichies / Archivés (ou compteur d'offres en état brut) */}
          {(scoredSignals.length > 0 || companies.length > 0 || viewState === 'archived') ? (
            <div
              className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
              role="tablist"
              aria-label="Vue prospection"
            >
              {scoredSignals.length > 0 && (
                <ViewToggleButton active={viewState === 'scored'} onClick={() => setManualView('scored')} label="Scorées" count={scoredSignals.length} />
              )}
              {companies.length > 0 && (
                <ViewToggleButton active={viewState === 'enriched'} onClick={() => setManualView('enriched')} label="Enrichies" count={companies.length} />
              )}
              <ViewToggleButton active={viewState === 'archived'} onClick={() => setManualView('archived')} label="Archivés" count={archivedCount.data} />
            </div>
          ) : (
            <Badge variant="outline" className="px-3 py-1 text-sm font-normal">
              {jobSignals.length} offres
            </Badge>
          )}

          {/* Source (admin) */}
          {isAdminUser && (
            <div
              className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
              role="tablist"
              aria-label="Source des entreprises"
            >
              <SourceToggleButton active={acquisitionFilter === 'scrape'} onClick={() => setAcquisitionFilter('scrape')} label="Scrapées" />
              <SourceToggleButton active={acquisitionFilter === 'file_upload'} onClick={() => setAcquisitionFilter('file_upload')} label="Importées" />
            </div>
          )}

          {/* Filtre run (vue enrichies) */}
          {viewState === 'enriched' && (
            <div
              className="inline-flex items-center rounded-md border border-border bg-muted/30 p-0.5"
              role="tablist"
              aria-label="Filtre par run d'enrichissement"
            >
              <ViewToggleButton active={runFilter === 'all'} onClick={() => setRunFilter('all')} label="Toutes" count={enrichedBaseCount} />
              <ViewToggleButton active={runFilter === 'last'} onClick={() => setRunFilter('last')} label="Dernier run" count={lastRunCount} />
            </div>
          )}
        </div>

        {/* Recherche (vues scored / enriched) */}
        {(viewState === 'scored' || viewState === 'enriched') && (
          <div className="w-full sm:w-auto sm:min-w-[260px]">
            <ProspectSearchBar
              value={searchQuery}
              onChange={setSearchQuery}
              resultCount={viewState === 'scored' ? filteredScoredSignals.length : filteredCompanies.length}
              totalCount={viewState === 'scored' ? scoredSignals.length : companies.length}
            />
          </div>
        )}
      </div>

      {/* State 1: Raw — aucun run lance ou scoring Claude encore en cours */}
      {viewState === 'raw' && (
        <div className="glass rounded-lg p-8 text-center">
          <Building2 className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="text-lg text-muted-foreground mb-2">
            {jobSignals.length > 0
              ? `${jobSignals.length} offres en attente de scoring`
              : 'Aucun run en cours.'
            }
          </p>
          <p className="text-sm text-muted-foreground/60">
            {jobSignals.length > 0
              ? 'Les offres sont scorees par Claude en 30 a 60 min. La liste apparaitra automatiquement.'
              : 'Cliquez sur "Lancer un run" pour scraper les nouvelles offres et lancer le scoring.'}
          </p>
        </div>
      )}

      {/* State 2: Scored — table with checkboxes + enrichment */}
      {viewState === 'scored' && (
        <ScoredSignalsTable
          signals={filteredScoredSignals}
          selectedIds={selectedIds}
          onToggle={toggleSelection}
          onSelectAll={selectAll}
          onRowClick={setDetailSignalId}
        />
      )}

      <ScoredSignalDetailSheet
        signal={detailSignal}
        open={detailSignalId !== null}
        onOpenChange={(open) => !open && setDetailSignalId(null)}
        onEnrich={handleEnrichOne}
        isEnriching={enrichmentJob.running}
      />


      {/* State 3: Enriched — inbox left + fiche right */}
      {viewState === 'enriched' && (
        <div className="flex gap-4 h-[calc(100vh-300px)] min-h-[440px]">
          <EntrepriseInboxList
            companies={filteredCompanies}
            selectedId={selectedCompanyId}
            onSelect={setSelectedCompanyId}
            sortDir={sortDir}
            onToggleSort={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
          />
          {selectedCompany ? (
            <EntrepriseFiche company={selectedCompany} />
          ) : (
            <div className="glass rounded-xl flex-1 flex items-center justify-center text-[13px] text-muted-foreground">
              Sélectionnez une entreprise
            </div>
          )}
        </div>
      )}

      {/* State 4: Archived — liste verticale avec ré-enrichissement */}
      {viewState === 'archived' && (
        <>
          {archived.isLoading ? (
            <div className="glass rounded-lg p-8 text-center">
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">Chargement des archivés…</p>
            </div>
          ) : !archived.data || archived.data.length === 0 ? (
            <div className="glass rounded-lg p-8 text-center">
              <Archive className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
              <p className="text-lg text-muted-foreground mb-2">
                Aucune entreprise archivée.
              </p>
              <p className="text-sm text-muted-foreground/60">
                Les entreprises archivées apparaissent ici après un scoring et sont purgées après 60 jours.
              </p>
            </div>
          ) : (
            <div className="glass rounded-lg overflow-hidden">
              {/* En-tête : tout sélectionner · tri · ré-enrichir la sélection */}
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-muted/30">
                <button
                  type="button"
                  onClick={selectAllArchived}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                >
                  {archivedSelectedIds.size > 0 && archivedSelectedIds.size === (archived.data?.length ?? 0)
                    ? <CheckSquare className="w-4 h-4 text-violet-500" />
                    : <Square className="w-4 h-4" />}
                  <span>
                    {archivedSelectedIds.size > 0
                      ? `${archivedSelectedIds.size} sélectionné${archivedSelectedIds.size > 1 ? 's' : ''}`
                      : 'Tout sélectionner'}
                  </span>
                </button>
                <div className="flex items-center gap-2">
                  <div
                    className="inline-flex items-center rounded-md border border-border bg-foreground/5 p-0.5 text-xs"
                    role="tablist"
                    aria-label="Tri des archivés"
                  >
                    <button
                      type="button"
                      onClick={() => setArchivedSort('expiration')}
                      className={cn('px-2 py-1 rounded transition-colors', archivedSort === 'expiration' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      Expiration
                    </button>
                    <button
                      type="button"
                      onClick={() => setArchivedSort('score')}
                      className={cn('px-2 py-1 rounded transition-colors', archivedSort === 'score' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}
                    >
                      Score
                    </button>
                  </div>
                  {archivedSelectedIds.size > 0 && (
                    <Button
                      size="sm"
                      disabled={enqueueMutation.isPending || enrichmentJob.running}
                      onClick={handleReenrichArchivedSelection}
                    >
                      Ré-enrichir la sélection ({archivedSelectedIds.size})
                    </Button>
                  )}
                </div>
              </div>
              <div className="divide-y divide-border/50">
                {sortedArchived.map((signal) => {
                  const score = signal.ai_score ? Number(signal.ai_score) : null;
                  const archiveDate = new Date(signal.archived_at);
                  const daysAgo = Math.floor((Date.now() - archiveDate.getTime()) / 86_400_000);
                  const daysLeft = Math.max(0, 60 - daysAgo);
                  const purgeClass = daysLeft <= 3 ? 'text-red-400/80' : daysLeft <= 7 ? 'text-amber-400/80' : 'text-muted-foreground/60';
                  const selected = archivedSelectedIds.has(signal.id);

                  return (
                    <div
                      key={signal.id}
                      className={cn('flex items-center gap-3 px-4 py-3 transition-colors', selected ? 'bg-violet-500/5' : 'hover:bg-muted/50')}
                    >
                      <button
                        type="button"
                        onClick={() => toggleArchivedSelection(signal.id)}
                        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                        aria-label={selected ? 'Désélectionner' : 'Sélectionner'}
                      >
                        {selected ? <CheckSquare className="w-4 h-4 text-violet-500" /> : <Square className="w-4 h-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-foreground font-medium truncate">
                          {signal.company_name || '—'}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {score !== null && (
                            <ScoreBadge score={score} />
                          )}
                          <span className="text-xs text-muted-foreground">
                            {archiveDate.toLocaleDateString('fr-FR')}
                          </span>
                          <span className={cn('text-xs', purgeClass)}>
                            purgé dans {daysLeft}j
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={enqueueMutation.isPending || enrichmentJob.running}
                        onClick={() => handleEnrichOne(signal.id)}
                        className="shrink-0"
                      >
                        Ré-enrichir
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      <AlertDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction === 'run'
                ? 'Lancer un run ?'
                : pendingAction === 'wipe'
                  ? 'Vider la DB prospection ?'
                  : pendingAction === 'reenrich'
                    ? 'Tout re-enrichir ?'
                    : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction === 'run'
                ? `Scrape les nouvelles offres et soumet le scoring Claude. Les boîtes déjà présentes (${companies.length}) sont conservées, le scraping dédoublonne automatiquement. ~30-60 min avant que la liste scorée soit prête.`
                : pendingAction === 'wipe'
                  ? 'Tous les signaux, profils, messages et batches seront supprimés définitivement. Les templates et filtres ICP sont conservés.'
                  : pendingAction === 'reenrich'
                    ? `${companies.length} entreprises : les profils actuels et leurs messages seront supprimés puis régénérés.`
                    : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const action = pendingAction;
                setPendingAction(null);
                if (action === 'run') void doFullRun();
                else if (action === 'wipe') wipeMutation.mutate();
                else if (action === 'reenrich') reenrichAllMutation.mutate({});
              }}
            >
              Confirmer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={bulkPushPersonaId !== null} onOpenChange={(open) => !open && setBulkPushPersonaId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Pousser sur Smartlead — global
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-[13px]">
                {bulkPushPersonaId && (() => {
                  const row = personaPushRows.find((r) => r.personaId === bulkPushPersonaId);
                  const count = row?.count ?? 0;
                  const label = row?.label ?? 'contacts';
                  return (
                    <>
                      <p>
                        <strong>{count}</strong> contact{count > 1 ? 's' : ''} « {label} » avec <strong>deliverability_status=valid</strong> répartis sur toutes les entreprises enrichies seront poussés dans la campagne Smartlead du persona.
                      </p>
                      <p className="text-muted-foreground text-[12px]">
                        Le gate backend re-valide chaque envoi. Les emails non validés ne seront pas envoyés.
                      </p>
                    </>
                  );
                })()}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const personaId = bulkPushPersonaId;
                setBulkPushPersonaId(null);
                if (personaId) bulkPushMutation.mutate(personaId);
              }}
            >
              Pousser sur Smartlead
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EnrichmentJobModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        job={enrichmentJob.job}
        items={jobItems}
      />

      <RunProgressModal
        open={runModalOpen}
        onClose={() => {
          setRunModalOpen(false);
          if (runProgress.isDone) runProgress.clear();
        }}
        scrape={scrapeState}
        scoring={runProgress.scoring}
        isDone={runProgress.isDone}
      />

      {isAdminUser && importModalOpen && (
        <Suspense fallback={null}>
          <ImportProspectsModal
            open
            onOpenChange={setImportModalOpen}
            onImportSucceeded={(jobId) => {
              if (jobId) {
                enrichmentJob.trackJob(jobId);
                setModalOpen(true);
              }
              queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
              queryClient.invalidateQueries({ queryKey: ['enriched-companies'] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}

import { useState, useMemo } from 'react';
import { useProspectSignals, type ProspectSignal } from '@/hooks/useProspectSignals';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Radio, ExternalLink, MapPin, Loader2, Briefcase, Sparkles, CheckSquare, Square, ArrowUpDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';
import { ScrapingDashboard } from './ScrapingDashboard';
import { CompanyEnrichedView } from './CompanyEnrichedView';
import { JobPostingPanel } from './JobPostingPanel';
import {
  useScoreSignals,
  useEnrichCompany,
  useArchiveUnselectedSignals,
  useGenerateCompanyMessages
} from '@/hooks/useScoreSignals';

const TABS = [
  { key: 'all', label: 'Tout', icon: Radio },
  { key: 'jobs', label: 'Offres d\'emploi', icon: Briefcase },
] as const;

type TabKey = typeof TABS[number]['key'];

export function ProspectionSignals() {
  const [activeTab, setActiveTab] = useState<TabKey>('all');
  const [isScrapingOpen, setIsScrapingOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ current: number; total: number } | null>(null);
  const [enrichedCompany, setEnrichedCompany] = useState<{ groupId: string; name: string } | null>(null);
  const [selectedJobSignal, setSelectedJobSignal] = useState<ProspectSignal | null>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: signals = [], isLoading } = useProspectSignals();

  const scoreSignals = useScoreSignals();
  const archiveUnselected = useArchiveUnselectedSignals();
  const enrichCompany = useEnrichCompany();
  const generateMessages = useGenerateCompanyMessages();

  const filteredSignals = useMemo(() => {
    let result = signals;
    if (activeTab === 'jobs') result = signals.filter(s => s.signal_type === 'job_posting');

    // Sort jobs by ai_score descending
    if (activeTab === 'jobs' || activeTab === 'all') {
      result = [...result].sort((a, b) => {
        const scoreA = (a.extracted_data)?.ai_score as number || 0;
        const scoreB = (b.extracted_data)?.ai_score as number || 0;
        return scoreB - scoreA;
      });
    }

    return result;
  }, [signals, activeTab]);

  const counts = useMemo(() => ({
    all: signals.length,
    jobs: signals.filter(s => s.signal_type === 'job_posting').length,
  }), [signals]);

  const handleScrapeComplete = () => {
    queryClient.invalidateQueries({ queryKey: ['prospect-signals'] });
    queryClient.invalidateQueries({ queryKey: ['prospect-stats'] });
    toast({ description: 'Scraping terminé. Les signaux ont été actualisés.' });
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < 10) next.add(id);
      return next;
    });
  };

  const hasScores = filteredSignals.some(s => (s.extracted_data)?.ai_score);

  const handleEnrichSelection = async () => {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);

    await archiveUnselected.mutateAsync({ selectedIds: ids });

    setEnrichmentProgress({ current: 0, total: ids.length });
    const companyGroupIds: string[] = [];

    for (let i = 0; i < ids.length; i++) {
      setEnrichmentProgress({ current: i + 1, total: ids.length });
      const signalId = ids[i];
      if (!signalId) continue;
      try {
        const result = await enrichCompany.mutateAsync({ signalId });
        if (result.company_group_id) {
          companyGroupIds.push(result.company_group_id);
        }
      } catch (err) {
        logger.error('Enrichment failed for signal', err, { signalId });
      }
    }

    for (const groupId of companyGroupIds) {
      try {
        await generateMessages.mutateAsync({ companyGroupId: groupId });
      } catch (err) {
        logger.error('Message generation failed for group', err, { groupId });
      }
    }

    // Open first enriched company view
    if (companyGroupIds.length > 0) {
      const firstGroupId = companyGroupIds[0];
      if (firstGroupId) {
        const firstSignal = signals.find(s => s.id === ids[0]);
        const ed = firstSignal?.extracted_data as Record<string, unknown> | null;
        const name = ((ed?.company_name as string) || firstSignal?.company_name || 'Entreprise');
        setEnrichedCompany({ groupId: firstGroupId, name });
      }
    }

    setEnrichmentProgress(null);
    setSelectedIds(new Set());
    toast({ description: `${companyGroupIds.length} entreprises enrichies et messages générés` });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Radio className="h-6 w-6" />
            Signaux
          </h1>
          <Badge variant="secondary" className="text-base px-3 py-1">
            {signals.length}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          {(activeTab === 'jobs' || activeTab === 'all') && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => scoreSignals.mutate()}
              disabled={scoreSignals.isPending}
            >
              {scoreSignals.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Scorer les offres
            </Button>
          )}
          {selectedIds.size > 0 && (
            <Button
              size="sm"
              className="gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={handleEnrichSelection}
              disabled={enrichmentProgress !== null}
            >
              {enrichmentProgress ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {enrichmentProgress.current}/{enrichmentProgress.total}
                </>
              ) : (
                <>
                  <ArrowUpDown className="w-4 h-4" />
                  Enrichir la sélection ({selectedIds.size}/10)
                </>
              )}
            </Button>
          )}
          <Button variant="outline" size="sm" className="gap-2" onClick={() => setIsScrapingOpen(true)}>
            <Radio className="w-4 h-4" />
            Scraper maintenant
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-violet-500 text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4" />
              {tab.label}
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-violet-500/15 text-violet-600 dark:text-violet-400' : 'bg-muted text-muted-foreground'
              }`}>
                {counts[tab.key]}
              </span>
            </button>
          );
        })}
      </div>

      {/* Loading state */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredSignals.length === 0 && (
        <div className="glass rounded-lg p-12 text-center">
          <Radio className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-muted-foreground">Aucun signal détecté</p>
        </div>
      )}

      {/* Signal table */}
      {!isLoading && filteredSignals.length > 0 && (
        <div className="glass rounded-lg overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[40px_60px_100px_1fr_200px_120px_80px_40px] gap-3 px-4 py-2.5 bg-muted/30 border-b border-border text-xs font-semibold text-muted-foreground">
            <div></div>
            <div>Score</div>
            <div>Source</div>
            <div>Entreprise</div>
            <div>Poste</div>
            <div>Localisation</div>
            <div>Date</div>
            <div></div>
          </div>

          {/* Table body */}
          <div className="max-h-[calc(100vh-340px)] overflow-y-auto">
            {filteredSignals.map((signal, index) => {
              const extracted = signal.extracted_data as Record<string, unknown> | null;
              const companyName = (extracted?.company_name as string) || signal.company_name;
              const jobTitle = (extracted?.job_title as string) || '';
              const location = (extracted?.location as string) || '';
              const detectedDate = new Date(signal.detected_at).toLocaleDateString('fr-FR');

              const rowBg = index % 2 === 0 ? 'bg-foreground/5' : 'bg-muted/10';

              // Jobs view
              const sourceLabels: Record<string, { label: string; color: string }> = {
                france_travail: { label: 'France Travail', color: 'bg-blue-500' },
                adzuna: { label: 'Adzuna', color: 'bg-emerald-500' },
                apify_linkedin: { label: 'Apify (LinkedIn)', color: 'bg-sky-500' },
                hellowork: { label: 'HelloWork', color: 'bg-orange-500' },
                indeed: { label: 'Indeed', color: 'bg-violet-500' },
                welcometothejungle: { label: 'WTTJ', color: 'bg-yellow-500' },
              };
              const sourceInfo = sourceLabels[signal.source] || { label: signal.source, color: 'bg-gray-500' };

              const aiScore = (extracted?.ai_score as number) || 0;
              const aiReason = (extracted?.ai_reason as string) || '';
              const isSelected = selectedIds.has(signal.id);

              const scoreBadgeColor = aiScore >= 70 ? 'bg-emerald-500/15 text-emerald-600' :
                aiScore >= 40 ? 'bg-amber-500/15 text-amber-600' :
                aiScore > 0 ? 'bg-red-500/15 text-red-500' : 'bg-muted text-muted-foreground';

              return (
                <div
                  key={signal.id}
                  onClick={() => setSelectedJobSignal(signal)}
                  className={`grid grid-cols-[40px_60px_100px_1fr_200px_120px_80px_40px] gap-3 px-4 py-2.5 items-center border-b border-border/30 cursor-pointer transition-colors ${
                    isSelected ? 'bg-violet-500/10' : selectedJobSignal?.id === signal.id ? 'bg-violet-500/5' : `${rowBg} hover:bg-muted/20`
                  }`}
                >
                  {/* Checkbox */}
                  <div>
                    {hasScores && (
                      <button onClick={(e) => { e.stopPropagation(); toggleSelection(signal.id); }} className="text-muted-foreground hover:text-foreground">
                        {isSelected ? <CheckSquare className="h-4 w-4 text-violet-500" /> : <Square className="h-4 w-4" />}
                      </button>
                    )}
                  </div>

                  {/* Score */}
                  <div>
                    {aiScore > 0 ? (
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${scoreBadgeColor}`} title={aiReason}>
                        {aiScore}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Source */}
                  <div>
                    <Badge className={`${sourceInfo.color} text-white text-[10px] px-2 py-0.5 whitespace-nowrap`}>
                      {sourceInfo.label}
                    </Badge>
                  </div>

                  {/* Company */}
                  <div>
                    <p className="font-semibold text-foreground text-sm truncate">{companyName || '—'}</p>
                  </div>

                  {/* Job title */}
                  <div>
                    <p className="text-sm text-muted-foreground truncate">{jobTitle || '—'}</p>
                  </div>

                  {/* Location */}
                  <div>
                    <p className="text-sm text-muted-foreground truncate flex items-center gap-1">
                      {location ? (
                        <>
                          <MapPin className="h-3 w-3 flex-shrink-0" />
                          <span>{location}</span>
                        </>
                      ) : '—'}
                    </p>
                  </div>

                  {/* Date */}
                  <div>
                    <p className="text-xs text-muted-foreground">{detectedDate}</p>
                  </div>

                  {/* External link */}
                  <div className="flex justify-end">
                    {signal.source_url && (
                      <a href={signal.source_url} target="_blank" rel="noopener noreferrer"
                        className="text-muted-foreground hover:text-foreground transition-colors p-1">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Scraping Dashboard */}
      <ScrapingDashboard
        isOpen={isScrapingOpen}
        onClose={() => setIsScrapingOpen(false)}
        onComplete={handleScrapeComplete}
      />

      {/* Job Posting Panel */}
      {selectedJobSignal && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={() => setSelectedJobSignal(null)} />
          <JobPostingPanel signal={selectedJobSignal} onClose={() => setSelectedJobSignal(null)} />
        </>
      )}

      {/* Enriched company view */}
      {enrichedCompany && (
        <CompanyEnrichedView
          companyGroupId={enrichedCompany.groupId}
          companyName={enrichedCompany.name}
          onClose={() => setEnrichedCompany(null)}
        />
      )}
    </div>
  );
}

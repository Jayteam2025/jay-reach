import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Radio, Search, Check, X, Loader2, Clock } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { logger } from '@/lib/logger';

interface ScrapingDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void;
}

type SourceStatus = 'idle' | 'in_progress' | 'done' | 'error' | 'waiting';

interface SourceState {
  name: string;
  status: SourceStatus;
  progress: number;
  resultCount: number;
  icon: React.ReactNode;
  accentColor: string;
}

type ScrapingPhase = 'idle' | 'scraping_jobs' | 'done';

const SOURCES: Record<string, Omit<SourceState, 'status' | 'progress' | 'resultCount'>> = {
  france_travail: {
    name: 'France Travail',
    icon: <Radio className="h-4 w-4" />,
    accentColor: 'bg-blue-500',
  },
  job_boards: {
    name: 'Job Boards',
    icon: <Search className="h-4 w-4" />,
    accentColor: 'bg-orange-500',
  },
};

function StatusIcon({ status }: { status: SourceStatus }) {
  switch (status) {
    case 'in_progress':
      return <Loader2 className="h-4 w-4 animate-spin text-foreground" />;
    case 'done':
      return <Check className="h-4 w-4 text-green-500" />;
    case 'error':
      return <X className="h-4 w-4 text-red-500" />;
    case 'waiting':
      return <Clock className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function SourceRow({
  sourceKey: _sourceKey,
  state,
}: {
  sourceKey: string;
  state: SourceState;
}) {
  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-muted-foreground">{state.icon}</div>
          <span className="text-sm font-medium text-foreground">{state.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIcon status={state.status} />
          <span className="text-xs text-muted-foreground min-w-[50px] text-right">
            {state.resultCount} {state.resultCount === 1 ? 'résultat' : 'résultats'}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full h-2 bg-card rounded-full overflow-hidden border border-border/50">
        <div
          className={`h-full rounded-full transition-all duration-300 ${state.accentColor}`}
          style={{ width: `${state.progress}%` }}
        />
      </div>
    </div>
  );
}

export function ScrapingDashboard({
  isOpen,
  onClose,
  onComplete,
}: ScrapingDashboardProps) {
  const { toast } = useToast();
  const [phase, setPhase] = useState<ScrapingPhase>('idle');
  const [sources, setSources] = useState<Record<string, SourceState>>({
    france_travail: {
      ...SOURCES.france_travail,
      status: 'idle',
      progress: 0,
      resultCount: 0,
    },
    job_boards: {
      ...SOURCES.job_boards,
      status: 'idle',
      progress: 0,
      resultCount: 0,
    },
  });
  const [totalResults, setTotalResults] = useState(0);

  // Start scraping jobs (France Travail + Job Boards)
  const startScrapeJobs = useCallback(async () => {
    setPhase('scraping_jobs');
    setSources((prev) => ({
      ...prev,
      france_travail: { ...prev.france_travail, status: 'in_progress', progress: 0 },
      job_boards: { ...prev.job_boards, status: 'in_progress', progress: 0 },
    }));

    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setSources((prev) => ({
          ...prev,
          france_travail: {
            ...prev.france_travail,
            progress: Math.min(prev.france_travail.progress + 15, 90),
          },
          job_boards: {
            ...prev.job_boards,
            progress: Math.min(prev.job_boards.progress + 12, 90),
          },
        }));
      }, 500);

      const { data, error } = await supabase.functions.invoke('scrape-job-signals');

      clearInterval(progressInterval);

      if (error) throw error;

      // Response: { total_inserted, results: { france_travail: { inserted }, adzuna: { inserted } } }
      const ftInserted = data?.results?.france_travail?.inserted || 0;
      const adzunaInserted = data?.results?.adzuna?.inserted || 0;
      const jobResults = data?.total_inserted || (ftInserted + adzunaInserted);

      setSources((prev) => ({
        ...prev,
        france_travail: {
          ...prev.france_travail,
          status: data?.results?.france_travail?.success === false ? 'error' : 'done',
          progress: 100,
          resultCount: ftInserted,
        },
        job_boards: {
          ...prev.job_boards,
          status: 'done',
          progress: 100,
          resultCount: adzunaInserted,
        },
      }));

      setTotalResults(jobResults);
      setPhase('done');
    } catch (err) {
      logger.error('Job scraping error', err);
      setSources((prev) => ({
        ...prev,
        france_travail: { ...prev.france_travail, status: 'error', progress: 0 },
        job_boards: { ...prev.job_boards, status: 'error', progress: 0 },
      }));
      toast({
        description: 'Erreur lors du scraping des offres: ' + (err as Error).message,
        variant: 'destructive',
      });
      setPhase('idle');
    }
  }, [toast]);

  // Handle opening the dashboard
  useEffect(() => {
    if (isOpen && phase === 'idle') {
      setTotalResults(0);
      setSources({
        france_travail: {
          ...SOURCES.france_travail,
          status: 'idle',
          progress: 0,
          resultCount: 0,
        },
        job_boards: {
          ...SOURCES.job_boards,
          status: 'idle',
          progress: 0,
          resultCount: 0,
        },
      });

      void setTimeout(() => {
        void startScrapeJobs();
      }, 300);
    }
  }, [isOpen, phase, startScrapeJobs]);

  // Handle completion
  const handleClose = () => {
    if (phase === 'done') {
      onComplete();
    }
    onClose();
    setPhase('idle');
  };

  const isCompleted = phase === 'done';

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent className="w-full sm:w-96">
        <SheetHeader>
          <SheetTitle>Scraping en cours</SheetTitle>
        </SheetHeader>

        <div className="space-y-6 mt-6">
          {/* Source rows */}
          <div className="space-y-4">
            {Object.entries(sources).map(([key, state]) => (
              <SourceRow key={key} sourceKey={key} state={state} />
            ))}
          </div>

          {/* Summary */}
          {isCompleted && (
            <div className="rounded-lg bg-card border border-border p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Check className="h-4 w-4 text-green-500" />
                <span className="text-sm font-medium text-foreground">
                  Scraping terminé
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Total: <span className="font-semibold text-foreground">{totalResults}</span> résultats
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="flex gap-2 justify-end">
            {isCompleted && (
              <Button variant="outline" size="sm" onClick={handleClose}>
                Fermer
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

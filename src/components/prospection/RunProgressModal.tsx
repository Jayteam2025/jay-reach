import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Clock, Rocket, Minimize2, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { StatTile } from './_shared/progress-ui';
import type { RunScoring } from '@/hooks/useRunProgress';

export interface ScrapeState {
  status: 'running' | 'done' | 'failed';
  totalInserted?: number;
  sources?: string[];
  error?: string;
}

const SOURCE_LABELS: Record<string, string> = {
  adzuna: 'Adzuna',
  france_travail: 'France Travail',
};

function formatElapsedTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function RunProgressModal({
  open,
  onClose,
  scrape,
  scoring,
  isDone,
}: {
  open: boolean;
  onClose: () => void;
  scrape: ScrapeState;
  scoring: RunScoring | null;
  isDone: boolean;
}) {
  const scrapeDone = scrape.status === 'done';
  const scrapeFailed = scrape.status === 'failed';
  const sourcesLabel = (scrape.sources ?? []).map((s) => SOURCE_LABELS[s] ?? s).join(' · ');

  // Chrono : démarre quand le scoring passe en in_progress (l'effet ne se relance
  // que sur le changement de statut, pas à chaque processed → le start reste fixe).
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    if (scoring?.status !== 'in_progress') {
      setElapsedSeconds(0);
      return;
    }
    const start = Date.now();
    setElapsedSeconds(0);
    const interval = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [scoring?.status]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg p-0 gap-0 bg-card border-border/40 dark:border-border/30 shadow-2xl">
        <DialogHeader className="p-6 pb-4 border-b border-border">
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <Rocket className="h-5 w-5 text-violet-500" />
            {isDone ? 'Run terminé' : scrapeFailed ? 'Run en échec' : 'Run en cours'}
          </DialogTitle>
        </DialogHeader>

        <div className="px-6 py-5 space-y-5">
          {/* Étape 1 : Scrape */}
          <div className="flex items-start gap-3">
            {scrapeFailed
              ? <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              : scrapeDone
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                : <Loader2 className="h-5 w-5 text-violet-500 shrink-0 mt-0.5 animate-spin" />}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-foreground">Scraping des offres</div>
              <div className="text-xs text-muted-foreground">
                {scrapeFailed
                  ? (scrape.error ?? 'Échec du scraping')
                  : scrapeDone
                    ? `${scrape.totalInserted ?? 0} offres récupérées${sourcesLabel ? ` (${sourcesLabel})` : ''}`
                    : 'Récupération en cours…'}
              </div>
            </div>
          </div>

          {/* Étape 2 : Scoring */}
          <div className={cn('flex items-start gap-3', !scrapeDone && 'opacity-50')}>
            {scoring?.status === 'failed'
              ? <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
              : scoring?.status === 'ended'
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                : scrapeDone
                  ? <Loader2 className="h-5 w-5 text-violet-500 shrink-0 mt-0.5 animate-spin" />
                  : <Clock className="h-5 w-5 text-muted-foreground/60 shrink-0 mt-0.5" />}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium text-foreground">Scoring des entreprises</div>
                {scoring?.status === 'in_progress' && (
                  <div className="text-xs text-muted-foreground flex items-center gap-1">
                    <Zap className="h-3 w-3 text-violet-500" />
                    Analyse IA · {formatElapsedTime(elapsedSeconds)}
                  </div>
                )}
              </div>
              {!scrapeDone && <div className="text-xs text-muted-foreground">En attente du scraping…</div>}
              {scrapeDone && scoring?.status === 'pending' && (
                <div className="text-xs text-muted-foreground">Préparation du batch…</div>
              )}
              {scrapeDone && scoring && (scoring.status === 'in_progress' || scoring.status === 'ended') && (
                <>
                  {scoring.total > 0 ? (
                    <>
                      {/* Barre vivante — indéterminée si processed === 0, sinon déterminée */}
                      {scoring.status === 'in_progress' && scoring.processed === 0 ? (
                        // Barre indéterminée avec shimmer
                        <div className="space-y-1">
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-violet-500 to-transparent animate-shimmer" />
                            </div>
                            <div className="text-sm tabular-nums text-muted-foreground min-w-[60px] text-right">
                              0/{scoring.total}
                              <span className="ml-1.5 text-xs">(0%)</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Barre déterminée avec animation douce
                        <div className="flex items-center gap-3">
                          <div className="flex-1">
                            <div className="h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-violet-500 rounded-full transition-[width] duration-700 ease-out"
                                style={{
                                  width: `${scoring.total > 0 ? Math.round((scoring.processed / scoring.total) * 100) : 0}%`,
                                }}
                              />
                            </div>
                          </div>
                          <div className="text-sm tabular-nums text-muted-foreground min-w-[60px] text-right">
                            {scoring.processed}/{scoring.total}
                            <span className="ml-1.5 text-xs">({scoring.total > 0 ? Math.round((scoring.processed / scoring.total) * 100) : 0}%)</span>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-3 pt-1">
                        <StatTile
                          icon={CheckCircle2}
                          label={scoring.status === 'ended' ? 'Scorées' : 'Scorées'}
                          value={scoring.processed}
                          tone={scoring.status === 'ended' ? 'done' : 'active'}
                        />
                        {scoring.failed > 0 && <StatTile icon={XCircle} label="Échecs" value={scoring.failed} tone="error" />}
                      </div>
                    </>
                  ) : (
                    <div className="text-xs text-muted-foreground">Initialisation du scoring…</div>
                  )}
                </>
              )}
              {scoring?.status === 'failed' && (
                <div className="text-xs text-red-500/80">Le scoring a échoué.</div>
              )}
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {isDone ? 'Run terminé.' : 'Continue même si tu fermes cette fenêtre.'}
          </p>
          <Button variant="ghost" size="sm" onClick={onClose} className="gap-1.5 h-7">
            <Minimize2 className="h-3.5 w-3.5" />
            {isDone ? 'Fermer' : 'Réduire'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

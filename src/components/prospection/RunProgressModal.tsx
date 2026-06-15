import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, XCircle, Loader2, Clock, Rocket, Minimize2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ProgressBar, StatTile } from './_shared/progress-ui';
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
              <div className="text-sm font-medium text-foreground">Scoring des entreprises</div>
              {!scrapeDone && <div className="text-xs text-muted-foreground">En attente du scraping…</div>}
              {scrapeDone && scoring?.status === 'pending' && (
                <div className="text-xs text-muted-foreground">Préparation du batch…</div>
              )}
              {scrapeDone && scoring && (scoring.status === 'in_progress' || scoring.status === 'ended') && scoring.total > 0 && (
                <>
                  <ProgressBar value={scoring.processed} total={scoring.total} />
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <StatTile icon={CheckCircle2} label="Scorées" value={scoring.processed} tone="done" />
                    {scoring.failed > 0 && <StatTile icon={XCircle} label="Échecs" value={scoring.failed} tone="error" />}
                  </div>
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

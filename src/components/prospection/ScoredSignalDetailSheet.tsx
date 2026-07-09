import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, MapPin, Mail, Briefcase, Calendar, ArrowUpDown, Loader2 } from 'lucide-react';
import type { ProspectSignal } from '@/hooks/useProspectSignals';
import { cn } from '@/lib/utils';

interface Props {
  signal: ProspectSignal | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEnrich: (signalId: string) => void;
  isEnriching?: boolean;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
    : score >= 40
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
      : 'bg-red-500/10 text-red-400 border-red-500/30';

  return (
    <span className={cn('inline-flex items-center px-3 py-1 rounded-md text-lg font-mono font-semibold border', color)}>
      {score}
      <span className="text-xs ml-1 opacity-60">/100</span>
    </span>
  );
}

export function ScoredSignalDetailSheet({ signal, open, onOpenChange, onEnrich, isEnriching }: Props) {
  if (!signal) return null;

  const ed = signal.extracted_data as Record<string, unknown> | null;
  const score = (ed?.ai_score as number) ?? 0;
  const reason = (ed?.ai_reason as string) || '';
  const company = (ed?.company_name as string) || signal.company_name || 'Entreprise inconnue';
  const jobTitle = (ed?.job_title as string) || '';
  const location = (ed?.location as string) || '';
  const email = (ed?.email as string) || (ed?.contact_email as string) || '';
  const description = (ed?.description as string) || signal.raw_content || '';
  const sourceUrl = signal.source_url;
  const detectedAt = signal.detected_at;

  const formattedDate = detectedAt
    ? new Date(detectedAt).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto glass-strong border-l-0"
      >
        <SheetHeader className="space-y-3 pr-8">
          <div className="flex items-start gap-3">
            <ScoreBadge score={score} />
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-xl leading-tight">{company}</SheetTitle>
              {jobTitle && (
                <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5" />
                  {jobTitle}
                </p>
              )}
            </div>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Métadonnées */}
          <section className="grid grid-cols-1 gap-2 text-sm">
            {location && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4 shrink-0" />
                <span>{location}</span>
              </div>
            )}
            {email && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Mail className="w-4 h-4 shrink-0" />
                <a href={`mailto:${email}`} className="hover:text-foreground truncate">{email}</a>
              </div>
            )}
            {formattedDate && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="w-4 h-4 shrink-0" />
                <span>Détectée le {formattedDate}</span>
              </div>
            )}
            {sourceUrl && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <ExternalLink className="w-4 h-4 shrink-0" />
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground truncate"
                >
                  Voir l'offre source
                </a>
              </div>
            )}
          </section>

          {/* Justification Claude */}
          {reason && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Justification du score
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed border-l-2 border-violet-500/40 pl-3">
                {reason}
              </p>
            </section>
          )}

          {/* Description offre */}
          {description && (
            <section>
              <h3 className="text-sm font-semibold text-foreground mb-2">
                Description du poste
              </h3>
              <div className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed bg-muted/20 border border-border rounded-md p-3 max-h-60 overflow-y-auto">
                {description}
              </div>
            </section>
          )}

          {/* Action */}
          <div className="pt-2 border-t border-border">
            <Button
              className="w-full gap-2 bg-violet-600 hover:bg-violet-700 text-white"
              onClick={() => onEnrich(signal.id)}
              disabled={isEnriching}
            >
              {isEnriching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Enrichissement…
                </>
              ) : (
                <>
                  <ArrowUpDown className="w-4 h-4" />
                  Enrichir cette boîte
                </>
              )}
            </Button>
            <div className="flex items-center gap-2 mt-2">
              <Badge variant="secondary" className="text-[10px] font-mono">
                {signal.source}
              </Badge>
              <span className="text-[11px] text-muted-foreground/60 font-mono">
                {signal.id.slice(0, 8)}
              </span>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

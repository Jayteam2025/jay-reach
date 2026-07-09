import { X, Building2, MapPin, Mail, Briefcase, Star, ExternalLink, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProspectSignal } from '@/hooks/useProspectSignals';

interface Props {
  signal: ProspectSignal;
  onClose: () => void;
}

export function JobPostingPanel({ signal, onClose }: Props) {
  const ed = signal.extracted_data;
  const companyName = (ed.company_name as string) || signal.company_name || '—';
  const jobTitle = (ed.job_title as string) || '—';
  const location = (ed.location as string) || null;
  const description = (ed.description as string) || signal.raw_content || '';
  const contactEmail = (ed.contact_email as string) || null;
  const contractType = (ed.contract_type as string) || null;
  const postedDate = (ed.posted_date as string) || null;
  const aiScore = (ed.ai_score as number) || 0;
  const aiReason = (ed.ai_reason as string) || null;
  const aiJustification = (ed.ai_justification as string) || null;

  const scoreBadgeColor = aiScore >= 70 ? 'bg-emerald-500/15 text-emerald-600 border-emerald-600/30'
    : aiScore >= 40 ? 'bg-amber-500/15 text-amber-600 border-amber-600/30'
    : aiScore > 0 ? 'bg-red-500/15 text-red-500 border-red-500/30'
    : 'bg-muted text-muted-foreground border-border';

  const sourceLabels: Record<string, string> = {
    france_travail: 'France Travail',
    adzuna: 'Adzuna',
    apify_linkedin: 'Apify (LinkedIn)',
    hellowork: 'HelloWork',
    indeed: 'Indeed',
    welcometothejungle: 'WTTJ',
  };

  return (
    <div className="fixed right-0 top-0 h-full w-[420px] glass-strong z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-start justify-between p-5 border-b border-border">
        <div className="min-w-0 flex-1 mr-3">
          <h3 className="font-semibold text-foreground text-base truncate">{jobTitle}</h3>
          <div className="flex items-center gap-2 mt-1">
            <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-sm text-muted-foreground truncate">{companyName}</span>
          </div>
          {location && (
            <div className="flex items-center gap-2 mt-0.5">
              <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs text-muted-foreground">{location}</span>
            </div>
          )}
        </div>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1">
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-5">

        {/* Score IA */}
        {aiScore > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Star className="h-3.5 w-3.5" />
              Score IA
            </h4>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className={`text-lg font-bold px-3 py-1 ${scoreBadgeColor}`}>
                {aiScore}/100
              </Badge>
            </div>
            {aiReason && (
              <p className="text-xs text-muted-foreground">{aiReason}</p>
            )}
            {aiJustification && (
              <p className="text-sm text-foreground bg-muted/30 rounded-md px-3 py-2 border border-border/50 leading-relaxed">
                {aiJustification}
              </p>
            )}
          </div>
        )}

        {/* Infos */}
        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" />
            Informations
          </h4>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Source</span>
              <span className="text-foreground">{sourceLabels[signal.source] || signal.source}</span>
            </div>
            {contractType && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Contrat</span>
                <span className="text-foreground capitalize">{contractType === 'permanent' ? 'CDI' : contractType}</span>
              </div>
            )}
            {postedDate && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Publiee le</span>
                <span className="text-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date(postedDate).toLocaleDateString('fr-FR')}
                </span>
              </div>
            )}
            {contactEmail && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Email RH</span>
                <span className="text-emerald-600 flex items-center gap-1">
                  <Mail className="h-3 w-3" />
                  {contactEmail}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Description */}
        {description && (
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Description
            </h4>
            <p className="text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
              {description}
            </p>
          </div>
        )}

        {/* Lien externe */}
        {signal.source_url && (
          <a
            href={signal.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-sm text-violet-500 hover:text-violet-400 transition-colors"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Voir l'offre originale
          </a>
        )}
      </div>
    </div>
  );
}

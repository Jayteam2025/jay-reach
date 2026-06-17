import { Database, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type EnrichedCompany } from '@/hooks/useEnrichedCompanies';
import { useCompanyProgress } from '@/hooks/useProspectActions';
import { useCrmDetection } from '@/features/crm-detection/useCrmDetection';

interface EntrepriseInboxListProps {
  companies: EnrichedCompany[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Sens du tri par avancement + bascule (fleche icone dans le header). */
  sortDir?: 'desc' | 'asc';
  onToggleSort?: () => void;
}

export function EntrepriseInboxList({
  companies,
  selectedId,
  onSelect,
  sortDir = 'desc',
  onToggleSort,
}: EntrepriseInboxListProps) {
  return (
    <div className="w-72 shrink-0 border-r border-border overflow-y-auto">
      <div className="px-6 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10 flex items-center gap-3">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-widest">
          {companies.length} entreprises
        </span>
        {onToggleSort && (
          <button
            type="button"
            onClick={onToggleSort}
            className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            aria-label={sortDir === 'desc' ? 'Trier par avancement croissant' : 'Trier par avancement décroissant'}
            title={sortDir === 'desc' ? 'Plus avancées en premier' : 'Moins avancées en premier'}
          >
            {sortDir === 'desc' ? <ArrowDown className="w-3.5 h-3.5" /> : <ArrowUp className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
      <div>
        {companies.map(company => (
          <CompanyRow
            key={company.company_group_id}
            company={company}
            isSelected={selectedId === company.company_group_id}
            onSelect={() => onSelect(company.company_group_id)}
          />
        ))}
      </div>
    </div>
  );
}

function CompanyRow({
  company,
  isSelected,
  onSelect,
}: {
  company: EnrichedCompany;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const { data: progress } = useCompanyProgress(company.company_group_id);
  const { detection } = useCrmDetection(company.company_group_id);
  const percent = progress?.percent || 0;
  // Comptage par persona réel (plus de hr/director/sales en dur) : un libellé par
  // persona présent, ex. "2 Responsable maintenance".
  const counts: string[] = Object.values(company.personaGroups)
    .filter((profiles) => profiles.length > 0)
    .map((profiles) => `${profiles.length} ${profiles[0]?.persona?.label ?? 'contact'}`);

  const detectedCrm = detection?.detection_status === 'completed' ? detection.crm_name : null;

  return (
    <div
      className={cn(
        'w-full px-6 py-3 border-b border-border/40 transition-colors block relative',
        isSelected ? 'bg-muted/60 hover:bg-muted/70' : 'hover:bg-muted/30',
      )}
    >
      <button
        onClick={onSelect}
        className="w-full min-w-0 text-left"
      >
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-medium text-foreground text-[14px] leading-tight truncate">
            {company.company_name}
          </p>
          {progress && progress.total > 0 && (
            <span className={cn(
              'text-[11px] font-mono tabular-nums shrink-0',
              percent === 100 ? 'text-emerald-500' : 'text-muted-foreground'
            )}>
              {percent}%
            </span>
          )}
        </div>
        <p className="text-[12px] text-muted-foreground mt-1">
          {counts.join(' · ') || 'aucun contact'}
        </p>

        {detectedCrm && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Database className="h-3 w-3 text-muted-foreground shrink-0" />
            <span className="text-[11px] font-medium truncate text-muted-foreground">
              {detectedCrm}
            </span>
          </div>
        )}

        {progress && progress.total > 0 && (
          <div className="mt-2 h-[2px] rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-500 ease-out',
                percent === 100 ? 'bg-emerald-500' : 'bg-foreground'
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </button>
    </div>
  );
}

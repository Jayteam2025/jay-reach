import { Sparkles, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type EnrichedCompany } from '@/hooks/useEnrichedCompanies';
import { useCompanyProgress } from '@/hooks/useProspectActions';
import { useCrmDetection } from '@/features/crm-detection/useCrmDetection';
import { isJayNativeCrm } from '@/lib/crm-detection/native';
import { Checkbox } from '@/components/ui/checkbox';

interface EntrepriseInboxListProps {
  companies: EnrichedCompany[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  bulkSelectedIds: Set<string>;
  onToggleBulk: (companyId: string, checked: boolean) => void;
  onToggleAllBulk: (checked: boolean) => void;
  /** Sens du tri par avancement + bascule (fleche icone dans le header). */
  sortDir?: 'desc' | 'asc';
  onToggleSort?: () => void;
}

export function EntrepriseInboxList({
  companies,
  selectedId,
  onSelect,
  bulkSelectedIds,
  onToggleBulk,
  onToggleAllBulk,
  sortDir = 'desc',
  onToggleSort,
}: EntrepriseInboxListProps) {
  const allChecked = companies.length > 0 && companies.every(c => bulkSelectedIds.has(c.company_group_id));
  const someChecked = !allChecked && companies.some(c => bulkSelectedIds.has(c.company_group_id));
  const headerState: boolean | 'indeterminate' = allChecked ? true : someChecked ? 'indeterminate' : false;

  return (
    <div className="w-72 shrink-0 border-r border-border overflow-y-auto">
      <div className="px-6 py-4 border-b border-border sticky top-0 bg-background/95 backdrop-blur z-10 flex items-center gap-3">
        <Checkbox
          checked={headerState}
          onCheckedChange={(v) => onToggleAllBulk(v === true)}
          aria-label="Tout selectionner"
        />
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
            isBulkChecked={bulkSelectedIds.has(company.company_group_id)}
            onSelect={() => onSelect(company.company_group_id)}
            onToggleBulk={(checked) => onToggleBulk(company.company_group_id, checked)}
          />
        ))}
      </div>
    </div>
  );
}

function CompanyRow({
  company,
  isSelected,
  isBulkChecked,
  onSelect,
  onToggleBulk,
}: {
  company: EnrichedCompany;
  isSelected: boolean;
  isBulkChecked: boolean;
  onSelect: () => void;
  onToggleBulk: (checked: boolean) => void;
}) {
  const { data: progress } = useCompanyProgress(company.company_group_id);
  const { detection } = useCrmDetection(company.company_group_id);
  const percent = progress?.percent || 0;
  const counts: string[] = [];
  if (company.hr) counts.push('RH');
  if (company.director) counts.push('Dir Co');
  if (company.sales.length > 0) counts.push(`${company.sales.length} com.`);

  const detectedCrm = detection?.detection_status === 'completed' ? detection.crm_name : null;
  const isNative = isJayNativeCrm(detectedCrm);

  return (
    <div
      className={cn(
        'w-full px-6 py-3 border-b border-border/40 transition-colors block relative flex items-start gap-3',
        isSelected ? 'bg-muted/60' : isBulkChecked ? 'bg-violet-500/5 hover:bg-violet-500/10' : 'hover:bg-muted/30',
        isNative && !isBulkChecked && 'bg-primary/5 hover:bg-primary/10 border-l-2 border-l-primary'
      )}
    >
      <div className="pt-0.5 shrink-0" onClick={e => e.stopPropagation()}>
        <Checkbox
          checked={isBulkChecked}
          onCheckedChange={(v) => onToggleBulk(v === true)}
          aria-label={`Selectionner ${company.company_name}`}
        />
      </div>
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 text-left"
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
            {isNative && <Sparkles className="h-3 w-3 text-primary shrink-0" />}
            <span
              className={cn(
                'text-[11px] font-medium truncate',
                isNative ? 'text-primary' : 'text-muted-foreground'
              )}
            >
              {detectedCrm}
              {isNative && <span className="ml-1 opacity-70">· natif</span>}
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

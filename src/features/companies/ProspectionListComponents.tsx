import { type ReactNode } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { CheckSquare, Square, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ProspectSignal } from '@/hooks/useProspectSignals';

// -----------------------------------------------------------------------------
// Composants presentationnels de la liste Prospection (Jay Reach 1.5.5).
// Extraits de ProspectionEntreprises.tsx — aucune logique metier, juste du rendu.
// -----------------------------------------------------------------------------

// ToolsRow — ligne d'action dans le dropdown "Outils".
// Layout : icone — label — (count badge | spinner) — bouton focus invisible.
// Dark-first, respect des tokens (text-muted-foreground, bg-accent, etc.).
export function ToolsRow({
  icon,
  label,
  count,
  onSelect,
  disabled,
  loading,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  count?: number;
  onSelect: () => void;
  disabled?: boolean;
  loading?: boolean;
  destructive?: boolean;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      disabled={disabled}
      className={cn(
        'flex items-center gap-3 px-2 py-2 text-[13px] rounded-md cursor-pointer',
        'focus:bg-accent/60 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed',
        destructive && 'text-destructive focus:bg-destructive/10 focus:text-destructive',
      )}
    >
      <span className="shrink-0 inline-flex items-center justify-center w-5 h-5">
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {typeof count === 'number' && (
        <span
          className={cn(
            'shrink-0 inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded text-[11px] font-mono tabular-nums',
            count > 0
              ? 'bg-emerald-500/15 text-emerald-500 dark:text-emerald-400'
              : 'bg-muted/50 text-muted-foreground/50',
          )}
        >
          {count}
        </span>
      )}
    </DropdownMenuItem>
  );
}

export function SourceToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      role="tab"
      aria-selected={active}
      className={cn(
        'px-3 py-1 text-xs font-medium rounded transition-colors',
        active
          ? 'bg-violet-500 text-white'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      {label}
    </button>
  );
}

export function ViewToggleButton({
  active,
  onClick,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-2 px-3 py-1 rounded text-sm font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <span>{label}</span>
      {typeof count === 'number' && (
        <span
          className={cn(
            'inline-flex items-center justify-center min-w-5 px-1.5 rounded text-[11px] font-mono leading-5',
            active
              ? 'bg-violet-500/15 text-violet-600 dark:text-violet-300'
              : 'bg-muted text-muted-foreground/80',
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

export function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70
    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    : score >= 40
      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
      : 'bg-red-500/10 text-red-400 border-red-500/20';

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-sm font-mono font-medium border ${color}`}>
      {score}
    </span>
  );
}

// Table des signaux scores (vue Scorees) avec selection multiple.
export function ScoredSignalsTable({
  signals,
  selectedIds,
  onToggle,
  onSelectAll,
  onRowClick,
}: {
  signals: ProspectSignal[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onSelectAll: () => void;
  onRowClick: (id: string) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border bg-muted/30">
            <th className="p-3 w-10">
              <button onClick={onSelectAll} className="text-muted-foreground hover:text-foreground">
                {selectedIds.size === signals.length ? (
                  <CheckSquare className="w-4 h-4 text-violet-500" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
            </th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Score</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Entreprise</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Poste</th>
            <th className="p-3 text-left text-xs font-medium text-muted-foreground uppercase">Justification</th>
          </tr>
        </thead>
        <tbody>
          {signals.map(signal => {
            const ed = signal.extracted_data as Record<string, unknown> | null;
            const score = ed?.ai_score as number || 0;
            const company = (ed?.company_name as string) || signal.company_name || '—';
            const title = (ed?.job_title as string) || signal.raw_content?.substring(0, 60) || '—';
            const justification = (ed?.ai_justification as string) || (ed?.ai_reason as string) || '';
            const isSelected = selectedIds.has(signal.id);

            return (
              <tr
                key={signal.id}
                className="border-b border-border/50 hover:bg-muted/50 cursor-pointer transition-colors"
                onClick={() => onRowClick(signal.id)}
              >
                <td className="p-3">
                  <button
                    type="button"
                    aria-label={isSelected ? 'Desélectionner' : 'Sélectionner'}
                    className="flex items-center justify-center w-6 h-6 -m-1 rounded hover:bg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggle(signal.id);
                    }}
                  >
                    {isSelected ? (
                      <CheckSquare className="w-4 h-4 text-violet-500" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground/40" />
                    )}
                  </button>
                </td>
                <td className="p-3">
                  <ScoreBadge score={score} />
                </td>
                <td className="p-3 font-medium text-foreground">{company}</td>
                <td className="p-3 text-muted-foreground text-sm max-w-[200px] truncate">{title}</td>
                <td className="p-3 text-muted-foreground/60 text-sm max-w-[300px] truncate">{justification}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

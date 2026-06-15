import type { LucideIcon } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

export function ProgressBar({ value, total, className }: { value: number; total: number; className?: string }) {
  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <div className="flex-1">
        <Progress value={percent} className="h-2 bg-muted" />
      </div>
      <div className="text-sm tabular-nums text-muted-foreground min-w-[60px] text-right">
        {value}/{total}
        <span className="ml-1.5 text-xs">({percent}%)</span>
      </div>
    </div>
  );
}

export type StatTone = 'done' | 'active' | 'pending' | 'error';

const TONE_CLASSES: Record<StatTone, string> = {
  done: 'text-emerald-600 dark:text-emerald-400',
  active: 'text-violet-600 dark:text-violet-400',
  pending: 'text-muted-foreground',
  error: 'text-red-600 dark:text-red-400',
};

export function StatTile({
  icon: Icon,
  label,
  value,
  tone,
  spin = false,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  tone: StatTone;
  spin?: boolean;
}) {
  const c = TONE_CLASSES[tone];
  return (
    <div className="flex items-center gap-2">
      <Icon className={cn('h-4 w-4', c, spin && 'animate-spin')} />
      <div>
        <div className={cn('text-sm font-semibold tabular-nums', c)}>{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

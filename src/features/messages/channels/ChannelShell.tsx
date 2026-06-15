import { cn } from '@/lib/utils';

export type ChannelAccent = 'violet' | 'amber' | 'emerald' | 'sky' | 'slate';

const ACCENT_BORDER: Record<ChannelAccent, string> = {
  violet: 'border-l-violet-500',
  amber: 'border-l-amber-500',
  emerald: 'border-l-emerald-500',
  sky: 'border-l-sky-500',
  slate: 'border-l-slate-400 dark:border-l-slate-500',
};

const ACCENT_ICON: Record<ChannelAccent, string> = {
  violet: 'text-violet-600 dark:text-violet-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  sky: 'text-sky-600 dark:text-sky-400',
  slate: 'text-slate-500 dark:text-slate-400',
};

export function ChannelShell({
  accent,
  children,
}: {
  accent: ChannelAccent;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('border-l-[3px] pl-5 py-3 -ml-5', ACCENT_BORDER[accent])}>
      {children}
    </div>
  );
}

export function ChannelHeader({
  Icon,
  label,
  accent,
  status,
}: {
  Icon: React.ComponentType<{ className?: string }>;
  label: string;
  accent: ChannelAccent;
  status?: { label: string; kind: 'found' | 'missing' | 'sent' | 'draft' };
}) {
  return (
    <div className="flex items-center justify-between mb-2">
      <span className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-foreground/80">
        <Icon className={cn('w-3.5 h-3.5', ACCENT_ICON[accent])} />
        {label}
      </span>
      {status && <StatusPill {...status} />}
    </div>
  );
}

export function StatusPill({
  label,
  kind,
}: {
  label: string;
  kind: 'found' | 'missing' | 'sent' | 'draft';
}) {
  const style = {
    found: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 ring-emerald-500/20',
    missing: 'bg-amber-500/10 text-amber-700 dark:text-amber-300 ring-amber-500/20',
    sent: 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/20',
    draft: 'bg-violet-500/10 text-violet-700 dark:text-violet-300 ring-violet-500/20',
  }[kind];
  return (
    <span
      className={cn(
        'text-[10px] font-medium px-2 py-0.5 rounded-full ring-1 tracking-tight',
        style
      )}
    >
      {label}
    </span>
  );
}

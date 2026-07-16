import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, CheckCircle2, ExternalLink, Inbox, Loader2, RotateCcw, X, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fadeUp, staggerProps } from '@/lib/motion';
import { Button } from '@/components/ui/button';
import type { ProspectSignal } from '@/hooks/useProspectSignals';
import {
  bucketOf,
  TriageBucket,
  useBulkValidateSignals,
  useSetSignalStatus,
  useSignaux,
} from '@/hooks/useSignauxTriage';

const SOURCE_LABELS: Record<string, string> = {
  france_travail: 'France Travail',
  adzuna: 'Adzuna',
  apify_linkedin: 'LinkedIn Jobs',
  hellowork: 'HelloWork',
  indeed: 'Indeed',
  welcometothejungle: 'WTTJ',
};

const BUCKET_META: { id: TriageBucket; label: string; icon: typeof Inbox }[] = [
  { id: 'todo', label: 'À traiter', icon: Inbox },
  { id: 'validated', label: 'Validées', icon: CheckCircle2 },
  { id: 'rejected', label: 'Rejetées', icon: XCircle },
];

function scoreTier(score: number): 'high' | 'mid' | 'low' {
  if (score >= 80) return 'high';
  if (score >= 60) return 'mid';
  return 'low';
}
function tierBadge(tier: 'high' | 'mid' | 'low') {
  return tier === 'high'
    ? 'bg-emerald-400/15 text-emerald-500'
    : tier === 'mid'
      ? 'bg-amber-400/15 text-amber-500'
      : 'bg-foreground/10 text-muted-foreground';
}
function tierBorder(tier: 'high' | 'mid' | 'low') {
  return tier === 'high' ? 'border-l-emerald-400' : tier === 'mid' ? 'border-l-amber-400' : 'border-l-muted-foreground/40';
}
function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return "à l'instant";
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString('fr-FR');
}
function getScore(s: ProspectSignal): number {
  return Number(s.extracted_data?.ai_score ?? 0) || 0;
}
function ex(s: ProspectSignal) {
  const e = s.extracted_data as Record<string, unknown> | null;
  return {
    company: (e?.company_name as string) || s.company_name || '—',
    title: (e?.job_title as string) || (e?.title as string) || 'Signal détecté',
    size: e?.company_size as string | undefined,
    contract: e?.contract_type as string | undefined,
    sector: (e?.sector as string) || (e?.company_sector as string) || undefined,
    location: e?.location as string | undefined,
    reason: e?.ai_reason as string | undefined,
  };
}
function metaLine(s: ProspectSignal): string {
  const e = ex(s);
  return [SOURCE_LABELS[s.source] ?? s.source, relativeTime(s.detected_at), e.contract, e.sector, e.location]
    .filter(Boolean)
    .join(' · ');
}

export function ProspectionSignaux() {
  const [tab, setTab] = useState<TriageBucket>('todo');
  const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'mid'>('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: signals, isLoading } = useSignaux();
  const setStatus = useSetSignalStatus();
  const bulkValidate = useBulkValidateSignals();

  const counts = useMemo(() => {
    const c: Record<TriageBucket, number> = { todo: 0, validated: 0, rejected: 0 };
    (signals ?? []).forEach((s) => c[bucketOf(s.status)]++);
    return c;
  }, [signals]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    (signals ?? []).forEach((s) => s.source && set.add(s.source));
    return Array.from(set);
  }, [signals]);

  const rows = useMemo(
    () =>
      (signals ?? [])
        .filter((s) => bucketOf(s.status) === tab)
        .filter((s) => {
          if (sourceFilter !== 'all' && s.source !== sourceFilter) return false;
          const sc = getScore(s);
          if (scoreFilter === 'high') return sc >= 80;
          if (scoreFilter === 'mid') return sc >= 60 && sc < 80;
          return true;
        })
        .sort((a, z) => getScore(z) - getScore(a)),
    [signals, tab, scoreFilter, sourceFilter],
  );

  const validableIds = useMemo(
    () => (signals ?? []).filter((s) => s.status === 'raw' && getScore(s) >= 80).map((s) => s.id),
    [signals],
  );

  const validate = (id: string) => setStatus.mutate({ id, status: 'matched' });
  const reject = (id: string) => setStatus.mutate({ id, status: 'dismissed' });
  const reset = (id: string) => setStatus.mutate({ id, status: 'raw' });

  const drawer = useMemo(
    () => (selectedId ? (signals ?? []).find((s) => s.id === selectedId) ?? null : null) ?? rows[0] ?? null,
    [selectedId, signals, rows],
  );

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="pt-2">
        <h1 className="text-2xl font-semibold text-foreground title-glow">Signaux</h1>
        <p className="mt-1 text-sm text-muted-foreground">Qu’est-ce que je dois traiter aujourd’hui ?</p>
      </div>

      {/* Onglets + filtres */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="glass inline-flex items-center gap-1 rounded-xl p-1">
          {BUCKET_META.map((b) => (
            <button
              key={b.id}
              onClick={() => setTab(b.id)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition',
                tab === b.id ? 'bg-[hsl(var(--a1)/0.16)] text-[hsl(var(--a1))]' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {b.label} <span className="ml-0.5 opacity-60">{counts[b.id]}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={scoreFilter}
            onChange={(e) => setScoreFilter(e.target.value as typeof scoreFilter)}
            className="h-9 rounded-md border border-border bg-foreground/5 px-2.5 text-xs text-foreground backdrop-blur-sm"
          >
            <option value="all">Score : tous</option>
            <option value="high">≥ 80</option>
            <option value="mid">60–79</option>
          </select>
          <select
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
            className="h-9 rounded-md border border-border bg-foreground/5 px-2.5 text-xs text-foreground backdrop-blur-sm"
          >
            <option value="all">Source : toutes</option>
            {sources.map((s) => (
              <option key={s} value={s}>
                {SOURCE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
          {tab === 'todo' && (
            <Button
              size="sm"
              className="gap-1.5"
              disabled={validableIds.length === 0 || bulkValidate.isPending}
              onClick={() => bulkValidate.mutate(validableIds)}
            >
              <Check className="h-3.5 w-3.5" />
              Valider tout ≥ 80 ({validableIds.length})
            </Button>
          )}
        </div>
      </div>

      {/* Liste + drawer */}
      {isLoading ? (
        <div className="flex h-56 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--a1))]" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            {rows.length === 0 ? (
              <div className="glass rounded-2xl p-10 text-center text-sm text-muted-foreground">
                Rien à afficher dans « {BUCKET_META.find((b) => b.id === tab)?.label} ».
              </div>
            ) : (
              <motion.div key={tab} {...staggerProps} className="glass overflow-hidden rounded-2xl">
                {rows.map((s, i) => {
                  const e = ex(s);
                  const score = getScore(s);
                  const tier = scoreTier(score);
                  const active = drawer?.id === s.id;
                  return (
                    <motion.button
                      key={s.id}
                      variants={fadeUp}
                      onClick={() => setSelectedId(s.id)}
                      className={cn(
                        'flex w-full items-center gap-4 border-b border-l-[3px] border-border/40 px-4 py-3.5 text-left transition',
                        tierBorder(tier),
                        active ? 'bg-[hsl(var(--a1)/0.08)]' : 'hover:bg-[hsl(var(--a1)/0.04)]',
                        i === rows.length - 1 && 'border-b-0',
                      )}
                    >
                      <span className={cn('min-w-[44px] rounded-md py-1 text-center text-sm font-bold tabular-nums', tierBadge(tier))}>
                        {score || '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {e.title}
                          <span className="ml-1 text-xs font-normal text-muted-foreground/70">· {e.company}</span>
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{metaLine(s)}</p>
                      </div>
                    </motion.button>
                  );
                })}
              </motion.div>
            )}
          </div>

          {/* Drawer détail */}
          <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass h-fit rounded-2xl p-5">
            {!drawer ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Sélectionne une offre.</p>
            ) : (
              (() => {
                const e = ex(drawer);
                const score = getScore(drawer);
                const tier = scoreTier(score);
                const b = bucketOf(drawer.status);
                return (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-foreground">{e.title}</h3>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {e.company}
                          {e.size ? ` · ${e.size}` : ''}
                        </p>
                      </div>
                      <span className={cn('shrink-0 rounded-lg px-2.5 py-1 text-sm font-bold tabular-nums', tierBadge(tier))}>
                        {score || '—'}
                      </span>
                    </div>

                    <div className="mt-4 space-y-2">
                      {[
                        ['Source', SOURCE_LABELS[drawer.source] ?? drawer.source],
                        ['Publiée', relativeTime(drawer.detected_at)],
                        ['Contrat', e.contract ?? '—'],
                        ['Secteur', e.sector ?? '—'],
                        ['Localisation', e.location ?? '—'],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between border-b border-border/40 pb-1.5 text-[12.5px]">
                          <span className="text-muted-foreground">{k}</span>
                          <span className="text-foreground">{v}</span>
                        </div>
                      ))}
                    </div>

                    {e.reason && (
                      <div className="mt-4 rounded-xl border border-border bg-foreground/[0.03] p-3">
                        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pourquoi ce score</p>
                        <p className="text-[12.5px] text-foreground/90">{e.reason}</p>
                      </div>
                    )}

                    {drawer.source_url && (
                      <a
                        href={drawer.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 inline-flex items-center gap-1 text-xs text-[hsl(var(--a2))] hover:underline"
                      >
                        Voir l’offre <ExternalLink className="h-3 w-3" />
                      </a>
                    )}

                    <div className="mt-5 flex gap-2">
                      {b === 'todo' ? (
                        <>
                          <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled={setStatus.isPending} onClick={() => reject(drawer.id)}>
                            <X className="h-3.5 w-3.5" /> Rejeter
                          </Button>
                          <Button size="sm" className="flex-1 gap-1.5" disabled={setStatus.isPending} onClick={() => validate(drawer.id)}>
                            <Check className="h-3.5 w-3.5" /> Valider
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" className="flex-1 gap-1.5" disabled={setStatus.isPending} onClick={() => reset(drawer.id)}>
                          <RotateCcw className="h-3.5 w-3.5" /> Remettre à traiter
                        </Button>
                      )}
                    </div>
                  </>
                );
              })()
            )}
          </motion.div>
        </div>
      )}

      <p className="px-1 text-xs text-muted-foreground/70">
        Clique une offre pour voir le détail et le score expliqué. « Valider tout ≥ 80 » traite les meilleures d’un coup.
      </p>
    </div>
  );
}

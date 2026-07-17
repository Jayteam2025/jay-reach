import { useMemo, useState } from 'react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownRight,
  ArrowUpRight,
  CalendarCheck,
  Coins,
  Flame,
  Lightbulb,
  Loader2,
  MessageSquare,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { motion } from 'framer-motion';
import { fadeUp, glassPop, staggerProps } from '@/lib/motion';
import {
  DashboardActivityBucket,
  DashboardAlert,
  DashboardPeriod,
  useDashboardActivity,
  useDashboardAlerts,
  useDashboardKpis,
  useSetDealSize,
} from '@/hooks/useDashboard';
import { useSignaux } from '@/hooks/useSignauxTriage';
import { AnimatedNumber } from './AnimatedNumber';

const PERIODS: { id: DashboardPeriod; label: string }[] = [
  { id: '7d', label: '7 j' },
  { id: '30d', label: '30 j' },
  { id: '3m', label: '3 mois' },
];

const VIOLET = '#8B5CF6';
const VIOLET_2 = '#A78BFA';
const BLUE = '#60A5FA';
const GREEN = '#34D399';
const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

function formatBucket(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function formatEuros(v: number): string {
  return v >= 1000 ? `${Math.round(v / 1000)} k€` : `${Math.round(v)} €`;
}

/** Pastille de variation vs période précédente. */
function Delta({ cur, prev, euros }: { cur: number; prev: number; euros?: boolean }) {
  const diff = cur - prev;
  const up = diff > 0;
  const down = diff < 0;
  const val = euros ? formatEuros(Math.abs(diff)) : Math.abs(diff);
  const cls = up
    ? 'bg-emerald-400/15 text-emerald-500'
    : down
      ? 'bg-rose-400/15 text-rose-400'
      : 'bg-foreground/10 text-muted-foreground';
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : null;
  return (
    <span className={cn('inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums', cls)}>
      {Icon && <Icon className="h-3 w-3" />}
      {up ? '+' : down ? '−' : ''}
      {val}
    </span>
  );
}

const ALERT_ICONS: Record<string, typeof Flame> = { flame: Flame, bulb: Lightbulb, alert: TriangleAlert };

function AlertCard({ alert }: { alert: DashboardAlert }) {
  const Icon = ALERT_ICONS[alert.icon] ?? Lightbulb;
  const critical = alert.severity === 'critical';
  const iconColor = critical ? 'text-amber-400' : alert.icon === 'flame' ? 'text-[#F0997B]' : 'text-[hsl(var(--a1))]';
  return (
    <div className={critical ? 'rounded-2xl border border-amber-400/40 bg-amber-400/10 p-4' : 'glass rounded-2xl p-4'}>
      <div className={critical ? 'flex items-start gap-2 font-semibold text-amber-400' : 'flex items-start gap-2 font-medium text-foreground'}>
        <Icon className={`mt-0.5 h-[15px] w-[15px] shrink-0 ${critical ? '' : iconColor}`} />
        <span>{alert.text}</span>
      </div>
      <div className="mt-2 text-xs">
        <span className={critical ? 'font-medium text-amber-400' : 'font-medium text-muted-foreground'}>{alert.action_label} →</span>
      </div>
    </div>
  );
}

interface ChartDatum extends DashboardActivityBucket {
  label: string;
  total: number;
}

function ActivityTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartDatum }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const rate = d.total > 0 ? ((100 * d.replies) / d.total).toFixed(1) : '0.0';
  return (
    <div className="glass-strong rounded-lg px-3 py-2 text-xs">
      <p className="mb-1 font-semibold text-foreground">{d.label}</p>
      <p className="text-muted-foreground">Envois : {d.total}</p>
      <p className="text-muted-foreground">Réponses : {d.replies} ({rate} %)</p>
    </div>
  );
}

const KPI_ICON = { replies: MessageSquare, positive: Sparkles, meetings: CalendarCheck, pipeline: Coins };

function KpiCard({
  label,
  icon: Icon,
  children,
  foot,
}: {
  label: string;
  icon: typeof MessageSquare;
  children: React.ReactNode;
  foot: React.ReactNode;
}) {
  return (
    <motion.div variants={glassPop} className="glass rounded-2xl p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[hsl(var(--a1)/0.14)] text-[hsl(var(--a1))]">
          <Icon className="h-4 w-4" />
        </span>
      </div>
      <div className="mt-3 text-4xl font-bold tracking-tight tabular-nums text-foreground">{children}</div>
      <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">{foot}</p>
    </motion.div>
  );
}

export function ProspectionDashboard() {
  const [period, setPeriod] = useState<DashboardPeriod>('30d');
  const [dealOpen, setDealOpen] = useState(false);
  const [dealInput, setDealInput] = useState('');

  const { data: kpis, isLoading: kpisLoading } = useDashboardKpis(period);
  const { data: activity } = useDashboardActivity(period);
  const { data: alerts } = useDashboardAlerts(period);
  const { data: signals } = useSignaux();
  const setDealSize = useSetDealSize();

  const chartData = useMemo<ChartDatum[]>(
    () =>
      (activity ?? []).map((b) => ({
        ...b,
        label: formatBucket(b.bucket),
        total: b.linkedin_invites + b.emails + b.linkedin_messages,
      })),
    [activity],
  );

  const totals = useMemo(
    () =>
      chartData.reduce(
        (a, d) => ({ inv: a.inv + d.linkedin_invites, em: a.em + d.emails, ms: a.ms + d.linkedin_messages, rep: a.rep + d.replies }),
        { inv: 0, em: 0, ms: 0, rep: 0 },
      ),
    [chartData],
  );

  const donutData = useMemo(
    () => [
      { name: 'Emails', value: totals.em, color: VIOLET },
      { name: 'Invitations LinkedIn', value: totals.inv, color: BLUE },
      { name: 'Messages LinkedIn', value: totals.ms, color: VIOLET_2 },
    ],
    [totals],
  );
  const donutTotal = totals.em + totals.inv + totals.ms;

  // Répartition des signaux par score (données réelles useSignaux)
  const scoreDist = useMemo(() => {
    const c = { low: 0, mid: 0, high: 0, top: 0 };
    (signals ?? []).forEach((s) => {
      const sc = Number(s.extracted_data?.ai_score ?? 0) || 0;
      if (sc <= 0) return;
      if (sc < 40) c.low++;
      else if (sc < 60) c.mid++;
      else if (sc < 80) c.high++;
      else c.top++;
    });
    return [
      { label: '<40', n: c.low, hot: false },
      { label: '40–59', n: c.mid, hot: false },
      { label: '60–79', n: c.high, hot: false },
      { label: '80+', n: c.top, hot: true },
    ];
  }, [signals]);

  const topSignals = useMemo(() => {
    return (signals ?? [])
      .filter((s) => s.status === 'raw')
      .map((s) => {
        const ex = s.extracted_data as Record<string, unknown> | null;
        return {
          id: s.id,
          company: (ex?.company_name as string) || s.company_name || '—',
          title: (ex?.job_title as string) || 'Signal détecté',
          score: Number(ex?.ai_score ?? 0) || 0,
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 4);
  }, [signals]);

  const hasPipeline = kpis?.deal_size !== null && kpis?.deal_size !== undefined;

  const saveDeal = () => {
    const parsed = Number(dealInput.replace(/[^\d.]/g, ''));
    setDealSize.mutate(Number.isFinite(parsed) && parsed > 0 ? parsed : null, { onSuccess: () => setDealOpen(false) });
  };

  const gridStroke = 'hsl(var(--border) / 0.4)';
  const tick = { fill: 'hsl(var(--muted-foreground))', fontSize: 11 };

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground title-glow">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">Est-ce que votre prospection fonctionne ?</p>
        </div>
        <div className="glass inline-flex items-center gap-1 rounded-xl p-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={
                period === p.id
                  ? 'rounded-lg bg-[hsl(var(--a1)/0.16)] px-3 py-1.5 text-xs font-semibold text-[hsl(var(--a1))]'
                  : 'rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground'
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alertes */}
      {alerts && alerts.length > 0 && (
        <motion.div {...staggerProps} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {alerts.slice(0, 3).map((a, i) => (
            <motion.div key={i} variants={fadeUp}>
              <AlertCard alert={a} />
            </motion.div>
          ))}
        </motion.div>
      )}

      {/* KPIs */}
      {kpisLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-[hsl(var(--a1))]" />
        </div>
      ) : kpis ? (
        <motion.div {...staggerProps} className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <KpiCard label="Réponses" icon={KPI_ICON.replies} foot={<><Delta cur={kpis.replies} prev={kpis.replies_prev} /> vs préc.</>}>
            <AnimatedNumber value={kpis.replies} />
          </KpiCard>
          <KpiCard
            label="Réponses positives"
            icon={KPI_ICON.positive}
            foot={<>
              <span className="rounded-full bg-[hsl(var(--a1)/0.14)] px-2 py-0.5 text-[11px] font-semibold text-[hsl(var(--a1))]">{kpis.positive_pct} %</span>
              des réponses
            </>}
          >
            <AnimatedNumber value={kpis.positive_replies} />
          </KpiCard>
          <KpiCard label="Réunions obtenues" icon={KPI_ICON.meetings} foot={<><Delta cur={kpis.meetings} prev={kpis.meetings_prev} /> RDV confirmés</>}>
            <AnimatedNumber value={kpis.meetings} />
          </KpiCard>
          {hasPipeline ? (
            <KpiCard
              label="Pipeline généré"
              icon={KPI_ICON.pipeline}
              foot={<><Delta cur={kpis.pipeline ?? 0} prev={kpis.pipeline_prev ?? 0} euros /> réunions × panier</>}
            >
              <AnimatedNumber value={kpis.pipeline ?? 0} format={formatEuros} />
            </KpiCard>
          ) : (
            <motion.button
              variants={glassPop}
              onClick={() => {
                setDealInput('');
                setDealOpen(true);
              }}
              className="glass flex flex-col items-start justify-center rounded-2xl p-5 text-left transition-transform duration-300 hover:-translate-y-0.5"
            >
              <p className="text-[13px] font-medium text-muted-foreground">Pipeline généré</p>
              <p className="mt-3 text-base font-semibold text-[hsl(var(--a1))]">Définir le panier moyen →</p>
              <p className="mt-2 text-xs text-muted-foreground">requis pour estimer le pipeline</p>
            </motion.button>
          )}
        </motion.div>
      ) : null}

      {/* Graphe principal + donut */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass rounded-2xl p-6 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Activité &amp; résultats</h2>
            <p className="text-xs text-muted-foreground">agrégé {period === '7d' ? 'par jour' : 'par semaine'}</p>
          </div>
          <div className="mb-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: VIOLET }} />Envois multicanaux</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-[3px] w-4 rounded-full" style={{ background: GREEN }} />Réponses reçues</span>
          </div>
          <div className="chart-glow" style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 8, right: 6, left: -16, bottom: 0 }}>
                <defs>
                  <linearGradient id="envFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIOLET} stopOpacity={0.45} />
                    <stop offset="55%" stopColor={VIOLET} stopOpacity={0.14} />
                    <stop offset="100%" stopColor={BLUE} stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="envStroke" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={VIOLET} />
                    <stop offset="100%" stopColor={BLUE} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} dy={6} />
                <YAxis tickLine={false} axisLine={false} tick={tick} width={36} tickCount={4} />
                <Tooltip cursor={{ stroke: VIOLET, strokeOpacity: 0.25 }} content={<ActivityTooltip />} />
                <Area type="natural" dataKey="total" stroke="url(#envStroke)" strokeWidth={3} fill="url(#envFill)" dot={false} activeDot={{ r: 5 }} animationDuration={1000} animationEasing="ease-out" />
                <Line type="natural" dataKey="replies" stroke={GREEN} strokeWidth={2.5} dot={{ r: 3, fill: GREEN, strokeWidth: 0 }} activeDot={{ r: 6, fill: GREEN, stroke: 'hsl(var(--background))', strokeWidth: 2 }} animationDuration={1100} animationEasing="ease-out" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass rounded-2xl p-6">
          <h2 className="mb-2 text-base font-semibold text-foreground">Répartition par canal</h2>
          <div className="relative mx-auto" style={{ height: 180, width: '100%', maxWidth: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <linearGradient id="segViolet" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={VIOLET_2} />
                    <stop offset="100%" stopColor={VIOLET} />
                  </linearGradient>
                  <linearGradient id="segBlue" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#93C5FD" />
                    <stop offset="100%" stopColor={BLUE} />
                  </linearGradient>
                  <linearGradient id="segViolet2" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#C4B5FD" />
                    <stop offset="100%" stopColor={VIOLET_2} />
                  </linearGradient>
                </defs>
                <Pie
                  data={donutData}
                  dataKey="value"
                  innerRadius={56}
                  outerRadius={82}
                  paddingAngle={3}
                  cornerRadius={6}
                  stroke="none"
                  animationDuration={900}
                >
                  {['url(#segViolet)', 'url(#segBlue)', 'url(#segViolet2)'].map((fill, i) => (
                    <Cell key={i} fill={fill} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums text-foreground">
                <AnimatedNumber value={donutTotal} />
              </span>
              <span className="text-[11px] text-muted-foreground">envois</span>
            </div>
          </div>
          <div className="mt-4 space-y-2.5">
            {donutData.map((d) => (
              <div key={d.name} className="flex items-center gap-2 text-[13px]">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} />
                <span className="text-muted-foreground">{d.name}</span>
                <span className="ml-auto font-semibold tabular-nums text-foreground">
                  {donutTotal > 0 ? Math.round((100 * d.value) / donutTotal) : 0} %
                </span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Signaux par score + top signaux */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass rounded-2xl p-6">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Signaux par score</h2>
            <span className="text-xs text-muted-foreground">offres détectées</span>
          </div>
          <div style={{ height: 180 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={scoreDist} margin={{ top: 8, right: 6, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="barViolet" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={VIOLET_2} />
                    <stop offset="100%" stopColor={VIOLET} stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="barGreen" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6EE7B7" />
                    <stop offset="100%" stopColor={GREEN} stopOpacity={0.55} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke={gridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tick={tick} dy={6} />
                <YAxis tickLine={false} axisLine={false} tick={tick} width={30} tickCount={4} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'hsl(var(--a1)/0.06)' }} contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="n" radius={[6, 6, 2, 2]} maxBarSize={46} animationDuration={900} animationEasing="ease-out">
                  {scoreDist.map((b) => (
                    <Cell key={b.label} fill={b.hot ? 'url(#barGreen)' : 'url(#barViolet)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        <motion.div initial="hidden" animate="show" variants={fadeUp} className="glass rounded-2xl p-6">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-foreground">Signaux à traiter</h2>
            <span className="text-xs text-muted-foreground">meilleurs scores</span>
          </div>
          <div>
            {topSignals.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Aucun signal à traiter.</p>
            ) : (
              topSignals.map((s) => {
                const tier = s.score >= 80 ? 'high' : s.score >= 60 ? 'mid' : 'low';
                const badge =
                  tier === 'high'
                    ? 'bg-emerald-400/15 text-emerald-500'
                    : tier === 'mid'
                      ? 'bg-amber-400/15 text-amber-500'
                      : 'bg-foreground/10 text-muted-foreground';
                return (
                  <div key={s.id} className="flex items-center gap-3 border-t border-border/40 py-3 first:border-t-0">
                    <span className={cn('min-w-[40px] rounded-md py-1 text-center text-sm font-bold tabular-nums', badge)}>
                      {s.score || '—'}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-medium text-foreground">{s.title}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.company}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </motion.div>
      </div>

      {/* Modale panier moyen */}
      <Dialog open={dealOpen} onOpenChange={setDealOpen}>
        <DialogContent className="glass-strong">
          <DialogHeader>
            <DialogTitle>Panier moyen</DialogTitle>
            <DialogDescription>
              Montant moyen d’un deal signé (€). Sert à estimer le pipeline : réunions obtenues × panier moyen.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="ex. 8000"
              value={dealInput}
              onChange={(e) => setDealInput(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDealOpen(false)}>
              Annuler
            </Button>
            <Button onClick={saveDeal} disabled={setDealSize.isPending}>
              {setDealSize.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

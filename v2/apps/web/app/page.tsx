import { getTranslations } from 'next-intl/server';
import { AppTopBar } from './chrome';
import { createClientOrNull } from '../lib/supabase/server';
import { initials, type DashPoint, type ChannelShare, type DashKpi, type DashSignalRow, type DashReplyRow } from '../lib/sample-dashboard';
import { providerLabel } from '../lib/labels';

// Courbe d'activité (aire lime pour les signaux, ligne sourde pour les réponses).
const CW = 640;
const CH = 176;
const PAD = 14;

function seriesPoints(points: readonly DashPoint[], pick: (p: DashPoint) => number, max: number) {
  const n = points.length;
  return points.map((p, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * CW;
    const y = CH - PAD - (pick(p) / max) * (CH - PAD * 2);
    return [x, y] as const;
  });
}

function ActivityChart({ activity }: { activity: readonly DashPoint[] }) {
  const max = Math.max(...activity.map((p) => p.qualified), 1);
  const qual = seriesPoints(activity, (p) => p.qualified, max);
  const rep = seriesPoints(activity, (p) => p.replies, max);
  const line = (pts: readonly (readonly [number, number])[]) => pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `M0,${CH - PAD} ${qual.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} L${CW},${CH - PAD} Z`;
  const last = qual[qual.length - 1];

  return (
    <svg className="rs-chart" viewBox={`0 0 ${CW} ${CH}`} preserveAspectRatio="none" role="img">
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={CW} y1={CH * g} y2={CH * g} stroke="var(--slate2)" strokeWidth={1} />
      ))}
      <path d={area} fill="var(--limeghost)" stroke="none" />
      <polyline points={line(qual)} fill="none" stroke="var(--lime)" strokeWidth={2} strokeLinejoin="round" />
      <polyline points={line(rep)} fill="none" stroke="var(--moss)" strokeWidth={1.5} strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r={3.5} fill="var(--lime)" /> : null}
    </svg>
  );
}

const RING_C = 2 * Math.PI * 52;
const CHANNEL_COLOR: Record<string, string> = { email: 'var(--lime)', linkedin: 'var(--lime2)', courrier: 'var(--moss)' };

function ChannelRing({ channels }: { channels: readonly ChannelShare[] }) {
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" width={132} height={132} role="img" style={{ display: 'block', margin: '4px auto 0' }}>
      <circle cx={70} cy={70} r={52} fill="none" stroke="var(--slate2)" strokeWidth={16} />
      <g transform="rotate(-90 70 70)">
        {channels.map((c) => {
          const dash = c.share * RING_C;
          const seg = (
            <circle
              key={c.key}
              cx={70}
              cy={70}
              r={52}
              fill="none"
              stroke={CHANNEL_COLOR[c.key]}
              strokeWidth={16}
              strokeDasharray={`${dash.toFixed(2)} ${(RING_C - dash).toFixed(2)}`}
              strokeDashoffset={(-offset).toFixed(2)}
            />
          );
          offset += dash;
          return seg;
        })}
      </g>
    </svg>
  );
}

function Kpi(props: { label: string; value: string; live?: boolean; trend: string; dir: 'up' | 'down' }) {
  return (
    <div className="rs-kpi">
      <div className="rs-kpi-l">{props.label}</div>
      <div className="rs-kpi-n" data-live={props.live ? 'true' : undefined}>
        {props.value}
      </div>
      <div className="rs-kpi-d" data-dir={props.dir}>
        {props.trend}
      </div>
    </div>
  );
}

interface DashData {
  kpi: DashKpi;
  activity: DashPoint[];
  channels: ChannelShare[];
  noCampaign: DashSignalRow[];
  replies: DashReplyRow[];
}

const EMPTY: DashData = {
  kpi: { replies: 0, positives: 0, qualified: 0, medianDays: 0, delta: { replies: 0, positives: 0, qualified: 0, medianDays: 0 } },
  activity: Array.from({ length: 30 }, () => ({ qualified: 0, replies: 0 })),
  channels: [],
  noCampaign: [],
  replies: [],
};

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

async function loadDashboard(orgId: string): Promise<DashData> {
  const supabase = await createClientOrNull();
  if (!supabase || !orgId) return EMPTY;

  const stats = (((await supabase.from('campaign_stats').select('sent,accepted,replies').eq('organization_id', orgId)).data as
    | { sent: number; accepted: number; replies: number }[]
    | null) ?? []);
  const sumReplies = stats.reduce((a, s) => a + (s.replies ?? 0), 0);
  const sumAccepted = stats.reduce((a, s) => a + (s.accepted ?? 0), 0);

  const qualified =
    ((
      await supabase
        .from('signals')
        .select('occurred_at,title,provider_id,company_hint,score,accounts(name)')
        .eq('organization_id', orgId)
        .eq('status', 'qualified')
        .order('occurred_at', { ascending: false })
    ).data as { occurred_at: string; title: string | null; provider_id: string | null; company_hint: string | null; score: number | null; accounts: { name: string | null } | null }[] | null) ?? [];

  const threads =
    ((
      await supabase
        .from('threads')
        .select('classification,last_message_at,contacts(first_name,last_name,accounts(name))')
        .eq('organization_id', orgId)
    ).data as { classification: string; last_message_at: string | null; contacts: { first_name: string | null; last_name: string | null; accounts: { name: string | null } | null } | null }[] | null) ?? [];

  const actions =
    ((
      await supabase
        .from('actions')
        .select('channel,dispatched_at,enrollments(started_at)')
        .eq('organization_id', orgId)
        .in('status', ['dispatched', 'delivered'])
    ).data as { channel: string; dispatched_at: string | null; enrollments: { started_at: string } | null }[] | null) ?? [];

  // Répartition par canal.
  const group = (ch: string): ChannelShare['key'] => (ch === 'email' ? 'email' : ch === 'letter' ? 'courrier' : 'linkedin');
  const counts: Record<string, number> = {};
  for (const a of actions) counts[group(a.channel)] = (counts[group(a.channel)] ?? 0) + 1;
  const totalActions = actions.length || 1;
  const channels: ChannelShare[] = (['email', 'linkedin', 'courrier'] as const)
    .filter((k) => counts[k])
    .map((k) => ({ key: k, share: (counts[k] ?? 0) / totalActions }));

  // Délai médian inscription → premier envoi (proxy du délai signal → 1er contact).
  const delays = actions
    .filter((a) => a.dispatched_at && a.enrollments?.started_at)
    .map((a) => (new Date(a.dispatched_at as string).getTime() - new Date(a.enrollments!.started_at).getTime()) / 86_400_000)
    .filter((d) => d >= 0)
    .sort((x, y) => x - y);
  const medianDays = delays.length ? Math.round(delays[Math.floor(delays.length / 2)]! * 10) / 10 : 0;

  // Activité sur 30 jours.
  const days: string[] = [];
  for (let i = 29; i >= 0; i--) days.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  const qualByDay: Record<string, number> = {};
  for (const s of qualified) qualByDay[dayKey(s.occurred_at)] = (qualByDay[dayKey(s.occurred_at)] ?? 0) + 1;
  const repByDay: Record<string, number> = {};
  for (const th of threads)
    if (th.classification === 'human_reply' && th.last_message_at) repByDay[dayKey(th.last_message_at)] = (repByDay[dayKey(th.last_message_at)] ?? 0) + 1;
  const activity: DashPoint[] = days.map((d) => ({ qualified: qualByDay[d] ?? 0, replies: repByDay[d] ?? 0 }));

  const noCampaign: DashSignalRow[] = qualified.slice(0, 5).map((s) => ({
    company: s.accounts?.name ?? s.company_hint ?? '—',
    title: s.title ?? '—',
    source: providerLabel(s.provider_id),
    score: s.score ?? 0,
  }));

  const replies: DashReplyRow[] = threads
    .filter((th) => th.classification === 'human_reply')
    .map((th) => ({
      name: `${th.contacts?.first_name ?? ''} ${th.contacts?.last_name ?? ''}`.trim() || '—',
      company: th.contacts?.accounts?.name ?? '—',
      step: 1,
    }));

  return {
    kpi: {
      replies: sumReplies,
      positives: sumAccepted,
      qualified: qualified.length,
      medianDays,
      delta: { replies: 0, positives: 0, qualified: 0, medianDays: 0 },
    },
    activity,
    channels,
    noCampaign,
    replies,
  };
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard');
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const data = await loadDashboard(orgId);
  const k = data.kpi;
  const nf = new Intl.NumberFormat('fr-FR');
  const pct = (n: number) => `${n > 0 ? '+' : ''}${n} %`;

  return (
    <div className="rs-shell">
      <AppTopBar active="dashboard" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>

        <div className="rs-kpis">
          <Kpi label={t('kpi.replies')} value={nf.format(k.replies)} trend={t('trend', { delta: pct(k.delta.replies) })} dir="up" />
          <Kpi label={t('kpi.positives')} value={nf.format(k.positives)} live trend={t('trend', { delta: pct(k.delta.positives) })} dir="up" />
          <Kpi label={t('kpi.qualified')} value={nf.format(k.qualified)} trend={t('trend', { delta: pct(k.delta.qualified) })} dir="up" />
          <Kpi
            label={t('kpi.median')}
            value={t('days', { n: k.medianDays.toLocaleString('fr-FR') })}
            live
            trend={t('trend', { delta: `${k.delta.medianDays.toLocaleString('fr-FR')} j` })}
            dir="up"
          />
        </div>

        <div className="rs-dash">
          <section className="rs-card">
            <div className="rs-dash-head">
              <h3 className="rs-section-title" style={{ margin: 0 }}>
                {t('activity')}
              </h3>
              <span className="rs-eyebrow">{t('period')}</span>
            </div>
            <ActivityChart activity={data.activity} />
            <div className="rs-chart-legend">
              <span className="rs-legend-row">
                <span className="rs-legend-dot" style={{ background: 'var(--lime)' }} />
                {t('legend.signals')}
              </span>
              <span className="rs-legend-row">
                <span className="rs-legend-dot" style={{ background: 'var(--moss)' }} />
                {t('legend.replies')}
              </span>
            </div>
          </section>

          <section className="rs-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <h3 className="rs-section-title">{t('byChannel')}</h3>
            <div style={{ flex: 1, display: 'grid', placeItems: 'center' }}>
              {data.channels.length === 0 ? <p className="rs-row-sub">{t('period')}</p> : <ChannelRing channels={data.channels} />}
            </div>
            <div className="rs-legend">
              {data.channels.map((c) => (
                <div key={c.key} className="rs-legend-row">
                  <span className="rs-legend-dot" style={{ background: CHANNEL_COLOR[c.key] }} />
                  {t(`channel.${c.key}`)}
                  <span className="rs-legend-val">{Math.round(c.share * 100)}%</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="rs-dash-lists">
          <section className="rs-card">
            <h3 className="rs-section-title">{t('noCampaign')}</h3>
            <p className="rs-row-sub" style={{ margin: '0 0 6px' }}>
              {t('noCampaignSub')}
            </p>
            {data.noCampaign.map((s, i) => (
              <div key={`${s.company}-${i}`} className="rs-mini">
                <div className="rs-mini-main">
                  <div className="rs-mini-title">{s.company}</div>
                  <div className="rs-mini-sub mono">
                    {s.title} - {s.source}
                  </div>
                </div>
                <span className="rs-mini-score" data-high={s.score >= 80 ? 'true' : undefined}>
                  {s.score}
                </span>
              </div>
            ))}
          </section>

          <section className="rs-card">
            <h3 className="rs-section-title">{t('replied')}</h3>
            <p className="rs-row-sub" style={{ margin: '0 0 6px' }}>
              {t('repliedSub')}
            </p>
            {data.replies.map((r, i) => (
              <div key={`${r.name}-${i}`} className="rs-mini">
                <span className="rs-avatar">{initials(r.name)}</span>
                <div className="rs-mini-main">
                  <div className="rs-mini-title">{r.name}</div>
                  <div className="rs-mini-sub">{r.company}</div>
                </div>
                <span className="rs-mini-sub mono">{t('atStep', { n: r.step })}</span>
              </div>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}

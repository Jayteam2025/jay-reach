import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';

const STATUS_TONE: Record<string, string> = { active: 'live', paused: 'neutral', draft: 'ghost', archived: 'neutral' };
const nf = (n: number): string => n.toLocaleString('fr-FR');
const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

interface Stat {
  id: string;
  name: string;
  status: string;
  source_id: string | null;
  enrolled: number;
  sent: number;
  contacted: number;
  invites: number;
  accepted: number;
  replies: number;
  channels: number;
}

export default async function CampaignsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const stats: Stat[] =
    supabase && orgId
      ? (((await supabase.from('campaign_stats').select('*').eq('organization_id', orgId)).data as Stat[] | null) ?? [])
      : [];

  const sources =
    supabase && orgId
      ? (((await supabase.from('sources').select('id,name').eq('organization_id', orgId)).data as { id: string; name: string }[] | null) ?? [])
      : [];
  const sourceName = new Map(sources.map((s) => [s.id, s.name]));

  return (
    <div className="rs-shell">
      <AppTopBar active="campaigns" />
      <main className="rs-main">
        <div className="rs-page-head">
          <div>
            <p className="rs-eyebrow">{t('campaigns.eyebrow')}</p>
            <h1>{t('campaigns.title')}</h1>
            <p className="rs-lead" style={{ marginBottom: 0 }}>
              {t('campaigns.subtitle')}
            </p>
          </div>
          <div className="rs-head-actions">
            <a className="rs-btn" data-primary="true" href="/import">
              {t('campaigns.newCampaign')}
            </a>
          </div>
        </div>

        <div className="rs-camp-grid" style={{ marginTop: 18, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
          {stats.map((c) => {
            const treated = pct(c.contacted, c.enrolled);
            const acceptance = pct(c.accepted, c.invites);
            const replyRate = pct(c.replies, c.sent);
            const live = c.status === 'active';
            return (
              <a key={c.id} href={`/campaigns/${c.id}`} className="rs-camp-card" style={{ display: 'block', color: 'inherit' }}>
                <div className="rs-camp-head">
                  <h3 style={{ fontSize: 15 }}>{c.name}</h3>
                  <span className="rs-pill" data-tone={STATUS_TONE[c.status] ?? 'ghost'}>
                    {t(`campaigns.status.${c.status}`)}
                  </span>
                </div>

                <div className="rs-figs" style={{ gridTemplateColumns: 'repeat(2, 1fr)', rowGap: 12 }}>
                  <Fig label={t('campaigns.fig.contacted')} value={`${nf(c.contacted)} / ${nf(c.enrolled)}`} sub={t('campaigns.treated', { pct: treated })} />
                  <Fig label={t('campaigns.fig.sent')} value={nf(c.sent)} sub={t('campaigns.channelsN', { n: c.channels })} />
                  <Fig label={t('campaigns.fig.accepted')} value={`${nf(acceptance)} %`} sub={t('campaigns.linkedinInvites')} live={live} />
                  <Fig label={t('campaigns.fig.replies')} value={nf(c.replies)} sub={t('campaigns.replyRateSub', { pct: nf(replyRate) })} live={live} />
                </div>

                <div className="rs-meter">
                  <span style={{ width: `${treated}%`, background: live ? 'var(--lime)' : 'var(--slate3)' }} />
                </div>

                <div className="rs-camp-foot">
                  <span className="rs-row-sub">{(c.source_id && sourceName.get(c.source_id)) || t('campaigns.eyebrow')}</span>
                  <span className="rs-open">{t('campaigns.open')}</span>
                </div>
              </a>
            );
          })}

          {/* Carte pointillée « Importer un fichier » */}
          <a href="/import" className="rs-camp-card rs-import-card">
            <div>
              <div className="rs-import-title">{t('campaigns.importCard.title')}</div>
              <div className="rs-row-sub" style={{ maxWidth: 280, marginTop: 4 }}>
                {t('campaigns.importCard.desc')}
              </div>
            </div>
          </a>
        </div>
      </main>
    </div>
  );
}

function Fig({ label, value, sub, live }: { label: string; value: string; sub: string; live?: boolean }) {
  return (
    <div>
      <div className="rs-fig-l">{label}</div>
      <div className="rs-fig-n" data-live={live ? 'true' : undefined}>
        {value}
      </div>
      <div className="rs-fig-sub">{sub}</div>
    </div>
  );
}

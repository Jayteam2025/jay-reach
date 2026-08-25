import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../../chrome';
import { SAMPLE_SOURCES } from '../../../lib/sample-sources';

const RUN_COLOR: Record<string, string> = {
  success: 'var(--lime2)',
  error: 'var(--flare)',
  running: 'var(--moss)',
};

export default async function SourcesPage() {
  const t = await getTranslations();

  return (
    <div className="rs-shell">
      <AppTopBar active="sources" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('sources.eyebrow')}</p>
        <h1>{t('sources.title')}</h1>
        <p className="rs-lead">{t('sources.lead')}</p>

        <div style={{ display: 'grid', gap: 14 }}>
          {SAMPLE_SOURCES.map((source) => (
            <section key={source.id} className="rs-card">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h3 style={{ fontSize: 15 }}>{source.name}</h3>
                <span className="rs-pill" data-tone={source.active ? 'live' : 'neutral'}>
                  {source.active ? t('sources.active') : t('sources.paused')}
                </span>
                <span className="rs-chan" style={{ marginLeft: 'auto' }}>
                  {source.provider}
                </span>
              </div>

              <dl className="rs-kv" style={{ gridTemplateColumns: '110px 1fr' }}>
                <dt>{t('sources.keywords')}</dt>
                <dd>
                  <span className="rs-chips">
                    {source.keywords.map((k) => (
                      <span key={k} className="rs-chip">
                        {k}
                      </span>
                    ))}
                  </span>
                </dd>
                {source.location ? (
                  <>
                    <dt>{t('sources.location')}</dt>
                    <dd>{source.location}</dd>
                  </>
                ) : null}
              </dl>

              <div className="rs-section-title" style={{ marginTop: 14 }}>
                {t('sources.history')}
              </div>
              <div style={{ display: 'grid', gap: 0 }}>
                {source.runs.map((run, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '90px 1fr auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: '9px 0',
                      borderTop: '1px solid var(--slate2)',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }}>
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: RUN_COLOR[run.status],
                          flex: '0 0 auto',
                        }}
                      />
                      {t(`sources.status.${run.status}`)}
                    </span>
                    <span className="rs-row-sub">
                      {run.error ? <span style={{ color: 'var(--flare)' }}>{run.error}</span> : run.when}
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>
                      {run.itemsFound} {t('sources.found')} ·{' '}
                      <span style={{ color: run.itemsNew > 0 ? 'var(--lime)' : 'var(--moss2)' }}>
                        {run.itemsNew} {t('sources.new')}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

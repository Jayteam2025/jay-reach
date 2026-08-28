import { getTranslations } from 'next-intl/server';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';

const RUN_COLOR: Record<string, string> = {
  success: 'var(--lime2)',
  error: 'var(--flare)',
  running: 'var(--moss)',
};

/** Nombre d'exécutions montrées par source : de quoi voir une dégradation. */
const RUNS_AFFICHES = 3;

interface SourceRow {
  readonly id: string;
  readonly name: string;
  readonly provider_id: string;
  readonly is_active: boolean;
  readonly config: { keywords?: unknown; location?: unknown } | null;
}

interface RunRow {
  readonly source_id: string;
  readonly status: string;
  readonly started_at: string;
  readonly items_found: number;
  readonly items_new: number;
  readonly error: string | null;
}

/** Date d'exécution en clair, dans le fuseau du lecteur. */
function quand(iso: string, locale: string): string {
  const d = new Date(iso);
  const jours = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const heure = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  if (jours === 0) return `aujourd’hui ${heure}`;
  if (jours === 1) return `hier ${heure}`;
  return `${d.toLocaleDateString(locale)} ${heure}`;
}

export default async function SourcesPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();

  // Sources de l'organisation, puis leurs dernières exécutions. Deux requêtes
  // plutôt qu'une jointure imbriquée : PostgREST ne détecte pas toujours la
  // relation, et un `null` silencieux afficherait une source sans historique
  // comme une source qui n'a jamais tourné — deux choses différentes.
  const sources = supabase
    ? (((await supabase
        .from('sources')
        .select('id, name, provider_id, is_active, config')
        .order('created_at', { ascending: true })).data ?? []) as SourceRow[])
    : [];

  const runs = supabase && sources.length > 0
    ? (((await supabase
        .from('source_runs')
        .select('source_id, status, started_at, items_found, items_new, error')
        .in('source_id', sources.map((s) => s.id))
        .order('started_at', { ascending: false })).data ?? []) as RunRow[])
    : [];

  const runsParSource = new Map<string, RunRow[]>();
  for (const run of runs) {
    const liste = runsParSource.get(run.source_id) ?? [];
    if (liste.length < RUNS_AFFICHES) liste.push(run);
    runsParSource.set(run.source_id, liste);
  }

  return (
    <div className="rs-shell">
      <AppTopBar active="sources" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('sources.eyebrow')}</p>
        <h1>{t('sources.title')}</h1>
        <p className="rs-lead">{t('sources.lead')}</p>

        {sources.length === 0 ? (
          <p className="rs-row-sub">{t('sources.empty')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {sources.map((source) => {
              const keywords = Array.isArray(source.config?.keywords)
                ? (source.config.keywords as unknown[]).map((k) => String(k)).filter(Boolean)
                : [];
              const location = typeof source.config?.location === 'string' ? source.config.location : null;
              const sesRuns = runsParSource.get(source.id) ?? [];

              return (
                <section key={source.id} className="rs-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h3 style={{ fontSize: 15 }}>{source.name}</h3>
                    <span className="rs-pill" data-tone={source.is_active ? 'live' : 'neutral'}>
                      {source.is_active ? t('sources.active') : t('sources.paused')}
                    </span>
                    <span className="rs-chan" style={{ marginLeft: 'auto' }}>
                      {source.provider_id}
                    </span>
                  </div>

                  <dl className="rs-kv" style={{ gridTemplateColumns: '110px 1fr' }}>
                    <dt>{t('sources.keywords')}</dt>
                    <dd>
                      <span className="rs-chips">
                        {keywords.map((k) => (
                          <span key={k} className="rs-chip">
                            {k}
                          </span>
                        ))}
                      </span>
                    </dd>
                    {location ? (
                      <>
                        <dt>{t('sources.location')}</dt>
                        <dd>{location}</dd>
                      </>
                    ) : null}
                  </dl>

                  <div className="rs-section-title" style={{ marginTop: 14 }}>
                    {t('sources.history')}
                  </div>
                  {sesRuns.length === 0 ? (
                    <p className="rs-row-sub">{t('sources.neverRan')}</p>
                  ) : (
                    <div style={{ display: 'grid', gap: 0 }}>
                      {sesRuns.map((run) => (
                        <div
                          key={`${run.source_id}-${run.started_at}`}
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
                                background: RUN_COLOR[run.status] ?? 'var(--moss)',
                                flex: '0 0 auto',
                              }}
                            />
                            {t(`sources.status.${run.status}`)}
                          </span>
                          <span className="rs-row-sub">
                            {run.error ? (
                              <span style={{ color: 'var(--flare)' }}>{run.error}</span>
                            ) : (
                              quand(run.started_at, 'fr-FR')
                            )}
                          </span>
                          <span className="mono" style={{ fontSize: 12, color: 'var(--moss)' }}>
                            {run.items_found} {t('sources.found')} ·{' '}
                            <span style={{ color: run.items_new > 0 ? 'var(--lime)' : 'var(--moss2)' }}>
                              {run.items_new} {t('sources.new')}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

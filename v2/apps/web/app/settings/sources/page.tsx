import { getTranslations } from 'next-intl/server';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { SourceActions, AddSource } from './source-actions';
import { ProviderActions } from './provider-actions';

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
  readonly description: string | null;
  readonly is_active: boolean;
  readonly config: { keywords?: unknown; location?: unknown; scoring_prompt?: unknown; match_threshold?: unknown } | null;
}

interface SourceProviderRow {
  readonly id: string;
  readonly source_id: string;
  readonly provider_id: string;
  readonly is_active: boolean;
}

interface RunRow {
  readonly source_id: string;
  readonly source_provider_id: string | null;
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
  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const sources = supabase
    ? (((await supabase
        .from('sources')
        .select('id, name, description, is_active, config')
        .order('created_at', { ascending: true })).data ?? []) as SourceRow[])
    : [];

  // Rattachements et exécutions dépendent tous deux des thèmes, mais pas l'un
  // de l'autre : ils partent ensemble.
  const idsThemes = sources.map((s) => s.id);
  const [rattachements, runs] = supabase && idsThemes.length > 0
    ? await Promise.all([
        supabase
          .from('source_providers')
          .select('id, source_id, provider_id, is_active')
          .in('source_id', idsThemes)
          .order('created_at', { ascending: true })
          .then((r) => (r.data ?? []) as SourceProviderRow[]),
        supabase
          .from('source_runs')
          .select('source_id, source_provider_id, status, started_at, items_found, items_new, error')
          .in('source_id', idsThemes)
          .order('started_at', { ascending: false })
          .then((r) => (r.data ?? []) as RunRow[]),
      ])
    : [[] as SourceProviderRow[], [] as RunRow[]];

  const fournisseursParTheme = new Map<string, SourceProviderRow[]>();
  for (const r of rattachements) {
    fournisseursParTheme.set(r.source_id, [...(fournisseursParTheme.get(r.source_id) ?? []), r]);
  }

  // L'historique s'affiche PAR FOURNISSEUR : c'est ce qui permet de repérer
  // celui qui se dégrade. Regroupé par thème, une panne chez l'un se noyait
  // dans les collectes réussies de l'autre.
  const runsParFournisseur = new Map<string, RunRow[]>();
  const runsSansFournisseur = new Map<string, RunRow[]>();
  for (const run of runs) {
    const cle = run.source_provider_id;
    const cible = cle ? runsParFournisseur : runsSansFournisseur;
    const index = cle ?? run.source_id;
    const liste = cible.get(index) ?? [];
    if (liste.length < RUNS_AFFICHES) liste.push(run);
    cible.set(index, liste);
  }

  return (
    <div className="rs-shell">
      <AppTopBar active="sources" />
      <main className="rs-main">
        <div className="rs-page-head">
          <div>
            <p className="rs-eyebrow">{t('sources.eyebrow')}</p>
            <h1>{t('sources.title')}</h1>
            <p className="rs-lead">{t('sources.lead')}</p>
          </div>
          <AddSource orgId={orgId} />
        </div>

        {sources.length === 0 ? (
          <p className="rs-empty">{t('sources.empty')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 14 }}>
            {sources.map((source) => {
              const keywords = Array.isArray(source.config?.keywords)
                ? (source.config.keywords as unknown[]).map((k) => String(k)).filter(Boolean)
                : [];
              const location = typeof source.config?.location === 'string' ? source.config.location : null;
              const sesFournisseurs = fournisseursParTheme.get(source.id) ?? [];
              const actifs = sesFournisseurs.filter((f) => f.is_active);

              return (
                <section key={source.id} className="rs-card">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <h3 style={{ fontSize: 15 }}>{source.name}</h3>
                    <span className="rs-pill" data-tone={source.is_active ? 'live' : 'neutral'}>
                      {source.is_active ? t('sources.active') : t('sources.paused')}
                    </span>
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {actifs.length === 0 ? (
                        <span className="rs-row-sub">{t('sources.noProvider')}</span>
                      ) : (
                        actifs.map((f) => (
                          <span key={f.id} className="rs-chan">
                            {t(`providers.${f.provider_id}`)}
                          </span>
                        ))
                      )}
                    </span>
                  </div>

                  {source.description ? (
                    <p className="rs-row-sub" style={{ marginTop: 6 }}>
                      {source.description}
                    </p>
                  ) : null}

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
                  {sesFournisseurs.map((f) => {
                    const runsDuFournisseur = runsParFournisseur.get(f.id) ?? [];
                    return (
                      <div key={f.id} className="rs-src-provider">
                        <div className="rs-src-provider-head">
                          <span className="rs-chan">{t(`providers.${f.provider_id}`)}</span>
                          {!f.is_active ? (
                            <span className="rs-pill" data-tone="neutral">
                              {t('sources.paused')}
                            </span>
                          ) : null}
                          <span style={{ marginLeft: 'auto' }}>
                            <ProviderActions orgId={orgId} sourceProviderId={f.id} isActive={f.is_active} />
                          </span>
                        </div>
                        {runsDuFournisseur.length === 0 ? (
                          <p className="rs-row-sub">{t('sources.neverRan')}</p>
                        ) : (
                          <Executions runs={runsDuFournisseur} t={t} />
                        )}
                      </div>
                    );
                  })}
                  {/* Exécutions antérieures à la bascule vers les thèmes : elles
                      ne portent pas de fournisseur, et les taire ferait
                      disparaître l'historique déjà accumulé. */}
                  {(runsSansFournisseur.get(source.id) ?? []).length > 0 ? (
                    <div className="rs-src-provider">
                      <div className="rs-src-provider-head">
                        <span className="rs-row-sub">{t('sources.beforeProviders')}</span>
                      </div>
                      <Executions runs={runsSansFournisseur.get(source.id) ?? []} t={t} />
                    </div>
                  ) : null}

                  <SourceActions
                    orgId={orgId}
                    source={{
                      id: source.id,
                      name: source.name,
                      description: source.description ?? '',
                      providerIds: actifs.map((f) => f.provider_id),
                      keywords,
                      location: location ?? '',
                      scoringPrompt: typeof source.config?.scoring_prompt === 'string' ? source.config.scoring_prompt : '',
                      matchThreshold: Number(source.config?.match_threshold ?? 60),
                      isActive: source.is_active,
                    }}
                  />
                </section>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Trois dernières exécutions d'un fournisseur : de quoi voir une dégradation
 * sans dérouler tout l'historique.
 */
function Executions({
  runs,
  t,
}: {
  runs: RunRow[];
  t: Awaited<ReturnType<typeof getTranslations>>;
}) {
  return (
    <div style={{ display: 'grid', gap: 0 }}>
      {runs.map((run) => (
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
            {run.error ? <span style={{ color: 'var(--flare)' }}>{run.error}</span> : quand(run.started_at, 'fr-FR')}
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
  );
}

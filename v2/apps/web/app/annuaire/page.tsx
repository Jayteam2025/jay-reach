import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { searchCompanies } from '../../lib/directory';
import { DirectoryResults } from './directory-results';

const BUCKETS = ['small', 'mid', 'large', 'xl'] as const;

export default async function AnnuairePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await getTranslations('directory');
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

  const params = {
    q: str(sp.q),
    naf: str(sp.naf),
    department: str(sp.department),
    effectif: str(sp.effectif),
    page: Number(str(sp.page)) || 1,
  };
  const searched = Boolean(params.q || params.naf || params.department || params.effectif);
  const result = searched ? await searchCompanies(params) : { total: 0, page: 1, perPage: 10, results: [] };

  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  return (
    <div className="rs-shell">
      <AppTopBar active="annuaire" />
      <main className="rs-main" style={{ maxWidth: 820 }}>
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>

        <form className="rs-dir-form" method="get">
          <label className="rs-dir-field">
            <span>{t('field.q')}</span>
            <input className="rs-input" name="q" defaultValue={params.q} placeholder={t('field.qPlaceholder')} />
          </label>
          <label className="rs-dir-field">
            <span>{t('field.naf')}</span>
            <input className="rs-input" name="naf" defaultValue={params.naf} placeholder="62.01Z" />
          </label>
          <label className="rs-dir-field">
            <span>{t('field.department')}</span>
            <input className="rs-input" name="department" defaultValue={params.department} placeholder="69" maxLength={3} />
          </label>
          <label className="rs-dir-field">
            <span>{t('field.effectif')}</span>
            <select className="rs-input" name="effectif" defaultValue={params.effectif}>
              <option value="">{t('bucket.all')}</option>
              {BUCKETS.map((b) => (
                <option key={b} value={b}>
                  {t(`bucket.${b}`)}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="rs-btn" data-primary="true">
            {t('search')}
          </button>
        </form>

        {searched ? (
          <>
            <p className="rs-dir-count">
              {t('count', { n: result.total })}
              {result.total > result.perPage ? ` · ${t('showingFirst', { n: result.perPage })}` : ''}
            </p>
            {result.results.length === 0 ? (
              <p className="rs-empty">{t('none')}</p>
            ) : (
              <DirectoryResults companies={result.results} orgId={orgId} />
            )}
          </>
        ) : (
          <p className="rs-row-sub" style={{ marginTop: 16 }}>
            {t('hint')}
          </p>
        )}
      </main>
    </div>
  );
}

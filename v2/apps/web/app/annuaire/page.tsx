import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { searchCompanies, PER_PAGE, PAGES_MAX } from '../../lib/directory';
import { DirectoryResults } from './directory-results';
import { BulkAdd } from './bulk-add';
import Link from 'next/link';

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
  const result = searched
    ? await searchCompanies(params)
    : { total: 0, page: 1, perPage: PER_PAGE, truncated: false, results: [] };

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
            {/* Le compteur dit ce qu'il sait. L'API plafonne son décompte à
                10 000 : au-delà, ce n'est plus un nombre d'entreprises mais une
                borne, et l'afficher tel quel laissait croire à une coïncidence
                sur un chiffre suspicieusement rond. */}
            <p className="rs-dir-count">
              {result.truncated ? t('countTruncated', { n: result.total }) : t('count', { n: result.total })}
            </p>

            {result.results.length === 0 ? (
              <p className="rs-empty">{t('none')}</p>
            ) : (
              <>
                <BulkAdd
                  orgId={orgId}
                  params={{
                    q: params.q,
                    naf: params.naf,
                    department: params.department,
                    effectif: params.effectif,
                    page: params.page,
                  }}
                  total={result.total}
                  truncated={result.truncated}
                  pageCount={result.results.length}
                />
                <DirectoryResults companies={result.results} orgId={orgId} />
                <Pagination page={result.page} total={result.total} perPage={result.perPage} params={sp} />
              </>
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

/**
 * Pagination par liens : l'écran est un composant serveur, et la recherche vit
 * déjà dans l'URL. L'API refuse au-delà de la 400e page (page x per_page doit
 * rester sous 10 000), donc on n'y mène pas.
 */
function Pagination({
  page,
  total,
  perPage,
  params,
}: {
  page: number;
  total: number;
  perPage: number;
  params: Record<string, string | string[] | undefined>;
}) {
  const dernierePage = Math.min(Math.ceil(total / perPage), PAGES_MAX);
  if (dernierePage <= 1) {
    return null;
  }
  const lien = (p: number): string => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (k === 'page') continue;
      const val = Array.isArray(v) ? v[0] : v;
      if (val) qs.set(k, val);
    }
    qs.set('page', String(p));
    return `/annuaire?${qs.toString()}`;
  };

  return (
    <nav className="rs-dir-pager">
      {page > 1 ? <Link className="rs-btn" href={lien(page - 1)}>&larr;</Link> : <span />}
      <span className="rs-row-sub mono">
        {page} / {dernierePage}
      </span>
      {page < dernierePage ? <Link className="rs-btn" href={lien(page + 1)}>&rarr;</Link> : <span />}
    </nav>
  );
}

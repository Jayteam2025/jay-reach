import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../../chrome';
import { createClientOrNull } from '../../../lib/supabase/server';
import { CustomerImport } from './customer-import';

export default async function CustomersPage() {
  const t = await getTranslations('customers');
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const lists =
    supabase && orgId
      ? (((await supabase.from('customer_lists').select('name,entries_count').eq('organization_id', orgId).order('created_at', { ascending: false })).data as
          | { name: string; entries_count: number }[]
          | null) ?? [])
      : [];

  return (
    <div className="rs-shell">
      <AppTopBar active="customers" />
      <main className="rs-main" style={{ maxWidth: 720 }}>
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>

        <CustomerImport orgId={orgId} />

        {lists.length > 0 ? (
          <div className="rs-card" style={{ marginTop: 16 }}>
            <h3 className="rs-section-title">{t('listsTitle')}</h3>
            {lists.map((l, i) => (
              <div key={`${l.name}-${i}`} className="rs-row" style={{ gridTemplateColumns: '1fr auto', display: 'grid', padding: '8px 0', background: 'transparent' }}>
                <span>{l.name}</span>
                <span className="mono rs-row-sub">{t('entries', { n: l.entries_count })}</span>
              </div>
            ))}
          </div>
        ) : null}
      </main>
    </div>
  );
}

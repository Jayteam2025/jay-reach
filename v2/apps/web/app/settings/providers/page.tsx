import { getTranslations } from 'next-intl/server';
import { PROVIDER_CATALOG } from '@jay-reach/providers';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { ProviderForm } from './provider-form';

const CATEGORY_ORDER = ['email', 'enrichment', 'signals', 'ai'] as const;

export default async function ProvidersPage() {
  const t = await getTranslations();

  const supabase = await createClientOrNull();
  // Le secret n'est jamais lu ici : seule la vue publique (statut + last4).
  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const creds = supabase
    ? (await supabase.from('credentials_public').select('provider_id, status, last4')).data
    : null;
  const rows = (creds ?? []) as { provider_id: string; status: string; last4: string | null }[];
  const byProvider = new Map(rows.map((row) => [row.provider_id, row]));

  const categories = CATEGORY_ORDER.map((cat) => ({
    cat,
    providers: PROVIDER_CATALOG.filter((p) => p.category === cat),
  })).filter((g) => g.providers.length > 0);

  return (
    <div className="rs-shell">
      <AppTopBar active="providers" />
      <main className="rs-main" style={{ maxWidth: 720 }}>
        <p className="rs-eyebrow">{t('providers.eyebrow')}</p>
        <h1>{t('providers.title')}</h1>
        <p className="rs-lead">{t('providers.lead')}</p>

        {categories.map(({ cat, providers }) => (
          <section key={cat} className="rs-prov-cat">
            <div className="rs-prov-cat-head">{t(`providers.category.${cat}`)}</div>
            <div className="rs-prov-list">
              {providers.map((provider) => {
                const row = byProvider.get(provider.id);
                return (
                  <ProviderForm
                    key={provider.id}
                    orgId={orgId}
                    providerId={provider.id}
                    labelKey={provider.labelKey}
                    fields={provider.fields.map((f) => ({
                      name: f.name,
                      labelKey: f.labelKey,
                      type: f.type,
                      secret: f.secret,
                      required: f.required,
                    }))}
                    status={row?.status ?? null}
                    last4={row?.last4 ?? null}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}

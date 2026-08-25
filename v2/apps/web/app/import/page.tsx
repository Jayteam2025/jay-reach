import { getTranslations } from 'next-intl/server';
import { AppTopBar } from '../chrome';
import { createClientOrNull } from '../../lib/supabase/server';
import { ImportWizard } from './import-wizard';

export default async function ImportPage() {
  const t = await getTranslations('import');
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const campaigns =
    supabase && orgId
      ? (((await supabase.from('campaigns').select('id,name').eq('organization_id', orgId)).data as { id: string; name: string }[] | null) ?? [])
      : [];
  const lists =
    supabase && orgId
      ? (((await supabase.from('lists').select('id,name').eq('organization_id', orgId).order('created_at', { ascending: false })).data as
          | { id: string; name: string }[]
          | null) ?? [])
      : [];

  return (
    <div className="rs-shell">
      <AppTopBar active="import" />
      <main className="rs-main">
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead">{t('lead')}</p>
        <ImportWizard orgId={orgId} campaigns={campaigns} lists={lists} />
      </main>
    </div>
  );
}

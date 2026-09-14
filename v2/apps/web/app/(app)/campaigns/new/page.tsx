import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { NewCampaign, type EntryOption, type PersonaOption } from './new-campaign';

export default async function NewCampaignPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const sources: EntryOption[] = supabase
    ? (((await supabase.from('sources').select('id,name').eq('is_active', true)).data as EntryOption[] | null) ?? [])
    : [];
  const lists: EntryOption[] = supabase
    ? (((await supabase.from('lists').select('id,name')).data as EntryOption[] | null) ?? [])
    : [];
  const personas: PersonaOption[] = supabase
    ? (((await supabase.from('personas').select('id,name').eq('is_active', true)).data as PersonaOption[] | null) ?? [])
    : [];

  return (
    <div className="rs-shell">
      <AppTopBar active="campaigns" />
      <main className="rs-main">
        <NewCampaign orgId={orgId} demo={!supabase} sources={sources} lists={lists} personas={personas} />
      </main>
    </div>
  );
}

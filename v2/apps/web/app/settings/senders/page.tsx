import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { SendersForm, type SenderRow } from './senders-form';

const COLS = 'id, kind, identity, display_name, daily_quota, hourly_quota, is_active';

export default async function SendersPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const data = supabase ? (await supabase.from('senders').select(COLS).order('kind')).data : null;

  // Sans Supabase, la liste est vide et l'écran le dit : aucun expéditeur
  // d'exemple, sinon l'opérateur croit avoir un compte branché qu'il n'a pas.
  const demo = !supabase;
  const senders = ((data ?? []) as unknown as SenderRow[]);

  return (
    <div className="rs-shell">
      <AppTopBar active="senders" />
      <main className="rs-main" style={{ maxWidth: 640 }}>
        <SendersForm senders={senders} orgId={orgId} demo={demo} />
      </main>
    </div>
  );
}

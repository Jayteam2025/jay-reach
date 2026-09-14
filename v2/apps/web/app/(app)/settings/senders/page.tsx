import { createClientOrNull } from '../../../lib/supabase/server';
import { listerBoitesSalesBlink } from '../../../lib/salesblink';
import { AppTopBar } from '../../chrome';
import { SendersForm, type SenderRow } from './senders-form';

const COLS = 'id, kind, identity, display_name, daily_quota, hourly_quota, is_active, business_hours, timezone, provider_ref, provider_state';

export default async function SendersPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';
  const data = supabase ? (await supabase.from('senders').select(COLS).order('kind')).data : null;

  // Sans Supabase, la liste est vide et l'écran le dit : aucun expéditeur
  // d'exemple, sinon l'opérateur croit avoir un compte branché qu'il n'a pas.
  const demo = !supabase;
  const senders = ((data ?? []) as unknown as SenderRow[]);

  // Boîtes du workspace SalesBlink, pour le sélecteur de liaison des
  // expéditeurs email. Résolu côté serveur : ni la clé ni l'appel HTTP ne
  // doivent transiter par le client.
  const boitesSalesBlink = orgId && supabase ? await listerBoitesSalesBlink(orgId) : { ok: false as const, error: 'no_key' };

  return (
    <div className="rs-shell">
      <AppTopBar active="senders" />
      <main className="rs-main" style={{ maxWidth: 640 }}>
        <SendersForm senders={senders} orgId={orgId} demo={demo} boitesSalesBlink={boitesSalesBlink} />
      </main>
    </div>
  );
}

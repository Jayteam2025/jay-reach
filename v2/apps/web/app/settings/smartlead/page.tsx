import { createClientOrNull } from '../../../lib/supabase/server';
import { createServiceClient } from '../../../lib/supabase/service';
import { AppTopBar } from '../../chrome';
import { SmartleadWebhooks } from './smartlead-webhooks';

export default async function SmartleadWebhooksPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  let secret: string | null = null;
  if (supabase && orgId) {
    try {
      const service = createServiceClient();
      const { data } = await service
        .from('credentials')
        .select('config')
        .eq('organization_id', orgId)
        .eq('provider_id', 'smartlead')
        .maybeSingle();
      secret = ((data?.config as { webhook_secret?: string } | null)?.webhook_secret) ?? null;
    } catch {
      secret = null;
    }
  }

  return (
    <div className="rs-shell">
      <AppTopBar active="smartlead" />
      <main className="rs-main">
        <SmartleadWebhooks orgId={orgId} demo={!supabase} appUrl={process.env.APP_URL ?? ''} initialSecret={secret} />
      </main>
    </div>
  );
}

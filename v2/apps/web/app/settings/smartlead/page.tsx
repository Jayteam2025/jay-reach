import { createClientOrNull } from '../../../lib/supabase/server';
import { createServiceClient } from '../../../lib/supabase/service';
import { requireRole } from '../../../lib/auth';
import { appUrl } from '../../../lib/env';
import { AppTopBar } from '../../chrome';
import { SmartleadWebhooks } from './smartlead-webhooks';

export default async function SmartleadWebhooksPage() {
  const supabase = await createClientOrNull();
  const memberships = supabase ? (await supabase.from('memberships').select('organization_id').limit(1)).data : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  // Le secret est un identifiant d'authentification : sa lecture exige `admin`,
  // comme sa régénération. On lit via le client service_role (le secret n'est pas
  // exposé par la RLS), mais SEULEMENT après avoir vérifié le rôle — sinon un
  // simple `viewer` verrait le token et pourrait forger des événements.
  let secret: string | null = null;
  let canManage = false;
  if (supabase && orgId) {
    try {
      await requireRole(orgId, 'admin');
      canManage = true;
    } catch {
      canManage = false;
    }
    if (canManage) {
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
  }

  return (
    <div className="rs-shell">
      <AppTopBar active="smartlead" />
      <main className="rs-main">
        <SmartleadWebhooks
          orgId={orgId}
          demo={!supabase}
          canManage={canManage}
          appUrl={appUrl()}
          initialSecret={secret}
        />
      </main>
    </div>
  );
}

import { getTranslations } from 'next-intl/server';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { LinkedInPanel } from './linkedin-panel';

export default async function LinkedInSettingsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();

  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  // Réglages d'envoi — valeurs par défaut si la ligne n'existe pas encore.
  const settingsRow = supabase && orgId
    ? (
        await supabase
          .from('linkedin_settings')
          .select('weekly_cap, send_days, send_from_hour, send_to_hour, timezone')
          .eq('organization_id', orgId)
          .maybeSingle()
      ).data
    : null;
  const settings = (settingsRow as {
    weekly_cap: number;
    send_days: number[];
    send_from_hour: number;
    send_to_hour: number;
    timezone: string;
  } | null) ?? {
    weekly_cap: 100,
    send_days: [1, 2, 3, 4, 5],
    send_from_hour: 9,
    send_to_hour: 18,
    timezone: 'Europe/Paris',
  };

  // Un jeton actif signifie que l'extension a deja ete connectee au moins une
  // fois. C'est ce qui decide laquelle des deux actions de la page merite le
  // lime : connecter tant que ce n'est pas fait, enregistrer les reglages ensuite.
  // On lit une ligne plutot qu'un `count: 'exact', head: true` : cette forme
  // renvoie `count: null` sans erreur sur cette table, et un drapeau faux se
  // serait traduit par du lime sur le mauvais bouton, sans rien pour l'expliquer.
  const jetonActif = supabase && orgId
    ? (
        await supabase
          .from('extension_tokens')
          .select('organization_id, linkedin_profile_name')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .limit(1)
      )
    : null;
  const jetons = (jetonActif?.data ?? []) as { linkedin_profile_name: string | null }[];
  const alreadyConnected = jetons.length > 0;
  const profileName = jetons[0]?.linkedin_profile_name ?? null;

  // Compteurs d'activité.
  const now = Date.now();
  const iso7 = new Date(now - 7 * 24 * 3600_000).toISOString();
  const iso1 = new Date(now - 24 * 3600_000).toISOString();
  const canRead = Boolean(supabase && orgId);
  const pending = canRead
    ? (
        await supabase!
          .from('linkedin_action_queue')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'pending')
      ).count ?? 0
    : 0;
  const sent7d = canRead
    ? (
        await supabase!
          .from('linkedin_action_queue')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'sent')
          .gte('sent_at', iso7)
      ).count ?? 0
    : 0;
  const today = canRead
    ? (
        await supabase!
          .from('linkedin_action_queue')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'sent')
          .gte('sent_at', iso1)
      ).count ?? 0
    : 0;

  // Alertes : compte restreint/déconnecté, limite hebdo proche, échecs récents.
  const restricted = canRead
    ? Boolean(
        (
          await supabase!
            .from('linkedin_action_queue')
            .select('id', { count: 'exact', head: true })
            .eq('organization_id', orgId)
            .eq('status', 'failed')
            .in('error_code', ['restricted', 'not_logged_in'])
            .gte('updated_at', iso1)
        ).count,
      )
    : false;
  const failed24 = canRead
    ? (
        await supabase!
          .from('linkedin_action_queue')
          .select('id', { count: 'exact', head: true })
          .eq('organization_id', orgId)
          .eq('status', 'failed')
          .gte('updated_at', iso1)
      ).count ?? 0
    : 0;

  const WEEKLY_CAP = 200;
  const alerts: { level: 'danger' | 'warn'; key: string; params?: Record<string, number> }[] = [];
  if (restricted) alerts.push({ level: 'danger', key: 'accountRestricted' });
  if (sent7d >= WEEKLY_CAP - 20) alerts.push({ level: 'warn', key: 'weeklyCapNear', params: { sent: sent7d, cap: WEEKLY_CAP } });
  if (failed24 >= 5) alerts.push({ level: 'warn', key: 'manyFailures', params: { count: failed24 } });

  return (
    <div className="rs-shell">
      <AppTopBar active="linkedin" />
      <main className="rs-main" style={{ maxWidth: 720 }}>
        <p className="rs-eyebrow">{t('linkedin.eyebrow')}</p>
        <h1>{t('linkedin.title')}</h1>
        <p className="rs-lead">{t('linkedin.lead')}</p>

        <LinkedInPanel
          orgId={orgId}
          weeklyCap={settings.weekly_cap}
          sendDays={settings.send_days}
          sendFromHour={settings.send_from_hour}
          sendToHour={settings.send_to_hour}
          timezone={settings.timezone}
          stats={{ pending, sent7d, today }}
          alreadyConnected={alreadyConnected}
          profileName={profileName}
          storeUrl={process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? null}
          alerts={alerts}
        />
      </main>
    </div>
  );
}

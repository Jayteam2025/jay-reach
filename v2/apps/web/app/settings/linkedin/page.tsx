import { getTranslations } from 'next-intl/server';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { LinkedInPanel } from './linkedin-panel';

type Mode = 'auto' | 'hybrid' | 'manual';

export default async function LinkedInSettingsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();

  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  // Réglages actuels (curseur) — valeurs par défaut si absents.
  const settingsRow = supabase && orgId
    ? (await supabase.from('linkedin_settings').select('mode, daily_cap').eq('organization_id', orgId).maybeSingle())
        .data
    : null;
  const settings = (settingsRow as { mode: Mode; daily_cap: number } | null) ?? { mode: 'auto' as Mode, daily_cap: 25 };

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
          mode={settings.mode}
          dailyCap={settings.daily_cap}
          stats={{ pending, sent7d, today }}
          alerts={alerts}
        />
      </main>
    </div>
  );
}

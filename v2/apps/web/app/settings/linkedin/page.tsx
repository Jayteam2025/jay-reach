import { getTranslations } from 'next-intl/server';
import { createClientOrNull } from '../../../lib/supabase/server';
import { AppTopBar } from '../../chrome';
import { LinkedInPanel } from './linkedin-panel';

/** Plafond hebdomadaire dur, indépendant du réglage de l'opérateur. */
const WEEKLY_CAP = 200;

const REGLAGES_PAR_DEFAUT = {
  weekly_cap: 100,
  send_days: [1, 2, 3, 4, 5],
  send_from_hour: 9,
  send_to_hour: 18,
  timezone: 'Europe/Paris',
};

/**
 * Réglages et activité du canal LinkedIn.
 *
 * Les lectures partent ENSEMBLE. Chaque appel coûte environ 140 ms, et les
 * enchaîner faisait attendre près de trois secondes devant un écran blanc :
 * la page n'envoyait pas un octet avant d'avoir tout reçu. Seul l'identifiant
 * d'organisation se lit d'abord, puisque tout le reste en dépend.
 */
export default async function LinkedInSettingsPage() {
  const t = await getTranslations();
  const supabase = await createClientOrNull();

  const memberships = supabase
    ? (await supabase.from('memberships').select('organization_id').limit(1)).data
    : null;
  const orgId = ((memberships ?? []) as { organization_id: string }[])[0]?.organization_id ?? '';

  const now = Date.now();
  const iso7 = new Date(now - 7 * 24 * 3600_000).toISOString();
  const iso1 = new Date(now - 24 * 3600_000).toISOString();
  const peutLire = Boolean(supabase && orgId);

  // Un compteur qui ne peut pas être lu vaut zéro, pas « inconnu » : l'écran
  // n'a rien d'autre à afficher, et une exception ici priverait l'opérateur de
  // ses réglages pour un chiffre d'activité.
  const compter = async (
    construire: (client: NonNullable<typeof supabase>) => PromiseLike<{ count: number | null }>,
  ): Promise<number> => (peutLire ? ((await construire(supabase!)).count ?? 0) : 0);

  const [reglages, jetons, enAttente, envoyes7j, aujourdhui, restreint, echecs24h] = await Promise.all([
    peutLire
      ? supabase!
          .from('linkedin_settings')
          .select('weekly_cap, send_days, send_from_hour, send_to_hour, timezone')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),

    // Un jeton actif signifie que l'extension a déjà été connectée au moins une
    // fois. C'est ce qui décide laquelle des deux actions de la page mérite le
    // lime : connecter tant que ce n'est pas fait, enregistrer les réglages
    // ensuite. On lit une ligne plutôt qu'un `count: 'exact', head: true` :
    // cette forme renvoie `count: null` sans erreur sur cette table, et un
    // drapeau faux se serait traduit par du lime sur le mauvais bouton.
    peutLire
      ? supabase!
          .from('extension_tokens')
          .select('organization_id, linkedin_profile_name')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .limit(1)
          .then((r) => (r.data ?? []) as { linkedin_profile_name: string | null }[])
      : Promise.resolve([] as { linkedin_profile_name: string | null }[]),

    compter((c) =>
      c.from('linkedin_action_queue').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'pending'),
    ),
    compter((c) =>
      c.from('linkedin_action_queue').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'sent').gte('sent_at', iso7),
    ),
    compter((c) =>
      c.from('linkedin_action_queue').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'sent').gte('sent_at', iso1),
    ),
    compter((c) =>
      c.from('linkedin_action_queue').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'failed')
        .in('error_code', ['restricted', 'not_logged_in']).gte('updated_at', iso1),
    ),
    compter((c) =>
      c.from('linkedin_action_queue').select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId).eq('status', 'failed').gte('updated_at', iso1),
    ),
  ]);

  const settings = (reglages as typeof REGLAGES_PAR_DEFAUT | null) ?? REGLAGES_PAR_DEFAUT;
  const alreadyConnected = jetons.length > 0;
  const profileName = jetons[0]?.linkedin_profile_name ?? null;

  const alerts: { level: 'danger' | 'warn'; key: string; params?: Record<string, number> }[] = [];
  if (restreint > 0) alerts.push({ level: 'danger', key: 'accountRestricted' });
  if (envoyes7j >= WEEKLY_CAP - 20) {
    alerts.push({ level: 'warn', key: 'weeklyCapNear', params: { sent: envoyes7j, cap: WEEKLY_CAP } });
  }
  if (echecs24h >= 5) alerts.push({ level: 'warn', key: 'manyFailures', params: { count: echecs24h } });

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
          stats={{ pending: enAttente, sent7d: envoyes7j, today: aujourdhui }}
          alreadyConnected={alreadyConnected}
          profileName={profileName}
          storeUrl={process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? null}
          alerts={alerts}
        />
      </main>
    </div>
  );
}

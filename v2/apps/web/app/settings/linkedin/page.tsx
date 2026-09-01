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

  const peutLire = Boolean(supabase && orgId);

  /** Compteurs à zéro quand la lecture est impossible : l'écran n'a rien d'autre à afficher. */
  const AUCUNE_ACTIVITE = { en_attente: 0, envoyes_7j: 0, envoyes_24h: 0, restreint: 0, echecs_24h: 0 };

  const [reglages, jetons, activite] = await Promise.all([
    peutLire
      ? supabase!
          .from('linkedin_settings')
          .select('weekly_cap, send_days, send_from_hour, send_to_hour, timezone')
          .eq('organization_id', orgId)
          .maybeSingle()
          .then((r) => r.data)
      : Promise.resolve(null),

    // « Connectée » veut dire que l'extension a RÉELLEMENT appelé le serveur
    // avec son jeton, pas qu'un jeton existe.
    //
    // La page se contentait de l'existence d'un jeton actif. Or générer un
    // jeton est un geste de la page, pas de l'extension : cliquer « Connecter »
    // suffisait à faire passer l'état au vert, même si l'extension n'était pas
    // installée, pas activée, ou sur une adresse où son script ne s'injecte
    // pas. Alexandre a vu le 01/09/2026 les deux messages côte à côte —
    // « Extension connectée » et « L'extension n'a pas répondu » — et le second
    // disait vrai. C'est la même tromperie que la CSP la veille : un état vert
    // affirmé sans preuve.
    //
    // `last_used_at` est posé par `validate_extension_token`, donc uniquement
    // quand un appel de l'extension a été authentifié. C'est la seule preuve
    // qu'elle parle.
    peutLire
      ? supabase!
          .from('extension_tokens')
          .select('organization_id, linkedin_profile_name, last_used_at')
          .eq('organization_id', orgId)
          .eq('is_active', true)
          .not('last_used_at', 'is', null)
          .limit(1)
          .then((r) => (r.data ?? []) as { linkedin_profile_name: string | null }[])
      : Promise.resolve([] as { linkedin_profile_name: string | null }[]),

    // Les cinq compteurs en une lecture. Séparés, ils portaient les mêmes
    // filtres sur la même table et coûtaient cinq allers-retours.
    peutLire
      ? supabase!
          .rpc('linkedin_activite', { p_org: orgId })
          .then((r) => (r.data as (typeof AUCUNE_ACTIVITE)[] | null)?.[0] ?? AUCUNE_ACTIVITE)
      : Promise.resolve(AUCUNE_ACTIVITE),
  ]);

  const settings = (reglages as typeof REGLAGES_PAR_DEFAUT | null) ?? REGLAGES_PAR_DEFAUT;
  const alreadyConnected = jetons.length > 0;
  const profileName = jetons[0]?.linkedin_profile_name ?? null;

  const alerts: { level: 'danger' | 'warn'; key: string; params?: Record<string, number> }[] = [];
  if (activite.restreint > 0) alerts.push({ level: 'danger', key: 'accountRestricted' });
  if (activite.envoyes_7j >= WEEKLY_CAP - 20) {
    alerts.push({ level: 'warn', key: 'weeklyCapNear', params: { sent: activite.envoyes_7j, cap: WEEKLY_CAP } });
  }
  if (activite.echecs_24h >= 5) {
    alerts.push({ level: 'warn', key: 'manyFailures', params: { count: activite.echecs_24h } });
  }

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
          stats={{ pending: activite.en_attente, sent7d: activite.envoyes_7j, today: activite.envoyes_24h }}
          alreadyConnected={alreadyConnected}
          profileName={profileName}
          storeUrl={process.env.NEXT_PUBLIC_EXTENSION_STORE_URL ?? null}
          alerts={alerts}
        />
      </main>
    </div>
  );
}

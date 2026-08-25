import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';
import { defaultLocale, isLocale, type Locale } from '@jay-reach/i18n';
import fr from '@jay-reach/i18n/messages/fr.json';
import en from '@jay-reach/i18n/messages/en.json';
import nl from '@jay-reach/i18n/messages/nl.json';
import { createClientOrNull } from '../lib/supabase/server';

const MESSAGES = { fr, en, nl } satisfies Record<Locale, unknown>;

/** Langue par défaut de l'organisation de l'utilisateur (ou null). */
async function orgDefaultLocale(): Promise<Locale | null> {
  try {
    const supabase = await createClientOrNull();
    if (!supabase) return null;
    const { data: userData } = await supabase.auth.getUser();
    if (!userData.user) return null;
    const { data } = await supabase
      .from('memberships')
      .select('organizations(default_locale)')
      .eq('user_id', userData.user.id)
      .limit(1)
      .maybeSingle();
    const dl = (data as { organizations?: { default_locale?: string } | null } | null)?.organizations?.default_locale;
    return dl && isLocale(dl) ? dl : null;
  } catch {
    return null;
  }
}

export default getRequestConfig(async () => {
  const store = await cookies();
  const cookieLocale = store.get('NEXT_LOCALE')?.value;
  // Priorité : choix explicite (cookie) → défaut de l'organisation → défaut global.
  let locale: Locale;
  if (cookieLocale && isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    locale = (await orgDefaultLocale()) ?? defaultLocale;
  }
  return { locale, messages: MESSAGES[locale] };
});

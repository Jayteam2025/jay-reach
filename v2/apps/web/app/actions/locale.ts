'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isLocale } from '@jay-reach/i18n';

/** Mémorise la langue choisie dans un cookie et rafraîchit la page. */
export async function setLocale(locale: string): Promise<void> {
  if (!isLocale(locale)) {
    return;
  }
  const store = await cookies();
  store.set('NEXT_LOCALE', locale, { path: '/', maxAge: 60 * 60 * 24 * 365 });
  revalidatePath('/', 'layout');
}

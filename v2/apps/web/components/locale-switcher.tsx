'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';
import { locales } from '@jay-reach/i18n';
import { setLocale } from '../app/actions/locale';

export function LocaleSwitcher() {
  const current = useLocale();
  const t = useTranslations('common');
  const [pending, startTransition] = useTransition();

  return (
    <label style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
      {t('language')}
      <select
        value={current}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          startTransition(() => {
            void setLocale(next);
          });
        }}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {locale.toUpperCase()}
          </option>
        ))}
      </select>
    </label>
  );
}

'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { addAccountFromDirectory } from '../actions/directory';
import type { DirectoryCompany } from '../../lib/directory';

export function DirectoryResults({ companies, orgId }: { companies: DirectoryCompany[]; orgId: string }) {
  const t = useTranslations('directory');
  const [added, setAdded] = useState<Record<string, 'ok' | 'err'>>({});
  const [pending, startTransition] = useTransition();

  function add(c: DirectoryCompany) {
    startTransition(async () => {
      const res = await addAccountFromDirectory(orgId, {
        siren: c.siren,
        name: c.name,
        naf: c.naf,
        city: c.city,
        postalCode: c.postalCode,
      });
      setAdded((prev) => ({ ...prev, [c.siren]: res.ok ? 'ok' : 'err' }));
    });
  }

  return (
    <div className="rs-dir-list">
      {companies.map((c) => (
        <div key={c.siren} className="rs-dir-row">
          <div className="rs-dir-main">
            <div className="rs-dir-name">{c.name}</div>
            <div className="rs-dir-sub mono">
              {c.siren}
              {c.naf ? ` · ${c.naf}` : ''}
              {c.city ? ` · ${c.city}` : ''}
              {c.effectifLabel !== '—' ? ` · ${t('headcount')} ${c.effectifLabel}` : ''}
            </div>
          </div>
          {added[c.siren] === 'ok' ? (
            <span className="rs-lk-msg" data-ok="true">
              {t('added')}
            </span>
          ) : (
            <button type="button" className="rs-btn" disabled={pending} onClick={() => add(c)}>
              {t('add')}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

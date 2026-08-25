'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createCampaign } from '../../actions/campaigns';

export interface EntryOption {
  id: string;
  name: string;
}
export interface PersonaOption {
  id: string;
  name: string;
}

type EntryKind = 'source' | 'list';

export function NewCampaign({
  orgId,
  demo,
  sources,
  lists,
  personas,
}: {
  orgId: string;
  demo: boolean;
  sources: EntryOption[];
  lists: EntryOption[];
  personas: PersonaOption[];
}) {
  const t = useTranslations('campaignNew');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [entryKind, setEntryKind] = useState<EntryKind>('source');
  const [entryId, setEntryId] = useState('');
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [minScore, setMinScore] = useState('60');
  const [dailyCap, setDailyCap] = useState('');

  const entryOptions = entryKind === 'source' ? sources : lists;

  const togglePersona = (id: string): void =>
    setPersonaIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = (): void => {
    if (demo) return;
    const score = minScore.trim() ? Number(minScore) : undefined;
    startTransition(async () => {
      const res = await createCampaign(orgId, {
        name,
        entryKind,
        entryId,
        ...(score !== undefined && Number.isFinite(score) ? { minScore: score } : {}),
        ...(personaIds.length > 0 ? { personaIds } : {}),
        ...(dailyCap.trim() ? { dailyCap: Number(dailyCap) } : {}),
      });
      if (res.ok) {
        router.push(`/campaigns/${res.id}`);
      } else {
        setError(res.issues && res.issues.length > 0 ? res.issues.join(' · ') : res.error);
      }
    });
  };

  const canSubmit = Boolean(name.trim() && entryId) && !pending && !demo;

  return (
    <>
      <a href="/campaigns" className="rs-crumb">
        {t('back')}
      </a>
      <div className="rs-page-head" style={{ marginTop: 8 }}>
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead" style={{ marginBottom: 0 }}>
          {t('lead')}
        </p>
      </div>

      {demo ? <p className="rs-row-sub" style={{ marginTop: 12 }}>{t('demoNotice')}</p> : null}

      <div className="rs-card" style={{ marginTop: 16, display: 'grid', gap: 14, maxWidth: 620 }}>
        <label className="rs-label">
          {t('name')}
          <input className="rs-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('namePlaceholder')} />
        </label>

        <div className="rs-label">
          {t('entryKind')}
          <div className="rs-chips" style={{ marginTop: 4 }}>
            {(['source', 'list'] as EntryKind[]).map((k) => (
              <button
                key={k}
                type="button"
                className="rs-toggle"
                data-on={entryKind === k ? 'true' : 'false'}
                onClick={() => {
                  setEntryKind(k);
                  setEntryId('');
                }}
              >
                {t(`kind.${k}`)}
              </button>
            ))}
          </div>
        </div>

        <label className="rs-label">
          {entryKind === 'source' ? t('pickSource') : t('pickList')}
          <select className="rs-input" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
            <option value="">{t('choose')}</option>
            {entryOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {entryOptions.length === 0 ? <span className="rs-row-sub">{t('noneAvailable')}</span> : null}
        </label>

        <div className="rs-label">
          {t('personas')}
          <div className="rs-chips" style={{ marginTop: 4 }}>
            {personas.length === 0 ? <span className="rs-row-sub">{t('noPersona')}</span> : null}
            {personas.map((p) => (
              <button
                key={p.id}
                type="button"
                className="rs-toggle"
                data-on={personaIds.includes(p.id) ? 'true' : 'false'}
                onClick={() => togglePersona(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>

        <label className="rs-label">
          {t('minScore')}
          <input className="rs-input mono" inputMode="numeric" value={minScore} onChange={(e) => setMinScore(e.target.value.replace(/[^\d]/g, ''))} />
        </label>

        <label className="rs-label">
          {t('dailyCap')}
          <input className="rs-input mono" inputMode="numeric" value={dailyCap} onChange={(e) => setDailyCap(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('dailyCapPlaceholder')} />
        </label>

        {error ? (
          <p role="status" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
            {error}
          </p>
        ) : null}

        <div className="rs-actions">
          <a className="rs-btn" href="/campaigns">
            {t('cancel')}
          </a>
          <button className="rs-btn" data-primary="true" disabled={!canSubmit} onClick={submit}>
            {t('create')}
          </button>
        </div>
      </div>
    </>
  );
}

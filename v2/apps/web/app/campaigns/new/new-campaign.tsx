'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createCampaign } from '../../actions/campaigns';
import Link from 'next/link';

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
  /**
   * Thèmes de veille retenus. Plusieurs sont permis : une prospection réelle
   * croise plusieurs veilles, et il fallait jusqu'ici dupliquer la campagne
   * pour chacune. Une liste importée reste unique — c'est un fichier.
   */
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [personaIds, setPersonaIds] = useState<string[]>([]);
  const [minScore, setMinScore] = useState('60');
  const [dailyCap, setDailyCap] = useState('');


  const togglePersona = (id: string): void =>
    setPersonaIds((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = (): void => {
    if (demo) return;
    const score = minScore.trim() ? Number(minScore) : undefined;
    startTransition(async () => {
      const res = await createCampaign(orgId, {
        name,
        entryKind,
        entryId: entryKind === 'source' ? (sourceIds[0] ?? '') : entryId,
        ...(entryKind === 'source' ? { sourceIds } : {}),
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

  const canSubmit = Boolean(name.trim() && (entryKind === 'source' ? sourceIds.length > 0 : entryId)) && !pending && !demo;

  return (
    <>
      <Link href="/campaigns" className="rs-crumb">
        {t('back')}
      </Link>
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

        {entryKind === 'source' ? (
          <div className="rs-label">
            {t('pickSource')}
            <div className="rs-chips" style={{ marginTop: 4 }}>
              {sources.length === 0 ? <span className="rs-row-sub">{t('noneAvailable')}</span> : null}
              {sources.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className="rs-toggle"
                  data-on={sourceIds.includes(o.id) ? 'true' : 'false'}
                  onClick={() =>
                    setSourceIds((ids) => (ids.includes(o.id) ? ids.filter((x) => x !== o.id) : [...ids, o.id]))
                  }
                >
                  {o.name}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <label className="rs-label">
            {t('pickList')}
            <select className="rs-input" value={entryId} onChange={(e) => setEntryId(e.target.value)}>
              <option value="">{t('choose')}</option>
              {lists.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            {lists.length === 0 ? <span className="rs-row-sub">{t('noneAvailable')}</span> : null}
          </label>
        )}

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
          {/* « 60 » ne veut rien dire sans dire de quoi c'est la note. Le lien
              vers les personas est là parce que c'est leur consigne qui produit
              ce score : les deux ne se comprennent que l'un par l'autre. */}
          <span className="rs-row-sub">
            {t('minScoreHelp')} <Link href="/settings/personas">{t('minScoreLink')}</Link>
          </span>
        </label>

        <label className="rs-label">
          {t('dailyCap')}
          <input className="rs-input mono" inputMode="numeric" value={dailyCap} onChange={(e) => setDailyCap(e.target.value.replace(/[^\d]/g, ''))} placeholder={t('dailyCapPlaceholder')} />
          {/* Deux plafonds peuvent se contredire : celui-ci et celui de l'écran
              LinkedIn. Le plus contraignant l'emporte — c'est ce que fait le
              séquenceur, et le taire laissait croire à un réglage sans effet. */}
          <span className="rs-row-sub">
            {t('dailyCapHelp')} <Link href="/settings/linkedin">{t('dailyCapLink')}</Link>
          </span>
        </label>

        {error ? (
          <p role="status" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
            {error}
          </p>
        ) : null}

        <div className="rs-actions">
          <Link className="rs-btn" href="/campaigns">
            {t('cancel')}
          </Link>
          <button className="rs-btn" data-primary="true" disabled={!canSubmit} onClick={submit}>
            {t('create')}
          </button>
        </div>
      </div>
    </>
  );
}

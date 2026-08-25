'use client';

import { useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  CHANNEL_WORD_LIMITS,
  countWords,
  STANDARD_VARIABLES,
  validateTemplateVariables,
  type CampaignNature,
  type MessageRole,
} from '@jay-reach/core';
import { saveTemplateVersion, activateTemplateVersion, type TemplateChannel } from '../../actions/templates';

export interface TemplateRow {
  id: string;
  parent_id: string | null;
  name: string;
  channel: string;
  locale: string;
  version: number;
  subject: string | null;
  body: string;
  sent_count: number;
  is_active: boolean;
}

export interface TemplateFamily {
  familyId: string;
  name: string;
  channel: string;
  versions: TemplateRow[];
}

/** Regroupe les lignes par lignée (parent_id, sinon id de la racine). */
export function groupFamilies(rows: TemplateRow[]): TemplateFamily[] {
  const byFamily = new Map<string, TemplateRow[]>();
  for (const r of rows) {
    const key = r.parent_id ?? r.id;
    const arr = byFamily.get(key);
    if (arr) arr.push(r);
    else byFamily.set(key, [r]);
  }
  return [...byFamily.entries()].map(([familyId, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    const head = sorted.find((v) => v.is_active) ?? sorted[0]!;
    return { familyId, name: head.name, channel: head.channel, versions: sorted };
  });
}

const LOCALES = ['fr', 'en', 'nl'] as const;
type Locale = (typeof LOCALES)[number];
const CHANNELS: TemplateChannel[] = ['email', 'linkedin_invite', 'linkedin_message', 'letter'];

/** Rôle de longueur pour un canal (email = ouverture par défaut). */
function roleForChannel(channel: TemplateChannel): MessageRole {
  if (channel === 'email') return 'email_opening';
  if (channel === 'linkedin_invite') return 'linkedin_invite';
  if (channel === 'linkedin_message') return 'linkedin_message';
  return 'letter';
}

interface Draft {
  familyId: string | null;
  name: string;
  channel: TemplateChannel;
  nature: CampaignNature;
  locale: Locale;
  byLocale: Record<Locale, { subject: string; body: string }>;
}

function emptyByLocale(): Record<Locale, { subject: string; body: string }> {
  return { fr: { subject: '', body: '' }, en: { subject: '', body: '' }, nl: { subject: '', body: '' } };
}

function draftFromFamily(f: TemplateFamily): Draft {
  const byLocale = emptyByLocale();
  for (const loc of LOCALES) {
    const active = f.versions.find((v) => v.locale === loc && v.is_active) ?? f.versions.find((v) => v.locale === loc);
    if (active) byLocale[loc] = { subject: active.subject ?? '', body: active.body };
  }
  const firstLoc = LOCALES.find((l) => byLocale[l].body) ?? 'fr';
  return {
    familyId: f.familyId,
    name: f.name,
    channel: (CHANNELS as string[]).includes(f.channel) ? (f.channel as TemplateChannel) : 'linkedin_message',
    nature: 'signal',
    locale: firstLoc,
    byLocale,
  };
}

export function TemplatesBoard({ families, orgId, demo }: { families: TemplateFamily[]; orgId: string; demo: boolean }) {
  const t = useTranslations('templates');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const current = draft ? draft.byLocale[draft.locale] : { subject: '', body: '' };
  const issues = useMemo(
    () => (draft ? validateTemplateVariables(current.body, draft.nature) : []),
    [draft, current.body],
  );
  const role = draft ? roleForChannel(draft.channel) : 'linkedin_message';
  const words = countWords(current.body);
  const limit = CHANNEL_WORD_LIMITS[role];
  const overLimit = words > limit;

  const availableVars = useMemo(() => {
    if (!draft) return [];
    return Object.entries(STANDARD_VARIABLES)
      .filter(([, avail]) => avail === 'always' || avail === draft.nature)
      .map(([name]) => name);
  }, [draft]);

  const setCurrent = (patch: Partial<{ subject: string; body: string }>): void => {
    setDraft((d) => (d ? { ...d, byLocale: { ...d.byLocale, [d.locale]: { ...d.byLocale[d.locale], ...patch } } } : d));
  };

  const insertVar = (name: string): void => {
    const el = bodyRef.current;
    const token = `{{${name}}}`;
    if (!el) {
      setCurrent({ body: current.body + token });
      return;
    }
    const start = el.selectionStart ?? current.body.length;
    const end = el.selectionEnd ?? start;
    setCurrent({ body: current.body.slice(0, start) + token + current.body.slice(end) });
  };

  const familyForDraft = (): TemplateFamily | undefined =>
    draft?.familyId ? families.find((f) => f.familyId === draft.familyId) : undefined;

  const versionsForLocale = (): TemplateRow[] =>
    (familyForDraft()?.versions ?? []).filter((v) => v.locale === draft?.locale).sort((a, b) => b.version - a.version);

  const save = (): void => {
    if (!draft || demo) return;
    if (issues.length > 0) {
      setError(t('fixVariables'));
      return;
    }
    startTransition(async () => {
      const res = await saveTemplateVersion(orgId, {
        familyId: draft.familyId,
        name: draft.name,
        channel: draft.channel,
        locale: draft.locale,
        subject: draft.channel === 'email' ? current.subject : null,
        body: current.body,
        nature: draft.nature,
      });
      if (res.ok) {
        setDraft(null);
        setError(null);
        router.refresh();
      } else {
        setError(res.issues && res.issues.length > 0 ? res.issues.join(' · ') : res.error);
      }
    });
  };

  const reactivate = (versionId: string): void => {
    if (demo) return;
    startTransition(async () => {
      const res = await activateTemplateVersion(orgId, versionId);
      if (res.ok) {
        setDraft(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const flare = { color: 'var(--flare)' } as const;

  return (
    <>
      <div className="rs-page-head">
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead" style={{ marginBottom: 0 }}>
          {t('lead')}
        </p>
      </div>

      <div className="rs-actions" style={{ margin: '16px 0' }}>
        <button
          className="rs-btn"
          data-primary="true"
          disabled={demo}
          onClick={() => {
            setError(null);
            setDraft({ familyId: null, name: '', channel: 'linkedin_message', nature: 'signal', locale: 'fr', byLocale: emptyByLocale() });
          }}
        >
          {t('new')}
        </button>
        {demo ? <span className="rs-row-sub">{t('demoNotice')}</span> : null}
      </div>

      {families.length === 0 ? (
        <p className="rs-empty">{t('empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {families.map((f) => {
            const locales = LOCALES.filter((l) => f.versions.some((v) => v.locale === l));
            return (
              <div key={f.familyId} className="rs-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 15 }}>{f.name}</h3>
                    <span className="rs-pill" data-tone="neutral">
                      {t(`channel.${f.channel}`)}
                    </span>
                  </div>
                  <button className="rs-btn" disabled={demo} onClick={() => { setError(null); setDraft(draftFromFamily(f)); }}>
                    {t('edit')}
                  </button>
                </div>
                <div className="rs-chips" style={{ marginTop: 8, alignItems: 'center' }}>
                  {LOCALES.map((l) => (
                    <span key={l} className="rs-pill" data-tone={locales.includes(l) ? 'live' : 'neutral'}>
                      {l.toUpperCase()}
                    </span>
                  ))}
                  <span className="rs-row-sub">{t('versionsCount', { n: f.versions.length })}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {draft ? (
        <div className="rs-overlay" role="dialog" aria-modal="true" onClick={() => setDraft(null)}>
          <div className="rs-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
            <div className="rs-modal-head">
              <h3 style={{ fontSize: 16 }}>{draft.familyId ? t('editTitle') : t('newTitle')}</h3>
              <button className="rs-modal-close" aria-label={t('close')} onClick={() => setDraft(null)}>
                ×
              </button>
            </div>

            <label className="rs-label">
              {t('name')}
              <input className="rs-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('namePlaceholder')} />
            </label>

            <div className="rs-label">
              {t('channel.label')}
              <div className="rs-chips" style={{ marginTop: 4 }}>
                {CHANNELS.map((c) => (
                  <button key={c} type="button" className="rs-toggle" data-on={draft.channel === c ? 'true' : 'false'} onClick={() => setDraft({ ...draft, channel: c })}>
                    {t(`channel.${c}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rs-label">
              {t('nature.label')}
              <div className="rs-chips" style={{ marginTop: 4 }}>
                {(['signal', 'list'] as CampaignNature[]).map((n) => (
                  <button key={n} type="button" className="rs-toggle" data-on={draft.nature === n ? 'true' : 'false'} onClick={() => setDraft({ ...draft, nature: n })}>
                    {t(`nature.${n}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rs-tabs" style={{ marginTop: 12 }}>
              {LOCALES.map((l) => (
                <button key={l} type="button" className="rs-tab" data-active={draft.locale === l ? 'true' : undefined} onClick={() => setDraft({ ...draft, locale: l })}>
                  {l.toUpperCase()} {draft.byLocale[l].body ? '●' : '○'}
                </button>
              ))}
            </div>

            {draft.channel === 'email' ? (
              <label className="rs-label">
                {t('subject')}
                <input className="rs-input mono" value={current.subject} onChange={(e) => setCurrent({ subject: e.target.value })} />
              </label>
            ) : null}

            <label className="rs-label">
              {t('message')}
              <textarea ref={bodyRef} className="rs-textarea" rows={6} value={current.body} onChange={(e) => setCurrent({ body: e.target.value })} placeholder={t('messagePlaceholder')} />
              <span className="rs-row-sub mono" style={overLimit ? flare : undefined}>
                {t('wordCount', { n: words, max: limit })}
              </span>
            </label>

            <div className="rs-chips" style={{ alignItems: 'center' }}>
              <span className="rs-row-sub">{t('insertVar')}</span>
              {availableVars.map((v) => (
                <button key={v} type="button" className="rs-chip" onClick={() => insertVar(v)}>{`{{${v}}}`}</button>
              ))}
            </div>

            {issues.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 4 }}>
                {issues.map((i) => (
                  <li key={`${i.kind}:${i.variable}`} className="rs-row-sub" style={flare}>
                    {i.message}
                  </li>
                ))}
              </ul>
            ) : null}

            {draft.familyId ? (
              <details style={{ marginTop: 12 }}>
                <summary className="rs-row-sub" style={{ cursor: 'pointer' }}>
                  {t('versionHistory')}
                </summary>
                <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 }}>
                  {versionsForLocale().map((v) => (
                    <li key={v.id} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span className="mono">{`v${v.version}`}</span>
                      {v.is_active ? (
                        <span className="rs-pill" data-tone="live">
                          {t('active')}
                        </span>
                      ) : (
                        <button className="rs-btn" disabled={pending} onClick={() => reactivate(v.id)}>
                          {t('reactivate')}
                        </button>
                      )}
                      <span className="rs-row-sub">{t('sentCount', { n: v.sent_count })}</span>
                    </li>
                  ))}
                  {versionsForLocale().length === 0 ? <li className="rs-row-sub">{t('noVersionYet')}</li> : null}
                </ul>
              </details>
            ) : null}

            {error ? (
              <p role="status" className="rs-row-sub" style={flare}>
                {error}
              </p>
            ) : null}

            <div className="rs-actions">
              <button className="rs-btn" onClick={() => setDraft(null)}>
                {t('cancel')}
              </button>
              <button className="rs-btn" data-primary="true" disabled={pending || demo || issues.length > 0 || !current.body.trim() || !draft.name.trim()} onClick={save}>
                {t('saveVersion')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

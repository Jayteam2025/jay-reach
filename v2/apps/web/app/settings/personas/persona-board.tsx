'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  createPersona,
  updatePersona,
  deletePersona,
  togglePersonaActive,
  type PersonaInput,
} from '../../actions/personas';
import type { Persona } from '../../../lib/sample-personas';

const SENIORITIES = ['executive', 'director', 'manager', 'individual'] as const;
const CHANNELS = ['email', 'linkedin', 'letter', 'call'] as const;

interface Draft {
  id: string | null;
  name: string;
  description: string;
  patterns: string;
  exclusions: string;
  seniority: string | null;
  channels: string[];
  scoringPrompt: string;
  isActive: boolean;
}

function emptyDraft(): Draft {
  return { id: null, name: '', description: '', patterns: '', exclusions: '', seniority: null, channels: ['email'], scoringPrompt: '', isActive: true };
}

function toDraft(p: Persona): Draft {
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    patterns: (p.title_patterns ?? []).join(', '),
    exclusions: (p.title_exclusions ?? []).join(', '),
    seniority: p.seniority,
    channels: p.channels_priority ?? ['email'],
    scoringPrompt: p.scoring_prompt ?? '',
    isActive: p.is_active,
  };
}

function split(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function PersonaBoard({ personas, orgId, demo }: { personas: Persona[]; orgId: string; demo: boolean }) {
  const t = useTranslations('personas');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  // En démo (sans Supabase), on édite en local (non persisté).
  const [localItems, setLocalItems] = useState<Persona[]>(personas);
  const list = demo ? localItems : personas;

  const total = list.length;
  const active = list.filter((p) => p.is_active).length;

  const submit = (): void => {
    if (!draft) {
      return;
    }
    const input: PersonaInput = {
      name: draft.name,
      description: draft.description,
      titlePatterns: split(draft.patterns),
      titleExclusions: split(draft.exclusions),
      seniority: draft.seniority,
      channels: draft.channels,
      scoringPrompt: draft.scoringPrompt,
      isActive: draft.isActive,
    };
    if (demo) {
      const persona: Persona = {
        id: draft.id ?? crypto.randomUUID(),
        name: input.name.trim(),
        description: input.description.trim() || null,
        title_patterns: input.titlePatterns,
        title_exclusions: input.titleExclusions,
        seniority: input.seniority,
        channels_priority: input.channels.length > 0 ? input.channels : ['email'],
        scoring_prompt: input.scoringPrompt.trim() || null,
        is_active: input.isActive,
      };
      setLocalItems((it) => (draft.id ? it.map((p) => (p.id === draft.id ? persona : p)) : [...it, persona]));
      setDraft(null);
      setError(null);
      return;
    }
    startTransition(async () => {
      const res = draft.id ? await updatePersona(orgId, draft.id, input) : await createPersona(orgId, input);
      if (res.ok) {
        setDraft(null);
        setError(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const remove = (id: string): void => {
    if (!window.confirm(t('deleteConfirm'))) {
      return;
    }
    if (demo) {
      setLocalItems((it) => it.filter((p) => p.id !== id));
      return;
    }
    startTransition(async () => {
      const res = await deletePersona(orgId, id);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  const toggle = (p: Persona): void => {
    if (demo) {
      setLocalItems((it) => it.map((x) => (x.id === p.id ? { ...x, is_active: !x.is_active } : x)));
      return;
    }
    startTransition(async () => {
      const res = await togglePersonaActive(orgId, p.id, !p.is_active);
      if (res.ok) {
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  };

  return (
    <>
      <div className="rs-page-head">
        <div>
          <p className="rs-eyebrow">{t('eyebrow')}</p>
          <h1>{t('title')}</h1>
          <p className="rs-lead" style={{ marginBottom: 0 }}>
            {t('lead')}
          </p>
        </div>
        <button className="rs-btn" data-primary="true" onClick={() => setDraft(emptyDraft())}>
          {t('newPersona')}
        </button>
      </div>

      {demo ? (
        <p className="rs-row-sub" style={{ marginTop: 8 }}>
          {t('demoNote')}
        </p>
      ) : null}

      <div className="rs-figs" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 150px))', margin: '16px 0' }}>
        <div>
          <div className="rs-fig-n">{total}</div>
          <div className="rs-fig-l">{t('statsTotal')}</div>
        </div>
        <div>
          <div className="rs-fig-n" data-live="true">
            {active}
          </div>
          <div className="rs-fig-l">{t('statsActive')}</div>
        </div>
      </div>

      {error ? (
        <p role="status" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {error}
        </p>
      ) : null}

      {list.length === 0 ? (
        <p className="rs-empty">{t('empty')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {list.map((p) => {
            const titles = (p.title_patterns ?? []).slice(0, 5).join(', ') + ((p.title_patterns ?? []).length > 5 ? ' …' : '');
            return (
              <div key={p.id} className="rs-card rs-persona" data-inactive={!p.is_active ? 'true' : undefined}>
                <span className="rs-persona-icon">{p.name.charAt(0).toUpperCase()}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <h3 style={{ fontSize: 15 }}>{p.name}</h3>
                    <span className="rs-pill" data-tone="neutral">
                      {t('patternsCount', { n: (p.title_patterns ?? []).length })}
                    </span>
                    {!p.is_active ? (
                      <span className="rs-pill" data-tone="neutral">
                        {t('inactive')}
                      </span>
                    ) : null}
                  </div>
                  {p.description ? (
                    <p className="rs-row-sub" style={{ margin: '4px 0 0' }}>
                      {p.description}
                    </p>
                  ) : null}
                  <div className="rs-chips" style={{ marginTop: 8 }}>
                    {(p.channels_priority ?? []).map((c) => (
                      <span key={c} className="rs-chip">
                        {t(`channel.${c}`)}
                      </span>
                    ))}
                    {p.seniority ? (
                      <span className="rs-pill" data-tone="neutral">
                        {t(`seniorityLevel.${p.seniority}`)}
                      </span>
                    ) : null}
                  </div>
                  {titles.trim() ? (
                    <p className="rs-row-sub" style={{ marginTop: 6 }}>
                      {t('titlesLabel')} {titles}
                    </p>
                  ) : null}
                </div>
                <div style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
                  <button className="rs-btn" onClick={() => toggle(p)} disabled={pending}>
                    {p.is_active ? t('deactivate') : t('activate')}
                  </button>
                  <button className="rs-btn" onClick={() => setDraft(toDraft(p))} disabled={pending}>
                    {t('edit')}
                  </button>
                  <button className="rs-btn" onClick={() => remove(p.id)} disabled={pending}>
                    {t('delete')}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Formulaire créer / éditer */}
      {draft ? (
        <div className="rs-overlay" onClick={() => setDraft(null)} role="dialog" aria-modal="true">
          <div className="rs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rs-modal-head">
              <h3 style={{ fontSize: 16 }}>{draft.id ? t('editTitle') : t('newPersona')}</h3>
              <button className="rs-modal-close" onClick={() => setDraft(null)} aria-label={t('cancel')}>
                ×
              </button>
            </div>

            <label className="rs-label">
              {t('name')}
              <input className="rs-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </label>
            <label className="rs-label">
              {t('description')}
              <input className="rs-input" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </label>
            <label className="rs-label">
              {t('patterns')}
              <input className="rs-input" value={draft.patterns} onChange={(e) => setDraft({ ...draft, patterns: e.target.value })} placeholder="directeur commercial, sales director" />
            </label>
            <label className="rs-label">
              {t('excludeTitles')}
              <input className="rs-input" value={draft.exclusions} onChange={(e) => setDraft({ ...draft, exclusions: e.target.value })} placeholder="stagiaire, assistant" />
            </label>

            <div className="rs-label">
              {t('seniority')}
              <div className="rs-chips" style={{ marginTop: 4 }}>
                {SENIORITIES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="rs-toggle"
                    data-on={draft.seniority === s ? 'true' : 'false'}
                    onClick={() => setDraft({ ...draft, seniority: draft.seniority === s ? null : s })}
                  >
                    {t(`seniorityLevel.${s}`)}
                  </button>
                ))}
              </div>
            </div>

            <div className="rs-label">
              {t('channels')}
              <div className="rs-chips" style={{ marginTop: 4 }}>
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rs-toggle"
                    data-on={draft.channels.includes(c) ? 'true' : 'false'}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        channels: draft.channels.includes(c) ? draft.channels.filter((x) => x !== c) : [...draft.channels, c],
                      })
                    }
                  >
                    {t(`channel.${c}`)}
                  </button>
                ))}
              </div>
            </div>

            <label className="rs-label">
              {t('scoringPrompt')}
              <textarea
                className="rs-textarea"
                value={draft.scoringPrompt}
                onChange={(e) => setDraft({ ...draft, scoringPrompt: e.target.value })}
                placeholder={t('scoringPromptHint')}
              />
              <span className="rs-row-sub mono">{draft.scoringPrompt.length}</span>
            </label>

            <label className="rs-row-sub" style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
              <input type="checkbox" checked={draft.isActive} onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              {t('active')}
            </label>

            <div className="rs-actions">
              <button className="rs-btn" onClick={() => setDraft(null)} disabled={pending}>
                {t('cancel')}
              </button>
              <button className="rs-btn" data-primary="true" onClick={submit} disabled={pending || !draft.name.trim()}>
                {draft.id ? t('update') : t('create')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

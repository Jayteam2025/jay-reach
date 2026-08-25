'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { TREATMENTS, type InboxThread, type Treatment, type Classification } from '../../lib/sample-inbox';
import { Icon } from '../icons';
import { classifyInbox, suggestReply } from '../actions/inbox';

type Filter = 'all' | Treatment;

const CLASS_TONE: Record<Classification, string | undefined> = {
  human_reply: 'live',
  auto_left_company: 'flare',
  auto_absence: 'neutral',
  auto_other: 'neutral',
  unclassified: undefined,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function InboxView({ threads, orgId }: { threads: readonly InboxThread[]; orgId: string }) {
  const t = useTranslations('inbox');
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>('all');
  const [sorting, startSort] = useTransition();
  const [sortMsg, setSortMsg] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [suggesting, startSuggest] = useTransition();
  const [suggestMsg, setSuggestMsg] = useState<string | null>(null);
  // État de traitement modifiable localement (par fil).
  const [states, setStates] = useState<Record<string, Treatment>>(
    Object.fromEntries(threads.map((th) => [th.id, th.treatment])),
  );
  const [selectedId, setSelectedId] = useState<string | null>(threads[0]?.id ?? null);

  const visible = useMemo(
    () => threads.filter((th) => filter === 'all' || states[th.id] === filter),
    [threads, filter, states],
  );
  const selected = threads.find((th) => th.id === selectedId) ?? null;
  const FILTERS: Filter[] = ['all', 'todo', 'in_progress', 'done', 'later'];

  function sortNow() {
    setSortMsg(null);
    startSort(async () => {
      const res = await classifyInbox(orgId);
      if (res.ok) {
        setSortMsg(t('sorted', { n: res.count }));
        router.refresh();
      } else {
        setSortMsg(res.error);
      }
    });
  }

  return (
    <>
      <div className="rs-inbox-head" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="rs-tabs" style={{ flex: 1, marginTop: 0 }}>
          {FILTERS.map((f) => {
            const count = f === 'all' ? threads.length : threads.filter((th) => states[th.id] === f).length;
            return (
              <button key={f} className="rs-tab" data-active={filter === f} onClick={() => setFilter(f)}>
                {t(`filter.${f}`)}
                <span className="rs-count">{count}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="rs-btn" data-primary="true" onClick={sortNow} disabled={sorting}>
          {sorting ? t('sorting') : t('sortAuto')}
        </button>
        {sortMsg ? <span className="rs-lk-msg" data-ok="true">{sortMsg}</span> : null}
      </div>

      <div className="rs-inbox">
        {/* Liste des fils */}
        <div className="rs-thread-list">
          {visible.length === 0 ? (
            <div className="rs-empty" style={{ background: 'var(--slate)' }}>
              {t('emptyList')}
            </div>
          ) : (
            visible.map((th) => (
              <button
                key={th.id}
                className="rs-thread"
                data-selected={th.id === selectedId}
                onClick={() => setSelectedId(th.id)}
              >
                <div className="rs-thread-top">
                  <span className="rs-thread-name">{th.contactName}</span>
                  <span className="rs-chan-badge" data-ch={th.channel} title={t(`channel.${th.channel}`)}>
                    <Icon
                      name={th.channel === 'linkedin' ? 'linkedin' : 'mail'}
                      width={14}
                      height={14}
                      className={th.channel === 'linkedin' ? 'rs-ico-linkedin' : 'rs-ico-mail'}
                      aria-label={t(`channel.${th.channel}`)}
                    />
                  </span>
                  <span className="rs-pill" data-tone={CLASS_TONE[th.classification]} style={{ marginLeft: 'auto' }}>
                    {t(`class.${th.classification}`)}
                  </span>
                </div>
                <div className="rs-thread-excerpt">{th.excerpt}</div>
                <div className="rs-row-sub">
                  {th.company} · {th.when}
                </div>
              </button>
            ))
          )}
        </div>

        {/* Détail du fil */}
        {selected ? (
          <section className="rs-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="rs-avatar">{initials(selected.contactName)}</span>
              <div>
                <div style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {selected.contactName}
                  <span className="rs-chan-badge" data-ch={selected.channel} title={t(`channel.${selected.channel}`)}>
                    <Icon
                      name={selected.channel === 'linkedin' ? 'linkedin' : 'mail'}
                      width={15}
                      height={15}
                      className={selected.channel === 'linkedin' ? 'rs-ico-linkedin' : 'rs-ico-mail'}
                      aria-label={t(`channel.${selected.channel}`)}
                    />
                  </span>
                </div>
                <div className="rs-row-sub">
                  {selected.jobTitle} · {selected.company}
                </div>
              </div>
              <span className="rs-pill" data-tone={CLASS_TONE[selected.classification]} style={{ marginLeft: 'auto' }}>
                {t(`class.${selected.classification}`)}
              </span>
            </div>

            {selected.buySignal ? <div className="rs-buysignal">{t('buySignal')}</div> : null}

            <div className="rs-convo">
              {selected.messages.map((m, i) => (
                <div key={i} className="rs-bubble" data-dir={m.direction}>
                  <span className="rs-bubble-when">
                    {m.direction === 'out' ? `${t('you')} · ` : ''}
                    {m.when}
                  </span>
                  {m.body}
                </div>
              ))}
            </div>

            <div className="rs-reply-box">
              <textarea
                className="rs-textarea"
                placeholder={t('replyPlaceholder')}
                value={drafts[selected.id] ?? ''}
                onChange={(e) => setDrafts((d) => ({ ...d, [selected.id]: e.target.value }))}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="rs-btn"
                  disabled={suggesting}
                  onClick={() => {
                    setSuggestMsg(null);
                    const id = selected.id;
                    startSuggest(async () => {
                      const res = await suggestReply(orgId, id);
                      if (res.ok) setDrafts((d) => ({ ...d, [id]: res.draft }));
                      else setSuggestMsg(res.error);
                    });
                  }}
                >
                  {suggesting ? t('suggesting') : t('suggest')}
                </button>
                <button className="rs-btn" data-primary="true" disabled title={t('replyNote')}>
                  {t('reply')}
                </button>
                <span className="rs-row-sub mono">{t('via', { sender: selected.sender })}</span>
                <label className="rs-row-sub" style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('state')}
                  <select
                    className="rs-input"
                    style={{ width: 'auto', padding: '5px 8px' }}
                    value={states[selected.id]}
                    onChange={(e) => setStates((s) => ({ ...s, [selected.id]: e.target.value as Treatment }))}
                  >
                    {TREATMENTS.map((tr) => (
                      <option key={tr} value={tr}>
                        {t(`treatment.${tr}`)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="rs-row-sub" style={{ marginTop: 8 }}>
                {t('replyNote')}
              </p>
              {suggestMsg ? (
                <p className="rs-lk-msg" style={{ marginTop: 4 }}>
                  {suggestMsg}
                </p>
              ) : null}
            </div>
          </section>
        ) : (
          <p className="rs-empty">{t('empty')}</p>
        )}
      </div>
    </>
  );
}

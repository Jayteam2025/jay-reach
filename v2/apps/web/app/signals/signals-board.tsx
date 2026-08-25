'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setSignalStatus } from '../actions/signals';

export type SignalState = 'todo' | 'validated' | 'discarded' | 'arbitrate';

/** Ligne de signal telle qu'affichée (mappée depuis la table `signals`). */
export interface SignalRow {
  readonly id: string;
  readonly company: string;
  readonly siren?: string | null;
  readonly title: string;
  readonly location: string;
  readonly source: string;
  readonly score: number;
  readonly state: SignalState;
  readonly daysAgo: number;
  readonly discardReason?: string | null;
  readonly url?: string | null;
}

const TABS: SignalState[] = ['todo', 'validated', 'discarded', 'arbitrate'];
const TONE: Record<SignalState, string> = {
  todo: 'ghost',
  validated: 'live',
  discarded: 'neutral',
  arbitrate: 'flare',
};
// Motifs d'écartement connus → clés i18n ; sinon le texte brut est affiché.
const REASON_KEYS = new Set(['manual', 'recruiter', 'customer', 'opposition']);

export function SignalsBoard({ signals, orgId }: { signals: readonly SignalRow[]; orgId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [tab, setTab] = useState<SignalState>('todo');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => signals.filter((s) => s.state === tab), [signals, tab]);
  const selected = signals.find((s) => s.id === selectedId) ?? rows[0] ?? null;
  const count = (s: SignalState) => signals.filter((x) => x.state === s).length;

  function reasonLabel(reason: string): string {
    return REASON_KEYS.has(reason) ? t(`signals.reason.${reason}`) : reason;
  }

  function decide(signalId: string, decision: 'validate' | 'discard') {
    setError(null);
    startTransition(async () => {
      const res = await setSignalStatus(orgId, signalId, decision);
      if (res.ok) {
        setSelectedId(null);
        router.refresh();
      } else {
        setError(res.error);
      }
    });
  }

  return (
    <div>
      <div className="rs-tabs">
        {TABS.map((s) => (
          <button
            key={s}
            type="button"
            className="rs-tab"
            data-active={tab === s}
            onClick={() => {
              setTab(s);
              setSelectedId(null);
            }}
          >
            {t(`signals.state.${s}`)}
            <span className="rs-count">{count(s)}</span>
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="rs-empty">{t('signals.empty')}</p>
      ) : (
        <div className="rs-split">
          <div className="rs-list">
            {rows.map((s) => (
              <button
                key={s.id}
                type="button"
                className="rs-row"
                data-selected={selected?.id === s.id}
                onClick={() => setSelectedId(s.id)}
              >
                <span>
                  <span className="rs-row-title">{s.company}</span>
                  <br />
                  <span className="rs-row-sub">{s.title}</span>
                </span>
                <span className="rs-chan">{s.source}</span>
                <span>
                  <span className="rs-pill" data-tone={TONE[s.state]}>
                    {t(`signals.state.${s.state}`)}
                  </span>
                </span>
                <span className="rs-score" data-high={s.score >= 80}>
                  {s.score}
                </span>
                <span className="rs-chan">{t('signals.daysAgo', { n: s.daysAgo })}</span>
              </button>
            ))}
          </div>

          {selected ? (
            <aside className="rs-card">
              <h3>{selected.company}</h3>
              <p className="rs-row-sub">{selected.title}</p>
              <dl className="rs-kv">
                <dt>{t('signals.detail.source')}</dt>
                <dd className="mono">{selected.source}</dd>
                <dt>{t('signals.detail.siren')}</dt>
                <dd className="mono">{selected.siren ?? t('signals.detail.noSiren')}</dd>
                <dt>{t('signals.detail.location')}</dt>
                <dd>{selected.location}</dd>
                <dt>{t('signals.detail.score')}</dt>
                <dd className="mono">{selected.score}</dd>
                <dt>{t('signals.detail.age')}</dt>
                <dd className="mono">{t('signals.daysAgo', { n: selected.daysAgo })}</dd>
                {selected.discardReason ? (
                  <>
                    <dt>{t('signals.detail.reason')}</dt>
                    <dd>{reasonLabel(selected.discardReason)}</dd>
                  </>
                ) : null}
              </dl>
              {selected.state === 'todo' || selected.state === 'arbitrate' ? (
                <div className="rs-actions">
                  <button
                    className="rs-btn"
                    data-primary="true"
                    type="button"
                    disabled={pending}
                    onClick={() => decide(selected.id, 'validate')}
                  >
                    {t('signals.validate')}
                  </button>
                  <button className="rs-btn" type="button" disabled={pending} onClick={() => decide(selected.id, 'discard')}>
                    {t('signals.discard')}
                  </button>
                </div>
              ) : null}
              {error ? <p className="rs-lk-msg">{error}</p> : null}
            </aside>
          ) : null}
        </div>
      )}
    </div>
  );
}

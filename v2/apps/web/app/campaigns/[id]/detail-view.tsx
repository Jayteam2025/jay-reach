'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CampaignDetail, SeqStepDetail, Sentiment, Channel } from '../../../lib/sample-campaign-detail';
import { Icon, type IconName } from '../../icons';
import { ApprovalList, type ApprovalRow } from '../../approvals/approval-list';

const STATUS_TONE: Record<string, string> = { active: 'live', paused: 'neutral', draft: 'ghost' };
const SENTIMENT_TONE: Record<Sentiment, string | undefined> = { positive: 'live', later: 'neutral', negative: 'flare' };

const TABS = ['overview', 'contacts', 'queue', 'sourcesPersonas', 'sequence', 'activity', 'settings'] as const;
type Tab = (typeof TABS)[number];
const FUNCTIONAL: Tab[] = ['overview', 'sequence', 'queue'];

const DEC = '−';
const INC = '+';

function channelIcon(channel: Channel): IconName {
  if (channel === 'linkedin_invite' || channel === 'linkedin_message') return 'linkedin';
  if (channel === 'call') return 'phone';
  return 'mail';
}

function channelIconClass(channel: Channel): string {
  if (channel === 'linkedin_invite' || channel === 'linkedin_message') return 'rs-ico-linkedin';
  if (channel === 'email') return 'rs-ico-mail';
  return '';
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

interface Edit {
  subject: string;
  body: string;
  variables: string[];
}

export function CampaignDetailView({
  detail,
  pendingApprovals,
  orgId,
}: {
  detail: CampaignDetail;
  pendingApprovals: ApprovalRow[];
  orgId: string;
}) {
  const t = useTranslations('campaigns');
  const [tab, setTab] = useState<Tab>('sequence');
  const [openStep, setOpenStep] = useState<SeqStepDetail | null>(null);
  const [delays, setDelays] = useState<number[]>(detail.steps.map((s) => s.delayDays));
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [edits, setEdits] = useState<Record<number, Edit>>({});
  const [newVar, setNewVar] = useState('');

  const exitedPct = detail.contacted > 0 ? Math.round((detail.replies / detail.contacted) * 100) : 0;

  const bump = (i: number, delta: number): void =>
    setDelays((d) => d.map((v, idx) => (idx === i ? Math.max(0, (v ?? 0) + delta) : v)));

  const editOf = (step: SeqStepDetail): Edit =>
    edits[step.n] ?? { subject: step.subject ?? '', body: step.body, variables: [...step.variables] };
  const patch = (step: SeqStepDetail, part: Partial<Edit>): void =>
    setEdits((e) => ({ ...e, [step.n]: { ...editOf(step), ...part } }));

  const cur = openStep ? editOf(openStep) : null;

  return (
    <>
      {/* En-tête */}
      <a href="/campaigns" className="rs-crumb">
        {t('back')}
      </a>
      <div className="rs-page-head" style={{ marginTop: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0 }}>{detail.name}</h1>
            <span className="rs-pill" data-tone={STATUS_TONE[detail.status]}>
              {t(`status.${detail.status}`)}
            </span>
          </div>
          <p className="rs-row-sub" style={{ marginTop: 6 }}>
            {t('detailSub', {
              days: detail.createdDaysAgo,
              next: detail.nextSendIn,
              contacts: detail.total,
              steps: detail.steps.length,
            })}
          </p>
        </div>
        <div className="rs-head-actions">
          <span className="rs-pill" data-tone="live">
            {t('perDay', { n: detail.cadencePerDay })}
          </span>
          <a className="rs-btn" href="/import">
            {t('addContacts')}
          </a>
          <button className="rs-btn">{t('pause')}</button>
        </div>
      </div>

      {/* Onglets */}
      <div className="rs-tabs" style={{ marginTop: 16 }}>
        {TABS.map((tb) => (
          <button key={tb} className="rs-tab" data-active={tab === tb} onClick={() => setTab(tb)}>
            {t(`tabs.${tb}`)}
          </button>
        ))}
      </div>

      {!FUNCTIONAL.includes(tab) ? (
        <p className="rs-empty">{t('soon')}</p>
      ) : tab === 'queue' ? (
        <ApprovalList items={pendingApprovals} orgId={orgId} />
      ) : tab === 'overview' ? (
        <div className="rs-grid2">
          <section className="rs-card">
            <p className="rs-lead" style={{ marginTop: 0 }}>
              {t('overviewLead')}
            </p>
            <div className="rs-head-figs">
              <HeadFig n={`${detail.replyRate.toLocaleString('fr-FR')} %`} label={t('rate')} live />
              <HeadFig n={detail.positives} label={t('fig.positives')} live />
              <HeadFig n={detail.replies} label={t('fig.replies')} />
              <HeadFig n={`${detail.acceptanceRate.toLocaleString('fr-FR')} %`} label={t('fig.accepted')} />
            </div>
          </section>
          <div />
        </div>
      ) : (
        <div className="rs-grid2">
          {/* Colonne séquence */}
          <section style={{ display: 'grid', gap: 12 }}>
            <div className="rs-card rs-qualif">
              <div className="rs-chips">
                {detail.qualif.map((q, i) => (
                  <span key={q} className="rs-chip" data-strong={i === 0 ? 'true' : undefined}>
                    {q}
                  </span>
                ))}
              </div>
              <button className="rs-btn" style={{ marginLeft: 'auto' }}>
                {t('editRule')}
              </button>
            </div>

            <div className="rs-steps">
              {detail.steps.map((step, i) => (
                <div key={step.n}>
                  {i > 0 ? (
                    <div className="rs-delay-row">
                      <span>{t('wait')}</span>
                      <span className="rs-stepper">
                        <button type="button" onClick={() => bump(i, -1)} aria-label={t('wait')}>
                          {DEC}
                        </button>
                        <input
                          className="rs-delay-input"
                          inputMode="numeric"
                          value={String(delays[i] ?? step.delayDays)}
                          onChange={(e) => {
                            const num = Number(e.target.value.replace(/[^\d]/g, ''));
                            setDelays((d) => d.map((v, idx) => (idx === i ? (Number.isFinite(num) ? num : v) : v)));
                          }}
                          aria-label={t('wait')}
                        />
                        <button type="button" onClick={() => bump(i, 1)} aria-label={t('wait')}>
                          {INC}
                        </button>
                      </span>
                      <span>{t('dayUnit', { n: delays[i] ?? step.delayDays })}</span>
                      <span className={step.condition ? 'rs-cond' : undefined}>
                        · {step.condition ?? t('noCondition')}
                      </span>
                    </div>
                  ) : null}

                  <div
                    className="rs-step"
                    role="button"
                    tabIndex={0}
                    onClick={() => setOpenStep(step)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setOpenStep(step);
                      }
                    }}
                  >
                    <span className="rs-step-n">{step.n}</span>
                    <span style={{ minWidth: 0 }}>
                      <span className="rs-step-title" style={{ display: 'block' }}>
                        {step.title}
                      </span>
                      <span className="rs-step-preview">{step.preview}</span>
                    </span>
                    <span className="rs-step-right">
                      {step.validation ? (
                        <span className="rs-pill rs-pill-solid">{t('validation')}</span>
                      ) : step.channel === 'call' && step.phone ? (
                        revealed.has(step.n) ? (
                          <span className="rs-pill rs-pill-lime mono" title={t('viaFullenrich')}>
                            {step.phone}
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="rs-pill rs-pill-lime"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRevealed((s) => new Set(s).add(step.n));
                            }}
                          >
                            {t('showPhone')}
                          </button>
                        )
                      ) : (
                        <span className="rs-chan" title={t(`channel.${step.channel}`)}>
                          <Icon
                            name={channelIcon(step.channel)}
                            width={16}
                            height={16}
                            className={channelIconClass(step.channel)}
                            aria-label={t(`channel.${step.channel}`)}
                          />
                        </span>
                      )}
                      <span className="rs-step-fig" data-live={step.replied > 0 ? 'true' : undefined}>
                        {step.replied}
                        <small>{t('modal.replied')}</small>
                      </span>
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <button className="rs-btn">{t('addStep')}</button>
            <p className="rs-eyebrow">{t('stopNote')}</p>
          </section>

          {/* Colonne droite */}
          <aside style={{ display: 'grid', gap: 16, alignSelf: 'start' }}>
            <section className="rs-card">
              <h3 className="rs-section-title">{t('replied')}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div className="rs-avatar-stack">
                  {detail.repliedContacts.slice(0, 3).map((r) => (
                    <span key={r.name} className="rs-avatar">
                      {initials(r.name)}
                    </span>
                  ))}
                  <span className="rs-avatar-more">+{detail.avatarOverflow}</span>
                </div>
                <div className="rs-hf-n" data-live="true" style={{ marginLeft: 'auto' }}>
                  {detail.replies}
                </div>
              </div>
              <p className="rs-row-sub" style={{ marginTop: 8 }}>
                {t('exited', { pct: exitedPct })}
              </p>
              <button className="rs-btn" style={{ marginTop: 8 }}>
                {t('viewContacts')}
              </button>
            </section>

            <section className="rs-card">
              <h3 className="rs-section-title">{t('lastReplies')}</h3>
              {detail.repliedContacts.map((r) => (
                <div key={r.name} className="rs-contact" style={{ alignItems: 'flex-start' }}>
                  <span className="rs-avatar">{initials(r.name)}</span>
                  <div style={{ minWidth: 0 }}>
                    <div className="rs-contact-name">{r.name}</div>
                    <div className="rs-contact-sub">
                      {r.company} · {t('step', { n: r.step })} · {r.when}
                    </div>
                  </div>
                  <span className="rs-pill" data-tone={SENTIMENT_TONE[r.sentiment]} style={{ marginLeft: 'auto' }}>
                    {t(`sentiment.${r.sentiment}`)}
                  </span>
                </div>
              ))}
            </section>

            <section className="rs-card">
              <h3 className="rs-section-title">{t('funnel')}</h3>
              {detail.steps.map((step, i) => {
                const prev = i > 0 ? detail.steps[i - 1]?.eligible ?? step.eligible : step.eligible;
                const drop = i > 0 && step.eligible < prev * 0.6;
                const width = detail.contacted > 0 ? Math.round((step.eligible / detail.contacted) * 100) : 0;
                return (
                  <div key={step.n} className="rs-funnel-row">
                    <div className="rs-funnel-head">
                      <span className="rs-row-sub">
                        {t('step', { n: step.n })} · {t(`channel.${step.channel}`)}
                      </span>
                      <span className="mono">
                        {step.eligible} · {width}%
                      </span>
                    </div>
                    <div className="rs-funnel-bar" data-drop={drop ? 'true' : undefined}>
                      <span style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </section>
          </aside>
        </div>
      )}

      {/* Modale d'étape — message + variables éditables */}
      {openStep && cur ? (
        <div className="rs-overlay" onClick={() => setOpenStep(null)} role="dialog" aria-modal="true">
          <div className="rs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rs-modal-head">
              <h3 style={{ fontSize: 16 }}>
                {t('step', { n: openStep.n })} · {t(`channel.${openStep.channel}`)}
              </h3>
              <button className="rs-modal-close" onClick={() => setOpenStep(null)} aria-label={t('modal.close')}>
                ×
              </button>
            </div>

            {openStep.subject !== undefined ? (
              <label className="rs-label">
                {t('modal.subject')}
                <input className="rs-input mono" value={cur.subject} onChange={(e) => patch(openStep, { subject: e.target.value })} />
              </label>
            ) : null}

            <div className="rs-section-title" style={{ marginTop: 10 }}>
              {t('modal.message')}
            </div>
            <textarea
              className="rs-textarea"
              style={{ minHeight: 150 }}
              value={cur.body}
              onChange={(e) => patch(openStep, { body: e.target.value })}
            />

            <div className="rs-section-title" style={{ marginTop: 12 }}>
              {t('modal.variables')}
            </div>
            <div className="rs-chips" style={{ marginTop: 6 }}>
              {cur.variables.map((v) => (
                <span key={v} className="rs-chip rs-chip-x">
                  {`{{${v}}}`}
                  <button
                    type="button"
                    aria-label={t('modal.close')}
                    onClick={() => patch(openStep, { variables: cur.variables.filter((x) => x !== v) })}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <input
              className="rs-input mono"
              style={{ marginTop: 8 }}
              value={newVar}
              placeholder="prenom"
              onChange={(e) => setNewVar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  const v = newVar.trim().replace(/[^a-z0-9_]/gi, '');
                  if (v && !cur.variables.includes(v)) {
                    patch(openStep, { variables: [...cur.variables, v] });
                  }
                  setNewVar('');
                }
              }}
            />

            {openStep.condition ? (
              <dl className="rs-field-row" style={{ marginTop: 12 }}>
                <dt>{t('modal.condition')}</dt>
                <dd className="rs-cond">{openStep.condition}</dd>
              </dl>
            ) : null}

            {openStep.approvalNote ? (
              <dl className="rs-field-row">
                <dt>{t('modal.approval')}</dt>
                <dd style={{ color: 'var(--flare)' }}>{openStep.approvalNote}</dd>
              </dl>
            ) : null}

            <div className="rs-section-title" style={{ marginTop: 14 }}>
              {t('modal.stats')}
            </div>
            <div className="rs-figs" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 0 }}>
              <div>
                <div className="rs-fig-n">{openStep.sent}</div>
                <div className="rs-fig-l">{t('modal.sent')}</div>
              </div>
              {openStep.opened !== undefined ? (
                <div>
                  <div className="rs-fig-n">{openStep.opened}</div>
                  <div className="rs-fig-l">{t('modal.opened')}</div>
                </div>
              ) : (
                <div />
              )}
              <div>
                <div className="rs-fig-n" data-live="true">
                  {openStep.replied}
                </div>
                <div className="rs-fig-l">{t('modal.replied')}</div>
              </div>
            </div>

            <div className="rs-actions">
              <button className="rs-btn" data-primary="true" onClick={() => setOpenStep(null)}>
                {t('modal.close')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function HeadFig({ n, label, live }: { n: number | string; label: string; live?: boolean }) {
  return (
    <div>
      <div className="rs-hf-n" data-live={live ? 'true' : undefined}>
        {n}
      </div>
      <div className="rs-hf-l">{label}</div>
    </div>
  );
}

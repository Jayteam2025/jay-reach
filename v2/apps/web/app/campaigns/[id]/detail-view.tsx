'use client';

import { useState, useTransition, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CampaignDetail, SeqStepDetail, Channel } from '../../../lib/sample-campaign-detail';
import { Icon, type IconName } from '../../icons';
import { ApprovalList, type ApprovalRow } from '../../approvals/approval-list';
import { setCampaignStatus, addStep, updateStep, deleteStep, moveStep } from '../../actions/campaigns';
import { StepMessageEditor } from './step-message-editor';
import Link from 'next/link';

const STATUS_TONE: Record<string, string> = { active: 'live', paused: 'neutral', draft: 'ghost' };

const TABS = ['overview', 'contacts', 'queue', 'sourcesPersonas', 'sequence', 'activity', 'settings'] as const;
type Tab = (typeof TABS)[number];
const FUNCTIONAL: Tab[] = ['overview', 'sequence', 'queue'];
const CHANNELS: Channel[] = ['email', 'linkedin_invite', 'linkedin_message', 'letter', 'call'];

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
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
}

interface StepDraft {
  id: string | null;
  channel: Channel;
  templateParentId: string | null;
  delayDays: number;
  subject: string;
  body: string;
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
  const te = useTranslations('campaigns.stepEd');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('sequence');
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [draft, setDraft] = useState<StepDraft | null>(null);
  /**
   * Du texte tapé dans l'étape qui n'est pas encore en base.
   *
   * La modale se ferme de trois façons — la croix, le bouton, et un clic à
   * côté. Aucune ne prévenait. Un message de dix lignes disparaissait donc
   * d'un geste involontaire, sans que rien ne le dise : c'est ce qui a fait
   * croire à Alexandre que ses messages avaient été supprimés.
   */
  const [messageNonEnregistre, setMessageNonEnregistre] = useState(false);

  /** Ferme l'étape, en demandant confirmation si du texte s'y perdrait. */
  const fermerEtape = (): void => {
    if (messageNonEnregistre && !window.confirm(te('closeUnsaved'))) {
      return;
    }
    setMessageNonEnregistre(false);
    setDraft(null);
  };

  const families = detail.templateFamilies ?? [];
  const exitedPct = detail.contacted > 0 ? Math.round((detail.replies / detail.contacted) * 100) : 0;

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string; issues?: string[] }>): void => {
    startTransition(async () => {
      const res = await fn();
      if (res.ok) {
        setError(null);
        setDraft(null);
        router.refresh();
      } else {
        setError(res.issues && res.issues.length > 0 ? res.issues.join(' · ') : res.error);
      }
    });
  };

  const toggleStatus = (): void => {
    const next = detail.status === 'active' ? 'paused' : 'active';
    run(() => setCampaignStatus(orgId, detail.id, next));
  };

  const openNew = (): void => setDraft({ id: null, channel: 'email', templateParentId: null, delayDays: 0, subject: '', body: '' });
  const openEdit = (step: SeqStepDetail): void =>
    setDraft({
      id: step.id ?? null,
      channel: step.channel,
      templateParentId: step.templateParentId ?? null,
      delayDays: step.delayDays,
      subject: step.subject ?? '',
      body: step.body ?? '',
    });

  const saveDraft = (): void => {
    if (!draft) return;
    const payload = {
      channel: draft.channel,
      delayHours: Math.max(0, Math.round(draft.delayDays)) * 24,
      templateParentId: draft.templateParentId,
    };
    run(() => (draft.id ? updateStep(orgId, detail.id, draft.id, payload) : addStep(orgId, detail.id, payload)));
  };

  const removeStep = (step: SeqStepDetail): void => {
    if (!step.id || !window.confirm(te('delConfirm'))) return;
    run(() => deleteStep(orgId, detail.id, step.id!));
  };
  const move = (step: SeqStepDetail, up: boolean): void => {
    if (!step.id) return;
    run(() => moveStep(orgId, detail.id, step.id!, up));
  };

  const familiesForDraft = draft ? families.filter((f) => f.channel === draft.channel) : [];
  const iconBtn: CSSProperties = {
    width: 26,
    height: 26,
    borderRadius: 6,
    border: '1px solid var(--slate3)',
    background: 'transparent',
    color: 'var(--chalk)',
    cursor: 'pointer',
    lineHeight: 1,
  };

  return (
    <>
      <Link href="/campaigns" className="rs-crumb">
        {t('back')}
      </Link>
      <div className="rs-page-head" style={{ marginTop: 8 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ margin: 0 }}>{detail.name}</h1>
            <span className="rs-pill" data-tone={STATUS_TONE[detail.status]}>
              {t(`status.${detail.status}`)}
            </span>
          </div>
          <p className="rs-row-sub" style={{ marginTop: 6 }}>
            {t('detailSub', { days: detail.createdDaysAgo, next: detail.nextSendIn, contacts: detail.total, steps: detail.steps.length })}
          </p>
        </div>
        <div className="rs-head-actions">
          <span className="rs-pill" data-tone="live">
            {t('perDay', { n: detail.cadencePerDay })}
          </span>
          <Link className="rs-btn" href="/import">
            {t('addContacts')}
          </Link>
          <button className="rs-btn" onClick={toggleStatus} disabled={pending}>
            {detail.status === 'active' ? t('pause') : t('activate')}
          </button>
        </div>
      </div>
      {error ? (
        <p role="status" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {error}
        </p>
      ) : null}

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
          <section style={{ display: 'grid', gap: 12 }}>
            <div className="rs-card rs-qualif">
              <div className="rs-chips">
                {detail.qualif.map((q, i) => (
                  <span key={q} className="rs-chip" data-strong={i === 0 ? 'true' : undefined}>
                    {q}
                  </span>
                ))}
                {detail.qualif.length === 0 ? <span className="rs-row-sub">{te('noRule')}</span> : null}
              </div>
            </div>

            <div className="rs-steps">
              {detail.steps.map((step, i) => (
                <div key={step.id ?? step.n}>
                  {i > 0 ? (
                    <div className="rs-delay-row">
                      <span>{t('wait')}</span>
                      <span className="mono">{t('dayUnit', { n: step.delayDays })}</span>
                    </div>
                  ) : null}

                  <div className="rs-step">
                    <span className="rs-step-n">{step.n}</span>
                    <button
                      type="button"
                      style={{ minWidth: 0, flex: 1, textAlign: 'left', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: 0 }}
                      onClick={() => openEdit(step)}
                    >
                      <span className="rs-step-title" style={{ display: 'block' }}>
                        {step.templateParentId ? step.title : te('noMessageYet')}
                      </span>
                      <span className="rs-step-preview">{step.preview}</span>
                    </button>
                    <span className="rs-step-right">
                      {step.validation ? (
                        <span className="rs-pill rs-pill-solid">{t('validation')}</span>
                      ) : step.channel === 'call' && step.phone ? (
                        revealed.has(step.n) ? (
                          <span className="rs-pill rs-pill-lime mono">{step.phone}</span>
                        ) : (
                          <button
                            type="button"
                            className="rs-pill rs-pill-lime"
                            onClick={() => setRevealed((s) => new Set(s).add(step.n))}
                          >
                            {t('showPhone')}
                          </button>
                        )
                      ) : (
                        <span className="rs-chan" title={t(`channel.${step.channel}`)}>
                          <Icon name={channelIcon(step.channel)} width={16} height={16} className={channelIconClass(step.channel)} aria-label={t(`channel.${step.channel}`)} />
                        </span>
                      )}
                      <span style={{ display: 'inline-flex', gap: 2 }}>
                        <button type="button" style={iconBtn} aria-label={te('up')} disabled={pending || i === 0} onClick={() => move(step, true)}>↑</button>
                        <button type="button" style={iconBtn} aria-label={te('down')} disabled={pending || i === detail.steps.length - 1} onClick={() => move(step, false)}>↓</button>
                        <button type="button" style={iconBtn} aria-label={te('del')} disabled={pending} onClick={() => removeStep(step)}>×</button>
                      </span>
                    </span>
                  </div>
                </div>
              ))}
              {detail.steps.length === 0 ? <p className="rs-row-sub">{te('empty')}</p> : null}
            </div>

            <button className="rs-btn" onClick={openNew} disabled={pending}>
              {t('addStep')}
            </button>
            <p className="rs-eyebrow">{t('stopNote')}</p>
          </section>

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
            </section>

            <section className="rs-card">
              <h3 className="rs-section-title">{t('funnel')}</h3>
              {detail.steps.map((step, i) => {
                const prev = i > 0 ? detail.steps[i - 1]?.eligible ?? step.eligible : step.eligible;
                const drop = i > 0 && step.eligible < prev * 0.6;
                const width = detail.contacted > 0 ? Math.round((step.eligible / detail.contacted) * 100) : 0;
                return (
                  <div key={step.id ?? step.n} className="rs-funnel-row">
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
              {detail.steps.length === 0 ? <p className="rs-row-sub">{te('empty')}</p> : null}
            </section>
          </aside>
        </div>
      )}

      {draft ? (
        <div className="rs-overlay" role="dialog" aria-modal="true" onClick={fermerEtape}>
          <div className="rs-modal" onClick={(e) => e.stopPropagation()}>
            <div className="rs-modal-head">
              <h3 style={{ fontSize: 16 }}>{draft.id ? te('edit') : te('new')}</h3>
              <button className="rs-modal-close" aria-label={t('modal.close')} onClick={fermerEtape}>
                ×
              </button>
            </div>

            <div className="rs-label">
              {te('channel')}
              <div className="rs-chips" style={{ marginTop: 4 }}>
                {CHANNELS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    className="rs-toggle"
                    data-on={draft.channel === c ? 'true' : 'false'}
                    onClick={() => setDraft({ ...draft, channel: c, templateParentId: null })}
                  >
                    {t(`channel.${c}`)}
                  </button>
                ))}
              </div>
            </div>

            {draft.channel === 'call' ? (
              <p className="rs-row-sub" style={{ marginTop: 8 }}>
                {te('callNote')}
              </p>
            ) : (
              <>
                {/* On écrit ici. Le sélecteur reste dessous : il sert quand on a
                    déjà un message qui marche, mais il n'est plus le seul
                    chemin — c'est ce qui obligeait à sortir de la campagne. */}
                <StepMessageEditor
                  orgId={orgId}
                  campaignId={detail.id}
                  channel={draft.channel}
                  nature={detail.nature ?? 'signal'}
                  locale={detail.locale ?? 'fr'}
                  templateParentId={draft.templateParentId}
                  initialSubject={draft.subject}
                  initialBody={draft.body}
                  estPremiereEtape={detail.steps.findIndex((st) => st.id === draft.id) <= 0}
                  onSaved={(id) => setDraft((d) => (d ? { ...d, templateParentId: id } : d))}
                  onModifications={setMessageNonEnregistre}
                />

                <label className="rs-label">
                  {te('template')}
                  <select
                    className="rs-input"
                    value={draft.templateParentId ?? ''}
                    onChange={(e) => setDraft({ ...draft, templateParentId: e.target.value || null })}
                  >
                    <option value="">{te('noTemplate')}</option>
                    {familiesForDraft.map((f) => (
                      <option key={f.familyId} value={f.familyId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                  {familiesForDraft.length === 0 ? <span className="rs-row-sub">{te('noneForChannel')}</span> : null}
                  <Link className="rs-row-sub" href="/settings/templates" style={{ marginTop: 4 }}>
                    {te('editInLibrary')}
                  </Link>
                </label>
              </>
            )}

            <label className="rs-label">
              {te('delayDays')}
              <input
                className="rs-input mono"
                inputMode="numeric"
                value={String(draft.delayDays)}
                onChange={(e) => setDraft({ ...draft, delayDays: Number(e.target.value.replace(/[^\d]/g, '')) || 0 })}
              />
            </label>

            {draft.channel === 'letter' ? (
              <p className="rs-row-sub" style={{ color: 'var(--flare)' }}>
                {te('letterNote')}
              </p>
            ) : null}

            <div className="rs-actions">
              <button className="rs-btn" onClick={fermerEtape}>
                {t('modal.close')}
              </button>
              <button className="rs-btn" data-primary="true" disabled={pending} onClick={saveDraft}>
                {te('save')}
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

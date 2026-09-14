'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { setActionApproval } from '../actions/approvals';
import { Icon, type IconName } from '../icons';

export interface ApprovalRow {
  id: string;
  channel: string;
  contact: string;
  company: string;
  campaign: string;
  reason: string | null;
}

function channelIcon(channel: string): IconName {
  if (channel.startsWith('linkedin')) return 'linkedin';
  if (channel === 'call') return 'phone';
  return 'mail';
}

export function ApprovalList({ items, orgId }: { items: ApprovalRow[]; orgId: string }) {
  const t = useTranslations('approvals');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function decide(id: string, decision: 'approve' | 'reject') {
    setError(null);
    startTransition(async () => {
      const res = await setActionApproval(orgId, id, decision);
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  if (items.length === 0) {
    return <p className="rs-empty">{t('empty')}</p>;
  }

  return (
    <div className="rs-appr-list">
      {items.map((a) => (
        <div key={a.id} className="rs-appr-row">
          <span className="rs-appr-ico">
            <Icon
              name={channelIcon(a.channel)}
              width={16}
              height={16}
              className={a.channel.startsWith('linkedin') ? 'rs-ico-linkedin' : a.channel === 'letter' ? undefined : 'rs-ico-mail'}
              aria-hidden="true"
            />
          </span>
          <div className="rs-appr-main">
            <div className="rs-appr-name">
              {a.contact} · <span className="rs-row-sub">{a.company}</span>
            </div>
            <div className="rs-appr-sub mono">
              {t(`channel.${a.channel}`)} · {a.campaign}
              {a.reason ? ` · ${t(`reason.${a.reason}`)}` : ''}
            </div>
          </div>
          <div className="rs-appr-actions">
            <button type="button" className="rs-btn" data-primary="true" disabled={pending} onClick={() => decide(a.id, 'approve')}>
              {t('approve')}
            </button>
            <button type="button" className="rs-btn" disabled={pending} onClick={() => decide(a.id, 'reject')}>
              {t('reject')}
            </button>
          </div>
        </div>
      ))}
      {error ? <p className="rs-lk-msg">{error}</p> : null}
    </div>
  );
}

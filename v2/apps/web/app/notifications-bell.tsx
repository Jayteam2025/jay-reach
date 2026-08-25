'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { markNotificationsRead } from './actions/notifications';
import { PushToggle } from './push-toggle';

export interface NotifItem {
  id: string;
  title: string;
  body: string;
  when: string;
  read: boolean;
}

export function NotificationsBell({ items }: { items: NotifItem[] }) {
  const t = useTranslations('notifications');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const unread = items.filter((i) => !i.read).length;

  function markRead() {
    startTransition(async () => {
      await markNotificationsRead();
      router.refresh();
    });
  }

  return (
    <div className="rs-notif">
      <button
        type="button"
        className="rs-notif-btn"
        aria-label={t('title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? <span className="rs-notif-badge">{unread}</span> : null}
      </button>

      {open ? (
        <div className="rs-notif-panel">
          <div className="rs-notif-head">
            <span>{t('title')}</span>
            {unread > 0 ? (
              <button type="button" className="rs-notif-mark" onClick={markRead} disabled={pending}>
                {t('markAll')}
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="rs-notif-empty">{t('empty')}</p>
          ) : (
            <ul className="rs-notif-list">
              {items.map((n) => (
                <li key={n.id} className="rs-notif-item" data-unread={!n.read ? 'true' : undefined}>
                  <div className="rs-notif-item-title">{n.title}</div>
                  <div className="rs-notif-item-body">{n.body}</div>
                  <div className="rs-notif-item-when">{n.when}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="rs-notif-foot">
            <PushToggle />
          </div>
        </div>
      ) : null}
    </div>
  );
}

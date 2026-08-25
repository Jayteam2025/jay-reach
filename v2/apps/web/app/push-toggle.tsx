'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { savePushSubscription, sendTestPush } from './actions/push';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushToggle() {
  const t = useTranslations('notifications');
  const [enabled, setEnabled] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function enable() {
    setMsg(null);
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setMsg(t('pushUnsupported'));
      return;
    }
    const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!key) {
      setMsg(t('pushUnsupported'));
      return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        setMsg(t('pushDenied'));
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
      });
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      startTransition(async () => {
        const res = await savePushSubscription(
          { endpoint: json.endpoint ?? '', keys: { p256dh: json.keys?.p256dh ?? '', auth: json.keys?.auth ?? '' } },
          navigator.userAgent,
        );
        if (res.ok) {
          setEnabled(true);
          setMsg(t('pushEnabled'));
        } else {
          setMsg(res.error);
        }
      });
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }

  function test() {
    setMsg(null);
    startTransition(async () => {
      const res = await sendTestPush();
      setMsg(res.ok ? t('pushSent', { n: res.sent ?? 0 }) : res.error);
    });
  }

  return (
    <div className="rs-push">
      {enabled ? (
        <button type="button" className="rs-notif-mark" onClick={test} disabled={pending}>
          {t('pushTest')}
        </button>
      ) : (
        <button type="button" className="rs-notif-mark" onClick={enable} disabled={pending}>
          {t('pushEnable')}
        </button>
      )}
      {msg ? <span className="rs-push-msg">{msg}</span> : null}
    </div>
  );
}

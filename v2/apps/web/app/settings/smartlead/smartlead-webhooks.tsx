'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { regenerateSmartleadWebhookSecret } from '../../actions/webhooks';

const EVENTS = ['LEAD_REPLIED', 'EMAIL_BOUNCED', 'LEAD_UNSUBSCRIBED'] as const;

export function SmartleadWebhooks({
  orgId,
  demo,
  canManage,
  appUrl,
  initialSecret,
}: {
  orgId: string;
  demo: boolean;
  canManage: boolean;
  appUrl: string;
  initialSecret: string | null;
}) {
  const t = useTranslations('smartleadWh');
  const [pending, startTransition] = useTransition();
  const [secret, setSecret] = useState<string | null>(initialSecret);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const base = appUrl || t('yourDomain');
  const url = secret ? `${base}/api/webhooks/smartlead?org=${orgId}&token=${secret}` : null;

  const regen = (): void => {
    if (demo) return;
    startTransition(async () => {
      const res = await regenerateSmartleadWebhookSecret(orgId);
      if (res.ok) {
        setSecret(res.secret);
        setError(null);
        setCopied(false);
      } else {
        setError(res.error);
      }
    });
  };

  const copy = (): void => {
    if (!url) return;
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(true),
      () => setCopied(false),
    );
  };

  return (
    <>
      <div className="rs-page-head">
        <p className="rs-eyebrow">{t('eyebrow')}</p>
        <h1>{t('title')}</h1>
        <p className="rs-lead" style={{ marginBottom: 0 }}>
          {t('lead')}
        </p>
      </div>

      {demo ? <p className="rs-row-sub" style={{ marginTop: 12 }}>{t('demoNotice')}</p> : null}

      {!demo && !canManage ? <p className="rs-empty">{t('adminOnly')}</p> : null}

      {demo || canManage ? (
      <div className="rs-card" style={{ marginTop: 16, display: 'grid', gap: 14, maxWidth: 720 }}>
        <div>
          <h3 className="rs-section-title">{t('urlTitle')}</h3>
          {url ? (
            <>
              <code
                className="mono"
                style={{
                  display: 'block',
                  wordBreak: 'break-all',
                  background: 'var(--slate2, #243629)',
                  border: '1px solid var(--slate3, #31473a)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12.5,
                }}
              >
                {url}
              </code>
              <div className="rs-actions" style={{ marginTop: 8 }}>
                <button className="rs-btn" onClick={copy}>
                  {copied ? t('copied') : t('copy')}
                </button>
              </div>
            </>
          ) : (
            <p className="rs-row-sub">{t('noSecret')}</p>
          )}
        </div>

        <div>
          <h3 className="rs-section-title">{t('howTitle')}</h3>
          <ol className="rs-row-sub" style={{ margin: '4px 0 0', paddingLeft: 18, display: 'grid', gap: 4 }}>
            <li>{t('step1')}</li>
            <li>
              {t('step2')}
              <span className="rs-chips" style={{ marginTop: 4 }}>
                {EVENTS.map((e) => (
                  <span key={e} className="rs-chip mono">
                    {e}
                  </span>
                ))}
              </span>
            </li>
            <li>{t('step3')}</li>
          </ol>
        </div>

        {error ? (
          <p role="status" className="rs-row-sub" style={{ color: 'var(--flare)' }}>
            {error}
          </p>
        ) : null}

        <div className="rs-actions">
          <button className="rs-btn" data-primary={secret ? undefined : 'true'} disabled={pending || demo} onClick={regen}>
            {secret ? t('regenerate') : t('generate')}
          </button>
          {secret ? <span className="rs-row-sub">{t('regenWarn')}</span> : null}
        </div>
      </div>
      ) : null}
    </>
  );
}

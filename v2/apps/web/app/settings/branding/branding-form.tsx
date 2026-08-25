'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

export function BrandingForm() {
  const t = useTranslations('branding');
  const [senderName, setSenderName] = useState('Élise Martin');
  const [replyTo, setReplyTo] = useState('elise@jay-reach.io');
  const [emailSig, setEmailSig] = useState('Élise Martin\nJay Reach\nelise@jay-reach.io');
  const [letterSig, setLetterSig] = useState('Élise');
  const [accent, setAccent] = useState('#c6ff3d');
  const [saved, setSaved] = useState(false);

  return (
    <>
      <p className="rs-eyebrow">{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p className="rs-lead">{t('lead')}</p>
      <p className="rs-row-sub" style={{ marginTop: -12, marginBottom: 16 }}>
        {t('note')}
      </p>

      <div className="rs-card" style={{ display: 'grid', gap: 4 }}>
        <label className="rs-label">
          {t('senderName')}
          <input className="rs-input" value={senderName} onChange={(e) => { setSenderName(e.target.value); setSaved(false); }} />
        </label>
        <label className="rs-label">
          {t('replyTo')}
          <input className="rs-input" type="email" value={replyTo} onChange={(e) => { setReplyTo(e.target.value); setSaved(false); }} />
        </label>
        <label className="rs-label">
          {t('emailSignature')}
          <textarea className="rs-textarea" value={emailSig} onChange={(e) => { setEmailSig(e.target.value); setSaved(false); }} />
        </label>
        <label className="rs-label">
          {t('letterSignature')}
          <input className="rs-input" value={letterSig} onChange={(e) => { setLetterSig(e.target.value); setSaved(false); }} />
        </label>

        <div className="rs-label">
          {t('accent')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <input
              type="color"
              value={accent}
              onChange={(e) => { setAccent(e.target.value); setSaved(false); }}
              style={{ width: 40, height: 30, background: 'none', border: '1px solid var(--slate2)', borderRadius: 6, padding: 0 }}
              aria-label={t('accent')}
            />
            <span className="mono rs-row-sub">{accent}</span>
          </div>
        </div>

        <div className="rs-label">
          {t('logo')}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <button className="rs-btn" type="button">{t('upload')}</button>
            <span className="rs-row-sub">{t('logoHint')}</span>
          </div>
        </div>

        <div className="rs-actions">
          <button className="rs-btn" data-primary="true" onClick={() => setSaved(true)}>
            {t('save')}
          </button>
          {saved ? (
            <span role="status" className="rs-row-sub" style={{ color: 'var(--lime2)', alignSelf: 'center' }}>
              {t('note')}
            </span>
          ) : null}
        </div>
      </div>
    </>
  );
}

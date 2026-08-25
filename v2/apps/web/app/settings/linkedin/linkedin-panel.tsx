'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { generateExtensionToken, saveLinkedInSettings, type LinkedInMode } from '../../actions/linkedin';
import { Icon } from '../../icons';

type Stats = { pending: number; sent7d: number; today: number };
type Alert = { level: 'danger' | 'warn'; key: string; params?: Record<string, number> };

const MODES: LinkedInMode[] = ['auto', 'hybrid', 'manual'];

export function LinkedInPanel(props: {
  orgId: string;
  mode: LinkedInMode;
  dailyCap: number;
  stats: Stats;
  alerts: Alert[];
}) {
  const t = useTranslations();
  const [mode, setMode] = useState<LinkedInMode>(props.mode);
  const [cap, setCap] = useState<number>(props.dailyCap);
  const [savePending, startSave] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [connectPending, startConnect] = useTransition();
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [extPresent, setExtPresent] = useState(false);
  const [connected, setConnected] = useState(false);
  const savedTokenRef = useRef<string | null>(null);

  // Détecte l'extension et confirme l'enregistrement du jeton (postMessage).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { type?: string; success?: boolean };
      if (data?.type === 'JAY_REACH_EXTENSION_PRESENT') setExtPresent(true);
      if (data?.type === 'JAY_REACH_LINKEDIN_TOKEN_SAVED' && data.success) {
        setConnected(true);
        setConnectMsg(t('linkedin.connect.connected'));
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [t]);

  function onSave() {
    setSavedMsg(null);
    startSave(async () => {
      const res = await saveLinkedInSettings(props.orgId, mode, cap);
      setSavedMsg(res.ok ? t('linkedin.cursor.saved') : res.error);
    });
  }

  function onConnect() {
    setConnectMsg(null);
    startConnect(async () => {
      const res = await generateExtensionToken(props.orgId);
      if (!res.ok) {
        setConnectMsg(res.error);
        return;
      }
      savedTokenRef.current = res.token;
      // Transmet le jeton à l'extension (le content script le stocke).
      window.postMessage({ type: 'JAY_REACH_LINKEDIN_TOKEN', token: res.token }, window.location.origin);
      if (!extPresent) {
        setConnectMsg(t('linkedin.connect.notDetected'));
      }
    });
  }

  const rules: { key: string; label: string }[] = [
    { key: 'window', label: t('linkedin.rules.window') },
    { key: 'weekly', label: t('linkedin.rules.weekly') },
    { key: 'interval', label: t('linkedin.rules.interval') },
    { key: 'pause', label: t('linkedin.rules.pause') },
    { key: 'single', label: t('linkedin.rules.single') },
  ];

  return (
    <div className="rs-lk">
      {/* Alertes */}
      {props.alerts.length > 0 ? (
        <section className="rs-lk-alerts">
          {props.alerts.map((a) => (
            <div key={a.key} className="rs-lk-alert" data-level={a.level}>
              <span className="rs-lk-alert-dot" aria-hidden="true" />
              <span>{t(`linkedin.alerts.${a.key}`, a.params ?? {})}</span>
            </div>
          ))}
        </section>
      ) : null}

      {/* Activité */}
      <section className="rs-lk-stats">
        <div className="rs-lk-stat">
          <span className="rs-lk-statnum mono">{props.stats.pending}</span>
          <span className="rs-lk-statlbl">{t('linkedin.stats.pending')}</span>
        </div>
        <div className="rs-lk-stat">
          <span className="rs-lk-statnum mono">{props.stats.sent7d}</span>
          <span className="rs-lk-statlbl">{t('linkedin.stats.sent7d')}</span>
        </div>
        <div className="rs-lk-stat">
          <span className="rs-lk-statnum mono">{props.stats.today}</span>
          <span className="rs-lk-statlbl">{t('linkedin.stats.today')}</span>
        </div>
      </section>

      {/* Curseur : mode + volume */}
      <section className="rs-card">
        <h2 className="rs-card-title">{t('linkedin.cursor.title')}</h2>
        <div className="rs-lk-modes">
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              className="rs-lk-mode"
              data-active={mode === m ? 'true' : undefined}
              onClick={() => setMode(m)}
            >
              <span className="rs-lk-mode-name">{t(`linkedin.cursor.${m}`)}</span>
              <span className="rs-lk-mode-hint">{t(`linkedin.cursor.${m}Hint`)}</span>
            </button>
          ))}
        </div>

        <div className="rs-lk-volume">
          <div className="rs-lk-volume-head">
            <span>{t('linkedin.cursor.volume')}</span>
            <span className="mono rs-lk-volume-val">{t('linkedin.cursor.perDay', { count: cap })}</span>
          </div>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={cap}
            disabled={mode === 'manual'}
            onChange={(e) => setCap(Number(e.target.value))}
            className="rs-lk-slider"
          />
        </div>

        <div className="rs-lk-actions">
          <button type="button" className="rs-btn" data-primary="true" onClick={onSave} disabled={savePending}>
            {t('linkedin.cursor.save')}
          </button>
          {savedMsg ? <span className="rs-lk-msg">{savedMsg}</span> : null}
        </div>
      </section>

      {/* Installer + connecter l'extension */}
      <section className="rs-card">
        <h2 className="rs-card-title">{t('linkedin.connect.title')}</h2>
        <p className="rs-lk-intro">{t('linkedin.connect.intro')}</p>
        <a className="rs-btn rs-lk-download" href="/jay-reach-linkedin-extension.zip" download>
          <Icon name="linkedin" width={16} height={16} aria-hidden="true" />
          {t('linkedin.connect.download')}
        </a>
        <ol className="rs-lk-steps rs-lk-steps-num">
          <li>{t('linkedin.connect.step1')}</li>
          <li>{t('linkedin.connect.step2')}</li>
          <li>{t('linkedin.connect.step3')}</li>
          <li>{t('linkedin.connect.step4')}</li>
          <li>{t('linkedin.connect.step5')}</li>
        </ol>
        <div className="rs-lk-actions">
          <button type="button" className="rs-btn" data-primary="true" onClick={onConnect} disabled={connectPending}>
            {connected ? t('linkedin.connect.regenerate') : t('linkedin.connect.button')}
          </button>
          <span className="rs-lk-msg" data-ok={connected ? 'true' : undefined}>
            {connectMsg ?? (extPresent ? t('linkedin.connect.connected') : t('linkedin.connect.notDetected'))}
          </span>
        </div>
      </section>

      {/* Règles d'envoi */}
      <section className="rs-card">
        <h2 className="rs-card-title">{t('linkedin.rules.title')}</h2>
        <ul className="rs-lk-rules">
          {rules.map((r) => (
            <li key={r.key}>{r.label}</li>
          ))}
        </ul>
        <p className="rs-lk-cgu">{t('linkedin.rules.cgu')}</p>
      </section>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { generateExtensionToken, saveLinkedInSettings } from '../../actions/linkedin';

type Stats = { pending: number; sent7d: number; today: number };
type Alert = { level: 'danger' | 'warn'; key: string; params?: Record<string, number> };

/** Jours au sens ISO : 1 = lundi ... 7 = dimanche. */
const JOURS = [1, 2, 3, 4, 5, 6, 7] as const;

/**
 * Fuseaux proposés. Volontairement court : ce sont ceux où un opérateur
 * francophone travaille. Une liste exhaustive de quatre cents entrées se
 * parcourt moins vite qu'elle ne se saisit.
 */
const FUSEAUX = ['Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal'] as const;

/**
 * Version du paquet que cette application attend.
 *
 * Le manifeste a changé le 31/08/2026 sans que son numéro bouge : impossible
 * alors de distinguer le paquet corrigé de celui qui portait le bug, et un
 * opérateur qui rechargeait son ancien dossier décompressé rechargeait le
 * défaut. À faire évoluer avec `apps/extension/manifest.json`.
 */
const VERSION_ATTENDUE = '0.2.0';

/**
 * L'installation de l'extension, en trois états.
 *
 * L'ancien parcours demandait de télécharger un zip, de le décompresser, puis
 * d'activer le mode développeur de Chrome : personne en dehors d'un développeur
 * n'allait au bout. Le parcours cible passe par le Chrome Web Store.
 *
 * Tant que l'extension n'y est pas publiée, `NEXT_PUBLIC_EXTENSION_STORE_URL`
 * est absente et l'écran le dit, avec l'installation manuelle repliée en
 * secours. Afficher un bouton « Installer » qui ne mène nulle part serait pire
 * que la procédure qu'on remplace.
 */
type EtatExtension = 'absente' | 'installee' | 'connectee';

export function LinkedInPanel(props: {
  orgId: string;
  weeklyCap: number;
  sendDays: number[];
  sendFromHour: number;
  sendToHour: number;
  timezone: string;
  stats: Stats;
  alerts: Alert[];
  alreadyConnected: boolean;
  /** Profil LinkedIn remonté par l'extension, s'il est connu. */
  profileName: string | null;
  /** URL du Chrome Web Store, quand l'extension y est publiée. */
  storeUrl: string | null;
}) {
  const t = useTranslations();

  const [weeklyCap, setWeeklyCap] = useState(props.weeklyCap);
  const [sendDays, setSendDays] = useState<number[]>(props.sendDays);
  const [fromHour, setFromHour] = useState(props.sendFromHour);
  const [toHour, setToHour] = useState(props.sendToHour);
  const [timezone, setTimezone] = useState(props.timezone);
  const [savePending, startSave] = useTransition();
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [connectPending, startConnect] = useTransition();
  const [connectMsg, setConnectMsg] = useState<string | null>(null);
  const [extPresent, setExtPresent] = useState(false);
  const [versionExt, setVersionExt] = useState<string | null>(null);
  const [connected, setConnected] = useState(props.alreadyConnected);
  const [profil, setProfil] = useState<string | null>(props.profileName);
  // `onConnect` lit cette valeur depuis une closure, qui ne verrait jamais une
  // mise à jour de state postérieure à son rendu.
  const confirmedRef = useRef(false);

  const etat: EtatExtension = connected ? 'connectee' : extPresent ? 'installee' : 'absente';

  // Le manifeste de l'extension ne connaît que trois origines. Sur une autre —
  // typiquement l'URL d'un déploiement Vercel, reconnaissable à l'identifiant
  // qui suit le nom du projet — son script ne s'injecte pas et rien ne
  // fonctionnera, quoi qu'on clique.
  const [adresseInattendue, setAdresseInattendue] = useState(false);
  useEffect(() => {
    const hote = window.location.hostname;
    const connue = hote === 'localhost' || hote === 'app.jay-reach.fr' || hote === 'jay-reach.vercel.app';
    setAdresseInattendue(!connue);
  }, []);

  const ping = useCallback(() => {
    window.postMessage({ type: 'JAY_REACH_EXTENSION_PING' }, window.location.origin);
  }, []);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window) return;
      const data = event.data as { type?: string; success?: boolean; name?: string; version?: string };
      if (data?.type === 'JAY_REACH_EXTENSION_PRESENT') {
        setExtPresent(true);
        // Une version absente signe un paquet antérieur à l'annonce de version,
        // donc forcément périmé.
        setVersionExt(typeof data.version === 'string' ? data.version : 'ancienne');
      }
      if (data?.type === 'JAY_REACH_LINKEDIN_PROFILE' && data.name) setProfil(data.name);
      if (data?.type === 'JAY_REACH_LINKEDIN_TOKEN_SAVED' && data.success) {
        confirmedRef.current = true;
        setConnected(true);
        setConnectMsg(null);
      }
    }
    window.addEventListener('message', onMessage);
    // Le content script annonce sa présence à `document_start`, avant que cet
    // écouteur existe : son annonce spontanée arrive toujours trop tôt.
    ping();
    // Puis on redemande périodiquement, pour que l'écran bascule tout seul
    // quand l'extension vient d'être installée — sans avoir à rafraîchir.
    const timer = window.setInterval(ping, 2000);
    return () => {
      window.removeEventListener('message', onMessage);
      window.clearInterval(timer);
    };
  }, [ping]);

  function onSave() {
    setSavedMsg(null);
    setSaveError(null);
    startSave(async () => {
      const res = await saveLinkedInSettings(props.orgId, {
        weeklyCap,
        sendDays,
        sendFromHour: fromHour,
        sendToHour: toHour,
        timezone,
      });
      if (res.ok) setSavedMsg(t('linkedin.sending.saved'));
      else setSaveError(res.error);
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
      confirmedRef.current = false;
      window.postMessage({ type: 'JAY_REACH_LINKEDIN_TOKEN', token: res.token }, window.location.origin);
      // On conclut sur la confirmation du content script : `extPresent` vaut ce
      // que vaut une annonce qui a pu se perdre.
      await new Promise((resolve) => setTimeout(resolve, 1200));
      if (!confirmedRef.current) {
        // La cause la plus fréquente n'est pas une extension absente mais une
        // adresse inattendue : le script ne s'injecte que sur les domaines
        // listés dans son manifeste, et Chrome n'accepte pas de joker au milieu
        // d'un nom d'hôte. Une URL de déploiement Vercel — celle qui porte un
        // identifiant après le nom du projet — ne réveille donc jamais
        // l'extension, et l'écran ne pouvait que répéter qu'elle ne répond pas.
        setConnectMsg(adresseInattendue ? t('linkedin.connect.wrongOrigin') : t('linkedin.connect.notDetected'));
      }
    });
  }

  const basculerJour = (jour: number) =>
    setSendDays((d) => (d.includes(jour) ? d.filter((x) => x !== jour) : [...d, jour].sort()));

  return (
    <div className="rs-lk">
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

      {/* ---------------------------------------------- L'extension, en trois états */}
      <section className="rs-card">
        <h2 className="rs-card-title">{t('linkedin.connect.title')}</h2>

        {versionExt !== null && versionExt !== VERSION_ATTENDUE ? (
          <div className="rs-lk-alert" data-level="warn" style={{ marginBottom: 12 }}>
            <span className="rs-lk-alert-dot" aria-hidden="true" />
            <span>{t('linkedin.connect.staleVersion', { installee: versionExt, attendue: VERSION_ATTENDUE })}</span>
          </div>
        ) : null}

        {adresseInattendue ? (
          <div className="rs-lk-alert" data-level="warn" style={{ marginBottom: 12 }}>
            <span className="rs-lk-alert-dot" aria-hidden="true" />
            <span>{t('linkedin.connect.wrongOrigin')}</span>
          </div>
        ) : null}

        <div className="rs-lk-state" data-state={etat}>
          <span className="rs-lk-state-dot" aria-hidden="true" />
          <span>
            {etat === 'connectee'
              ? profil
                ? t('linkedin.connect.stateConnectedTo', { profile: profil })
                : t('linkedin.connect.stateConnected')
              : etat === 'installee'
                ? t('linkedin.connect.stateInstalled')
                : t('linkedin.connect.stateMissing')}
          </span>
        </div>

        {etat === 'absente' ? (
          props.storeUrl ? (
            <div className="rs-lk-actions">
              <a className="rs-btn" data-primary="true" href={props.storeUrl} target="_blank" rel="noreferrer">
                {t('linkedin.connect.install')}
              </a>
              <span className="rs-lk-msg">{t('linkedin.connect.installHint')}</span>
            </div>
          ) : (
            <>
              <p className="rs-lk-intro">{t('linkedin.connect.notPublished')}</p>
              <details className="rs-lk-fallback">
                <summary>{t('linkedin.connect.manualTitle')}</summary>
                <ol className="rs-lk-steps rs-lk-steps-num">
                  <li>{t('linkedin.connect.step1')}</li>
                  <li>{t('linkedin.connect.step2')}</li>
                  <li>{t('linkedin.connect.step3')}</li>
                  <li>{t('linkedin.connect.step4')}</li>
                </ol>
                <a className="rs-btn" href="/jay-reach-linkedin-extension.zip" download>
                  {t('linkedin.connect.download')}
                </a>
              </details>
            </>
          )
        ) : (
          <div className="rs-lk-actions">
            <button
              type="button"
              className="rs-btn"
              data-primary={etat === 'installee' ? 'true' : undefined}
              onClick={onConnect}
              disabled={connectPending}
            >
              {etat === 'connectee' ? t('linkedin.connect.regenerate') : t('linkedin.connect.button')}
            </button>
            {connectMsg ? (
              <span role="alert" className="rs-lk-msg">
                {connectMsg}
              </span>
            ) : null}
          </div>
        )}

        {/* Le paquet reste téléchargeable en permanence.
            Il ne s'affichait que dans l'état « absente », si bien qu'un écran
            qui se croyait connecté retirait le seul moyen de récupérer
            l'extension. Alexandre s'est retrouvé exactement là le 01/09/2026 :
            extension supprimée de Chrome pour la réinstaller, écran affirmant
            « connectée » à cause du jeton d'un collègue, et plus aucun bouton
            de téléchargement.
            Le cas n'a d'ailleurs rien d'exceptionnel : mettre à jour son
            extension demande de retélécharger, et on ne le fait précisément
            que lorsqu'on est déjà connecté. */}
        {!props.storeUrl && etat !== 'absente' ? (
          <details className="rs-lk-fallback" style={{ marginTop: 12 }}>
            <summary>{t('linkedin.connect.reinstall')}</summary>
            <ol className="rs-lk-steps rs-lk-steps-num">
              <li>{t('linkedin.connect.step1')}</li>
              <li>{t('linkedin.connect.step2')}</li>
              <li>{t('linkedin.connect.step3')}</li>
              <li>{t('linkedin.connect.step4')}</li>
            </ol>
            <a className="rs-btn" href="/jay-reach-linkedin-extension.zip" download>
              {t('linkedin.connect.download')}
            </a>
          </details>
        ) : null}
      </section>

      {/* ---------------------------------------------- Réglages d'envoi */}
      <section className="rs-card">
        <h2 className="rs-card-title">{t('linkedin.sending.title')}</h2>
        <p className="rs-lk-intro">{t('linkedin.sending.help')}</p>

        <label className="rs-label">
          {t('linkedin.sending.weekly')}
          <span className="rs-lk-volume-head">
            <span className="mono rs-lk-volume-val">{t('linkedin.sending.perWeek', { count: weeklyCap })}</span>
          </span>
          <input
            className="rs-lk-slider"
            type="range"
            min={0}
            max={200}
            step={5}
            value={weeklyCap}
            onChange={(e) => setWeeklyCap(Number(e.target.value))}
          />
        </label>

        <div className="rs-label">
          {t('linkedin.sending.days')}
          <div className="rs-lk-days">
            {JOURS.map((j) => (
              <button
                key={j}
                type="button"
                className="rs-lk-day"
                data-active={sendDays.includes(j) ? 'true' : undefined}
                aria-pressed={sendDays.includes(j)}
                onClick={() => basculerJour(j)}
              >
                {t(`linkedin.sending.day.${j}`)}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="rs-label">
            {t('linkedin.sending.from')}
            <select className="rs-input mono" value={fromHour} onChange={(e) => setFromHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
          <label className="rs-label">
            {t('linkedin.sending.to')}
            <select className="rs-input mono" value={toHour} onChange={(e) => setToHour(Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map((h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, '0')}:00
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="rs-label">
          {t('linkedin.sending.timezone')}
          <select className="rs-input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {FUSEAUX.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </label>

        <div className="rs-lk-actions">
          <button
            type="button"
            className="rs-btn"
            data-primary={etat === 'connectee' ? 'true' : undefined}
            onClick={onSave}
            disabled={savePending}
          >
            {t('linkedin.sending.save')}
          </button>
          {savedMsg ? (
            <span role="status" className="rs-lk-msg" data-ok="true">
              {savedMsg}
            </span>
          ) : null}
          {saveError ? (
            <span role="alert" className="rs-lk-msg">
              {saveError}
            </span>
          ) : null}
        </div>
      </section>
    </div>
  );
}

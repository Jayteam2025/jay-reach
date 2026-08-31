'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { STANDARD_VARIABLES, type CampaignNature } from '@jay-reach/core';
import { saveStepMessage, promoteStepMessage } from '../../actions/step-message';

/**
 * Écriture du message directement dans l'étape (retours 9.1, 9.3 et 9.4).
 *
 * La modale ne savait que relier un message écrit ailleurs, et renvoyait vers
 * la bibliothèque : c'est ce qui rendait la page Messages incompréhensible.
 * On écrit donc ici, sans sortir de la campagne — et le sélecteur de modèle
 * reste à côté, parce qu'il est utile quand on a déjà un message qui marche.
 */
export function StepMessageEditor({
  orgId,
  campaignId,
  channel,
  nature,
  locale,
  templateParentId,
  initialSubject,
  initialBody,
  onSaved,
}: {
  orgId: string;
  campaignId: string;
  channel: 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';
  nature: CampaignNature;
  locale: string;
  templateParentId: string | null;
  initialSubject: string;
  initialBody: string;
  onSaved: (templateParentId: string) => void;
}) {
  const t = useTranslations('campaigns.stepEd');
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nomModele, setNomModele] = useState('');
  const [versement, setVersement] = useState(false);
  const zone = useRef<HTMLTextAreaElement>(null);

  // 9.4 : les variables disponibles dépendent de la nature de la campagne — une
  // campagne alimentée par une liste n'a pas de signal daté à citer.
  const variables = Object.entries(STANDARD_VARIABLES)
    .filter(([, dispo]) => dispo === 'always' || dispo === nature)
    .map(([nom]) => nom);

  /** Insère la variable à l'endroit du curseur, pas à la fin du texte. */
  function inserer(nom: string) {
    const el = zone.current;
    const jeton = `{{${nom}}}`;
    if (!el) {
      setBody((b) => b + jeton);
      return;
    }
    const debut = el.selectionStart ?? body.length;
    const fin = el.selectionEnd ?? body.length;
    const suivant = body.slice(0, debut) + jeton + body.slice(fin);
    setBody(suivant);
    // Replace le curseur après le jeton, sinon la frappe suivante repart du
    // début et l'insertion devient inutilisable au-delà du premier clic.
    requestAnimationFrame(() => {
      el.focus();
      const p = debut + jeton.length;
      el.setSelectionRange(p, p);
    });
  }

  function enregistrer() {
    setMessage(null);
    setErreur(null);
    startTransition(async () => {
      const res = await saveStepMessage(orgId, campaignId, {
        subject,
        body,
        channel,
        locale,
        nature,
        templateParentId,
      });
      if (res.ok) {
        setMessage(t('messageSaved'));
        onSaved(res.templateParentId);
      } else {
        setErreur(res.error);
      }
    });
  }

  function verser() {
    if (!templateParentId) return;
    setErreur(null);
    startTransition(async () => {
      const res = await promoteStepMessage(orgId, campaignId, templateParentId, nomModele);
      if (res.ok) {
        setVersement(false);
        setMessage(t('promoted'));
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div className="rs-step-msg">
      {channel === 'email' ? (
        <label className="rs-label">
          {t('subject')}
          <input className="rs-input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('subjectPlaceholder')} />
        </label>
      ) : null}

      <label className="rs-label">
        {t('body')}
        <textarea
          ref={zone}
          className="rs-textarea"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('bodyPlaceholder')}
        />
      </label>

      <div className="rs-label">
        {t('variables')}
        <p className="rs-row-sub" style={{ marginTop: 2, marginBottom: 6 }}>
          {t('variablesHelp')}
        </p>
        <div className="rs-var-list">
          {variables.map((v) => (
            <button key={v} type="button" className="rs-var" onClick={() => inserer(v)} title={t('insert')}>
              <span className="mono">{`{{${v}}}`}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="rs-actions">
        <button type="button" className="rs-btn" data-primary="true" onClick={enregistrer} disabled={pending}>
          {t('saveMessage')}
        </button>
        {templateParentId && !versement ? (
          <button type="button" className="rs-btn" onClick={() => setVersement(true)} disabled={pending}>
            {t('promote')}
          </button>
        ) : null}
        {message ? (
          <span role="status" className="rs-row-sub" style={{ alignSelf: 'center', color: 'var(--lime2)' }}>
            {message}
          </span>
        ) : null}
        {erreur ? (
          <span role="alert" className="rs-row-sub" style={{ alignSelf: 'center', color: 'var(--flare)' }}>
            {erreur}
          </span>
        ) : null}
      </div>

      {versement ? (
        <div className="rs-label" style={{ marginTop: 8 }}>
          {t('promoteName')}
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <input className="rs-input" value={nomModele} onChange={(e) => setNomModele(e.target.value)} placeholder={t('promoteNamePlaceholder')} />
            <button type="button" className="rs-btn" onClick={verser} disabled={pending || !nomModele.trim()}>
              {t('promoteConfirm')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

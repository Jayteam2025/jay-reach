'use client';

import { useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { STANDARD_VARIABLES, type CampaignNature } from '@jay-reach/core';
import { saveStepMessage, promoteStepMessage } from '../../actions/step-message';
import { generateStepMessage } from '../../actions/generate-message';

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
  estPremiereEtape,
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
  /** Un premier message ne se rédige pas comme une relance. */
  estPremiereEtape: boolean;
  onSaved: (templateParentId: string) => void;
}) {
  const t = useTranslations('campaigns.stepEd');
  /**
   * Une invitation LinkedIn part sans note : l'extension n'envoie que le profil
   * à inviter, jamais de texte. Écrire un message pour cette étape n'aurait
   * donc aucun effet — on ne le propose pas.
   */
  const sansMessage = channel === 'linkedin_invite';
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [nomModele, setNomModele] = useState('');
  const [versement, setVersement] = useState(false);
  const zone = useRef<HTMLTextAreaElement>(null);
  const [consigne, setConsigne] = useState('');
  const [propositions, setPropositions] = useState<{ subject: string | null; body: string }[]>([]);
  const [generation, setGeneration] = useState(false);

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

  /**
   * Premier jet proposé par le modèle. Rien n'est envoyé et rien n'est
   * enregistré : les propositions atterrissent dans le champ, où elles se
   * relisent et se modifient comme un texte écrit à la main.
   */
  function proposer() {
    setGeneration(true);
    setErreur(null);
    setPropositions([]);
    startTransition(async () => {
      const res = await generateStepMessage(orgId, campaignId, {
        channel,
        nature,
        estPremiereEtape,
        consigne,
      });
      setGeneration(false);
      if (res.ok) setPropositions(res.variantes);
      else setErreur(res.error);
    });
  }

  function retenir(v: { subject: string | null; body: string }) {
    if (v.subject) setSubject(v.subject);
    setBody(v.body);
    setPropositions([]);
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

  if (sansMessage) {
    return (
      <div className="rs-step-msg">
        <p className="rs-row-sub">{t('inviteNoMessage')}</p>
      </div>
    );
  }

  return (
    <div className="rs-step-msg">
      {/* Premier jet : une aide au démarrage, jamais un envoi. Le texte proposé
          se relit et se modifie comme n'importe quel autre. */}
      <div className="rs-gen">
        <div className="rs-gen-head">
          <input
            className="rs-input"
            value={consigne}
            onChange={(e) => setConsigne(e.target.value)}
            placeholder={t('generateHint')}
          />
          <button type="button" className="rs-btn" onClick={proposer} disabled={pending}>
            {generation ? t('generating') : t('generate')}
          </button>
        </div>
        {propositions.length > 0 ? (
          <div className="rs-gen-list">
            {propositions.map((v, i) => (
              <button key={i} type="button" className="rs-gen-item" onClick={() => retenir(v)}>
                {v.subject ? <span className="rs-gen-subject">{v.subject}</span> : null}
                <span className="rs-gen-body">{v.body}</span>
                <span className="rs-row-sub">{t('useThis')}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

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

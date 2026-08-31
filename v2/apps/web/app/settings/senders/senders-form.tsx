'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { updateSender } from '../../actions/senders';

export type SenderKind = 'email' | 'linkedin' | 'postal';

export interface SenderRow {
  readonly id: string;
  readonly kind: SenderKind;
  readonly identity: string;
  readonly display_name: string | null;
  readonly daily_quota: number | null;
  readonly hourly_quota: number | null;
  readonly is_active: boolean;
}

/** `''` vaut « aucun plafond » ; toute autre saisie est un entier. */
function versNombre(valeur: string): number | null {
  const net = valeur.trim();
  return net === '' ? null : Number(net);
}

function CarteExpediteur({
  sender,
  orgId,
  demo,
}: {
  sender: SenderRow;
  orgId: string;
  demo: boolean;
}) {
  const t = useTranslations('senders');
  const [nom, setNom] = useState(sender.display_name ?? '');
  const [quotidien, setQuotidien] = useState(sender.daily_quota?.toString() ?? '');
  const [horaire, setHoraire] = useState(sender.hourly_quota?.toString() ?? '');
  const [actif, setActif] = useState(sender.is_active);
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'enregistre'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);

  const modifie =
    nom !== (sender.display_name ?? '') ||
    quotidien !== (sender.daily_quota?.toString() ?? '') ||
    horaire !== (sender.hourly_quota?.toString() ?? '') ||
    actif !== sender.is_active;

  function touche<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setEtat('repos');
      setErreur(null);
    };
  }

  async function enregistrer() {
    setEtat('envoi');
    setErreur(null);
    const res = await updateSender(orgId, sender.id, {
      displayName: nom,
      dailyQuota: versNombre(quotidien),
      hourlyQuota: versNombre(horaire),
      isActive: actif,
    });
    if (res.ok) {
      setEtat('enregistre');
    } else {
      setEtat('repos');
      setErreur(res.error);
    }
  }

  return (
    <div className="rs-card" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
        <span className="rs-eyebrow" style={{ margin: 0 }}>
          {t(`kind.${sender.kind}`)}
        </span>
        <span className="mono rs-row-sub" style={{ overflowWrap: 'anywhere' }}>
          {sender.identity}
        </span>
      </div>

      <label className="rs-label">
        {t('displayName')}
        <input
          className="rs-input"
          value={nom}
          placeholder={t('displayNamePlaceholder')}
          onChange={(e) => touche(setNom)(e.target.value)}
        />
      </label>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <label className="rs-label">
          {t('dailyQuota')}
          <input
            className="rs-input mono"
            type="number"
            min={0}
            inputMode="numeric"
            value={quotidien}
            placeholder={t('noLimit')}
            onChange={(e) => touche(setQuotidien)(e.target.value)}
          />
        </label>
        <label className="rs-label">
          {t('hourlyQuota')}
          <input
            className="rs-input mono"
            type="number"
            min={0}
            inputMode="numeric"
            value={horaire}
            placeholder={t('noLimit')}
            onChange={(e) => touche(setHoraire)(e.target.value)}
          />
        </label>
      </div>

      <label className="rs-check">
        <input type="checkbox" checked={actif} onChange={(e) => touche(setActif)(e.target.checked)} />
        {t('active')}
      </label>

      <div className="rs-actions">
        <button className="rs-btn" type="button" disabled={demo || !modifie || etat === 'envoi'} onClick={enregistrer}>
          {etat === 'envoi' ? t('saving') : t('save')}
        </button>
        {etat === 'enregistre' ? (
          <span role="status" className="rs-row-sub" style={{ color: 'var(--lime2)', alignSelf: 'center' }}>
            {t('saved')}
          </span>
        ) : null}
        {erreur ? (
          <span role="alert" className="rs-row-sub" style={{ color: 'var(--flare)', alignSelf: 'center' }}>
            {erreur}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export function SendersForm({
  senders,
  orgId,
  demo,
}: {
  senders: readonly SenderRow[];
  orgId: string;
  demo: boolean;
}) {
  const t = useTranslations('senders');

  return (
    <>
      <p className="rs-eyebrow">{t('eyebrow')}</p>
      <h1>{t('title')}</h1>
      <p className="rs-lead">{t('lead')}</p>

      {senders.length === 0 ? (
        <div className="rs-card">
          <p className="rs-row-sub" style={{ margin: 0 }}>
            {t('empty')}
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {senders.map((s) => (
            <CarteExpediteur key={s.id} sender={s} orgId={orgId} demo={demo} />
          ))}
        </div>
      )}
    </>
  );
}

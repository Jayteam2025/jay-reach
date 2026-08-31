'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { createSource, updateSource } from '../../actions/sources';
import { SOURCE_PROVIDERS, type SourceInput } from '../../../lib/sources';

export interface SourceFormValues {
  readonly id?: string;
  readonly name: string;
  readonly description: string;
  readonly providerIds: string[];
  readonly keywords: string[];
  readonly location: string;
  readonly scoringPrompt: string;
  readonly matchThreshold: number;
  readonly isActive: boolean;
}

const VIDE: SourceFormValues = {
  name: '',
  description: '',
  providerIds: ['francetravail'],
  keywords: [],
  location: '',
  scoringPrompt: '',
  matchThreshold: 60,
  isActive: true,
};

/**
 * Création et modification d'un thème de veille.
 *
 * Les mots-clés sont saisis une seule fois, au niveau du thème, et valent pour
 * tous les fournisseurs rattachés. C'est la raison d'être de cet écran : quand
 * chaque fournisseur portait ses propres mots-clés, deux connecteurs censés
 * couvrir la même veille finissaient par chercher des choses différentes sans
 * que rien ne le signale.
 *
 * La qualification est dans le même formulaire que la collecte, en seconde
 * section : le prompt et le seuil vivent dans `sources.config`, et un thème
 * sans prompt collecte sans jamais rien qualifier. Les séparer laisserait
 * l'opérateur devant un écran qui se remplit et un autre qui reste vide, sans
 * rien pour relier les deux.
 *
 * L'action n'est primaire (lime plein) qu'à la création : le design system
 * n'autorise qu'une action primaire par vue, et c'est celle-là.
 */
export function SourceForm(props: { orgId: string; initial?: SourceFormValues; onDone?: () => void }) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [values, setValues] = useState<SourceFormValues>(props.initial ?? VIDE);
  const creation = !values.id;

  const modifier = <K extends keyof SourceFormValues>(cle: K, valeur: SourceFormValues[K]) =>
    setValues((v) => ({ ...v, [cle]: valeur }));

  return (
    <form
      className="rs-prov-detail"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input: SourceInput = { ...values };
        startTransition(async () => {
          const res = values.id
            ? await updateSource(props.orgId, values.id, input)
            : await createSource(props.orgId, input);
          setMessage(res.ok ? t('sources.form.saved') : res.error);
          if (res.ok) {
            if (creation) {
              form.reset();
              setValues(VIDE);
            }
            router.refresh();
            props.onDone?.();
          }
        });
      }}
    >
      <label className="rs-label">
        {t('sources.form.name')}
        <input
          className="rs-input"
          value={values.name}
          onChange={(e) => modifier('name', e.target.value)}
          required
          placeholder={t('sources.form.namePlaceholder')}
        />
      </label>

      <label className="rs-label">
        {t('sources.form.description')}
        <input
          className="rs-input"
          value={values.description}
          onChange={(e) => modifier('description', e.target.value)}
          placeholder={t('sources.form.descriptionPlaceholder')}
        />
      </label>

      <div className="rs-label">
        {t('sources.form.providers')}
        <p className="rs-row-sub" style={{ marginTop: 2, marginBottom: 6 }}>
          {t('sources.form.providersHelp')}
        </p>
        <div style={{ display: 'grid', gap: 6 }}>
          {SOURCE_PROVIDERS.map((p) => (
            <label key={p} className="rs-check">
              <input
                type="checkbox"
                checked={values.providerIds.includes(p)}
                onChange={(e) =>
                  modifier(
                    'providerIds',
                    e.target.checked
                      ? [...values.providerIds, p]
                      : values.providerIds.filter((x) => x !== p),
                  )
                }
              />
              <span>{t(`providers.${p}`)}</span>
            </label>
          ))}
        </div>
      </div>

      <label className="rs-label">
        {t('sources.keywords')}
        <input
          className="rs-input"
          value={values.keywords.join(', ')}
          onChange={(e) => modifier('keywords', e.target.value.split(',').map((k) => k.trim()))}
          required
          placeholder={t('sources.form.keywordsPlaceholder')}
        />
      </label>

      <label className="rs-label">
        {t('sources.location')}
        <input
          className="rs-input"
          value={values.location}
          onChange={(e) => modifier('location', e.target.value)}
          placeholder={t('sources.form.locationPlaceholder')}
        />
      </label>

      <div className="rs-section-title" style={{ marginTop: 16 }}>
        {t('sources.form.qualification')}
      </div>
      <p className="rs-row-sub">{t('sources.form.qualificationHelp')}</p>

      <label className="rs-label">
        {t('sources.form.scoringPrompt')}
        <textarea
          className="rs-textarea"
          rows={4}
          value={values.scoringPrompt}
          onChange={(e) => modifier('scoringPrompt', e.target.value)}
          placeholder={t('sources.form.scoringPromptPlaceholder')}
        />
      </label>

      <label className="rs-label">
        {t('sources.form.threshold')}
        <span className="rs-lk-volume-head">
          {/* Le seuil est une mesure : mono, comme les scores qu'il départage. */}
          <span className="mono rs-lk-volume-val">{values.matchThreshold}</span>
        </span>
        <input
          className="rs-lk-slider"
          type="range"
          min={0}
          max={100}
          step={5}
          value={values.matchThreshold}
          onChange={(e) => modifier('matchThreshold', Number(e.target.value))}
        />
      </label>

      <label className="rs-check">
        <input
          type="checkbox"
          checked={values.isActive}
          onChange={(e) => modifier('isActive', e.target.checked)}
        />
        <span>{t('sources.form.active')}</span>
      </label>

      {values.providerIds.length === 0 ? (
        <p className="rs-row-sub" style={{ color: 'var(--flare)' }}>
          {t('sources.form.noProviderWarning')}
        </p>
      ) : null}

      <div className="rs-actions">
        <button
          className="rs-btn"
          {...(creation ? { 'data-primary': 'true' } : {})}
          type="submit"
          disabled={pending || !props.orgId}
        >
          {creation ? t('sources.form.create') : t('sources.form.save')}
        </button>
        {message ? (
          <span role="status" className="rs-row-sub" style={{ alignSelf: 'center' }}>
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

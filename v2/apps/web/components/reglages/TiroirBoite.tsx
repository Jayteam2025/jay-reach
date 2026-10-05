'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Boite } from '@jay-reach/core';
import { Bouton, Champ, Tiroir } from '../ui';
import { actionModifierBoite } from '../../app/actions/senders';

/** Même liste restreinte que `LinkedInPanel.tsx` : les fuseaux où un opérateur francophone travaille. */
const FUSEAUX = ['Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal'] as const;

/** Jours ISO : 1 = lundi ... 7 = dimanche. Abréviation traduite via `reglages.days.short.*` — jamais câblée en dur. */
const JOURS: { valeur: number; cle: string }[] = [
  { valeur: 1, cle: 'mon' },
  { valeur: 2, cle: 'tue' },
  { valeur: 3, cle: 'wed' },
  { valeur: 4, cle: 'thu' },
  { valeur: 5, cle: 'fri' },
  { valeur: 6, cle: 'sat' },
  { valeur: 7, cle: 'sun' },
];

const HEURES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const HEURES_FIN = [...HEURES.slice(1), '24:00'];

export interface TiroirBoiteProps {
  ouvert: boolean;
  boite: Boite;
  onFermer: () => void;
  /** Appelé après un enregistrement réussi — le parent ferme le tiroir et rafraîchit la page. */
  onEnregistre: () => void;
}

export function TiroirBoite({ ouvert, boite, onFermer, onEnregistre }: TiroirBoiteProps) {
  const t = useTranslations('reglages.expediteurs.drawer');
  const tJours = useTranslations('reglages.days.short');

  const [sansPlafondJour, setSansPlafondJour] = useState(boite.quotas.jour === null);
  const [quotaJour, setQuotaJour] = useState(boite.quotas.jour ?? 30);
  const [sansPlafondHeure, setSansPlafondHeure] = useState(boite.quotas.heure === null);
  const [quotaHeure, setQuotaHeure] = useState(boite.quotas.heure ?? 5);
  const [debut, setDebut] = useState(boite.heures.debut);
  const [fin, setFin] = useState(boite.heures.fin);
  const [jours, setJours] = useState<number[]>(boite.heures.jours);
  const [fuseau, setFuseau] = useState(boite.heures.fuseau);
  const [lectureDirecte, setLectureDirecte] = useState(boite.inboxProvider === 'microsoft_graph');
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  function basculerJour(jour: number) {
    setJours((precedent) =>
      precedent.includes(jour) ? precedent.filter((j) => j !== jour) : [...precedent, jour].sort((a, b) => a - b),
    );
  }

  async function enregistrer() {
    setErreur(null);
    setEnregistrement(true);
    try {
      const resultat = await actionModifierBoite({
        boiteId: boite.id,
        quotaJour: sansPlafondJour ? null : quotaJour,
        quotaHeure: sansPlafondHeure ? null : quotaHeure,
        heures: { debut, fin, jours, fuseau },
        active: boite.active,
        inboxProvider: lectureDirecte ? 'microsoft_graph' : null,
      });
      if (resultat.ok) {
        onEnregistre();
      } else {
        setErreur(resultat.error);
      }
    } finally {
      setEnregistrement(false);
    }
  }

  const pied = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
      <Bouton onClick={onFermer} disabled={enregistrement}>
        {t('cancel')}
      </Bouton>
      <Bouton variante="principal" onClick={enregistrer} aria-busy={enregistrement} disabled={enregistrement}>
        {enregistrement ? t('saving') : t('save')}
      </Bouton>
    </div>
  );

  return (
    <Tiroir
      ouvert={ouvert}
      titre={t('title', { identite: boite.nomAffiche ?? boite.identite })}
      onFermer={onFermer}
      libelleFermer={t('close')}
      pied={pied}
    >
      <div style={{ display: 'grid', gap: 14 }}>
        <Champ libelle={t('dailyQuota')} id="tiroir-boite-quota-jour">
          <input
            id="tiroir-boite-quota-jour"
            type="number"
            min={1}
            max={200}
            value={quotaJour}
            disabled={sansPlafondJour}
            onChange={(e) => setQuotaJour(Number(e.target.value))}
          />
        </Champ>
        <label>
          <input type="checkbox" checked={sansPlafondJour} onChange={(e) => setSansPlafondJour(e.target.checked)} />
          {' '}
          {t('noLimit')}
        </label>

        <Champ libelle={t('hourlyQuota')} id="tiroir-boite-quota-heure">
          <input
            id="tiroir-boite-quota-heure"
            type="number"
            min={1}
            max={50}
            value={quotaHeure}
            disabled={sansPlafondHeure}
            onChange={(e) => setQuotaHeure(Number(e.target.value))}
          />
        </Champ>
        <label>
          <input type="checkbox" checked={sansPlafondHeure} onChange={(e) => setSansPlafondHeure(e.target.checked)} />
          {' '}
          {t('noLimit')}
        </label>

        <Champ libelle={t('hoursFrom')} id="tiroir-boite-debut">
          <select id="tiroir-boite-debut" value={debut} onChange={(e) => setDebut(e.target.value)}>
            {HEURES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </Champ>
        <Champ libelle={t('hoursTo')} id="tiroir-boite-fin">
          <select id="tiroir-boite-fin" value={fin} onChange={(e) => setFin(e.target.value)}>
            {HEURES_FIN.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </Champ>

        <Champ libelle={t('days')}>
          <div style={{ display: 'flex', gap: 6 }}>
            {JOURS.map(({ valeur, cle }) => (
              <Bouton
                key={valeur}
                taille="petit"
                variante={jours.includes(valeur) ? 'principal' : undefined}
                aria-pressed={jours.includes(valeur)}
                onClick={() => basculerJour(valeur)}
              >
                {tJours(cle)}
              </Bouton>
            ))}
          </div>
        </Champ>

        <Champ libelle={t('timezone')} id="tiroir-boite-fuseau">
          <select id="tiroir-boite-fuseau" value={fuseau} onChange={(e) => setFuseau(e.target.value)}>
            {FUSEAUX.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </Champ>

        <label>
          <input type="checkbox" checked={lectureDirecte} onChange={(e) => setLectureDirecte(e.target.checked)} />
          {' '}
          {t('inboxProvider')}
        </label>
        <p className="jr-secondaire">{t('inboxProviderHint')}</p>

        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </div>
    </Tiroir>
  );
}

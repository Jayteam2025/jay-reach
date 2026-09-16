'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Boite } from '@jay-reach/core';
import { BarreProgression, Bouton, Carte, Interrupteur, Puce, TuileLogo } from '../ui';
import type { TuileLogoMarque } from '../ui';
import { actionModifierBoite } from '../../app/actions/senders';
import { libelleJoursEnvoi } from '../../lib/jours-envoi';
import { puceEtatBoite } from './boite-affichage';
import { TiroirBoite } from './TiroirBoite';

const MARQUE_TUILE: Record<Boite['marque'], TuileLogoMarque> = {
  outlook: 'outlook',
  gmail: 'gmail',
  autre: 'email',
};

export interface CarteBoiteProps {
  boite: Boite;
  /** Date de connexion déjà formatée côté serveur (fuseau de l'organisation) — jamais `new Date()` dans un composant client. */
  creeLeTexte: string;
  /** Heure de dernière relève déjà formatée côté serveur, ou `null` si jamais relevée. */
  derniereReleveTexte: string | null;
  /** `false` pour un rôle viewer/operator : l'interrupteur et « Modifier » se lisent, mais n'agissent pas. */
  peutModifier: boolean;
}

export function CarteBoite({ boite, creeLeTexte, derniereReleveTexte, peutModifier }: CarteBoiteProps) {
  const t = useTranslations('reglages.expediteurs');
  const tJours = useTranslations('reglages.days');
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const etat = puceEtatBoite(boite);

  async function basculerActif(nouveauActif: boolean) {
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await actionModifierBoite({
        boiteId: boite.id,
        quotaJour: boite.quotas.jour,
        quotaHeure: boite.quotas.heure,
        heures: boite.heures,
        active: nouveauActif,
        inboxProvider: boite.inboxProvider,
      });
      if (resultat.ok) router.refresh();
      else setErreur(resultat.error);
    } finally {
      setEnCours(false);
    }
  }

  const cadenceJour = boite.quotas.jour !== null ? t('box.perDay', { n: boite.quotas.jour }) : t('box.perDayNoLimit');
  const cadenceHeure = boite.quotas.heure !== null ? t('box.perHour', { n: boite.quotas.heure }) : t('box.perHourNoLimit');

  return (
    <Carte
      entete={
        <>
          <div className="jr-qui">
            <TuileLogo marque={MARQUE_TUILE[boite.marque]} taille="grande" />
            <span>
              <b style={{ fontSize: 16 }}>{boite.nomAffiche ?? boite.identite}</b>
              <small>{t('box.createdOn', { date: creeLeTexte })}</small>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Puce ton={etat.ton} point>
              {t(`box.${etat.cle}`)}
            </Puce>
            {peutModifier && (
              <>
                <Interrupteur
                  actif={boite.active}
                  onChange={basculerActif}
                  libelle={t(boite.active ? 'box.active' : 'box.inactive')}
                  disabled={enCours}
                />
                <Bouton taille="petit" onClick={() => setOuvert(true)}>
                  {t('box.edit')}
                </Bouton>
              </>
            )}
          </div>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 20 }}>
        <div>
          <span className="jr-libelle">{t('box.today')}</span>
          <b style={{ fontSize: 22 }}>
            {boite.usageDuJour} / {boite.quotas.jour ?? '∞'}
          </b>
          {boite.quotas.jour !== null && boite.quotas.jour > 0 && (
            <BarreProgression valeur={(boite.usageDuJour / boite.quotas.jour) * 100} />
          )}
        </div>
        <div>
          <span className="jr-libelle">{t('box.cadence')}</span>
          <div>
            {cadenceJour} · {cadenceHeure}
          </div>
        </div>
        <div>
          <span className="jr-libelle">{t('box.hours')}</span>
          <div>{t('box.hoursValue', { debut: boite.heures.debut, fin: boite.heures.fin, jours: libelleJoursEnvoi(boite.heures.jours, tJours) })}</div>
          <small className="jr-secondaire">{boite.heures.fuseau}</small>
        </div>
        <div>
          <span className="jr-libelle">{t('box.replies')}</span>
          {boite.derniereReleve === null ? (
            <div>
              <Puce ton="gris">{t('box.repliesNone')}</Puce>
            </div>
          ) : boite.derniereReleve.erreur ? (
            <div>
              <Puce ton="attention" point>
                {t('box.repliesError')}
              </Puce>
            </div>
          ) : (
            <>
              <div>
                <Puce ton="bon" point>
                  {t('box.repliesOk')}
                </Puce>
              </div>
              <small className="jr-secondaire">
                {derniereReleveTexte ? t('box.repliesLast', { heure: derniereReleveTexte }) : t('box.repliesNever')}
              </small>
            </>
          )}
        </div>
      </div>
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
      <TiroirBoite
        ouvert={ouvert}
        boite={boite}
        onFermer={() => setOuvert(false)}
        onEnregistre={() => {
          setOuvert(false);
          router.refresh();
        }}
      />
    </Carte>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { BoiteSalesBlinkDistante } from '@jay-reach/core';
import { Bouton, EtatVide, Tiroir } from '../ui';
import { actionBoitesSalesBlinkNonReliees, actionRelierBoite } from '../../app/actions/senders';

/**
 * Bouton « Relier une boîte » (section-entête « Boîtes email »). Charge la
 * liste des boîtes SalesBlink pas encore reliées SEULEMENT à l'ouverture du
 * tiroir — la page elle-même ne fait pas cet appel à chaque rendu.
 */
export function BoutonRelierBoite() {
  const t = useTranslations('reglages.expediteurs.linkDrawer');
  const tCommun = useTranslations('common');
  const [ouvert, setOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [distantes, setDistantes] = useState<BoiteSalesBlinkDistante[] | null>(null);
  const [enCoursId, setEnCoursId] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function ouvrir() {
    setOuvert(true);
    setErreur(null);
    setChargement(true);
    try {
      const resultat = await actionBoitesSalesBlinkNonReliees();
      if (resultat.ok) setDistantes(resultat.valeur);
      else setErreur(resultat.error);
    } finally {
      setChargement(false);
    }
  }

  async function relier(boite: BoiteSalesBlinkDistante) {
    setEnCoursId(boite.providerRef);
    setErreur(null);
    try {
      const resultat = await actionRelierBoite({ providerRef: boite.providerRef, identite: boite.email });
      if (resultat.ok) {
        setOuvert(false);
      } else {
        setErreur(resultat.error);
      }
    } finally {
      setEnCoursId(null);
    }
  }

  return (
    <>
      <Bouton variante="principal" onClick={ouvrir}>
        {t('title')}
      </Bouton>
      <Tiroir ouvert={ouvert} titre={t('title')} description={t('description')} onFermer={() => setOuvert(false)} libelleFermer={t('close')}>
        {chargement ? (
          <p className="jr-secondaire">{tCommun('loading')}</p>
        ) : distantes && distantes.length === 0 ? (
          <EtatVide titre={t('empty')} texte="" />
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {(distantes ?? []).map((boite) => (
              <div key={boite.providerRef} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <span>
                  <b>{boite.nom}</b>
                  <br />
                  <small className="jr-secondaire">{boite.email}</small>
                </span>
                <Bouton
                  taille="petit"
                  variante="principal"
                  disabled={enCoursId !== null}
                  aria-busy={enCoursId === boite.providerRef}
                  onClick={() => relier(boite)}
                >
                  {enCoursId === boite.providerRef ? t('linking') : t('link')}
                </Bouton>
              </div>
            ))}
          </div>
        )}
        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </Tiroir>
    </>
  );
}

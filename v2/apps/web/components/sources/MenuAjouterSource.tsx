'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { TypeSource } from '@jay-reach/core';
import { Bouton, Menu, TuileLogo } from '../ui';

export interface MenuAjouterSourceProps {
  campagneId: string;
}

/**
 * Bouton « + Ajouter une source » (maquette `campagne-sources.html`) qui ouvre
 * le menu en trois groupes du kit (`Menu`). Chaque entrée navigue vers
 * `?ajouter=<type>` — c'est ce paramètre que la page lit pour ouvrir le
 * tiroir de création correspondant (même convention que `?source=<id>` pour
 * modifier une source existante).
 */
export function MenuAjouterSource({ campagneId }: MenuAjouterSourceProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [ouvert, setOuvert] = useState(false);

  function ouvrirTiroir(type: TypeSource) {
    setOuvert(false);
    router.push(`/campaigns/${campagneId}/sources?ajouter=${type}`, { scroll: false });
  }

  return (
    <div className="jr-menu-ancre">
      <Bouton variante="sombre" onClick={() => setOuvert((v) => !v)}>
        {t('add')}
      </Bouton>
      {ouvert && (
        <>
          <button
            type="button"
            className="jr-menu-clic-exterieur"
            aria-label={t('add')}
            onClick={() => setOuvert(false)}
          />
          <Menu
            groupes={[
              {
                titre: t('menu.jobs'),
                entrees: [
                  {
                    icone: <TuileLogo marque="adzuna" />,
                    titre: t('menu.adzuna.title'),
                    description: t('menu.adzuna.description'),
                    onSelectionner: () => ouvrirTiroir('adzuna'),
                  },
                  {
                    icone: <TuileLogo marque="francetravail" />,
                    titre: t('menu.franceTravail.title'),
                    description: t('menu.franceTravail.description'),
                    onSelectionner: () => ouvrirTiroir('france_travail'),
                  },
                ],
              },
              {
                titre: t('menu.linkedin'),
                entrees: [
                  {
                    icone: <TuileLogo marque="linkedin" />,
                    titre: t('menu.linkedinPostEngagers.title'),
                    description: t('menu.linkedinPostEngagers.description'),
                    onSelectionner: () => ouvrirTiroir('linkedin_post_engagers'),
                  },
                  {
                    icone: <TuileLogo marque="linkedin" />,
                    titre: t('menu.linkedinCompetitorFollowers.title'),
                    description: t('menu.linkedinCompetitorFollowers.description'),
                    onSelectionner: () => ouvrirTiroir('linkedin_competitor_followers'),
                  },
                  {
                    icone: <TuileLogo marque="linkedin" />,
                    titre: t('menu.linkedinKeywords.title'),
                    description: t('menu.linkedinKeywords.description'),
                    onSelectionner: () => ouvrirTiroir('linkedin_keywords'),
                  },
                  {
                    icone: <TuileLogo marque="linkedin" />,
                    titre: t('menu.linkedinJobChange.title'),
                    description: t('menu.linkedinJobChange.description'),
                    onSelectionner: () => ouvrirTiroir('linkedin_job_change'),
                  },
                ],
              },
              {
                titre: t('menu.manual'),
                entrees: [
                  {
                    icone: <TuileLogo marque="lettre" lettre="↑" />,
                    titre: t('menu.csv.title'),
                    description: t('menu.csv.description'),
                    onSelectionner: () => ouvrirTiroir('csv'),
                  },
                  {
                    icone: <TuileLogo marque="lettre" lettre="≡" />,
                    titre: t('menu.list.title'),
                    description: t('menu.list.description'),
                    onSelectionner: () => ouvrirTiroir('list'),
                  },
                  {
                    icone: <TuileLogo marque="lettre" lettre="⌂" />,
                    titre: t('menu.directory.title'),
                    description: t('menu.directory.description'),
                    onSelectionner: () => ouvrirTiroir('directory'),
                  },
                ],
              },
            ]}
          />
        </>
      )}
    </div>
  );
}

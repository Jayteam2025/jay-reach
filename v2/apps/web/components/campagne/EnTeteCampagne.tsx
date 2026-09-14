import Link from 'next/link';
import type { ReactNode } from 'react';
import type { CampagneEnTete } from '@jay-reach/core';
import { Puce, TuileLogo } from '../ui';
import type { PuceTon } from '../ui';

/**
 * Textes déjà traduits, fournis par l'appelant (le layout de campagne, un
 * composant serveur avec `getTranslations`) — ce composant reste une
 * fonction pure, testable par `renderToStaticMarkup` sans contexte next-intl
 * (même convention que `Carte`/`EnTetePage` du kit : `titre`/`action` en
 * `ReactNode` déjà résolus).
 */
export interface EnTeteCampagneLibelles {
  filAriane: string;
  statut: string;
  modifier: string;
  envoieDepuis: string;
}

export interface EnTeteCampagneProps {
  campagne: CampagneEnTete;
  libelles: EnTeteCampagneLibelles;
  /** Bouton Lancer/Mettre en pause (`BoutonLancerPause`, client) — fourni par le layout, jamais rendu ici directement : il ferait échouer un test par `renderToStaticMarkup` (`useRouter` exige le contexte App Router). */
  action: ReactNode;
  /** Onglets (`OngletsCampagne`, client — `usePathname`) — même raison qu'`action` : fourni par le layout, jamais construit ici. Rendu à l'intérieur du `<header>` : composants.css n'habille `.jr-onglets` (fond, filet, marges) qu'en tant qu'enfant direct de `.jr-entete-campagne`. */
  onglets?: ReactNode;
}

const TON_STATUT_CAMPAGNE: Record<CampagneEnTete['statut'], PuceTon> = {
  draft: 'gris',
  active: 'bon',
  paused: 'attention',
  archived: 'gris',
};

export function EnTeteCampagne({ campagne, libelles, action, onglets }: EnTeteCampagneProps) {
  return (
    <header className="jr-entete-campagne">
      <div className="jr-fil-ariane">
        <Link href="/campaigns">{libelles.filAriane}</Link>
      </div>
      <div className="jr-titre">
        <h1>
          <TuileLogo marque="lettre" lettre={campagne.nom.charAt(0).toUpperCase()} taille="grande" />
          {campagne.nom}
          <Puce ton={TON_STATUT_CAMPAGNE[campagne.statut]} point>
            {libelles.statut}
          </Puce>
        </h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link href={`/campaigns/${campagne.id}/settings`} className="jr-bouton">
            {libelles.modifier}
          </Link>
          {action}
        </div>
      </div>
      {campagne.boites.length > 0 && (
        <div className="jr-expediteurs">
          {libelles.envoieDepuis}
          {campagne.boites.map((boite) => (
            <span className="jr-puce" key={boite.id}>
              {boite.marque && <TuileLogo marque={boite.marque} />}
              {boite.identite}
            </span>
          ))}
        </div>
      )}
      {onglets}
    </header>
  );
}

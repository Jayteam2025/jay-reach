import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { CollecteAutoLinkedin } from './CollecteAutoLinkedin';

/**
 * Les libelles reels, lus sans cast : si une cle disparait de `fr.json`, le typage le dit ici.
 */
const l = fr.reglages.linkedin.collecteAuto;
const libelles = {
  titre: l.titre,
  aideActive: l.aideActive,
  aideInactive: l.aideInactive,
  activer: l.activer,
  desactiver: l.desactiver,
};

describe('l’interrupteur de la collecte automatique', () => {
  // Ce que l'operateur doit comprendre sans aller lire la documentation : eteint, ses sources
  // n'avancent QUE s'il clique. C'etait le defaut reel du lot 4b avant ce tour.
  it('eteint, il dit que rien ne part sans un clic', () => {
    const html = renderToStaticMarkup(
      <CollecteAutoLinkedin actif={false} peutModifier libelles={libelles} />,
    );
    expect(html).toContain(libelles.aideInactive);
    expect(html).toContain(libelles.activer);
    expect(html).not.toContain(libelles.aideActive);
  });

  it('allume, il dit ce que le serveur fait tout seul', () => {
    const html = renderToStaticMarkup(<CollecteAutoLinkedin actif peutModifier libelles={libelles} />);
    expect(html).toContain(libelles.aideActive);
    expect(html).toContain(libelles.desactiver);
  });

  // Un bouton qui serait refuse par le serveur ne doit pas s'afficher : l'ecriture exige le
  // droit d'administrer.
  it('sans droit de modifier, l’etat se lit mais aucun bouton n’apparait', () => {
    const html = renderToStaticMarkup(
      <CollecteAutoLinkedin actif peutModifier={false} libelles={libelles} />,
    );
    expect(html).toContain(libelles.aideActive);
    expect(html).not.toContain('<button');
  });
});

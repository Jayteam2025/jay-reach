import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { TAILLE_PAGE_RECEPTION } from '@jay-reach/core';
import { ListeFils, type LigneFilAffichage } from './ListeFils';

const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'reception' });

function fils(n: number): LigneFilAffichage[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `fil-${i}`,
    nom: `Contact ${i}`,
    canal: 'email' as const,
    classification: 'human_reply',
    apercu: 'Bonjour',
    quandAffiche: 'hier',
    interet: null,
    relanceLeAffiche: null,
  }));
}

function rendre(page: number, lignes: number) {
  return renderToStaticMarkup(
    <ListeFils
      t={t}
      fils={fils(lignes)}
      compteurs={{ a_traiter: 0, interesses: 0, absences: 4, traites: 2, tous: 171 }}
      filtreActif="tous"
      campagneId={null}
      campagnes={[]}
      filSelectionneId={null}
      page={page}
      taillePage={TAILLE_PAGE_RECEPTION}
    />,
  );
}

describe('ListeFils : le compteur dit 171, la liste ne rend qu’une page', () => {
  it('annonce la tranche affichée sur le total et offre la page suivante', () => {
    const html = rendre(1, TAILLE_PAGE_RECEPTION);
    expect(html).toContain('1–30 sur 171');
    expect(html).toMatch(/href="\/inbox\?filtre=tous&amp;page=2"/);
    expect(html).not.toMatch(/page=0/);
  });

  it('en page 2 : tranche suivante, lien précédent sans paramètre page, les liens de fil gardent la page', () => {
    const html = rendre(2, TAILLE_PAGE_RECEPTION);
    expect(html).toContain('31–60 sur 171');
    expect(html).toMatch(/href="\/inbox\?filtre=tous"/);
    expect(html).toMatch(/href="\/inbox\?filtre=tous&amp;page=2&amp;fil=fil-0"/);
  });

  it('dernière page : pas de lien suivant ; tout tient sur une page : aucune pagination', () => {
    expect(rendre(6, 21)).not.toMatch(/page=7/);
    expect(rendre(6, 21)).toContain('151–171 sur 171');
    const unique = renderToStaticMarkup(
      <ListeFils
        t={t}
        fils={fils(3)}
        compteurs={{ a_traiter: 0, interesses: 0, absences: 0, traites: 0, tous: 3 }}
        filtreActif="tous"
        campagneId={null}
        campagnes={[]}
        filSelectionneId={null}
        page={1}
        taillePage={TAILLE_PAGE_RECEPTION}
      />,
    );
    expect(unique).not.toContain(' sur ');
  });
});

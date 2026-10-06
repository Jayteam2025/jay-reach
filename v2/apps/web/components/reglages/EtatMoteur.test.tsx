import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EtatMoteur, type EtatMoteurLibelles } from './EtatMoteur';

const LIBELLES: EtatMoteurLibelles = {
  titre: 'État',
  enMarche: 'En marche',
  arrete: 'Arrêté',
  version: 'version {version}',
  dernierPassage: 'Dernier passage',
  prochainPassage: 'Prochain',
  aucunPassage: '—',
  derniereErreur: 'Dernière erreur',
  aucuneErreur: 'Aucune',
  tachesEnAttente: 'Tâches en attente',
  aucuneTache: 'Aucune',
  linkedin: 'LinkedIn',
};

describe('EtatMoteur', () => {
  it('affiche la puce « bon » et la version quand le moteur tourne', () => {
    const html = renderToStaticMarkup(
      <EtatMoteur
        enMarche
        version="8beb1fd"
        dernierPassage="10:47:12"
        prochainPassage="10:48"
        derniereErreur={null}
        tachesEnAttenteTexte="136 scorings · 2 enrichissements"
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-puce bon');
    expect(html).toContain('En marche');
    expect(html).toContain('version 8beb1fd');
    expect(html).toContain('136 scorings · 2 enrichissements');
  });

  it('affiche la puce « erreur » et la dernière erreur en rouge quand le moteur est arrêté', () => {
    const html = renderToStaticMarkup(
      <EtatMoteur
        enMarche={false}
        version={null}
        dernierPassage={null}
        prochainPassage={null}
        derniereErreur={{ quand: '08:12', libelle: 'SalesBlink 429' }}
        tachesEnAttenteTexte={null}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('jr-puce erreur');
    expect(html).toContain('Arrêté');
    expect(html).toContain('jr-texte-erreur');
    expect(html).toContain('SalesBlink 429');
    expect(html).toContain('Aucune');
  });

  describe('ligne LinkedIn', () => {
    const rendre = (linkedin: Parameters<typeof EtatMoteur>[0]['linkedin']) =>
      renderToStaticMarkup(
        <EtatMoteur
          enMarche
          version={null}
          dernierPassage="10:47"
          prochainPassage="10:48"
          derniereErreur={null}
          tachesEnAttenteTexte={null}
          linkedin={linkedin}
          libelles={LIBELLES}
        />,
      );

    it('sans session, la ligne dit l’état et mène à Réglages › LinkedIn', () => {
      const html = rendre({ ton: 'gris', libelle: 'LinkedIn : aucune session', detail: 'Session à ouvrir' });
      expect(html).toContain('LinkedIn : aucune session');
      expect(html).toContain('href="/settings/linkedin"');
    });

    it('session arrêtée : l’état se dit par le libellé, le logo garde sa couleur de marque', () => {
      const html = rendre({ ton: 'erreur', libelle: 'LinkedIn arrêté', detail: 'Vérification demandée' });
      expect(html).toContain('LinkedIn arrêté');
      expect(html).toContain('Vérification demandée');
      // Le logo porte la classe de marque, jamais une classe d'état ni un style en ligne.
      expect(html).toMatch(/<svg[^>]*class="jr-ico-li"/);
      expect(html).not.toMatch(/<svg[^>]*style=/);
    });

    it('ne parle jamais de « prochaine collecte » : la collecte est à la demande', () => {
      const html = rendre({ ton: 'bon', libelle: 'LinkedIn prêt', detail: 'Dernière collecte il y a 2 h' });
      expect(html).not.toMatch(/prochain(e)? collecte/i);
      // « Prochain » (passage du moteur) reste sur sa propre ligne, jamais sur celle de LinkedIn.
      const ligneLinkedin = html.slice(html.indexOf('jr-ico-li'));
      expect(ligneLinkedin).not.toContain('Prochain');
    });
  });
});

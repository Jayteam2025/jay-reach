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
});

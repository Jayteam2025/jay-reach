import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CampagneEnTete } from '@jay-reach/core';
import { EnTeteCampagne } from './EnTeteCampagne';
import { ongletActif } from './OngletsCampagne';

const LIBELLES = { filAriane: 'Campagnes', statut: 'Active', modifier: 'Modifier', envoieDepuis: 'Envoie depuis' };

function campagne(overrides: Partial<CampagneEnTete> = {}): CampagneEnTete {
  return {
    id: 'c1',
    nom: 'Directeur commercial',
    statut: 'active',
    boites: [],
    scoreMin: 60,
    relecturePremiersEnvois: 3,
    dailyCap: null,
    ...overrides,
  };
}

describe('EnTeteCampagne', () => {
  it('statut actif -> puce de ton bon', () => {
    const html = renderToStaticMarkup(
      <EnTeteCampagne campagne={campagne({ statut: 'active' })} libelles={LIBELLES} action={null} />,
    );
    expect(html).toContain('jr-puce bon');
    expect(html).toContain('Active');
  });

  it('statut en pause -> puce de ton attention', () => {
    const html = renderToStaticMarkup(
      <EnTeteCampagne
        campagne={campagne({ statut: 'paused' })}
        libelles={{ ...LIBELLES, statut: 'En pause' }}
        action={null}
      />,
    );
    expect(html).toContain('jr-puce attention');
  });

  it('brouillon et archivée -> puce de ton gris', () => {
    const draft = renderToStaticMarkup(
      <EnTeteCampagne campagne={campagne({ statut: 'draft' })} libelles={{ ...LIBELLES, statut: 'Brouillon' }} action={null} />,
    );
    const archived = renderToStaticMarkup(
      <EnTeteCampagne campagne={campagne({ statut: 'archived' })} libelles={{ ...LIBELLES, statut: 'Archivée' }} action={null} />,
    );
    expect(draft).toContain('jr-puce gris');
    expect(archived).toContain('jr-puce gris');
  });

  it('trois boîtes -> trois pilules, chacune avec le logo de sa marque', () => {
    const html = renderToStaticMarkup(
      <EnTeteCampagne
        campagne={campagne({
          boites: [
            { id: 'b1', identite: 'prospection@exemple.fr', marque: 'outlook' },
            { id: 'b2', identite: 'contact@exemple.fr', marque: 'outlook' },
            { id: 'b3', identite: 'veille@exemple.fr', marque: 'outlook' },
          ],
        })}
        libelles={LIBELLES}
        action={null}
      />,
    );
    // Une pilule = <span class="jr-puce"> (sans ton) — la puce de statut, elle,
    // porte toujours un ton (« jr-puce bon », jamais « jr-puce » nu).
    expect((html.match(/jr-puce"/g) ?? []).length).toBe(3);
    // `<img` précisément : React 19 ajoute aussi un <link rel="preload"> par image
    // rendue en SSR, qui porterait la même URL et fausserait un comptage plus large.
    expect((html.match(/<img src="\/logos\/outlook\.svg"/g) ?? []).length).toBe(3);
  });

  it('boîte sans marque connue (domaine propre) -> pilule sans <img>, adresse affichée', () => {
    const html = renderToStaticMarkup(
      <EnTeteCampagne
        campagne={campagne({ boites: [{ id: 'b1', identite: 'prospection@get-exemple.fr', marque: null }] })}
        libelles={LIBELLES}
        action={null}
      />,
    );
    expect(html).toContain('prospection@get-exemple.fr');
    expect(html).not.toContain('<img');
  });

  it("aucune boîte -> pas de ligne « Envoie depuis »", () => {
    const html = renderToStaticMarkup(<EnTeteCampagne campagne={campagne({ boites: [] })} libelles={LIBELLES} action={null} />);
    expect(html).not.toContain('jr-expediteurs');
  });
});

describe('ongletActif', () => {
  it("chemin de base -> onglet Vue d'ensemble", () => {
    expect(ongletActif('/campaigns/c1', 'c1')).toBe('/campaigns/c1');
  });

  it('sous-chemin contacts -> onglet Contacts', () => {
    expect(ongletActif('/campaigns/c1/contacts', 'c1')).toBe('/campaigns/c1/contacts');
  });

  it("navigation imbriquée sous un onglet -> l'onglet reste actif", () => {
    expect(ongletActif('/campaigns/c1/sequence/edit', 'c1')).toBe('/campaigns/c1/sequence');
  });

  it("chemin d'une autre campagne -> repli sur la Vue d'ensemble de celle demandée", () => {
    expect(ongletActif('/campaigns/c2/contacts', 'c1')).toBe('/campaigns/c1');
  });
});

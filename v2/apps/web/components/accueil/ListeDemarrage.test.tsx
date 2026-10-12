import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Demarrage, LigneDemarrage } from '@jay-reach/core';
import fr from '@jay-reach/i18n/messages/fr.json';
import { ListeDemarrage } from './ListeDemarrage';

/** Les libellés réels : si une clé disparaît de `fr.json`, le typage le dit ici. */
const d = fr.aujourdhui.demarrage;
const libelles = {
  titre: d.titre,
  titreCasse: d.titreCasse,
  sousTitre: d.sousTitre,
  sousTitreCasse: d.sousTitreCasse,
  avancement: d.avancement,
  lignes: d.lignes,
};

function ligne(cle: LigneDemarrage['cle'], p: Partial<LigneDemarrage> = {}): LigneDemarrage {
  return { cle, faite: true, compte: 1, casse: false, lien: '/x', ...p };
}

function demarrage(lignes: LigneDemarrage[]): Demarrage {
  const faites = lignes.filter((l) => l.faite).length;
  return { lignes, faites, total: lignes.length, terminee: faites === lignes.length };
}

function texte(html: string): string {
  return html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const toutesFaites = [
  ligne('fournisseurs', { compte: 7 }),
  ligne('boites', { compte: 3 }),
  ligne('persona', { compte: 2 }),
  ligne('linkedin', { compte: null }),
  ligne('source', { compte: 2 }),
  ligne('campagne', { compte: 1 }),
];

describe('la liste de démarrage', () => {
  // Elle ne survit pas à sa raison d'être : un bloc d'accueil qui reste pour toujours devient
  // du décor, et on cesse de le lire.
  it('tout branché, elle ne s’affiche pas du tout', () => {
    const html = renderToStaticMarkup(
      <ListeDemarrage demarrage={demarrage(toutesFaites)} libelles={libelles} />,
    );
    expect(html).toBe('');
  });

  it('au premier passage, elle compte et montre le chemin de chaque ligne manquante', () => {
    const lignes = [
      ligne('fournisseurs', { compte: 7 }),
      ligne('boites', { compte: 3 }),
      ligne('persona', { compte: 2 }),
      ligne('linkedin', { faite: false, compte: null, lien: '/settings/linkedin' }),
      ligne('source', { faite: false, compte: null, lien: '/campaigns' }),
      ligne('campagne', { faite: false, compte: null, lien: '/campaigns' }),
    ];
    const html = texte(renderToStaticMarkup(<ListeDemarrage demarrage={demarrage(lignes)} libelles={libelles} />));
    expect(html).toContain(libelles.titre);
    expect(html).toContain('3 sur 6');
    // Les mesures des lignes faites, et l'aide seulement là où il reste à faire.
    expect(html).toContain('7 posées');
    expect(html).toContain(libelles.lignes.linkedin.aide);
    expect(html).not.toContain(libelles.lignes.fournisseurs.aide);
    expect(html).toContain('href="/settings/linkedin"');
  });

  // Ce qui en fait un diagnostic et non un tutoriel : elle revient, et seulement sur la ligne
  // qui a lâché.
  it('quand un branchement lâche, elle revient et change de titre', () => {
    const lignes = toutesFaites.map((l) =>
      l.cle === 'linkedin' ? ligne('linkedin', { faite: false, compte: null, casse: true }) : l,
    );
    const html = texte(renderToStaticMarkup(<ListeDemarrage demarrage={demarrage(lignes)} libelles={libelles} />));
    expect(html).toContain(libelles.titreCasse);
    expect(html).toContain(libelles.sousTitreCasse);
    expect(html).not.toContain(libelles.titre);
    expect(html).toContain('jr-demarrage-ligne--cassee');
    expect(html).toContain('5 sur 6');
  });

  it('une ligne jamais faite ne se présente pas comme cassée', () => {
    const lignes = toutesFaites.map((l) =>
      l.cle === 'linkedin' ? ligne('linkedin', { faite: false, compte: null, casse: false }) : l,
    );
    const html = renderToStaticMarkup(<ListeDemarrage demarrage={demarrage(lignes)} libelles={libelles} />);
    expect(html).not.toContain('jr-demarrage-ligne--cassee');
    expect(texte(html)).toContain(libelles.titre);
  });
});

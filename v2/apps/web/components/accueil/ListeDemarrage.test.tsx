import { createTranslator } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CleDemarrage, Demarrage, LigneDemarrage } from '@jay-reach/core';
import fr from '@jay-reach/i18n/messages/fr.json';
import { ListeDemarrage, type ListeDemarrageProps } from './ListeDemarrage';

/** Les libellés réels : si une clé disparaît de `fr.json`, le typage le dit ici. */
const d = fr.aujourdhui.demarrage;
const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'aujourdhui.demarrage' });

/**
 * Les libellés sont résolus ici comme l'écran les résout : avec les vrais comptes, par le
 * traducteur. Le composant n'interpole plus rien, donc lui passer les chaînes brutes de `fr.json`
 * afficherait le message ICU tel quel — ce test ne prouverait plus ce qu'il prétend.
 */
function libellesPour(demarrage: Demarrage): ListeDemarrageProps['libelles'] {
  const compteDe = (cle: CleDemarrage) => demarrage.lignes.find((l) => l.cle === cle)?.compte ?? 0;
  const pour = (cle: CleDemarrage) => ({
    titre: d.lignes[cle].titre,
    aide: d.lignes[cle].aide,
    bouton: d.lignes[cle].bouton,
    mesure: t(`lignes.${cle}.mesure`, { n: compteDe(cle) }),
  });
  return {
    titre: d.titre,
    titreCasse: d.titreCasse,
    sousTitre: d.sousTitre,
    sousTitreCasse: d.sousTitreCasse,
    titreTerminee: d.titreTerminee,
    sousTitreTerminee: d.sousTitreTerminee,
    fermer: d.fermer,
    avancement: t('avancement', { faites: demarrage.faites, total: demarrage.total }),
    lignes: {
      fournisseurs: pour('fournisseurs'),
      boites: pour('boites'),
      persona: pour('persona'),
      linkedin: pour('linkedin'),
      source: pour('source'),
      campagne: pour('campagne'),
    },
  };
}

/** Le rendu complet, libellés compris, pour un jeu de lignes. */
function rendre(lignes: LigneDemarrage[], actionFermer?: () => Promise<void>): string {
  const dem = demarrage(lignes);
  return texte(
    renderToStaticMarkup(<ListeDemarrage demarrage={dem} libelles={libellesPour(dem)} actionFermer={actionFermer} />),
  );
}

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
  ligne('linkedin', { compte: null }),
  ligne('persona', { compte: 2 }),
  ligne('source', { compte: 2 }),
  ligne('campagne', { compte: 1 }),
];

describe('la liste de démarrage', () => {
  // Elle ne se masque plus d'elle-même : une organisation qui porte déjà les restes d'une recette
  // aurait « tout vert » avant que l'opérateur ait rien fait. C'est lui qui la ferme.
  it('tout branché, elle reste à l’écran et dit qu’on peut la fermer', () => {
    const html = rendre(toutesFaites);
    expect(html).toContain(d.titreTerminee);
    expect(html).toContain(d.sousTitreTerminee);
    expect(html).toContain('6 sur 6');
    expect(html).not.toContain(d.titre);
  });

  it('elle porte un bouton de fermeture seulement quand l’écran lui donne une action', () => {
    expect(rendre(toutesFaites)).not.toContain(d.fermer);
    const html = rendre(toutesFaites, async () => {});
    expect(html).toContain(d.fermer);
    expect(html).toContain('<form');
  });

  it('au premier passage, elle compte et montre le chemin de chaque ligne manquante', () => {
    const lignes = [
      ligne('fournisseurs', { compte: 7 }),
      ligne('boites', { compte: 3 }),
      ligne('linkedin', { faite: false, compte: null, lien: '/settings/linkedin' }),
      ligne('persona', { compte: 2 }),
      ligne('source', { faite: false, compte: null, lien: '/campaigns' }),
      ligne('campagne', { faite: false, compte: null, lien: '/campaigns' }),
    ];
    const html = rendre(lignes);
    expect(html).toContain(d.titre);
    expect(html).toContain('3 sur 6');
    // Les mesures des lignes faites, et l'aide seulement là où il reste à faire.
    expect(html).toContain('7 posées');
    expect(html).toContain(d.lignes.linkedin.aide);
    expect(html).not.toContain(d.lignes.fournisseurs.aide);
    expect(html).toContain('href="/settings/linkedin"');
  });

  // Ce qui en fait un diagnostic et non un tutoriel : elle revient, et seulement sur la ligne
  // qui a lâché.
  it('quand un branchement lâche, elle revient et change de titre', () => {
    const lignes = toutesFaites.map((l) =>
      l.cle === 'linkedin' ? ligne('linkedin', { faite: false, compte: null, casse: true }) : l,
    );
    const html = rendre(lignes);
    expect(html).toContain(d.titreCasse);
    expect(html).toContain(d.sousTitreCasse);
    expect(html).not.toContain(d.titre);
    expect(html).toContain('jr-demarrage-ligne--cassee');
    expect(html).toContain('5 sur 6');
  });

  it('une ligne jamais faite ne se présente pas comme cassée', () => {
    const lignes = toutesFaites.map((l) =>
      l.cle === 'linkedin' ? ligne('linkedin', { faite: false, compte: null, casse: false }) : l,
    );
    const html = rendre(lignes);
    expect(html).not.toContain('jr-demarrage-ligne--cassee');
    expect(html).toContain(d.titre);
  });
});

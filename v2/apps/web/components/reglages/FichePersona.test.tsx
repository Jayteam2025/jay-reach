import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LignePersonaArchivee } from './FichePersona';

/**
 * Tour de correction 1, important #3 : un persona archivé (« Supprimer », qui
 * pose `estActif: false`) n'avait aucun moyen d'être repris. `LignePersonaArchivee`
 * est la ligne de la section repliée « Archivés (N) » — fonction pure (comme
 * `BlocResultatAnnuaire`/`PiedTiroirRelecture`), testable sans fournisseur
 * `next-intl`/`next/navigation`.
 */
describe('LignePersonaArchivee', () => {
  it('affiche le nom du persona et un vrai bouton « Réactiver »', () => {
    const html = renderToStaticMarkup(
      <LignePersonaArchivee
        nom="CEO de scale-ups tech"
        libelleReactiver="Réactiver"
        disabled={false}
        onReactiver={vi.fn()}
      />,
    );
    expect(html).toContain('CEO de scale-ups tech');
    expect(html).toMatch(/<button[^>]*>\s*Réactiver\s*<\/button>/);
  });

  it('désactive le bouton pendant la réactivation en cours', () => {
    const html = renderToStaticMarkup(
      <LignePersonaArchivee
        nom="CEO de scale-ups tech"
        libelleReactiver="Réactiver"
        disabled
        onReactiver={vi.fn()}
      />,
    );
    expect(html).toContain('disabled');
  });

  it('n’imbrique jamais un bouton dans un autre élément interactif (pas de <button> englobant)', () => {
    const html = renderToStaticMarkup(
      <LignePersonaArchivee
        nom="CEO de scale-ups tech"
        libelleReactiver="Réactiver"
        disabled={false}
        onReactiver={vi.fn()}
      />,
    );
    // Un seul <button> dans toute la ligne (celui de Réactiver) : la ligne
    // elle-même est un <div>, jamais un <button> englobant (contrairement à
    // `LignePersona`, dont le rôle est la SÉLECTION, pas une action ponctuelle).
    expect(html.match(/<button/g)).toHaveLength(1);
  });
});

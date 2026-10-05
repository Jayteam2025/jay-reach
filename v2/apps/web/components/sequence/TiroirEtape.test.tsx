import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { VariablesDeListe } from './TiroirEtape';

const LIBELLES = {
  listVariables: 'Colonnes de la liste importée',
  listVariablesEmpty:
    'Une campagne alimentée par un fichier importé offre aussi ses colonnes : {{liste_nom_de_la_colonne}}.',
};

/**
 * Tâche 29, partie A point 3 : `VariablesDeListe` est la partie pure du
 * tiroir d'étape (même extraction que `PiedTiroirRelecture`, `TiroirRelecture.tsx`
 * — le tiroir complet dépend de `useRouter`/`useTranslations`, non testable par
 * `renderToStaticMarkup`).
 */
describe('VariablesDeListe', () => {
  it('avec des colonnes : une ligne d’aide puis une puce par colonne', () => {
    const html = renderToStaticMarkup(
      <VariablesDeListe
        variablesListe={['liste_poste', 'liste_ville']}
        onInserer={vi.fn()}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('Colonnes de la liste importée');
    expect(html).toContain('{{liste_poste}}');
    expect(html).toContain('{{liste_ville}}');
    expect(html).not.toContain('Une campagne alimentée');
  });

  it('sans colonne : une seule ligne d’aide, pas de puce', () => {
    const html = renderToStaticMarkup(
      <VariablesDeListe variablesListe={[]} onInserer={vi.fn()} libelles={LIBELLES} />,
    );
    expect(html).toContain('Une campagne alimentée par un fichier importé offre aussi ses colonnes');
    expect(html).toContain('{{liste_nom_de_la_colonne}}');
    expect(html).not.toContain('jr-puce variable');
  });
});

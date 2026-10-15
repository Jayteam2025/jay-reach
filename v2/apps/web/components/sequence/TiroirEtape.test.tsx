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

// Les puces de variables : ce que le tiroir propose doit être ce que l'enregistrement accepte.
describe('TiroirEtape : variables proposées', () => {
  const PROPS = {
    campagneId: 'camp-1',
    etape: null,
    apercu: null,
    variablesListe: [],
  } as const;

  async function rendre(nature: 'signal' | 'list', aSourceDePost: boolean): Promise<string> {
    vi.resetModules();
    vi.doMock('next-intl', () => ({ useTranslations: () => (cle: string) => cle }));
    vi.doMock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
    vi.doMock('../../app/actions/step-message', () => ({
      actionEnregistrerEtape: vi.fn(),
      actionEnvoyerTest: vi.fn(),
      actionSupprimerEtape: vi.fn(),
    }));
    const { TiroirEtape } = await import('./TiroirEtape');
    return renderToStaticMarkup(<TiroirEtape {...PROPS} nature={nature} aSourceDePost={aSourceDePost} />);
  }

  it('campagne de liste : aucune variable de signal ni de post, mais le contexte de la liste', async () => {
    const html = await rendre('list', true);
    expect(html).toContain('{{contexte}}');
    expect(html).toContain('{{prenom}}');
    for (const interdite of ['signal_titre', 'signal_date', 'lien_offre', 'post_auteur']) {
      expect(html).not.toContain(`{{${interdite}}}`);
    }
  });

  it('campagne de signal sans source de post : les variables de signal, pas celles du post', async () => {
    const html = await rendre('signal', false);
    expect(html).toContain('{{signal_titre}}');
    expect(html).not.toContain('{{post_sujet}}');
    expect(html).not.toContain('{{post_auteur}}');
  });

  it('campagne de signal avec une source de post : les quatre variables du post', async () => {
    const html = await rendre('signal', true);
    for (const v of ['post_auteur', 'post_sujet', 'post_url', 'post_date']) expect(html).toContain(`{{${v}}}`);
  });
});

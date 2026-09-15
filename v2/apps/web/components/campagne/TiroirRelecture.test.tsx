import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PiedTiroirRelecture } from './TiroirRelecture';

const LIBELLES = {
  ecarter: 'Écarter',
  modifierLeTexte: 'Modifier le texte',
  bientot: 'Bientôt',
  envoyerTelQuel: 'Envoyer tel quel',
};

/**
 * D6 (R39, tour de correction 1) : les trois actions n'apparaissent que sur
 * un envoi encore à relire (`dejaTraite` nul, calculé côté page pour
 * `scheduled`/`pending_approval`) ; sinon une ligne discrète les remplace,
 * jamais les deux à la fois. `PiedTiroirRelecture` est la seule partie du
 * tiroir sans `useRouter` — donc la seule testable par `renderToStaticMarkup`.
 */
describe('PiedTiroirRelecture', () => {
  it('un envoi encore à relire affiche les trois boutons', () => {
    const html = renderToStaticMarkup(
      <PiedTiroirRelecture
        dejaTraite={null}
        pending={false}
        peutEcarter
        libelles={LIBELLES}
        onEcarter={vi.fn()}
        onEnvoyerTelQuel={vi.fn()}
      />,
    );
    expect(html).toContain('Écarter');
    expect(html).toContain('Modifier le texte');
    expect(html).toContain('Envoyer tel quel');
  });

  it('un envoi déjà traité affiche la ligne discrète, pas les boutons', () => {
    const html = renderToStaticMarkup(
      <PiedTiroirRelecture
        dejaTraite="Cet envoi est échoué : plus rien à relire."
        pending={false}
        peutEcarter
        libelles={LIBELLES}
        onEcarter={vi.fn()}
        onEnvoyerTelQuel={vi.fn()}
      />,
    );
    expect(html).toContain('Cet envoi est échoué : plus rien à relire.');
    expect(html).not.toContain('Envoyer tel quel');
    expect(html).not.toContain('Modifier le texte');
    expect(html).not.toContain('>Écarter<');
  });

  it('sans contact identifié, Écarter est désactivé', () => {
    const html = renderToStaticMarkup(
      <PiedTiroirRelecture
        dejaTraite={null}
        pending={false}
        peutEcarter={false}
        libelles={LIBELLES}
        onEcarter={vi.fn()}
        onEnvoyerTelQuel={vi.fn()}
      />,
    );
    expect(html).toContain('disabled');
  });
});

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlocResultatAnnuaire } from './TiroirSourceAnnuaire';

const LIBELLES = {
  produces: 'Ce que ça produit',
  retained: 'Entreprises ajoutées à votre base',
  known: 'Déjà connues, mises à jour',
  contactsCreated: 'Contacts créés',
  none: 'aucun',
  hint: "L'annuaire donne des entreprises, pas des personnes.",
};

/**
 * R42 (tour de correction 1) : les trois lignes du bloc « Ce que ça produit »
 * doivent venir de la réponse du serveur, jamais d'un décompte fait avant
 * l'ajout — voir le commentaire de `BlocResultatAnnuaire`.
 */
describe('BlocResultatAnnuaire', () => {
  it('affiche les trois lignes avec les valeurs du serveur', () => {
    const html = renderToStaticMarkup(
      <BlocResultatAnnuaire entreprisesRetenues={7} dejaConnues={2} libelles={LIBELLES} />,
    );
    expect(html).toContain('Ce que ça produit');
    expect(html).toContain('Entreprises ajoutées à votre base');
    expect(html).toContain('>7<');
    expect(html).toContain('Déjà connues, mises à jour');
    expect(html).toContain('>2<');
    expect(html).toContain('Contacts créés');
    expect(html).toContain('>aucun<');
  });

  it('affiche zéro explicitement plutôt que de masquer la ligne', () => {
    const html = renderToStaticMarkup(
      <BlocResultatAnnuaire entreprisesRetenues={0} dejaConnues={0} libelles={LIBELLES} />,
    );
    expect(html).toContain('>0<');
  });
});

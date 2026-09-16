import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CorpsFormulaireOrganisation, type FormulaireOrganisationLibelles } from './FormulaireOrganisation';

const LIBELLES: FormulaireOrganisationLibelles = {
  titre: 'Organisation',
  nom: 'Nom',
  fuseau: 'Fuseau horaire',
  fuseauAide: 'heures affichées et fenêtres d’envoi par défaut',
  langue: 'Langue de l’interface',
  langueAide: 'aussi en anglais et en néerlandais',
  enregistrer: 'Enregistrer',
};

describe('CorpsFormulaireOrganisation', () => {
  it('affiche le nom, le fuseau courant sélectionné et les trois langues', () => {
    const html = renderToStaticMarkup(
      <CorpsFormulaireOrganisation
        nom="Hey Jay"
        onNomChange={() => {}}
        fuseau="Europe/Paris"
        onFuseauChange={() => {}}
        fuseaux={['Europe/Paris', 'America/New_York']}
        langue="fr"
        onLangueChange={() => {}}
        disabled={false}
        libelles={LIBELLES}
      />,
    );
    expect(html).toContain('value="Hey Jay"');
    expect(html).toContain('<option value="Europe/Paris" selected=');
    expect(html).toContain('Français');
    expect(html).toContain('English');
    expect(html).toContain('Nederlands');
  });

  it('désactive les champs pendant l’envoi', () => {
    const html = renderToStaticMarkup(
      <CorpsFormulaireOrganisation
        nom="Hey Jay"
        onNomChange={() => {}}
        fuseau="Europe/Paris"
        onFuseauChange={() => {}}
        fuseaux={['Europe/Paris']}
        langue="fr"
        onLangueChange={() => {}}
        disabled
        libelles={LIBELLES}
      />,
    );
    expect((html.match(/disabled=""/g) ?? []).length).toBe(3);
  });
});

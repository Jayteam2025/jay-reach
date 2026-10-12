import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { ChoixRythme, type CranAffiche } from './ChoixRythme';

// La Server Action n'est pas le sujet ici : ce test juge ce que l'écran MONTRE.
vi.mock('../../app/actions/plafonds', () => ({
  actionEcrireRythme: async () => ({ ok: true }),
}));

/** Les libellés réels, lus sans cast : si une clé disparaît de `fr.json`, le typage le dit ici. */
const l = fr.reglages.linkedin.rythme;
const libelles = {
  groupe: l.titre,
  invitations: l.crans.invitations,
  messages: l.crans.messages,
  horaires: l.crans.horaires,
  applique: l.applique,
  appliquer: l.appliquer,
  jours: l.jours,
  surMesureTitre: l.surMesure.titre,
  surMesureTexte: l.surMesure.texte,
};

const crans: CranAffiche[] = [
  { cle: 'prudent', nom: l.crans.prudent, invitations: 50, messages: 100, horaires: '9h-18h' },
  { cle: 'normal', nom: l.crans.normal, invitations: 100, messages: 200, horaires: '9h-18h' },
  { cle: 'soutenu', nom: l.crans.soutenu, invitations: 150, messages: 200, horaires: '8h-19h' },
];

function rendu(props: Partial<Parameters<typeof ChoixRythme>[0]> = {}) {
  return renderToStaticMarkup(
    <ChoixRythme applique="normal" crans={crans} peutModifier libelles={libelles} {...props} />,
  );
}

describe('le choix du rythme d’envoi', () => {
  it('montre les chiffres de chaque cran, pas seulement son nom', () => {
    const html = rendu();
    // C'est ce qui justifie trois cartes plutôt qu'un sélecteur segmenté : on choisit sur les
    // chiffres, et un sélecteur ne les montrerait pas.
    for (const cran of crans) {
      expect(html).toContain(cran.nom);
      expect(html).toContain(String(cran.invitations));
      expect(html).toContain(cran.horaires);
    }
    // Un rythme correspond : rien ne doit parler de réglages sur mesure.
    expect(html).not.toContain(libelles.surMesureTitre);
    expect(html).not.toContain(libelles.surMesureTexte);
  });

  it('marque un seul cran comme appliqué, et ne propose rien à enregistrer', () => {
    const html = rendu({ applique: 'soutenu' });
    expect(html.split(libelles.applique)).toHaveLength(2);
    // Le bouton n'a aucune raison d'être là : rien n'a été changé.
    expect(html).not.toContain(libelles.appliquer);
  });

  it('sur mesure : la raison se lit AVANT les crans, et aucun n’est coché', () => {
    const html = rendu({ applique: 'personnalise' });
    expect(html).toContain(libelles.surMesureTitre);
    expect(html).toContain(libelles.surMesureTexte);
    // Sinon l'opérateur voit trois cases vides et cherche l'explication après avoir cliqué.
    expect(html.indexOf(libelles.surMesureTexte)).toBeLessThan(html.indexOf(l.crans.prudent));
    expect(html).not.toContain('checked');
    // Et surtout : ne jamais dire qu'un cran s'applique quand aucun ne correspond.
    expect(html).not.toContain(libelles.applique);
    // « Du lundi au vendredi » décrit ce que POSE un cran. En sur mesure, les jours réels sont
    // tout autres — c'était le cas du constat d'origine, réglé sur mardi à jeudi.
    expect(html).not.toContain(libelles.jours);
  });

  it('un rythme appliqué, lui, peut annoncer ses jours', () => {
    expect(rendu({ applique: 'normal' })).toContain(libelles.jours);
  });

  it('un rythme appliqué coche son cran', () => {
    expect(rendu({ applique: 'prudent' }).split('checked=""')).toHaveLength(2);
  });

  it('sans droit de modifier, rien n’est actionnable', () => {
    const html = rendu({ peutModifier: false });
    expect(html.split('disabled=""')).toHaveLength(crans.length + 1);
    expect(html).not.toContain(libelles.appliquer);
  });
});

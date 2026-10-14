/**
 * Aucun contrôle de saisie ne reste au style natif du navigateur.
 *
 * Mesuré le 14/10 sur l'app déployée, écran Réglages › LinkedIn : cinq champs de plafond et trois
 * listes déroulantes de fenêtre d'envoi s'affichaient en Arial 13,33 px — la police par défaut du
 * navigateur — au milieu d'un écran en Instrument Sans. Ils mesuraient 19 et 22 px de haut, sous
 * le minimum de 24 px du critère 2.5.8 de WCAG 2.2.
 *
 * Deux causes, et il fallait les deux : les contrôles ne portaient aucune classe, et `.jr-champ`
 * ne posait pas `font-family`, si bien que même un contrôle habillé serait resté en Arial.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../../app/styles/composants.css', import.meta.url), 'utf8');
const lire = (f: string) => readFileSync(new URL(`./${f}`, import.meta.url), 'utf8');

/**
 * Compte les balises de saisie d'un fichier, hors cases à cocher et boutons radio, qui sont
 * habillées à part. On compte plutôt qu'on ne découpe les balises : une flèche `=>` dans un
 * `onChange` contient un `>` et tronque toute expression qui prétendrait lire une balise entière.
 */
function nombreDeControles(source: string): number {
  const balises = (source.match(/<(?:input|select|textarea)\b/g) ?? []).length;
  const coches = (source.match(/type="(?:checkbox|radio)"/g) ?? []).length;
  return balises - coches;
}

const nombreHabilles = (source: string) => (source.match(/className="jr-champ"/g) ?? []).length;

describe('les contrôles des réglages LinkedIn', () => {
  it('portent tous la classe de champ', () => {
    // Les deux fichiers de l'écran mesuré : cinq champs de plafond, trois listes de fenêtre.
    const attendus = { 'PlafondsLinkedin.tsx': 1, 'FenetreEnvoiLinkedin.tsx': 3 };
    for (const [fichier, compte] of Object.entries(attendus)) {
      const source = lire(fichier);
      expect(nombreDeControles(source), `${fichier} : le nombre de contrôles a changé`).toBe(compte);
      expect(nombreHabilles(source), `${fichier} : un contrôle sans classe de champ`).toBe(compte);
    }
  });

  // Sans cette règle, un contrôle qui porte `.jr-champ` garde la police du navigateur : la taille
  // est corrigée, la famille non, et l'écart passe inaperçu à la relecture du code.
  it('héritent de la police du produit, classe posée ou non', () => {
    const regle = css.match(/^\.jr-champ \{([^}]*)\}/m)?.[1];
    expect(regle, 'règle .jr-champ introuvable').toBeDefined();
    expect(regle).toMatch(/font-family:\s*inherit/);
  });
});

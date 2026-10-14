/**
 * Les mesures de la liste de démarrage s'accordent.
 *
 * Avant ce test, les cinq libellés français étaient figés au pluriel ou au singulier : la liste
 * annonçait « 1 posées », « 1 actives », « 1 créés » — et « 2 active » pour les campagnes, l'erreur
 * dans l'autre sens. Le nombre n'arrivait même pas jusqu'au traducteur : l'écran passait la chaîne
 * littérale `{n}` à `t()`, et le composant la remplaçait ensuite avec un `.replace`, ce qui mettait
 * ICU hors circuit.
 *
 * L'anglais et le néerlandais ne changent pas : « active », « set », « actief » sont invariables.
 * Le test les couvre quand même, pour qu'une traduction future ne casse pas en silence.
 */
import { readFileSync } from 'node:fs';
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import en from '@jay-reach/i18n/messages/en.json';
import nl from '@jay-reach/i18n/messages/nl.json';

const messages = { fr, en, nl };
const traducteur = (locale: keyof typeof messages) =>
  createTranslator({ locale, messages: messages[locale], namespace: 'aujourdhui.demarrage' });

/** Les cinq lignes qui comptent quelque chose. `linkedin` dit « connecté », sans nombre. */
const AVEC_NOMBRE = ['fournisseurs', 'boites', 'persona', 'source', 'campagne'] as const;

describe('les mesures de la liste de démarrage', () => {
  it('accordent le français au singulier comme au pluriel', () => {
    const t = traducteur('fr');
    expect(t('lignes.fournisseurs.mesure', { n: 1 })).toBe('1 posée');
    expect(t('lignes.fournisseurs.mesure', { n: 7 })).toBe('7 posées');
    expect(t('lignes.boites.mesure', { n: 1 })).toBe('1 active');
    expect(t('lignes.boites.mesure', { n: 3 })).toBe('3 actives');
    expect(t('lignes.persona.mesure', { n: 1 })).toBe('1 créé');
    expect(t('lignes.persona.mesure', { n: 4 })).toBe('4 créés');
    expect(t('lignes.source.mesure', { n: 1 })).toBe('1 active');
    expect(t('lignes.source.mesure', { n: 2 })).toBe('2 actives');
    // L'erreur dans l'autre sens : le libellé était figé au singulier.
    expect(t('lignes.campagne.mesure', { n: 1 })).toBe('1 active');
    expect(t('lignes.campagne.mesure', { n: 5 })).toBe('5 actives');
  });

  // Une mesure qui garderait un `{n}` littéral serait invisible à l'écran : elle s'afficherait
  // telle quelle, comme avant le correctif.
  it('rendent le nombre, dans les trois langues', () => {
    for (const locale of ['fr', 'en', 'nl'] as const) {
      const t = traducteur(locale);
      for (const cle of AVEC_NOMBRE) {
        const rendu = t(`lignes.${cle}.mesure`, { n: 42 });
        expect(rendu, `${locale}/${cle}`).toContain('42');
        expect(rendu, `${locale}/${cle}`).not.toContain('{n}');
      }
    }
  });

  it("l'avancement rend ses deux nombres", () => {
    expect(traducteur('fr')('avancement', { faites: 3, total: 6 })).toBe('3 sur 6');
  });

  /**
   * Les deux tests ci-dessus prouvent que les messages s'accordent quand on leur donne un nombre.
   * Ils ne prouvent pas que l'écran en donne un — et c'était précisément le défaut : les messages
   * étaient corrects, mais l'écran passait la chaîne `'{n}'`, et le composant interpolait après
   * coup. Cette garde lit les deux fichiers et refuse le retour du motif.
   */
  it("l'écran passe des nombres, et le composant n'interpole rien", () => {
    const ecran = readFileSync(new URL('../../app/(app)/page.tsx', import.meta.url), 'utf8');
    expect(ecran).not.toMatch(/\{\s*n:\s*'\{n\}'/);
    expect(ecran).not.toMatch(/faites:\s*'\{faites\}'/);
    expect(ecran).toMatch(/mesure:\s*t\(`demarrage\.lignes\.\$\{cle\}\.mesure`,\s*\{\s*n:\s*compteDe\(cle\)/);

    const composant = readFileSync(new URL('./ListeDemarrage.tsx', import.meta.url), 'utf8');
    expect(composant).not.toContain('.replace(');
  });
});

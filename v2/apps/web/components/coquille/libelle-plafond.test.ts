/**
 * Le coin droit de la carte des envois dit sa limite en toutes lettres.
 *
 * Relevé le 14/10 sur l'app déployée : il affichait « / 135 ». Un slash sans numérateur, que le
 * lecteur devait compléter de tête avec le chiffre lu deux lignes plus bas.
 *
 * La clé avait été écrite sur le modèle de ses deux sœurs — `reglages.expediteurs.box.todayValue`
 * et `reglages.plafonds.consommation.valeur` — en perdant `{utilise}` dans les trois branches. Mais
 * le remettre afficherait ici le quota de l'organisation (38) juste au-dessus des envois de la
 * carte (« 37 partis »), deux nombres proches et différents : pire que le slash. La carte montre
 * déjà ses chiffres et sa barre ; son coin droit n'a qu'à nommer la limite, comme le font déjà ses
 * deux autres branches, « en pause » et « sans limite ».
 */
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import en from '@jay-reach/i18n/messages/en.json';
import nl from '@jay-reach/i18n/messages/nl.json';

const messages = { fr, en, nl };
const ETATS = ['regle', 'pause', 'sansLimite'] as const;

describe('le libellé de plafond de la carte des envois', () => {
  it('ne commence jamais par un séparateur orphelin', () => {
    for (const locale of ['fr', 'en', 'nl'] as const) {
      const t = createTranslator({ locale, messages: messages[locale], namespace: 'coquille.sent' });
      for (const etat of ETATS) {
        const rendu = t('cap', { etat, utilise: 37, plafond: 135 });
        expect(rendu.trim(), `${locale}/${etat}`).not.toMatch(/^[/·-]/);
        expect(rendu, `${locale}/${etat}`).not.toContain('{');
      }
    }
  });

  it('nomme la limite quand il y en a une', () => {
    const t = createTranslator({ locale: 'fr', messages: fr, namespace: 'coquille.sent' });
    expect(t('cap', { etat: 'regle', utilise: 37, plafond: 135 })).toBe('plafond 135');
    expect(t('cap', { etat: 'pause', utilise: 37, plafond: 0 })).toBe('en pause');
    expect(t('cap', { etat: 'sansLimite', utilise: 37, plafond: 0 })).toBe('sans limite');
  });
});

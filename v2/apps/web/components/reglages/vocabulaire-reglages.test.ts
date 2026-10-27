import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import en from '@jay-reach/i18n/messages/en.json';
import nl from '@jay-reach/i18n/messages/nl.json';

/** Toutes les chaînes d'un sous-arbre de messages, à plat. */
function chaines(noeud: unknown): string[] {
  if (typeof noeud === 'string') return [noeud];
  if (typeof noeud !== 'object' || noeud === null) return [];
  return Object.values(noeud).flatMap(chaines);
}

/**
 * Le lecteur de Réglages est un directeur commercial. Ces garde-fous tiennent les décisions de
 * vocabulaire du 27/10 : ce que l'écran dit ne doit pas redevenir du vocabulaire de serveur.
 */
describe('le vocabulaire des Réglages', () => {
  it('Plafonds : aucune variable d’environnement dans aucune langue', () => {
    for (const catalogue of [fr, en, nl]) {
      for (const texte of chaines(catalogue.reglages.plafonds)) {
        expect(texte).not.toMatch(/\b[A-Z]{2,}(?:_[A-Z0-9]+)+\b/);
      }
      expect('colRepli' in catalogue.reglages.plafonds.table).toBe(false);
    }
  });

  it('Plafonds : l’introduction dit ce que fait un plafond atteint', () => {
    expect(fr.reglages.plafonds.lead).toBe(
      "Les limites quotidiennes de votre organisation. Un plafond atteint met la tâche en attente jusqu'au lendemain, rien n'est perdu.",
    );
    expect(fr.reglages.plafonds.table.colConseillee).toBe('Valeur conseillée');
  });

  it('Plafonds : l’enrichissement à zéro dit la conséquence', () => {
    expect(fr.reglages.plafonds.table.arreteEnrichissement).toBe(
      "En pause : aucun email ne sera cherché, les contacts sans email ne recevront pas d'étape email.",
    );
  });

  it('Moteur : « Purge de rétention » est devenu « Nettoyage des anciennes données »', () => {
    expect(fr.reglages.moteur.etat.purge).toBe('Nettoyage des anciennes données');
  });

  it('LinkedIn : la sortie se dit sans opérateur ni adresse, qui restent en détails techniques', () => {
    expect(fr.reglages.linkedin.faits.sortieValeur).toBe('Sortie par une IP résidentielle — pays : {pays}');
    expect(fr.reglages.linkedin.faits.detailsTechniques).toBe('Détails techniques');
    expect(fr.reglages.linkedin.faits.operateur).not.toContain('pays');
  });
});

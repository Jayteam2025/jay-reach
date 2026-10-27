import { describe, expect, it } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import { CATALOGUE_FOURNISSEURS } from '@jay-reach/core';
import { etatFournisseur, FOURNISSEURS_FACULTATIFS } from './fournisseur-affichage';

const sansCle = { presente: false, testeeLe: null, statut: 'a_renseigner', dernierCaracteres: null } as const;

function categorieDe(id: string) {
  const def = CATALOGUE_FOURNISSEURS.find((f) => f.id === id);
  if (!def) throw new Error(`fournisseur inconnu : ${id}`);
  return def.categorie;
}

describe('etatFournisseur', () => {
  it('Apify sans clé est « Facultatif », pas « À renseigner » : le canal LinkedIn ne l’utilise pas', () => {
    const etat = etatFournisseur({ providerId: 'apify', categorie: categorieDe('apify'), cle: sansCle });
    expect(etat).toEqual({ ton: 'gris', cle: 'facultatif' });
    expect(fr.reglages.fournisseurs.etat[etat.cle]).toBe('Facultatif');
  });

  it('un fournisseur dont l’application a besoin reste « À renseigner » sans clé', () => {
    const etat = etatFournisseur({ providerId: 'anthropic', categorie: categorieDe('anthropic'), cle: sansCle });
    expect(etat.cle).toBe('aRenseigner');
    expect(fr.reglages.fournisseurs.etat[etat.cle]).toBe('À renseigner');
  });

  it('une clé présente garde son état, facultatif ou non', () => {
    const presente = { ...sansCle, presente: true };
    expect(etatFournisseur({ providerId: 'apify', categorie: categorieDe('apify'), cle: presente }).cle).toBe('cleValide');
    expect(etatFournisseur({ providerId: 'salesblink', categorie: categorieDe('salesblink'), cle: presente }).cle).toBe('connecte');
    expect(
      etatFournisseur({ providerId: 'apify', categorie: categorieDe('apify'), cle: { ...presente, statut: 'echec' } }).cle,
    ).toBe('echec');
  });

  it('seul Apify est facultatif', () => {
    expect([...FOURNISSEURS_FACULTATIFS]).toEqual(['apify']);
  });

  it('le texte d’Apify dit sa vraie fonction : des offres d’emploi, et pas le canal LinkedIn', () => {
    const description = fr.reglages.fournisseurs.description.apify;
    expect(description).toContain('offres d\'emploi');
    expect(description).toContain('facultatif');
    expect(description).not.toContain('nécessaire');
  });
});

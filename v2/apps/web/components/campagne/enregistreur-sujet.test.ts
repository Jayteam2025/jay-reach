import { describe, expect, it } from 'vitest';
import { creerEnregistreurSujet, validerApresEnregistrement } from './enregistreur-sujet';

/** Une réponse du serveur que le test libère à la main. */
function differe() {
  let resoudre: (v: string | null) => void = () => undefined;
  const promesse = new Promise<string | null>((r) => {
    resoudre = r;
  });
  return { promesse, resoudre };
}

describe('l\'enregistrement du sujet', () => {
  it('un enregistrement refusé en vol puis « Valider » : la validation ne doit pas partir', async () => {
    let affiche = 'ancien';
    const reponse = differe();
    const erreurs: string[] = [];
    const enr = creerEnregistreurSujet({
      confirmeInitial: 'ancien',
      lire: () => affiche,
      envoyer: () => reponse.promesse,
      surErreur: (m) => erreurs.push(m),
    });
    affiche = 'un sujet beaucoup trop long';
    const surPerteDeFocus = enr.enregistrer();
    // Le clic sur Valider arrive pendant que le serveur n'a pas encore répondu.
    const avantValidation = enr.enregistrer();
    reponse.resoudre('Le sujet doit tenir en 70 caractères.');
    expect(await surPerteDeFocus).toBe(false);
    expect(await avantValidation).toBe(false);
    expect(enr.confirme()).toBe('ancien');
    expect(erreurs.length).toBeGreaterThan(0);
  });

  it('un enregistrement accepté en vol autorise la validation, une seule fois envoyé', async () => {
    let affiche = 'ancien';
    const reponse = differe();
    const envois: string[] = [];
    const enr = creerEnregistreurSujet({
      confirmeInitial: 'ancien',
      lire: () => affiche,
      envoyer: (s) => {
        envois.push(s);
        return reponse.promesse;
      },
      surErreur: () => undefined,
    });
    affiche = 'nouveau';
    const a = enr.enregistrer();
    const b = enr.enregistrer();
    reponse.resoudre(null);
    expect(await a).toBe(true);
    expect(await b).toBe(true);
    expect(envois).toEqual(['nouveau']);
    expect(enr.confirme()).toBe('nouveau');
  });

  it('un sujet vidé n\'est jamais considéré comme enregistré', async () => {
    const enr = creerEnregistreurSujet({
      confirmeInitial: 'ancien',
      lire: () => '',
      envoyer: async () => null,
      surErreur: () => undefined,
    });
    expect(await enr.enregistrer()).toBe(false);
  });
});

describe('un échec par exception est un échec comme un autre', () => {
  it('perte de focus : l\'action qui jette affiche un message et ne rejette pas', async () => {
    const erreurs: string[] = [];
    const enr = creerEnregistreurSujet({
      confirmeInitial: 'ancien',
      lire: () => 'nouveau',
      envoyer: async () => {
        throw new Error('Failed to fetch');
      },
      surErreur: (m) => erreurs.push(m),
    });
    await expect(enr.enregistrer()).resolves.toBe(false);
    expect(erreurs).toEqual(['Failed to fetch']);
    expect(enr.confirme()).toBe('ancien');
  });
});

describe('le clic sur Valider', () => {
  function monde(envoyer: () => Promise<string | null>) {
    const erreurs: string[] = [];
    const validations: string[] = [];
    const enr = creerEnregistreurSujet({ confirmeInitial: 'ancien', lire: () => 'nouveau', envoyer, surErreur: (m) => erreurs.push(m) });
    const valider = () =>
      validerApresEnregistrement({
        enregistreur: enr,
        valider: async () => {
          validations.push('valide');
          return null;
        },
        surErreur: (m) => erreurs.push(m),
      });
    return { erreurs, validations, valider };
  }

  it('ne valide pas quand l\'enregistrement est refusé, et le message est visible', async () => {
    const m = monde(async () => 'Sujet trop long.');
    await m.valider();
    expect(m.validations).toEqual([]);
    expect(m.erreurs).toEqual(['Sujet trop long.']);
  });

  it('ne valide pas quand l\'enregistrement jette, et le message est visible', async () => {
    const m = monde(async () => {
      throw new Error('Failed to fetch');
    });
    await m.valider();
    expect(m.validations).toEqual([]);
    expect(m.erreurs).toEqual(['Failed to fetch']);
  });

  it('valide quand l\'enregistrement a réussi', async () => {
    const m = monde(async () => null);
    await m.valider();
    expect(m.validations).toEqual(['valide']);
  });

  it('affiche l\'exception de la validation elle-même', async () => {
    const erreurs: string[] = [];
    const enr = creerEnregistreurSujet({ confirmeInitial: 'a', lire: () => 'a', envoyer: async () => null, surErreur: () => undefined });
    await validerApresEnregistrement({
      enregistreur: enr,
      valider: async () => {
        throw new Error('coupure');
      },
      surErreur: (m) => erreurs.push(m),
    });
    expect(erreurs).toEqual(['coupure']);
  });
});

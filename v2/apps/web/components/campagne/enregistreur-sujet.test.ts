import { describe, expect, it } from 'vitest';
import { creerEnregistreurSujet } from './enregistreur-sujet';

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

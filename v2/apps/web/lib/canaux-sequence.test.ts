import { describe, expect, it } from 'vitest';
import { aUneEtapeEmail, afficherEtapeEmailVerifie, cleRegleDEntree, compterCanaux, recapSequence, ligneEtapesEtBoites, natureDesCanaux, resumeCanaux, sequenceSansEmail, type LibellesCanaux } from './canaux-sequence';

/** Libellés factices au singulier/pluriel français : rend le décompte lisible dans l'assertion. */
const LIBELLES: LibellesCanaux = {
  email: (n) => `${n} ${n > 1 ? 'emails' : 'email'}`,
  linkedin: (n) => `${n} ${n > 1 ? 'actions' : 'action'} LinkedIn`,
  courrier: (n) => `${n} ${n > 1 ? 'courriers' : 'courrier'}`,
  appel: (n) => `${n} ${n > 1 ? 'appels' : 'appel'}`,
};

describe('compterCanaux', () => {
  it('range invitation et message LinkedIn dans le même compte, courrier et appel à part', () => {
    expect(compterCanaux(['linkedin_invite', 'email', 'linkedin_message', 'letter', 'call', 'call'])).toEqual({
      email: 1,
      linkedin: 2,
      courrier: 1,
      appel: 2,
    });
  });

  it('une séquence vide donne quatre zéros', () => {
    expect(compterCanaux([])).toEqual({ email: 0, linkedin: 0, courrier: 0, appel: 0 });
  });

  it('un canal inconnu n\'est compté nulle part, il ne devient jamais un email', () => {
    expect(compterCanaux(['sms'])).toEqual({ email: 0, linkedin: 0, courrier: 0, appel: 0 });
  });
});

describe('resumeCanaux', () => {
  it('« 2 actions LinkedIn, 1 email » pour invitation, email, message', () => {
    expect(resumeCanaux(compterCanaux(['linkedin_invite', 'email', 'linkedin_message']), LIBELLES)).toBe('2 actions LinkedIn, 1 email');
  });

  it('une invitation seule : « 1 action LinkedIn », jamais « 1 emails »', () => {
    expect(resumeCanaux(compterCanaux(['linkedin_invite']), LIBELLES)).toBe('1 action LinkedIn');
  });

  it('trois emails : « 3 emails », sans mention de LinkedIn', () => {
    expect(resumeCanaux(compterCanaux(['email', 'email', 'email']), LIBELLES)).toBe('3 emails');
  });

  it('les canaux absents ne figurent pas, courrier et appel suivent', () => {
    expect(resumeCanaux(compterCanaux(['email', 'letter', 'call']), LIBELLES)).toBe('1 email, 1 courrier, 1 appel');
  });

  it('une séquence vide donne une chaîne vide', () => {
    expect(resumeCanaux(compterCanaux([]), LIBELLES)).toBe('');
  });
});

describe('aUneEtapeEmail / sequenceSansEmail', () => {
  it('une séquence qui contient un email : boîtes et SalesBlink concernés, un email est requis', () => {
    expect(aUneEtapeEmail(['linkedin_invite', 'email'])).toBe(true);
    expect(sequenceSansEmail(['linkedin_invite', 'email'])).toBe(false);
  });

  it('une séquence 100 % LinkedIn : ni boîtes ni email requis', () => {
    expect(aUneEtapeEmail(['linkedin_invite', 'linkedin_message'])).toBe(false);
    expect(sequenceSansEmail(['linkedin_invite', 'linkedin_message'])).toBe(true);
  });

  it('une séquence VIDE n\'est pas « sans email » : elle ne dit pas par quel canal elle écrira (règle du moteur, sqlCampagneSansEmail)', () => {
    expect(aUneEtapeEmail([])).toBe(false);
    expect(sequenceSansEmail([])).toBe(false);
  });
});

describe('natureDesCanaux', () => {
  it('email seul, LinkedIn seul, mélange, rien', () => {
    expect(natureDesCanaux(['email', 'email'])).toBe('email');
    expect(natureDesCanaux(['linkedin_invite', 'linkedin_message'])).toBe('linkedin');
    expect(natureDesCanaux(['linkedin', 'linkedin'])).toBe('linkedin');
    expect(natureDesCanaux(['linkedin_invite', 'email'])).toBe('mixte');
    expect(natureDesCanaux([])).toBe('vide');
  });

  it('un canal sans nom (courrier, appel, inconnu) rend la nature mixte avec un autre canal, et mixte seul', () => {
    expect(natureDesCanaux(['email', undefined])).toBe('mixte');
    expect(natureDesCanaux(['letter'])).toBe('mixte');
  });
});

describe('ligneEtapesEtBoites', () => {
  /** Mêmes gabarits que fr.json (`aujourdhui.campaigns.steps` / `stepsBoxes` / `noSteps`), sans pluriel pour les boîtes. */
  const t = (cle: 'steps' | 'stepsBoxes' | 'noSteps', v?: { resume: string; boites: number }): string =>
    cle === 'noSteps' ? 'Aucune étape' : cle === 'steps' ? `${v?.resume}` : `${v?.resume} · ${v?.boites} boîtes`;

  it('une campagne qui contient un email montre ses boîtes', () => {
    expect(ligneEtapesEtBoites(['linkedin_invite', 'email', 'linkedin_message'], 3, LIBELLES, t)).toBe('2 actions LinkedIn, 1 email · 3 boîtes');
  });

  it('une campagne 100 % LinkedIn ne parle ni d\'email ni de boîtes', () => {
    expect(ligneEtapesEtBoites(['linkedin_invite'], 3, LIBELLES, t)).toBe('1 action LinkedIn');
  });

  it('une séquence vide le dit', () => {
    expect(ligneEtapesEtBoites([], 3, LIBELLES, t)).toBe('Aucune étape');
  });
});

describe('afficherEtapeEmailVerifie : la marche « Email vérifié » de l’entonnoir d’une liste', () => {
  it('une séquence sans étape email ne parle pas d’email : la marche disparaît', () => {
    expect(afficherEtapeEmailVerifie(['linkedin_invite'])).toBe(false);
    expect(afficherEtapeEmailVerifie(['linkedin_invite', 'linkedin_message'])).toBe(false);
  });

  it('dès qu’une étape est un email, la marche reste', () => {
    expect(afficherEtapeEmailVerifie(['email'])).toBe(true);
    expect(afficherEtapeEmailVerifie(['linkedin_invite', 'email', 'linkedin_message'])).toBe(true);
  });

  it('une séquence vide ne dit pas par quel canal elle écrira : la marche reste', () => {
    expect(afficherEtapeEmailVerifie([])).toBe(true);
  });

  it('suit la même définition que le moteur (sequenceSansEmail)', () => {
    for (const canaux of [[], ['email'], ['linkedin_invite'], ['letter', 'call'], ['call', 'email']]) {
      expect(afficherEtapeEmailVerifie(canaux)).toBe(!sequenceSansEmail(canaux));
    }
  });
});

describe('cleRegleDEntree : la phrase d’entrée de l’onglet Séquence', () => {
  it('une étape email : l’engageur sans email attend (phrase avec attente)', () => {
    expect(cleRegleDEntree(['linkedin_invite', 'email'])).toBe('flow.intoSequence');
    expect(cleRegleDEntree(['email'])).toBe('flow.intoSequence');
  });

  it('aucune étape email : aucune attente', () => {
    expect(cleRegleDEntree(['linkedin_invite', 'linkedin_message'])).toBe('flow.intoSequenceSansEmail');
  });

  it('séquence vide : ni l’une ni l’autre, le moteur ne sait pas par quel canal elle écrira', () => {
    expect(cleRegleDEntree([])).toBe('flow.intoSequenceVide');
  });
});

describe('recapSequence : le récapitulatif de l’assistant', () => {
  const libelles: LibellesCanaux = {
    email: (n) => `${n} email${n > 1 ? 's' : ''}`,
    linkedin: (n) => `${n} action${n > 1 ? 's' : ''} LinkedIn`,
    courrier: (n) => `${n} courrier`,
    appel: (n) => `${n} appel`,
  };
  const textes = {
    vide: 'Aucune étape pour l’instant',
    avec: (v: { resume: string; jours: number }) => `${v.resume} sur ${v.jours} jours`,
  };

  it('zéro étape : « aucune étape », jamais un résumé vide suivi de « sur un seul jour »', () => {
    expect(recapSequence([], libelles, 0, textes)).toBe('Aucune étape pour l’instant');
  });

  it('une séquence mixte garde le résumé par canal', () => {
    expect(recapSequence(['linkedin_invite', 'email', 'linkedin_message'], libelles, 6, textes)).toBe('2 actions LinkedIn, 1 email sur 6 jours');
  });
});

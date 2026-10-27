/**
 * Ce que les écrans ont le droit de dire d'une séquence selon les canaux de ses étapes.
 *
 * Sans `'use client'` : lu par des composants serveur (en-tête, file du jour) ET client (assistant de
 * création). Une fonction exportée d'un module client ne peut pas être appelée côté serveur (voir
 * `frontiere-client-serveur.test.ts`), d'où ce module neutre.
 *
 * Jusqu'ici les écrans parlaient d'email partout : « 3 emails sur 6 jours » pour une invitation LinkedIn, trois
 * boîtes « qui enverront » pour une campagne qui démarre par LinkedIn. Chaque libellé et chaque compteur lit
 * maintenant les canaux réels des étapes.
 */

/** Les canaux d'une étape, comme `sequence_steps.channel` (et `CanalFil` pour une action : `email`, `linkedin`). */
export type CanalBrut = string | null | undefined;

export interface CompteCanaux {
  readonly email: number;
  /** Invitations ET messages LinkedIn : pour l'opérateur, ce sont des actions LinkedIn. */
  readonly linkedin: number;
  readonly courrier: number;
  readonly appel: number;
}

/** Libellés déjà traduits (pluriel ICU résolu par l'appelant) : ce module ne dépend pas de next-intl. */
export interface LibellesCanaux {
  email: (n: number) => string;
  linkedin: (n: number) => string;
  courrier: (n: number) => string;
  appel: (n: number) => string;
}

/** Ce que contient un ensemble de canaux : de l'email seul, du LinkedIn seul, un mélange, ou rien. */
export type NatureCanaux = 'email' | 'linkedin' | 'mixte' | 'vide';

function estLinkedin(canal: string): boolean {
  return canal.startsWith('linkedin');
}

/** Compte les étapes par canal. Un canal inconnu n'est compté nulle part : il ne devient jamais un email. */
export function compterCanaux(canaux: readonly string[]): CompteCanaux {
  let email = 0;
  let linkedin = 0;
  let courrier = 0;
  let appel = 0;
  for (const canal of canaux) {
    if (canal === 'email') email += 1;
    else if (estLinkedin(canal)) linkedin += 1;
    else if (canal === 'letter') courrier += 1;
    else if (canal === 'call') appel += 1;
  }
  return { email, linkedin, courrier, appel };
}

/** « 2 actions LinkedIn, 1 email » : les canaux présents seulement, LinkedIn d'abord. Vide si la séquence l'est. */
export function resumeCanaux(compte: CompteCanaux, libelles: LibellesCanaux): string {
  const parties: string[] = [];
  if (compte.linkedin > 0) parties.push(libelles.linkedin(compte.linkedin));
  if (compte.email > 0) parties.push(libelles.email(compte.email));
  if (compte.courrier > 0) parties.push(libelles.courrier(compte.courrier));
  if (compte.appel > 0) parties.push(libelles.appel(compte.appel));
  return parties.join(', ');
}

/** Au moins une étape email : seul cas où les boîtes d'envoi et SalesBlink concernent la campagne. */
export function aUneEtapeEmail(canaux: readonly string[]): boolean {
  return canaux.includes('email');
}

/**
 * « Cette campagne a une séquence CONNUE, et cette séquence n'envoie aucun email » : la même définition que
 * `sqlCampagneSansEmail` (`apps/worker/src/handlers/post-engagement.ts`), que le moteur applique à l'inscription,
 * au scoring et à l'enrichissement. Une séquence vide ne dit pas par quel canal elle écrira : elle n'est pas
 * « sans email ».
 */
export function sequenceSansEmail(canaux: readonly string[]): boolean {
  return canaux.length > 0 && !aUneEtapeEmail(canaux);
}

/**
 * La marche « Email vérifié » de l'entonnoir d'une campagne à liste. Le moteur n'exige un email que d'une séquence qui
 * contient une étape email (`sequenceSansEmail`) : pour une séquence sans étape email, un contact entre sans email, donc
 * le nombre de contacts à email vérifié ne décrit aucune condition de la campagne. Rien ne la remplace (l'entrée ne
 * pose aucune autre condition mesurée) : la marche disparaît plutôt que de parler d'email. Séquence vide : on ne sait
 * pas par quel canal elle écrira, la marche reste.
 */
export function afficherEtapeEmailVerifie(canaux: readonly string[]): boolean {
  return !sequenceSansEmail(canaux);
}

/**
 * La nature d'un ensemble de canaux (étapes d'une séquence, ou actions d'une journée). Un canal absent, courrier,
 * appel ou inconnu rend le tout `mixte` : on ne le dit pas email, on ne le dit pas LinkedIn.
 */
export function natureDesCanaux(canaux: readonly CanalBrut[]): NatureCanaux {
  if (canaux.length === 0) return 'vide';
  const tousEmail = canaux.every((c) => c === 'email');
  if (tousEmail) return 'email';
  const tousLinkedin = canaux.every((c) => typeof c === 'string' && estLinkedin(c));
  if (tousLinkedin) return 'linkedin';
  return 'mixte';
}

/** Construit les libellés de `resumeCanaux` depuis un `t` lié à l'espace `canauxSequence` (next-intl, côté serveur ou client). */
export function libellesCanaux(t: (cle: string, valeurs: { n: number }) => string): LibellesCanaux {
  return {
    email: (n) => t('email', { n }),
    linkedin: (n) => t('linkedin', { n }),
    courrier: (n) => t('courrier', { n }),
    appel: (n) => t('appel', { n }),
  };
}

/**
 * La ligne « étapes · boîtes » d'une campagne dans un tableau : « 2 actions LinkedIn, 1 email · 3 boîtes ».
 * Les boîtes n'y figurent que s'il existe au moins une étape email, et une séquence vide le dit plutôt que de
 * compter des zéros. `t` est lié à l'espace qui porte `steps`, `stepsBoxes` et `noSteps` (aujourd'hui.campaigns).
 */
export function ligneEtapesEtBoites(
  canaux: readonly string[],
  boites: number,
  libelles: LibellesCanaux,
  t: (cle: 'steps' | 'stepsBoxes' | 'noSteps', valeurs?: { resume: string; boites: number }) => string,
): string {
  if (canaux.length === 0) return t('noSteps');
  const resume = resumeCanaux(compterCanaux(canaux), libelles);
  return aUneEtapeEmail(canaux) ? t('stepsBoxes', { resume, boites }) : t('steps', { resume, boites });
}

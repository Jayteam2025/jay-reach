/**
 * P5 : `statut` vient du layout de campagne et ne change qu'un instant après la
 * réponse de l'action. Le bouton ne doit pas pouvoir rejouer `lancer` dans
 * l'intervalle, ni par un double clic, ni par un second clic après succès.
 *
 * Pas de DOM ici : hooks remplacés par une mémoire minimale, composant appelé
 * comme une fonction, lecture des props du `Bouton` retourné (même méthode que
 * `rafraichissement-etat-local.test.tsx`).
 */
import { isValidElement, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoire = vi.hoisted(() => ({ valeurs: [] as unknown[], curseur: 0, transitions: [] as Promise<unknown>[] }));

vi.mock('react', async (importOriginal) => {
  const reel = await importOriginal<typeof import('react')>();
  return {
    ...reel,
    useState: (initial: unknown) => {
      const i = memoire.curseur++;
      if (!(i in memoire.valeurs)) memoire.valeurs[i] = initial;
      return [
        memoire.valeurs[i],
        (v: unknown) => {
          memoire.valeurs[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(memoire.valeurs[i]) : v;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = memoire.curseur++;
      if (!(i in memoire.valeurs)) memoire.valeurs[i] = { current: initial };
      return memoire.valeurs[i];
    },
    // `pending` reste faux : l'état « en cours » vient du verrou, pas du rendu intermédiaire.
    useTransition: () => [false, (fn: () => Promise<void>) => void memoire.transitions.push(Promise.resolve(fn()))],
  };
});
vi.mock('next-intl', () => ({ useTranslations: () => (cle: string) => cle }));
vi.mock('../../app/actions/campagne-cycle', () => ({ actionLancer: vi.fn(), actionMettreEnPause: vi.fn() }));

import type { CampaignStatus } from '@jay-reach/core';
import { actionLancer, actionMettreEnPause } from '../../app/actions/campagne-cycle';
import { BoutonLancerPause } from './BoutonLancerPause';

beforeEach(() => {
  memoire.valeurs.length = 0;
  memoire.transitions.length = 0;
  vi.mocked(actionLancer).mockReset();
  vi.mocked(actionMettreEnPause).mockReset();
});

type Element = ReactElement<Record<string, unknown>>;

function rendre(statut: CampaignStatus): Element {
  memoire.curseur = 0;
  const arbre = BoutonLancerPause({ campagneId: 'c1', statut });
  if (!isValidElement(arbre)) throw new Error('rien rendu');
  // Fragment > [Bouton, notification] : on lit le premier enfant.
  const enfants = (arbre as Element).props.children as Element[];
  return enfants[0]!;
}

const cliquer = (b: Element) => (b.props.onClick as () => void)();
const attendre = () => Promise.all(memoire.transitions.splice(0));

describe('BoutonLancerPause : une seule action par changement de statut', () => {
  it('un double clic dans le même tick ne lance qu’une fois', async () => {
    vi.mocked(actionLancer).mockResolvedValue({ ok: true });
    const bouton = rendre('draft');
    cliquer(bouton);
    cliquer(bouton);
    await attendre();
    expect(actionLancer).toHaveBeenCalledTimes(1);
  });

  it('après un succès, tant que le statut du layout n’a pas changé, le bouton reste verrouillé et un clic ne relance pas', async () => {
    vi.mocked(actionLancer).mockResolvedValue({ ok: true });
    cliquer(rendre('draft'));
    await attendre();

    const apres = rendre('draft'); // le layout n'a pas encore appliqué le nouveau statut
    expect(apres.props.disabled).toBe(true);
    cliquer(apres);
    await attendre();
    expect(actionLancer).toHaveBeenCalledTimes(1);
  });

  it('dès que le statut a changé, le bouton est de nouveau actionnable (Pause)', async () => {
    vi.mocked(actionLancer).mockResolvedValue({ ok: true });
    vi.mocked(actionMettreEnPause).mockResolvedValue({ ok: true });
    cliquer(rendre('draft'));
    await attendre();

    const enPause = rendre('active');
    expect(enPause.props.disabled).toBe(false);
    cliquer(enPause);
    await attendre();
    expect(actionMettreEnPause).toHaveBeenCalledTimes(1);
  });

  it('un lancement refusé libère le bouton : on peut réessayer', async () => {
    vi.mocked(actionLancer).mockResolvedValueOnce({ ok: false, manques: ['pas de boîte'] });
    cliquer(rendre('draft'));
    await attendre();

    const apres = rendre('draft');
    expect(apres.props.disabled).toBe(false);
    vi.mocked(actionLancer).mockResolvedValueOnce({ ok: true });
    cliquer(apres);
    await attendre();
    expect(actionLancer).toHaveBeenCalledTimes(2);
  });
});

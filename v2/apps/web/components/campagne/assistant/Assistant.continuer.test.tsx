/**
 * `continuer()` de l'assistant, rendu pour de vrai : la fonction composant est appelée avec ses vraies closures
 * (même méthode que `rafraichissement-etat-local.test.tsx`, pas de DOM dans cet environnement) et les messages
 * sont les vrais, ceux de `fr.json`. On clique « Continuer » comme l'opérateur, on lit ce qui s'affiche.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoire = vi.hoisted(() => ({ valeurs: [] as unknown[], curseur: 0 }));

vi.mock('react', async (importOriginal) => {
  const reel = await importOriginal<typeof import('react')>();
  return {
    ...reel,
    useState: (initial: unknown) => {
      const i = memoire.curseur++;
      if (!(i in memoire.valeurs)) memoire.valeurs[i] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
      const poser = (v: unknown) => {
        memoire.valeurs[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(memoire.valeurs[i]) : v;
      };
      return [memoire.valeurs[i], poser];
    },
    useTransition: () => [false, () => undefined],
  };
});
vi.mock('next-intl', async (importOriginal) => {
  const reel = await importOriginal<typeof import('next-intl')>();
  const messages: Record<string, unknown> = JSON.parse(
    readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../../../../../packages/i18n/src/messages/fr.json'), 'utf8'),
  );
  return { ...reel, useTranslations: (namespace: string) => reel.createTranslator({ locale: 'fr', messages, namespace }) };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../../app/actions/nouvelle-campagne', () => ({ actionCreerCampagneComplete: vi.fn() }));

import { Assistant } from './Assistant';
import { EtapeQui } from './EtapeQui';
import { EtapeSequence } from './EtapeSequence';

type Element = ReactElement<Record<string, unknown>>;

function rendre(props: Parameters<typeof Assistant>[0]): Element {
  memoire.curseur = 0;
  const arbre = Assistant(props);
  if (!isValidElement(arbre)) throw new Error('l’assistant ne rend pas un élément');
  return arbre as Element;
}

function chercher(noeud: ReactNode, test: (el: Element) => boolean, trouves: Element[] = []): Element[] {
  if (Array.isArray(noeud)) noeud.forEach((n) => chercher(n, test, trouves));
  else if (isValidElement(noeud)) {
    const el = noeud as Element;
    if (test(el)) trouves.push(el);
    chercher(el.props.children as ReactNode, test, trouves);
  }
  return trouves;
}

function cliquerContinuer(arbre: Element): void {
  const [bouton] = chercher(arbre, (el) => el.props.children === 'Continuer' && typeof el.props.onClick === 'function');
  if (!bouton) throw new Error('bouton « Continuer » introuvable');
  (bouton.props.onClick as () => void)();
}

function alerte(arbre: Element): string | null {
  const [el] = chercher(arbre, (e) => e.props.role === 'alert');
  return el ? String(el.props.children) : null;
}

const PROPS = { personas: [], boites: [], relectureDefaut: 0, linkedinConnecte: false };

beforeEach(() => {
  memoire.valeurs.length = 0;
});

describe('Assistant : « Continuer » depuis l’étape Séquence', () => {
  /** Passe l'étape Qui puis Sources en cliquant, et rend l'assistant sur l'étape Séquence. */
  function jusqueLaSequence(): Element {
    const qui = chercher(rendre(PROPS), (el) => el.type === EtapeQui)[0]!;
    (qui.props.onNomChange as (v: string) => void)('Ma campagne');
    cliquerContinuer(rendre(PROPS));
    cliquerContinuer(rendre(PROPS));
    return rendre(PROPS);
  }

  it('une étape email sans objet : le message traduit s’affiche et l’étape fautive s’ouvre', () => {
    const sequence = chercher(jusqueLaSequence(), (el) => el.type === EtapeSequence)[0]!;
    const etapes = sequence.props.etapes as readonly { cle: string }[];
    expect(etapes.length).toBeGreaterThan(2);
    const fautive = etapes[2]!.cle;
    expect(sequence.props.etapeOuverte).toBe(etapes[0]!.cle);

    (sequence.props.onModifierEtape as (cle: string, patch: { sujet: string }) => void)(fautive, { sujet: '  ' });
    cliquerContinuer(rendre(PROPS));

    const apres = rendre(PROPS);
    expect(alerte(apres)).toBe("L'étape 3 est un email sans objet : écrivez son objet avant de continuer.");
    expect(chercher(apres, (el) => el.type === EtapeSequence)[0]!.props.etapeOuverte).toBe(fautive);
    // Et on est restés sur l'étape Séquence : le bouton principal est toujours « Continuer ».
    expect(chercher(apres, (el) => el.type === EtapeSequence)).toHaveLength(1);
  });

  it('une séquence complète passe à l’étape Envoi sans erreur', () => {
    jusqueLaSequence();
    cliquerContinuer(rendre(PROPS));
    const apres = rendre(PROPS);
    expect(alerte(apres)).toBeNull();
    expect(chercher(apres, (el) => el.type === EtapeSequence)).toHaveLength(0);
  });
});

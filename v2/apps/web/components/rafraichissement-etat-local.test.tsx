/**
 * P2 (lot 2) : sans `window.location.reload()`, le composant n'est plus
 * remonté après l'action. Tout état local que le rechargement remettait à
 * zéro doit donc l'être explicitement.
 *
 * Pas de DOM dans cet environnement (vitest `node`, ni jsdom ni Testing
 * Library) : les hooks `useState`/`useTransition` sont remplacés par une
 * mémoire minimale, le composant est appelé comme une fonction, et on lit
 * l'arbre d'éléments retourné (props `value`, `note`, `onClick`). C'est un vrai
 * rendu de la fonction composant avec ses vraies closures, pas une relecture
 * de la source.
 */
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const memoire = vi.hoisted(() => ({ valeurs: [] as unknown[], curseur: 0, transitions: [] as Promise<unknown>[] }));

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
    useTransition: () => [false, (fn: () => Promise<void>) => void memoire.transitions.push(Promise.resolve(fn()))],
  };
});
vi.mock('../app/actions/inbox', () => ({ repondre: vi.fn(), marquerInteret: vi.fn(), marquerTraite: vi.fn() }));
vi.mock('../app/actions/enrichir', () => ({ enrichirMaintenant: vi.fn() }));
vi.mock('../app/actions/contacts', () => ({ actionChercherEmailContact: vi.fn() }));

import { repondre, marquerInteret } from '../app/actions/inbox';
import { enrichirMaintenant } from '../app/actions/enrichir';
import { actionChercherEmailContact } from '../app/actions/contacts';
import { ZoneReponseFil } from './reception/ZoneReponseFil';
import { BoutonChercherEmail } from './campagne/BoutonChercherEmail';
import { BoutonChercherEmailContact } from './contact/BoutonChercherEmailContact';

const reload = vi.fn();

beforeEach(() => {
  memoire.valeurs.length = 0;
  memoire.transitions.length = 0;
  reload.mockReset();
  vi.mocked(repondre).mockReset();
  vi.mocked(marquerInteret).mockReset();
  vi.mocked(enrichirMaintenant).mockReset();
  vi.mocked(actionChercherEmailContact).mockReset();
  vi.stubGlobal('window', { location: { reload } });
});

/** Rend le composant (appel direct de la fonction) en rejouant les hooks depuis le début. */
type Element = ReactElement<Record<string, unknown>>;

function rendre<P>(composant: (p: P) => ReactNode, props: P): Element {
  memoire.curseur = 0;
  const arbre = composant(props);
  if (!isValidElement(arbre)) throw new Error('le composant ne rend pas un élément');
  return arbre as Element;
}

async function attendreTransitions(): Promise<void> {
  await Promise.all(memoire.transitions.splice(0));
}

/** Parcourt l'arbre d'éléments (props.children comprises) et renvoie les éléments qui satisfont `test`. */
function chercher(noeud: ReactNode, test: (el: ReactElement<Record<string, unknown>>) => boolean, trouves: ReactElement<Record<string, unknown>>[] = []) {
  if (Array.isArray(noeud)) {
    noeud.forEach((n) => chercher(n, test, trouves));
  } else if (isValidElement(noeud)) {
    const el = noeud as ReactElement<Record<string, unknown>>;
    if (test(el)) trouves.push(el);
    for (const cle of ['children', 'actions']) chercher(el.props[cle] as ReactNode, test, trouves);
  }
  return trouves;
}

const PROPS_ZONE = {
  filId: 'fil-1',
  depuis: 'boîte',
  placeholder: 'Écrire…',
  note: 'Note habituelle',
  interet: null,
  libelleMarquerInteresse: 'Intéressé',
  libelleRetirerInteret: 'Retirer',
  libelleEnvoyer: 'Envoyer',
  libelleEnvoiEnCours: 'Envoi…',
  libelleEnvoyee: 'Envoyée',
  reponsePossible: true,
  raisonIndisponible: null,
} as const;

describe('ZoneReponseFil sans rechargement', () => {
  function boutons(arbre: Element) {
    const tous = chercher(arbre.props.actions as ReactNode, (el) => typeof el.props.onClick === 'function');
    return { interet: tous[0]!, envoyer: tous[1]! };
  }

  it("après un envoi réussi le champ de réponse est vidé (c'est le rechargement qui le faisait)", async () => {
    vi.mocked(repondre).mockResolvedValue({ ok: true });
    let arbre = rendre(ZoneReponseFil, PROPS_ZONE);
    (arbre.props.onChange as (v: string) => void)('Bonjour, merci pour votre retour');
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);
    expect(arbre.props.value).toBe('Bonjour, merci pour votre retour');

    (boutons(arbre).envoyer.props.onClick as () => void)();
    await attendreTransitions();
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);

    expect(repondre).toHaveBeenCalledWith('fil-1', 'Bonjour, merci pour votre retour');
    expect(arbre.props.value).toBe('');
    expect(arbre.props.note).toBe('Envoyée');
    expect(reload).not.toHaveBeenCalled();
  });

  it('un envoi refusé garde le brouillon et affiche l’erreur', async () => {
    vi.mocked(repondre).mockResolvedValue({ ok: false, error: 'Refusé par la boîte' });
    let arbre = rendre(ZoneReponseFil, PROPS_ZONE);
    (arbre.props.onChange as (v: string) => void)('Mon brouillon');
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);

    (boutons(arbre).envoyer.props.onClick as () => void)();
    await attendreTransitions();
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);

    expect(arbre.props.value).toBe('Mon brouillon');
    expect(arbre.props.note).toBe('Refusé par la boîte');
  });

  it("marquer l'intérêt ne recharge pas la page et ne touche pas au brouillon", async () => {
    vi.mocked(marquerInteret).mockResolvedValue({ ok: true });
    let arbre = rendre(ZoneReponseFil, PROPS_ZONE);
    (arbre.props.onChange as (v: string) => void)('Brouillon en cours');
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);

    (boutons(arbre).interet.props.onClick as () => void)();
    await attendreTransitions();
    arbre = rendre(ZoneReponseFil, PROPS_ZONE);

    expect(marquerInteret).toHaveBeenCalledWith('fil-1', 'interested');
    expect(arbre.props.value).toBe('Brouillon en cours');
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('Chercher l’email sans rechargement', () => {
  function bouton(arbre: Element) {
    return chercher(arbre, (el) => el.type === 'button')[0];
  }

  it('BoutonChercherEmail : après succès le bouton redevient cliquable (le rechargement le rendait tel quel)', async () => {
    vi.mocked(enrichirMaintenant).mockResolvedValue({ ok: true, message: 'ok' });
    const props = { organisationId: 'o1', signalId: 's1', libelle: 'Chercher l’email', cout: '1 crédit', raisonIndisponible: null };
    let arbre = rendre(BoutonChercherEmail, props);
    (bouton(arbre)!.props.onClick as () => void)();
    await attendreTransitions();
    arbre = rendre(BoutonChercherEmail, props);

    expect(enrichirMaintenant).toHaveBeenCalledWith('o1', 's1');
    expect(bouton(arbre)).toBeDefined();
    expect(reload).not.toHaveBeenCalled();
  });

  it('BoutonChercherEmailContact : même contrat', async () => {
    vi.mocked(actionChercherEmailContact).mockResolvedValue({ ok: true });
    const props = { contactId: 'c1', libelle: 'Chercher l’email', cout: '1 crédit', raisonIndisponible: null };
    let arbre = rendre(BoutonChercherEmailContact, props);
    (bouton(arbre)!.props.onClick as () => void)();
    await attendreTransitions();
    arbre = rendre(BoutonChercherEmailContact, props);

    expect(actionChercherEmailContact).toHaveBeenCalledWith('c1');
    expect(bouton(arbre)).toBeDefined();
    expect(reload).not.toHaveBeenCalled();
  });
});

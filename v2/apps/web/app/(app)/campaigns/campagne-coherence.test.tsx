/**
 * Contradictions entre écrans d'une même campagne (audit UI du 14/10, bloquants 2 et 3) :
 *  - l'onglet Sources disait « Aucune source » pour une campagne à liste importée, que la vue
 *    d'ensemble, la liste des campagnes et la Séquence décrivent correctement ;
 *  - « Persona Jay coach - RH » affichait le NOM DE LA CAMPAGNE comme persona, alors que la
 *    campagne n'en vise aucun (Réglages : « Aucun persona ciblé »).
 * Les pages sont rendues pour de bon, avec un traducteur réel ; seules les lectures de données
 * sont substituées, par des objets du type réel de `@jay-reach/core`.
 */
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import fr from '@jay-reach/i18n/messages/fr.json';
import type { CampagneListeResume, PersonaCampagne, VueDEnsemble } from '@jay-reach/core';

const etat = vi.hoisted(() => ({
  campagnes: [] as unknown[],
  sources: [] as unknown[],
  personas: [] as unknown[],
  vue: null as unknown,
}));

vi.mock('next-intl/server', async () => {
  const { createTranslator: creer } = await import('next-intl');
  const messages = (await import('@jay-reach/i18n/messages/fr.json')).default;
  return { getTranslations: async (namespace: string) => creer({ locale: 'fr', messages, namespace }) };
});
vi.mock('next/navigation', () => ({ notFound: () => undefined, useRouter: () => ({}), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));
vi.mock('../../../lib/contexte', () => ({ contexteCourant: async () => ({ role: 'admin', organisationId: 'o', utilisateurId: 'u', ex: {} }) }));
vi.mock('../../../lib/campagne', () => ({ lireVueDEnsembleCourante: async () => etat.vue }));
vi.mock('../../../lib/nombres', async (importOriginal) => ({ ...(await importOriginal<object>()), localeCourante: async () => 'fr' }));
vi.mock('@jay-reach/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listerCampagnes: async () => etat.campagnes,
  listerSourcesCampagne: async () => etat.sources,
  listerPersonasCampagne: async () => etat.personas,
  listerListesOrganisation: async () => [],
}));

import CampagnesPage from './page';
import CampagneSourcesPage from './[id]/sources/page';

const CAMPAGNE_RH: CampagneListeResume = {
  id: 'camp-rh',
  nom: 'Jay coach - RH',
  statut: 'active',
  boites: [],
  sources: [],
  personas: [],
  qualifies: 0,
  contacts: 167,
  enSequence: 167,
  enPause: 0,
  reponses: 0,
  tauxReponse: null,
  tendance7j: [0, 0, 0, 0, 0, 0, 0],
  interesses: 0,
  derniereActivite: null,
  listeSource: { nom: 'RH Jay coach (Smartlead mai-juillet 2026)', autresListes: 0 },
};

function vueListe(): VueDEnsemble {
  return {
    campagne: { id: 'camp-rh', nom: 'Jay coach - RH', statut: 'active' },
    listeSource: { nom: 'RH Jay coach (Smartlead mai-juillet 2026)', contacts: 167, importeeLe: '2026-09-17T08:00:00.000Z', autresListes: 0 },
    sources: [],
  } as unknown as VueDEnsemble;
}

beforeEach(() => {
  etat.campagnes = [CAMPAGNE_RH];
  etat.sources = [];
  etat.personas = [];
  etat.vue = vueListe();
});

describe('Liste des campagnes : le persona', () => {
  it('une campagne sans persona n’affiche pas son propre nom comme persona', async () => {
    const html = renderToStaticMarkup(await CampagnesPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain('Persona Jay coach - RH');
    expect(html).toContain('RH Jay coach (Smartlead mai-juillet 2026)');
  });

  it('une campagne qui vise un persona affiche le nom de CE persona', async () => {
    etat.campagnes = [{ ...CAMPAGNE_RH, nom: 'Recette LinkedIn lot 4b', personas: ['Directeur commercial'], listeSource: null }];
    const html = renderToStaticMarkup(await CampagnesPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Persona Directeur commercial');
    expect(html).not.toContain('Persona Recette LinkedIn lot 4b');
  });
});

describe('Onglet Sources d’une campagne', () => {
  const rendre = async () =>
    renderToStaticMarkup(
      <NextIntlClientProvider locale="fr" messages={fr} timeZone="Europe/Paris">
        {await CampagneSourcesPage({ params: Promise.resolve({ id: 'camp-rh' }), searchParams: Promise.resolve({}) })}
      </NextIntlClientProvider>,
    );

  it('une campagne à liste importée montre sa liste, pas « Aucune source pour l’instant »', async () => {
    const html = await rendre();
    expect(html).not.toContain('Aucune source pour l&#x27;instant');
    expect(html).toContain('RH Jay coach (Smartlead mai-juillet 2026)');
    expect(html).toContain('167 contacts');
  });

  it('sans liste ni source, l’état vide reste affiché', async () => {
    etat.vue = { ...(vueListe() as object), listeSource: null } as unknown as VueDEnsemble;
    const html = await rendre();
    expect(html).toContain('Aucune source pour l&#x27;instant');
  });

  it('la description ne cite pas le nom de la campagne comme persona', async () => {
    const html = await rendre();
    expect(html).not.toContain('persona « Jay coach - RH »');
  });

  it('la description cite le persona réellement ciblé quand il y en a un', async () => {
    const persona: PersonaCampagne = { id: 'p-1', nom: 'RH decideur' };
    etat.personas = [persona];
    const html = await rendre();
    expect(html).toContain('persona « RH decideur »');
  });
});

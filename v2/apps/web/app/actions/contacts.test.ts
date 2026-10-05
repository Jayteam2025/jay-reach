import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/contexte', () => ({ contexteCourant: vi.fn() }));
vi.mock('@jay-reach/core', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@jay-reach/core')>();
  return { ...reel, ajouterNote: vi.fn(), nePlusContacter: vi.fn(), chercherEmail: vi.fn() };
});

import { revalidatePath } from 'next/cache';
import { contexteCourant } from '../../lib/contexte';
import { ajouterNote, nePlusContacter, chercherEmail } from '@jay-reach/core';
import { actionAjouterNote, actionNePlusContacter, actionChercherEmailContact } from './contacts';

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(contexteCourant).mockResolvedValue({ organisationId: 'org-1' } as unknown as Awaited<ReturnType<typeof contexteCourant>>);
  vi.mocked(ajouterNote).mockResolvedValue({ id: 'n1' } as never);
  vi.mocked(nePlusContacter).mockResolvedValue(undefined as never);
  vi.mocked(chercherEmail).mockResolvedValue(undefined as never);
});

/**
 * La fiche (tiroir) s'ouvre sur `/contacts` ET sur l'onglet Contacts d'une
 * campagne. Sans `window.location.reload()`, seule la page revalidée se met à
 * jour : les deux doivent l'être.
 */
describe('Fiche contact : une mutation revalide les deux pages qui hébergent le tiroir', () => {
  it.each([
    ['actionAjouterNote', () => actionAjouterNote('c1', 'une note')],
    ['actionNePlusContacter', () => actionNePlusContacter('c1')],
    ['actionChercherEmailContact', () => actionChercherEmailContact('c1')],
  ])('%s', async (_nom, appel) => {
    const res = await appel();
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/contacts');
    expect(revalidatePath).toHaveBeenCalledWith('/campaigns/[id]/contacts', 'page');
  });
});

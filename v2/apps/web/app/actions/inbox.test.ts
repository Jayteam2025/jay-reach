import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/contexte', () => ({ contexteCourant: vi.fn() }));
vi.mock('../../lib/graph', () => ({ resolveGraphConfig: vi.fn() }));
vi.mock('../../lib/salesblink', () => ({ resolveSalesblinkKey: vi.fn() }));
vi.mock('@jay-reach/providers/mail', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@jay-reach/providers/mail')>();
  return { ...reel, repondreDansLaBoite: vi.fn() };
});
vi.mock('@jay-reach/providers/outreach', () => ({ repondreDansLeFil: vi.fn() }));
vi.mock('@jay-reach/core', async (importOriginal) => {
  const reel = await importOriginal<typeof import('@jay-reach/core')>();
  return { ...reel, repondre: vi.fn(), marquerTraite: vi.fn(), marquerInteret: vi.fn() };
});

import { revalidatePath } from 'next/cache';
import { contexteCourant } from '../../lib/contexte';
import { repondre as repondreCoeur, marquerTraite as marquerTraiteCoeur, marquerInteret as marquerInteretCoeur } from '@jay-reach/core';
import { repondre, marquerTraite, marquerInteret } from './inbox';

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(contexteCourant).mockResolvedValue({ organisationId: 'org-1' } as unknown as Awaited<ReturnType<typeof contexteCourant>>);
  vi.mocked(repondreCoeur).mockResolvedValue(undefined as never);
  vi.mocked(marquerTraiteCoeur).mockResolvedValue(undefined as never);
  vi.mocked(marquerInteretCoeur).mockResolvedValue(undefined as never);
});

/**
 * Le badge « à traiter » de la barre latérale est rendu par le layout du
 * groupe `(app)` : `revalidatePath('/inbox')` seul ne le met pas à jour.
 */
describe('Réception : une mutation revalide la page ET le layout (badge de la barre latérale)', () => {
  it.each([
    ['repondre', () => repondre('fil-1', 'Bonjour')],
    ['marquerTraite', () => marquerTraite('fil-1', true)],
    ['marquerInteret', () => marquerInteret('fil-1', 'interested')],
  ])('%s', async (_nom, appel) => {
    const res = await appel();
    expect(res.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/inbox');
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('un échec ne revalide rien', async () => {
    vi.mocked(marquerTraiteCoeur).mockRejectedValue(new Error('boom'));
    const res = await marquerTraite('fil-1', true);
    expect(res.ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

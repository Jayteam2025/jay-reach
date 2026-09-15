import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/auth', () => ({ requireRole: vi.fn() }));
vi.mock('../../lib/supabase/server', () => ({ createClient: vi.fn() }));

import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { enrichirMaintenant } from './enrichir';

/**
 * Client Supabase factice minimal : la première requête (lecture du signal)
 * ne renvoie rien, donc `enrichirMaintenant` s'arrête juste après le contrôle
 * de rôle — suffisant pour vérifier CE rôle (R35, tour de correction 1) sans
 * rejouer toute la chaîne d'enrichissement.
 */
function clientFactice() {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null });
  const eq = vi.fn(() => ({ eq, maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  return { from };
}

describe('enrichirMaintenant', () => {
  it('exige le rôle operator, pas admin (R35)', async () => {
    vi.mocked(requireRole).mockResolvedValue('operator');
    vi.mocked(createClient).mockResolvedValue(clientFactice() as unknown as Awaited<ReturnType<typeof createClient>>);

    await enrichirMaintenant('org-1', 'signal-1');

    expect(requireRole).toHaveBeenCalledWith('org-1', 'operator');
    expect(requireRole).not.toHaveBeenCalledWith('org-1', 'admin');
  });

  it("un rôle insuffisant renvoie une erreur sans appeler Supabase", async () => {
    vi.mocked(requireRole).mockRejectedValue(new Error('rôle insuffisant'));
    const client = clientFactice();
    vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);

    const resultat = await enrichirMaintenant('org-1', 'signal-1');

    expect(resultat).toEqual({ ok: false, error: 'Droit opérateur requis.' });
    expect(client.from).not.toHaveBeenCalled();
  });
});

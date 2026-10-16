/**
 * Garde à l'écriture de `linkedin_provider_id` : seul un identifiant de membre LinkedIn (forme nue)
 * est écrit, jamais l'UUID d'un fournisseur. Le SQL, lui, ne se prouve pas ici (pool factice).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { persistEnrichedContact } from './enrichment-persist.js';

const UUID = '015fc7a2-abd9-500c-a379-b5268f293c13';

async function ecrit(linkedinProviderId: string | null): Promise<unknown[][]> {
  const query = vi.fn(async () => ({ rows: [{ id: 'c-1' }], rowCount: 1 }));
  await persistEnrichedContact({ query } as unknown as Pool, 'org-1', 'acc-1', {
    email: 'jeanne@example.test',
    linkedinUrl: 'https://www.linkedin.com/in/jeanne-dupont',
    linkedinProviderId,
  });
  return query.mock.calls.map((c) => (c as unknown[])[1] as unknown[]);
}

describe('persistEnrichedContact : linkedin_provider_id', () => {
  it("n'écrit pas un UUID de fournisseur", async () => {
    const valeurs = await ecrit(UUID);
    expect(valeurs.length).toBeGreaterThan(0);
    for (const v of valeurs) expect(v).not.toContain(UUID);
  });

  it('dit son refus sans recopier la valeur', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await ecrit('Zq7Xk2');
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).not.toContain('Zq7');
    warn.mockRestore();
  });

  it("écrit un URN complet sous sa forme nue", async () => {
    const valeurs = await ecrit('urn:li:fsd_profile:ACoAAB1234567890');
    expect(valeurs.some((v) => v.includes('ACoAAB1234567890'))).toBe(true);
    for (const v of valeurs) expect(v).not.toContain('urn:li:fsd_profile:ACoAAB1234567890');
  });
});

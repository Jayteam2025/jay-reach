/**
 * `runFindContacts` : l'identifiant du profil CHEZ FullEnrich (un UUID) n'est jamais écrit comme
 * identifiant de membre LinkedIn. 353 contacts sur 590 portaient un UUID dans `linkedin_provider_id`.
 */
import { describe, expect, it, vi } from 'vitest';

const UUID = '015fc7a2-abd9-500c-a379-b5268f293c13';

vi.mock('@jay-reach/providers/enrichment', () => ({
  resolveCompany: vi.fn(),
  filterOutRecruiters: (p: unknown[]) => p,
  searchContactsAtCompany: vi.fn(async () => ({
    people: [
      {
        id: UUID,
        first_name: 'Jeanne',
        last_name: 'Dupont',
        social_profiles: { professional_network: { url: 'https://www.linkedin.com/in/jeanne-dupont' } },
      },
    ],
    totalAvailable: 1,
    creditsUsed: 0,
  })),
  enrichContactsViaFullEnrich: vi.fn(async () => ({ id: 'e1', resultsByKey: new Map([['c_0', {}]]), creditsUsed: 0 })),
  pickBestEmailWithSource: vi.fn(() => ({ email: 'jeanne@example.test' })),
}));

import { runFindContacts } from './enrich.js';

describe('runFindContacts', () => {
  it("n'écrit jamais l'identifiant FullEnrich comme identifiant de membre LinkedIn", async () => {
    const out = await runFindContacts('cle', {
      organizationId: 'org-1',
      accountId: 'acc-1',
      companyName: 'Acme',
      positionTitles: ['Directeur commercial'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]?.linkedinProviderId).toBeNull();
    expect(out[0]?.linkedinUrl).toBe('https://www.linkedin.com/in/jeanne-dupont');
    expect(JSON.stringify(out)).not.toContain(UUID);
  });
});

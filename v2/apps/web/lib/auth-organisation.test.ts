import { describe, it, expect, vi, beforeEach } from 'vitest';

const createClient = vi.fn();
vi.mock('./supabase/server', () => ({ createClient: () => createClient() }));

const { getCurrentOrganizationId } = await import('./auth');

interface Tri {
  readonly colonne: string;
  readonly options: unknown;
}

/**
 * Client Supabase factice : retient la suite des `order` demandés et rend les
 * lignes fournies. Une adhésion sans tri déterministe rendrait n'importe
 * laquelle des deux.
 */
function clientFactice(lignes: { organization_id: string }[]): { tris: Tri[] } {
  const tris: Tri[] = [];
  const requete = {
    select: () => requete,
    eq: () => requete,
    order: (colonne: string, options: unknown) => {
      tris.push({ colonne, options });
      return requete;
    },
    limit: () => Promise.resolve({ data: lignes }),
  };
  createClient.mockReturnValue({
    auth: { getUser: async () => ({ data: { user: { id: 'utilisateur-1' } } }) },
    from: () => requete,
  });
  return { tris };
}

describe('getCurrentOrganizationId', () => {
  beforeEach(() => {
    createClient.mockReset();
  });

  it("trie sur la date d'adhésion puis l'organisation : deux adhésions rendent toujours la même", async () => {
    const { tris } = clientFactice([{ organization_id: 'org-a' }, { organization_id: 'org-b' }]);

    const org = await getCurrentOrganizationId();

    expect(org).toBe('org-a');
    // Sans tri, la base rend les lignes dans l'ordre qui l'arrange : deux
    // appels successifs peuvent désigner deux organisations différentes, et
    // l'action écrit alors dans la mauvaise.
    expect(tris).toEqual([
      { colonne: 'created_at', options: { ascending: true } },
      { colonne: 'organization_id', options: { ascending: true } },
    ]);
  });

  it('sans adhésion : null', async () => {
    clientFactice([]);
    expect(await getCurrentOrganizationId()).toBeNull();
  });

  it('sans session : null, sans requête sur les adhésions', async () => {
    createClient.mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null } }) },
      from: () => {
        throw new Error('aucune requête ne doit partir sans session');
      },
    });
    expect(await getCurrentOrganizationId()).toBeNull();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `cache()` de React ne mémoïse que dans un rendu serveur ; ici on la remplace
// par une mémoïsation par arguments, remise à zéro avec `nouveauRendu()`.
const caches: Map<string, unknown>[] = [];
vi.mock('react', async (importOriginal) => {
  const original = await importOriginal<typeof import('react')>();
  return {
    ...original,
    cache: <A extends unknown[], R>(fn: (...args: A) => R) => {
      const memo = new Map<string, unknown>();
      caches.push(memo);
      return (...args: A): R => {
        const cle = JSON.stringify(args);
        if (!memo.has(cle)) memo.set(cle, fn(...args));
        return memo.get(cle) as R;
      };
    },
  };
});
function nouveauRendu(): void {
  for (const memo of caches) memo.clear();
}

const getUserReseau = vi.fn();
const requete = {
  select: () => requete,
  eq: () => requete,
  order: () => requete,
  limit: () =>
    Object.assign(Promise.resolve({ data: [{ organization_id: 'org-a' }] }), {
      maybeSingle: () => Promise.resolve({ data: { organizations: { default_locale: 'en' } } }),
    }),
  maybeSingle: () => Promise.resolve({ data: { role: 'admin' } }),
};
const clientFactice = { auth: { getUser: getUserReseau }, from: () => requete };
vi.mock('./supabase/server', () => ({
  createClient: async () => clientFactice,
  createClientOrNull: async () => clientFactice,
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next-intl/server', () => ({ getRequestConfig: (f: unknown) => f }));

const { getUser, getMembershipRole, getCurrentOrganizationId } = await import('./auth');
const configI18n = (await import('../i18n/request')).default as unknown as () => Promise<{ locale: string }>;

describe("un rendu ne fait qu'un aller-retour d'authentification", () => {
  beforeEach(() => {
    getUserReseau.mockReset();
    getUserReseau.mockResolvedValue({ data: { user: { id: 'u1' } } });
    nouveauRendu();
  });

  it('deux getUser dans le même rendu : un seul appel réseau', async () => {
    await getUser();
    await getUser();
    expect(getUserReseau).toHaveBeenCalledTimes(1);
  });

  it('getMembershipRole et getCurrentOrganizationId réutilisent le getUser du rendu', async () => {
    await getUser();
    expect(await getMembershipRole('org-a')).toBe('admin');
    expect(await getCurrentOrganizationId()).toBe('org-a');
    expect(getUserReseau).toHaveBeenCalledTimes(1);
  });

  it('le choix de la langue partage le getUser du reste du rendu', async () => {
    const { locale } = await configI18n();
    await getUser();
    expect(locale).toBe('en');
    expect(getUserReseau).toHaveBeenCalledTimes(1);
  });

  it("un rendu suivant redemande l'utilisateur (pas de fuite entre requêtes)", async () => {
    await getUser();
    nouveauRendu();
    await getUser();
    expect(getUserReseau).toHaveBeenCalledTimes(2);
  });

  it('sans session : null, comme avant', async () => {
    getUserReseau.mockResolvedValue({ data: { user: null } });
    expect(await getUser()).toBeNull();
    expect(await getMembershipRole('org-a')).toBeNull();
    expect(await getCurrentOrganizationId()).toBeNull();
  });
});

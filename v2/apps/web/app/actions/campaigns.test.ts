import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ORG_ID = 'org-1';
const CAMPAIGN_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/**
 * `contexteCourant` factice : la façade (tâche 7) ne parle plus directement à
 * Supabase pour `setCampaignStatus` — elle appelle `mettreEnPause`/`lancer`/
 * `archiver` (packages/core) avec un `Contexte` dont `ex.query` est ce mock.
 * `role` pilote `exiger` (viewer < operator ⇒ `ForbiddenError`) ;
 * `erreurJournal`, si posée, fait échouer le seul `insert into audit_events`.
 */
function creerContexteFactice(opts: { role: 'viewer' | 'operator' | 'admin' | null; erreurJournal?: Error }) {
  const appels: { sql: string; params: unknown[] }[] = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    appels.push({ sql, params });
    if (/insert into audit_events/i.test(sql) && opts.erreurJournal) {
      throw opts.erreurJournal;
    }
    if (/update campaigns/i.test(sql)) {
      return { rows: [{ id: CAMPAIGN_ID }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  return {
    ctx: {
      ex: { query },
      organisationId: ORG_ID,
      utilisateurId: 'utilisateur-1',
      role: opts.role,
      utilisateur: { nomAffiche: 'utilisateur-1' },
    },
    appels,
  };
}

vi.mock('../../lib/contexte', () => ({ contexteCourant: vi.fn() }));

import { contexteCourant } from '../../lib/contexte';
import { setCampaignStatus } from './campaigns';

beforeEach(() => {
  vi.mocked(contexteCourant).mockReset();
});

describe('setCampaignStatus — journal d’activité (tâche 6, façade tâche 7)', () => {
  it('une mise en pause écrit campaign_paused avec l’utilisateur qui a agi', async () => {
    const { ctx, appels } = creerContexteFactice({ role: 'admin' });
    vi.mocked(contexteCourant).mockResolvedValue(ctx as Awaited<ReturnType<typeof contexteCourant>>);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat).toEqual({ ok: true });
    const journal = appels.find((a) => /insert into audit_events/i.test(a.sql));
    expect(journal).toBeDefined();
    expect(journal!.params).toEqual([
      ORG_ID,
      'utilisateur-1',
      'campaign',
      CAMPAIGN_ID,
      'campaign_paused',
      JSON.stringify({ libelle: 'Campagne mise en pause' }),
    ]);
  });

  it('sans rôle suffisant, aucune écriture n’a lieu (ni campagne ni journal)', async () => {
    const { ctx, appels } = creerContexteFactice({ role: 'viewer' });
    vi.mocked(contexteCourant).mockResolvedValue(ctx as Awaited<ReturnType<typeof contexteCourant>>);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat.ok).toBe(false);
    expect(appels).toHaveLength(0);
  });

  it('un échec du journal n’empêche jamais la mise en pause de réussir', async () => {
    const { ctx } = creerContexteFactice({ role: 'admin', erreurJournal: new Error('table audit_events indisponible') });
    vi.mocked(contexteCourant).mockResolvedValue(ctx as Awaited<ReturnType<typeof contexteCourant>>);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat).toEqual({ ok: true });
    expect(avertissement).toHaveBeenCalledWith('[journal] campaign_paused', expect.any(Error));
    avertissement.mockRestore();
  });

  it('une organisation qui ne coïncide pas avec celle du contexte courant ne change rien', async () => {
    const { ctx, appels } = creerContexteFactice({ role: 'admin' });
    vi.mocked(contexteCourant).mockResolvedValue(ctx as Awaited<ReturnType<typeof contexteCourant>>);

    const resultat = await setCampaignStatus('une-autre-organisation', CAMPAIGN_ID, 'paused');

    expect(resultat).toEqual({ ok: false, error: 'Organisation invalide.' });
    expect(appels).toHaveLength(0);
  });
});

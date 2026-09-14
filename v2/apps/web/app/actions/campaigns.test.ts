import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const ORG_ID = 'org-1';
const CAMPAIGN_ID = 'campagne-1';

interface Appel {
  readonly table: string;
  readonly op: string;
  readonly payload?: unknown;
}

/**
 * Client Supabase factice minimal : assez de chaînage (`select`/`update`/
 * `insert`/`eq`/`maybeSingle`, et `then` pour un builder awaité directement)
 * pour couvrir le chemin `setCampaignStatus` → 'paused'/'active', sans
 * reconstruire tout le client. `role` pilote `getMembershipRole`,
 * `erreurMiseAJour`/`erreurJournal` simulent un échec ciblé de chaque insert.
 */
function creerSupabaseFactice(opts: {
  role: string | null;
  erreurMiseAJour?: { message: string } | null;
  erreurJournal?: unknown;
}): { supabase: unknown; appels: Appel[] } {
  const appels: Appel[] = [];

  function chain(table: string) {
    let op: 'select' | 'update' | 'insert' = 'select';
    let payload: unknown;
    const c = {
      select: () => c,
      update: (p: unknown) => {
        op = 'update';
        payload = p;
        return c;
      },
      insert: (p: unknown) => {
        appels.push({ table, op: 'insert', payload: p });
        return Promise.resolve({ error: table === 'audit_events' ? (opts.erreurJournal ?? null) : null });
      },
      eq: () => c,
      maybeSingle: async () => {
        appels.push({ table, op: 'maybeSingle' });
        if (table === 'memberships') {
          return { data: opts.role ? { role: opts.role } : null };
        }
        return { data: null };
      },
      then: (resolve: (v: { error: unknown }) => void) => {
        appels.push({ table, op, payload });
        resolve({ error: op === 'update' ? (opts.erreurMiseAJour ?? null) : null });
      },
    };
    return c;
  }

  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: { id: 'utilisateur-1' } } }) },
      from: (table: string) => chain(table),
    },
    appels,
  };
}

vi.mock('../../lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { createClient } from '../../lib/supabase/server';
import { setCampaignStatus } from './campaigns';

beforeEach(() => {
  vi.mocked(createClient).mockReset();
});

describe('setCampaignStatus — journal d’activité (tâche 6)', () => {
  it('une mise en pause écrit campaign_paused avec l’utilisateur qui a agi', async () => {
    const { supabase, appels } = creerSupabaseFactice({ role: 'admin' });
    vi.mocked(createClient).mockResolvedValue(supabase as Awaited<ReturnType<typeof createClient>>);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat).toEqual({ ok: true });
    const journal = appels.find((a) => a.table === 'audit_events');
    expect(journal).toBeDefined();
    expect(journal!.payload).toMatchObject({
      organization_id: ORG_ID,
      actor_id: 'utilisateur-1',
      entity_type: 'campaign',
      entity_id: CAMPAIGN_ID,
      action: 'campaign_paused',
      diff: { libelle: 'Campagne mise en pause.' },
    });
  });

  it('sans rôle admin, aucune écriture n’a lieu (ni campagne ni journal)', async () => {
    const { supabase, appels } = creerSupabaseFactice({ role: 'viewer' });
    vi.mocked(createClient).mockResolvedValue(supabase as Awaited<ReturnType<typeof createClient>>);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat.ok).toBe(false);
    expect(appels.some((a) => a.table === 'audit_events')).toBe(false);
  });

  it('un échec du journal n’empêche jamais la mise en pause de réussir', async () => {
    const { supabase } = creerSupabaseFactice({
      role: 'admin',
      erreurJournal: { message: 'table audit_events indisponible' },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as Awaited<ReturnType<typeof createClient>>);
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const resultat = await setCampaignStatus(ORG_ID, CAMPAIGN_ID, 'paused');

    expect(resultat).toEqual({ ok: true });
    expect(avertissement).toHaveBeenCalledWith('[journal] campaign_paused', { message: 'table audit_events indisponible' });
    avertissement.mockRestore();
  });
});

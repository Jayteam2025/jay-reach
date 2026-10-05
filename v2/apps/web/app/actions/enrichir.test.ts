import { describe, expect, it, vi, beforeEach } from 'vitest';
import type * as JayReachCore from '@jay-reach/core';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../../lib/contexte', () => ({ contexteCourant: vi.fn() }));
vi.mock('@jay-reach/core', async (importOriginal) => {
  const reel = await importOriginal<typeof JayReachCore>();
  return { ...reel, chercherEmail: vi.fn() };
});

import { contexteCourant } from '../../lib/contexte';
import { chercherEmail, ErreurEnrichissementImpossible } from '@jay-reach/core';
import { enrichirMaintenant } from './enrichir';

const ORG_ID = 'org-1';
const SIGNAL_ID = 'signal-1';
const CONTACT_ID = 'contact-1';

/**
 * `contexteCourant` factice : la façade (I4, revue finale) ne refait plus les
 * six étapes d'enrichissement elle-même, elle résout le `contactId` du signal
 * en SQL direct (une seule requête sur `ctx.ex`) puis délègue à
 * `chercherEmail` (packages/core/src/fonctions/contacts.ts), même patron que
 * `campaigns.test.ts`.
 */
function creerContexteFactice(contactId: string | null) {
  const query = vi.fn(async () => (contactId ? { rows: [{ id: contactId }], rowCount: 1 } : { rows: [], rowCount: 0 }));
  return {
    ex: { query },
    organisationId: ORG_ID,
    utilisateurId: 'utilisateur-1',
    role: 'operator' as const,
    utilisateur: { nomAffiche: 'utilisateur-1' },
  };
}

beforeEach(() => {
  vi.mocked(contexteCourant).mockReset();
  vi.mocked(chercherEmail).mockReset();
});

describe('enrichirMaintenant — façade sur chercherEmail (I4, revue finale)', () => {
  it('résout le contact depuis le signal et délègue à chercherEmail avec ce contactId', async () => {
    const ctx = creerContexteFactice(CONTACT_ID);
    vi.mocked(contexteCourant).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof contexteCourant>>);
    vi.mocked(chercherEmail).mockResolvedValue(undefined);

    const resultat = await enrichirMaintenant(ORG_ID, SIGNAL_ID);

    expect(resultat.ok).toBe(true);
    expect(chercherEmail).toHaveBeenCalledWith(ctx, { contactId: CONTACT_ID });
  });

  it('aucun contact rattaché à ce signal renvoie une erreur lisible, sans appeler chercherEmail', async () => {
    const ctx = creerContexteFactice(null);
    vi.mocked(contexteCourant).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof contexteCourant>>);

    const resultat = await enrichirMaintenant(ORG_ID, SIGNAL_ID);

    expect(resultat).toEqual({ ok: false, error: 'Aucun contact rattaché à ce signal : rien à enrichir.' });
    expect(chercherEmail).not.toHaveBeenCalled();
  });

  it('une organisation qui ne coïncide pas avec celle du contexte courant ne change rien', async () => {
    const ctx = creerContexteFactice(CONTACT_ID);
    vi.mocked(contexteCourant).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof contexteCourant>>);

    const resultat = await enrichirMaintenant('une-autre-organisation', SIGNAL_ID);

    expect(resultat).toEqual({ ok: false, error: 'Organisation invalide.' });
    expect(ctx.ex.query).not.toHaveBeenCalled();
    expect(chercherEmail).not.toHaveBeenCalled();
  });

  it('traduit une erreur cœur (plafond atteint) en message lisible', async () => {
    const ctx = creerContexteFactice(CONTACT_ID);
    vi.mocked(contexteCourant).mockResolvedValue(ctx as unknown as Awaited<ReturnType<typeof contexteCourant>>);
    vi.mocked(chercherEmail).mockRejectedValue(new ErreurEnrichissementImpossible('Plafond du jour atteint (30 par jour).'));

    const resultat = await enrichirMaintenant(ORG_ID, SIGNAL_ID);

    expect(resultat).toEqual({ ok: false, error: 'Plafond du jour atteint (30 par jour).' });
  });
});

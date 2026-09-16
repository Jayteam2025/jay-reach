import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import { lireOrganisation, listerMembres, modifierOrganisation, schemaModifierOrganisation } from './compte.js';

/** Même fabrique de contexte factice que plafonds.test.ts/moteur.test.ts : un motif (regex) par requête attendue. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'admin'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('lireOrganisation', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(lireOrganisation(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('lit le nom et la langue', async () => {
    const ctx = faux({ 'from organizations': [{ id: 'org-1', name: 'Hey Jay', default_locale: 'fr' }] });
    const org = await lireOrganisation(ctx);
    expect(org).toEqual({ id: 'org-1', nom: 'Hey Jay', langue: 'fr' });
  });

  it("lève ErreurIntrouvable si l'organisation n'existe pas", async () => {
    const ctx = faux({ 'from organizations': [] });
    await expect(lireOrganisation(ctx)).rejects.toThrow(ErreurIntrouvable);
  });
});

describe('schemaModifierOrganisation', () => {
  it('accepte un fuseau IANA connu', () => {
    const r = schemaModifierOrganisation.safeParse({ nom: 'Hey Jay', fuseau: 'Europe/Paris', langue: 'fr' });
    expect(r.success).toBe(true);
  });

  it('refuse un fuseau qui ne figure pas dans Intl.supportedValuesOf', () => {
    const r = schemaModifierOrganisation.safeParse({ nom: 'Hey Jay', fuseau: 'Mars/Olympus', langue: 'fr' });
    expect(r.success).toBe(false);
  });

  it('refuse une langue hors catalogue', () => {
    const r = schemaModifierOrganisation.safeParse({ nom: 'Hey Jay', fuseau: 'Europe/Paris', langue: 'de' });
    expect(r.success).toBe(false);
  });

  it('refuse un nom vide', () => {
    const r = schemaModifierOrganisation.safeParse({ nom: '  ', fuseau: 'Europe/Paris', langue: 'fr' });
    expect(r.success).toBe(false);
  });
});

describe('modifierOrganisation', () => {
  it('refuse un rôle inférieur à admin', async () => {
    const ctx = faux({}, 'operator');
    await expect(
      modifierOrganisation(ctx, { nom: 'Hey Jay', fuseau: 'Europe/Paris', langue: 'fr' }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('refuse une entrée invalide', async () => {
    const ctx = faux({}, 'admin');
    await expect(
      modifierOrganisation(ctx, { nom: '', fuseau: 'Europe/Paris', langue: 'fr' }),
    ).rejects.toThrow(ErreurEntree);
  });

  it('écrit le nom et la langue sur organizations, et le fuseau dans organization_settings', async () => {
    const appels: unknown[][] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      appels.push([sql, params]);
      return { rows: [], rowCount: 1 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await modifierOrganisation(ctx, { nom: 'Hey Jay', fuseau: 'Europe/Paris', langue: 'en' });

    const appelOrg = appels.find(([sql]) => /update organizations/i.test(sql as string));
    expect(appelOrg).toBeDefined();
    expect(appelOrg![1]).toEqual(expect.arrayContaining(['Hey Jay', 'en', 'org-1']));

    const appelFuseau = appels.find(([sql]) => /insert into organization_settings/i.test(sql as string));
    expect(appelFuseau).toBeDefined();
    expect(appelFuseau![1]).toEqual(expect.arrayContaining(['fuseau']));
  });
});

describe('listerMembres', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(listerMembres(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('combine les adhésions réelles et les invitations en attente, distingue l’utilisateur courant', async () => {
    const ctx = faux({
      'from memberships': [
        { id: 'user-1', role: 'owner', created_at: '2026-08-17T00:00:00.000Z', email: 'claire@example.com', nom: 'Claire Moreau' },
        { id: 'user-2', role: 'admin', created_at: '2026-09-10T00:00:00.000Z', email: 'marc@example.com', nom: 'Marc Lefèvre' },
      ],
      'from invitations': [
        { id: 'inv-1', role: 'viewer', created_at: '2026-09-13T00:00:00.000Z', email: 'marion@example.com' },
      ],
    });

    const membres = await listerMembres(ctx);

    expect(membres).toEqual([
      { id: 'user-1', nom: 'Claire Moreau', email: 'claire@example.com', role: 'owner', depuis: '2026-08-17T00:00:00.000Z', enAttente: false, moiMeme: true },
      { id: 'user-2', nom: 'Marc Lefèvre', email: 'marc@example.com', role: 'admin', depuis: '2026-09-10T00:00:00.000Z', enAttente: false, moiMeme: false },
      { id: 'inv-1', nom: 'marion@example.com', email: 'marion@example.com', role: 'viewer', depuis: '2026-09-13T00:00:00.000Z', enAttente: true, moiMeme: false },
    ]);
  });
});

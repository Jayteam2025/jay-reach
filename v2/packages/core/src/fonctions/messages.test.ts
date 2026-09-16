import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree } from './contexte.js';
import { enregistrerModele, listerModeles } from './messages.js';

/** Même convention que `contacts.test.ts`/`sequence.test.ts` : un motif (tag `/* jr:nom *\/`) associé aux lignes à renvoyer. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'viewer'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

function appelsDe(ctx: Contexte): { sql: string; params: unknown[] }[] {
  return (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls.map((a) => ({
    sql: String((a as unknown[])[0]),
    params: ((a as unknown[])[1] as unknown[]) ?? [],
  }));
}

/** Même convention que `contacts.test.ts` : un faux POOL, `connect()` compris (R47/R69) — `enregistrerModele` passe par `enregistrerVersionModele` (`dansUneTransaction`). */
function fauxConnectable(
  rows: Record<string, unknown[]>,
  role: Contexte['role'] = 'admin',
): { ctx: Contexte; appelsClient: () => string[]; releases: () => number } {
  let releases = 0;
  const resoudre = (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const poolQuery = vi.fn(async (sql: string) => resoudre(sql));
  const clientQuery = vi.fn(async (sql: string) => resoudre(sql));
  const ex = {
    query: poolQuery as unknown as Executeur['query'],
    connect: vi.fn(async () => ({
      query: clientQuery as unknown as Executeur['query'],
      release: vi.fn(() => {
        releases += 1;
      }),
    })),
  };
  const ctx: Contexte = {
    ex: ex as unknown as Executeur,
    organisationId: 'org-1',
    utilisateurId: 'user-1',
    role,
  };
  return {
    ctx,
    appelsClient: () => (clientQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    releases: () => releases,
  };
}

const familyId = '11111111-1111-1111-1111-111111111111';

describe('listerModeles', () => {
  it('refuse un appelant sans rôle', async () => {
    await expect(listerModeles(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('liste les versions actives de la locale de l’organisation, avec campagnes utilisatrices et envois réels', async () => {
    const ctx = faux({
      'jr:messages_lister': [
        {
          id: familyId,
          family_id: familyId,
          name: 'Premier email · question DC',
          channel: 'email',
          subject: '{{prenom}}, question de DC à DC',
          body: 'Bonjour {{prenom}}…',
          created_at: '2026-09-11T10:00:00.000Z',
          modifie_par: 'Alexandre',
          campagnes: ['Directeur commercial', 'Engageurs post Christelle'],
          envois: 186,
        },
      ],
    });

    const modeles = await listerModeles(ctx, {});

    expect(modeles).toEqual([
      {
        id: familyId,
        familyId,
        nom: 'Premier email · question DC',
        canal: 'email',
        sujet: '{{prenom}}, question de DC à DC',
        corps: 'Bonjour {{prenom}}…',
        campagnes: ['Directeur commercial', 'Engageurs post Christelle'],
        envois: 186,
        modifieLe: '2026-09-11T10:00:00.000Z',
        modifiePar: 'Alexandre',
      },
    ]);
  });

  it('un modèle jamais attaché à une étape a une liste de campagnes vide et zéro envoi', async () => {
    const ctx = faux({
      'jr:messages_lister': [
        {
          id: familyId,
          family_id: familyId,
          name: 'LinkedIn · invitation courte',
          channel: 'linkedin_invite',
          subject: null,
          body: 'Bonjour {{prenom}}…',
          created_at: '2026-09-10T09:00:00.000Z',
          modifie_par: 'Jean-Baptiste',
          campagnes: [],
          envois: 0,
        },
      ],
    });

    const [m] = await listerModeles(ctx, {});
    expect(m!.campagnes).toEqual([]);
    expect(m!.envois).toBe(0);
    expect(m!.sujet).toBeNull();
  });

  it('filtre par organisation courante et par la locale par défaut de l’organisation', async () => {
    const ctx = faux({ 'jr:messages_lister': [] });
    await listerModeles(ctx, {});
    const appel = appelsDe(ctx).find((a) => /jr:messages_lister/.test(a.sql))!;
    expect(appel.sql).toMatch(/is_active/);
    expect(appel.sql).toMatch(/default_locale/);
    expect(appel.params).toEqual(['org-1']);
  });
});

describe('enregistrerModele', () => {
  const entreeValide = {
    nom: 'Premier email · question DC',
    canal: 'email' as const,
    sujet: 'Objet',
    corps: 'Bonjour {{prenom}}',
    nature: 'signal' as const,
  };

  it('refuse un appelant sans rôle admin', async () => {
    await expect(enregistrerModele(faux({}, 'operator'), entreeValide)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuse une entrée invalide (corps vide)', async () => {
    await expect(
      enregistrerModele(faux({}, 'admin'), { ...entreeValide, corps: '' }),
    ).rejects.toThrow(ErreurEntree);
  });

  it('refuse une variable inconnue dans le corps', async () => {
    const { ctx } = fauxConnectable({ 'jr:sequence_extraits': [] });
    await expect(
      enregistrerModele(ctx, { ...entreeValide, corps: 'Bonjour {{inconnue}}' }),
    ).rejects.toThrow(ErreurEntree);
  });

  it('crée une nouvelle lignée avec la locale par défaut de l’organisation (R61)', async () => {
    const nouveauId = '99999999-9999-9999-9999-999999999999';
    const { ctx, appelsClient, releases } = fauxConnectable({
      'jr:messages_organisation_locale': [{ default_locale: 'nl' }],
      'jr:sequence_extraits': [],
      'jr:sequence_modele_creer': [{ id: nouveauId }],
    });

    const res = await enregistrerModele(ctx, entreeValide);

    expect(res).toEqual({ id: nouveauId });
    const creation = appelsClient().find((s) => /jr:sequence_modele_creer/.test(s));
    expect(creation).toBeDefined();
    expect(releases()).toBe(1);
  });

  it('verse une nouvelle version dans une lignée existante (familyId fourni)', async () => {
    const { ctx, appelsClient } = fauxConnectable({
      'jr:messages_organisation_locale': [{ default_locale: 'fr' }],
      'jr:sequence_extraits': [],
      'jr:sequence_modele_prochaine_version': [{ next: 2 }],
      'jr:sequence_modele_versionner': [{ id: familyId }],
    });

    await enregistrerModele(ctx, { ...entreeValide, familyId });

    expect(appelsClient().some((s) => /jr:sequence_modele_desactiver/.test(s))).toBe(true);
    expect(appelsClient().some((s) => /jr:sequence_modele_versionner/.test(s))).toBe(true);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import { enregistrerPersona, listerPersonas, testerAppariement } from './personas.js';

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

const personaId = '11111111-1111-1111-1111-111111111111';
const campagneId = '22222222-2222-2222-2222-222222222222';
const autreCampagneId = '33333333-3333-3333-3333-333333333333';

describe('listerPersonas', () => {
  it('refuse un appelant sans rôle', async () => {
    await expect(listerPersonas(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('assemble la fiche, les campagnes utilisatrices, les contacts et le score moyen', async () => {
    const ctx = faux({
      'jr:personas_lister': [
        {
          id: personaId,
          name: 'Directeur commercial',
          title_patterns: ['directeur commercial', 'head of sales'],
          seniority: 'director',
          scoring_prompt: 'Note de 0 à 100…',
          angle: 'Jay écoute les rendez-vous…',
          default_campaign_id: campagneId,
          is_active: true,
        },
      ],
      'jr:personas_campagnes': [
        { id: campagneId, name: 'Directeur commercial', entry_rules: { personas: [personaId] } },
        {
          id: autreCampagneId,
          name: 'Engageurs post Christelle',
          entry_rules: { personas: [personaId] },
        },
        { id: 'campagne-sans-persona', name: 'DRH PME industrielles', entry_rules: {} },
      ],
      'jr:personas_contacts': [{ persona_id: personaId, n: 412 }],
      'jr:personas_score_moyen': [{ persona_id: personaId, moyenne: 78.4 }],
    });

    const resultat = await listerPersonas(ctx, {});

    expect(resultat.personas).toHaveLength(1);
    const p = resultat.personas[0]!;
    expect(p).toMatchObject({
      id: personaId,
      nom: 'Directeur commercial',
      intitulesPostes: ['directeur commercial', 'head of sales'],
      seniorite: 'director',
      consignesNotation: 'Note de 0 à 100…',
      ceQueJayApporte: 'Jay écoute les rendez-vous…',
      campagneParDefautId: campagneId,
      estActif: true,
      nombreContacts: 412,
      scoreMoyen: 78,
    });
    expect(p.campagnesUtilisatrices.sort()).toEqual(
      ['Directeur commercial', 'Engageurs post Christelle'].sort(),
    );
  });

  it('un persona sans aucune campagne utilisatrice a un score nul et zéro contact', async () => {
    const ctx = faux({
      'jr:personas_lister': [
        {
          id: personaId,
          name: 'CEO de scale-ups tech',
          title_patterns: [],
          seniority: null,
          scoring_prompt: null,
          angle: null,
          default_campaign_id: null,
          is_active: true,
        },
      ],
      'jr:personas_campagnes': [],
      'jr:personas_contacts': [],
      'jr:personas_score_moyen': [],
    });

    const [p] = (await listerPersonas(ctx, {})).personas;
    expect(p!.campagnesUtilisatrices).toEqual([]);
    expect(p!.nombreContacts).toBe(0);
    expect(p!.scoreMoyen).toBeNull();
  });

  it('renvoie les campagnes disponibles pour le sélecteur « campagne par défaut »', async () => {
    const ctx = faux({
      'jr:personas_lister': [],
      'jr:personas_campagnes': [
        { id: campagneId, name: 'Directeur commercial', entry_rules: {} },
        { id: autreCampagneId, name: 'DRH PME industrielles', entry_rules: {} },
      ],
    });

    const { campagnesDisponibles } = await listerPersonas(ctx, {});
    expect(campagnesDisponibles).toEqual([
      { id: campagneId, nom: 'Directeur commercial' },
      { id: autreCampagneId, nom: 'DRH PME industrielles' },
    ]);
  });

  it('filtre par organisation courante', async () => {
    const ctx = faux({ 'jr:personas_lister': [] });
    await listerPersonas(ctx, {});
    const appel = appelsDe(ctx).find((a) => /jr:personas_lister/.test(a.sql))!;
    expect(appel.params).toEqual(['org-1']);
  });
});

describe('enregistrerPersona', () => {
  it('refuse un appelant sans rôle admin', async () => {
    await expect(enregistrerPersona(faux({}, 'operator'), { nom: 'Test' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuse une entrée invalide (nom vide)', async () => {
    await expect(enregistrerPersona(faux({}, 'admin'), { nom: '' })).rejects.toThrow(ErreurEntree);
  });

  it('crée un nouveau persona (organisation courante, intitulés nettoyés)', async () => {
    const ctx = faux({ 'jr:personas_creer': [{ id: personaId }] }, 'admin');

    const res = await enregistrerPersona(ctx, {
      nom: '  Directeur commercial  ',
      intitulesPostes: ['directeur commercial', '  ', 'head of sales'],
      seniorite: 'director',
      consignesNotation: 'Note de 0 à 100…',
      ceQueJayApporte: 'Jay écoute…',
      campagneParDefautId: campagneId,
    });

    expect(res).toEqual({ id: personaId });
    const appel = appelsDe(ctx).find((a) => /jr:personas_creer/.test(a.sql))!;
    expect(appel.params).toEqual([
      'org-1',
      'Directeur commercial',
      ['directeur commercial', 'head of sales'],
      'director',
      'Note de 0 à 100…',
      'Jay écoute…',
      campagneId,
    ]);
  });

  it('réécrit un persona existant sans toucher aux exclusions ni aux réglages LinkedIn (colonnes non gérées ici)', async () => {
    const ctx = faux({ 'jr:personas_modifier': [{ id: personaId }] }, 'admin');

    await enregistrerPersona(ctx, {
      id: personaId,
      nom: 'DRH',
      intitulesPostes: ['DRH', 'directeur des ressources humaines'],
      seniorite: null,
      consignesNotation: null,
      ceQueJayApporte: null,
      campagneParDefautId: null,
    });

    const appel = appelsDe(ctx).find((a) => /jr:personas_modifier/.test(a.sql))!;
    // Ni `title_exclusions`, ni `department_patterns`, ni `channels_priority` dans les colonnes écrites.
    expect(appel.sql).not.toMatch(/title_exclusions|department_patterns|channels_priority/);
    expect(appel.params).toEqual([
      'DRH',
      ['DRH', 'directeur des ressources humaines'],
      null,
      null,
      null,
      null,
      null,
      personaId,
      'org-1',
    ]);
  });

  it('lève ErreurIntrouvable si le persona à modifier n’existe pas (ou hors organisation)', async () => {
    const ctx = faux({ 'jr:personas_modifier': [] }, 'admin');
    await expect(enregistrerPersona(ctx, { id: personaId, nom: 'X' })).rejects.toThrow(
      ErreurIntrouvable,
    );
  });

  it('archive un persona (interprétation de « Supprimer » : is_active=false, préserve les références existantes)', async () => {
    const ctx = faux({ 'jr:personas_modifier': [{ id: personaId }] }, 'admin');
    await enregistrerPersona(ctx, { id: personaId, nom: 'CEO de scale-ups tech', estActif: false });
    const appel = appelsDe(ctx).find((a) => /jr:personas_modifier/.test(a.sql))!;
    expect(appel.params.at(-3)).toBe(false);
  });

  it('réactive un persona archivé (tour de correction 1, bouton « Réactiver » de la section Archivés)', async () => {
    const ctx = faux({ 'jr:personas_modifier': [{ id: personaId }] }, 'admin');
    const res = await enregistrerPersona(ctx, {
      id: personaId,
      nom: 'CEO de scale-ups tech',
      estActif: true,
    });
    expect(res).toEqual({ id: personaId });
    const appel = appelsDe(ctx).find((a) => /jr:personas_modifier/.test(a.sql))!;
    expect(appel.params.at(-3)).toBe(true);
  });

  it('la réactivation refuse un appelant sans rôle admin', async () => {
    await expect(
      enregistrerPersona(faux({}, 'operator'), { id: personaId, nom: 'X', estActif: true }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('la réactivation lève ErreurIntrouvable pour un persona inconnu (ou hors organisation)', async () => {
    const ctx = faux({ 'jr:personas_modifier': [] }, 'admin');
    await expect(
      enregistrerPersona(ctx, { id: personaId, nom: 'X', estActif: true }),
    ).rejects.toThrow(ErreurIntrouvable);
  });
});

describe('testerAppariement', () => {
  it('refuse un appelant sans rôle', async () => {
    await expect(testerAppariement(faux({}, null), { intitule: 'Head of Sales' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuse une entrée invalide (intitulé vide)', async () => {
    await expect(testerAppariement(faux({}, 'viewer'), { intitule: '' })).rejects.toThrow(
      ErreurEntree,
    );
  });

  it('renvoie le nom du persona apparié parmi les personas actifs de l’organisation', async () => {
    const ctx = faux({
      'jr:personas_tester_appariement': [
        {
          id: personaId,
          name: 'Directeur commercial',
          title_patterns: ['directeur commercial', 'head of sales'],
          title_exclusions: ['cabinet de recrutement'],
        },
      ],
    });

    const res = await testerAppariement(ctx, { intitule: 'Head of Sales, PME SaaS' });
    expect(res.persona).toBe('Directeur commercial');
    expect(res.statut).toBe('matched');
  });

  it('ne renvoie aucun persona pour un intitulé exclu', async () => {
    const ctx = faux({
      'jr:personas_tester_appariement': [
        {
          id: personaId,
          name: 'Directeur commercial',
          title_patterns: ['directeur commercial'],
          title_exclusions: ['cabinet de recrutement'],
        },
      ],
    });

    const res = await testerAppariement(ctx, {
      intitule: 'Directeur commercial, cabinet de recrutement Talents & Co',
    });
    expect(res.persona).toBeNull();
    expect(res.statut).toBe('none');
  });

  it('ne filtre que les personas actifs', async () => {
    const ctx = faux({ 'jr:personas_tester_appariement': [] });
    await testerAppariement(ctx, { intitule: 'DRH' });
    const appel = appelsDe(ctx).find((a) => /jr:personas_tester_appariement/.test(a.sql))!;
    expect(appel.sql).toMatch(/is_active/);
    expect(appel.params).toEqual(['org-1']);
  });
});

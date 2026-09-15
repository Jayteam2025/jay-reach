import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable } from './contexte.js';
import {
  ORDRE_STATUTS,
  archiver,
  creerCampagne,
  ErreurConflit,
  lancer,
  lireVueDEnsemble,
  listerActivite,
  listerCampagnes,
  listerContactsCampagne,
  listerFileDuJour,
  manquesPourLancer,
  marqueBoite,
  mettreEnPause,
  modifierReglagesCampagne,
} from './campagnes.js';

/**
 * Contexte factice : `rows` associe un motif (le tag `/* jr:nom *\/` de la requête, ou tout
 * autre fragment unique) au résultat renvoyé par `query`. Même convention que
 * `plafonds.test.ts`/`moteur.test.ts`.
 */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'admin'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('ORDRE_STATUTS', () => {
  it('respecte l’ordre de priorité de la spec (ne_plus_contacter en tête, a_contacter en dernier)', () => {
    expect(ORDRE_STATUTS).toEqual([
      'ne_plus_contacter',
      'rebond',
      'interesse',
      'a_repondu',
      'ecarte',
      'termine',
      'en_sequence',
      'sans_email',
      'a_contacter',
    ]);
  });
});

describe('marqueBoite', () => {
  it('reconnaît un domaine outlook', () => {
    expect(marqueBoite('alex@outlook.com')).toBe('outlook');
    expect(marqueBoite('alex@hotmail.fr')).toBe('outlook');
  });
  it('reconnaît un domaine gmail', () => {
    expect(marqueBoite('alex@gmail.com')).toBe('gmail');
  });
  it('renvoie null pour un domaine propre à l’organisation', () => {
    expect(marqueBoite('alex@exemple.fr')).toBeNull();
  });
});

describe('listerCampagnes', () => {
  it('refuse un viewer… non — accepte un viewer (lecture)', async () => {
    const ctx = faux(
      { 'jr:campagnes_liste': [], 'jr:boites_actives': [] },
      'viewer',
    );
    await expect(listerCampagnes(ctx)).resolves.toEqual([]);
  });

  it('refuse un contexte sans rôle', async () => {
    await expect(listerCampagnes(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('résout les boîtes (avec marque) et calcule le taux de réponse', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1',
          name: 'Directeur commercial',
          status: 'active',
          entry_rules: {},
          sources: ['adzuna'],
          qualifies: 20,
          contacts: 18,
          en_sequence: 5,
          reponses: 2,
          interesses: 1,
          derniere_activite: '2026-09-14T10:00:00.000Z',
        },
      ],
      'jr:boites_actives': [{ id: 'send-1', identity: 'alex@outlook.com' }],
      'jr:tendance_livraisons': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r).toHaveLength(1);
    expect(r[0]!.boites).toEqual([{ id: 'send-1', identite: 'alex@outlook.com', marque: 'outlook' }]);
    expect(r[0]!.sources).toEqual([{ providerId: 'adzuna' }]);
    expect(r[0]!.tauxReponse).toBe(10);
    expect(r[0]!.tendance7j).toHaveLength(7);
    expect(r[0]!.tendance7j.every((n) => n === 0)).toBe(true);
    // R31 : « Contacts » compte des personnes (`contacts`), pas les offres/signaux qualifiés (`qualifies`).
    expect(r[0]!.contacts).toBe(18);
    expect(r[0]!.interesses).toBe(1);
    expect(r[0]!.derniereActivite).toBe('2026-09-14T10:00:00.000Z');
  });

  it('n’a pas de dernière activité (`derniereActivite: null`) quand `audit_events` n’a rien pour cette campagne', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1',
          name: 'C',
          status: 'draft',
          entry_rules: {},
          sources: [],
          qualifies: 0,
          contacts: 0,
          en_sequence: 0,
          reponses: 0,
          interesses: 0,
          derniere_activite: null,
        },
      ],
      'jr:boites_actives': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.derniereActivite).toBeNull();
  });

  it('restreint les boîtes à `entry_rules.boiteIds` quand elles sont posées', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1',
          name: 'C',
          status: 'draft',
          entry_rules: { boiteIds: ['send-2'] },
          sources: [],
          qualifies: 0,
          contacts: 0,
          en_sequence: 0,
          reponses: 0,
          interesses: 0,
          derniere_activite: null,
        },
      ],
      'jr:boites_actives': [
        { id: 'send-1', identity: 'a@exemple.fr' },
        { id: 'send-2', identity: 'b@exemple.fr' },
      ],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.boites.map((b) => b.id)).toEqual(['send-2']);
  });
});

describe('lireVueDEnsemble', () => {
  function ctxComplet(role: Contexte['role'] = 'viewer') {
    return faux(
      {
        'jr:campagne_entete': [{ id: 'camp-1', name: 'Directeur commercial', status: 'active', entry_rules: { min_score: 80 }, daily_cap: 40 }],
        'jr:boites_actives': [{ id: 'send-1', identity: 'alex@outlook.com' }],
        'organization_settings': [],
        'jr:entonnoir_campagne': [{ trouves: 100, qualifies: 40, contacts: 35, en_sequence: 10, livres: 20, reponses: 4, interesses: 2 }],
        'jr:file_du_jour_campagne': [],
        'jr:sources_campagne_resume': [{ provider_id: 'adzuna' }],
        'jr:sources_campagne_compte': [{ n: 1 }],
        'jr:activite_campagne': [],
        scored_today: [],
        enrich_today: [],
        'from actions': [],
        'from senders': [],
      },
      role,
    );
  }

  it('refuse un rôle insuffisant (aucun rôle)', async () => {
    await expect(lireVueDEnsemble(ctxComplet(null), { campagneId: '11111111-1111-1111-1111-111111111111' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('lève ErreurIntrouvable quand la campagne n’existe pas (ou hors organisation)', async () => {
    const ctx = faux({ 'jr:campagne_entete': [] });
    await expect(lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' })).rejects.toThrow(ErreurIntrouvable);
  });

  it('assemble campagne, entonnoir et rendements dérivés', async () => {
    const ctx = ctxComplet();
    const v = await lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' });
    expect(v.campagne.nom).toBe('Directeur commercial');
    expect(v.campagne.scoreMin).toBe(80);
    expect(v.campagne.boites).toEqual([{ id: 'send-1', identite: 'alex@outlook.com', marque: 'outlook' }]);
    expect(v.entonnoir.trouves).toBe(100);
    // Marche « Contacts identifiés » (R31), après « Contacts qualifiés » : des personnes, pas des offres.
    expect(v.entonnoir.contacts).toBe(35);
    // tauxLivres = livres / qualifies = 20/40 = 50 % ; tauxReponses = reponses / livres = 4/20 = 20 %.
    expect(v.entonnoir.tauxLivres).toBe(50);
    expect(v.entonnoir.tauxReponses).toBe(20);
    expect(v.sources).toEqual([{ providerId: 'adzuna' }]);
    // Compteur de l'onglet Sources (tâche 11) : nombre réel de lignes
    // `campaign_sources`, pas `sources.length` (distinct provider_id) — les
    // deux coïncident ici mais divergeraient avec deux thèmes du même
    // fournisseur.
    expect(v.nombreSources).toBe(1);
  });
});

describe('listerContactsCampagne', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un rôle insuffisant (aucun rôle)', async () => {
    await expect(listerContactsCampagne(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('calcule les compteurs par statut, tous compris, et en fait le total (pas de la page)', async () => {
    const ctx = faux({
      'jr:compteurs_contacts_campagne': [
        { statut: 'en_sequence', n: 5 },
        { statut: 'a_repondu', n: 2 },
      ],
      'jr:lignes_contacts_campagne': [],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.compteurs.en_sequence).toBe(5);
    expect(r.compteurs.a_repondu).toBe(2);
    expect(r.compteurs.sans_email).toBe(0);
    expect(r.compteurs.tous).toBe(7);
    expect(r.total).toBe(7);
  });

  it('le total vient des compteurs, pas de la page demandée (une page au-delà de la dernière garde le bon total)', async () => {
    const ctx = faux({
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 42 }],
      'jr:lignes_contacts_campagne': [], // page au-delà de la dernière : aucune ligne renvoyée
    });
    const r = await listerContactsCampagne(ctx, { campagneId, filtre: 'en_sequence', page: 50 });
    expect(r.lignes).toHaveLength(0);
    expect(r.total).toBe(42);
  });

  it('la population est faite de personnes : jointure interne sur contacts, signaux non qualifiés exclus (R29)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const [sql] = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toMatch(/join contacts c on c\.id = pop\.contact_id/);
    expect(sql).not.toMatch(/left join contacts/);
    expect(sql).toMatch(/s0\.status <> 'new'/);
  });

  it('la population inclut aussi les contacts inscrits sans signal (R36, tour de correction 1)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const [sql] = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toMatch(/select e1\.contact_id, null::uuid\s+from enrollments e1/);
    expect(sql).toMatch(/left join signals s on s\.id = pop\.signal_id/);
  });

  it('la règle « sans email » couvre invalide, risqué et inconnu, pas seulement invalide (R27)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const [sql] = (query as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(sql).toMatch(/c\.email_status <> 'valid'/);
    expect(sql).not.toMatch(/email_status = 'invalid'/);
  });

  it('un contact `replied` avec un fil intéressé remonte comme `interesse` (priorité sur `a_repondu`)', async () => {
    // Le mock ne rejoue pas le `case` SQL : il simule ce que la requête renverrait déjà pour
    // cette situation, ORDRE_STATUTS faisant foi sur la priorité (interesse avant a_repondu).
    const ctx = faux({
      'jr:compteurs_contacts_campagne': [{ statut: 'interesse', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Claire',
          last_name: 'Moreau',
          job_title: 'Directrice',
          email: 'claire@exemple.fr',
          entreprise: 'Néolia',
          current_step: 2,
          statut: 'interesse',
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes).toHaveLength(1);
    expect(r.lignes[0]!.statut).toBe('interesse');
    expect(r.lignes[0]!.nom).toBe('Claire Moreau');
    expect(r.lignes[0]!.etape).toBe(3);
    expect(r.total).toBe(1);
    expect(ORDRE_STATUTS.indexOf('interesse')).toBeLessThan(ORDRE_STATUTS.indexOf('a_repondu'));
  });

  it('renseigne score et pourquoi depuis le signal d’origine (R33)', async () => {
    const ctx = faux({
      'jr:compteurs_contacts_campagne': [{ statut: 'a_contacter', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'Head of Sales',
          email: 'karim@exemple.fr',
          entreprise: 'Woodpecker Studio',
          current_step: null,
          statut: 'a_contacter',
          score: 91,
          pourquoi: 'Business developer senior',
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]).toMatchObject({ score: 91, pourquoi: 'Business developer senior' });
  });

  it('un contact inscrit sans signal (R36) a un signalId, un score et un pourquoi nuls', async () => {
    const ctx = faux({
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: null,
          contact_id: 'contact-2',
          first_name: 'Alex',
          last_name: 'Recette',
          job_title: null,
          email: 'alex@exemple.fr',
          entreprise: null,
          current_step: 0,
          statut: 'en_sequence',
          score: null,
          pourquoi: null,
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]).toMatchObject({ signalId: null, score: null, pourquoi: null, statut: 'en_sequence' });
  });

  it('passe la pagination et le filtre à la requête (page 2, filtre en_sequence)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId, filtre: 'en_sequence', page: 2 });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelLignes = appels.find((a) => /jr:lignes_contacts_campagne/i.test(String(a[0])));
    expect(appelLignes?.[1]).toEqual([campagneId, 'en_sequence', null, 50, 50]);
  });
});

describe('listerFileDuJour', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un rôle insuffisant', async () => {
    await expect(listerFileDuJour(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('sépare les envois prévus des envois partis', async () => {
    const ctx = faux({
      'organization_settings': [],
      'jr:file_du_jour_campagne': [
        { id: 'a1', status: 'scheduled', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00Z', dispatch_after: null, channel: 'email', first_name: 'A', last_name: 'B', campagne_nom: 'C', etape: 0, expediteur: 'x@exemple.fr' },
        { id: 'a2', status: 'delivered', dispatched_at: '2026-09-14T08:00:00Z', scheduled_for: null, dispatch_after: null, channel: 'email', first_name: 'D', last_name: 'E', campagne_nom: 'C', etape: 1, expediteur: 'x@exemple.fr' },
      ],
      'jr:plafond_envois_org': [{ plafond: 90 }],
    });
    const r = await listerFileDuJour(ctx, {});
    expect(r.prevus).toHaveLength(1);
    expect(r.partis).toHaveLength(1);
    expect(r.plafondDuJour).toBe(90);
  });

  it('utilise le plafond propre de la campagne quand `daily_cap` est posé', async () => {
    const ctx = faux({
      organization_settings: [],
      'jr:file_du_jour_campagne': [],
      'jr:file_du_jour_cap': [{ daily_cap: 25 }],
    });
    const r = await listerFileDuJour(ctx, { campagneId });
    expect(r.plafondDuJour).toBe(25);
  });

  it('lève ErreurIntrouvable quand la campagne du plafond n’existe pas', async () => {
    const ctx = faux({ organization_settings: [], 'jr:file_du_jour_campagne': [], 'jr:file_du_jour_cap': [] });
    await expect(listerFileDuJour(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });
});

describe('listerActivite', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un rôle insuffisant', async () => {
    await expect(listerActivite(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('mappe libellé et détail depuis `diff`', async () => {
    const ctx = faux({
      'jr:activite_campagne_total': [{ n: 1 }],
      'jr:activite_campagne': [
        { id: 'ev-1', created_at: '2026-09-14T08:00:00Z', entity_type: 'campaign', action: 'campaign_activated', diff: { libelle: 'Campagne lancée' } },
      ],
    });
    const r = await listerActivite(ctx, { campagneId });
    expect(r.total).toBe(1);
    expect(r.evenements[0]).toEqual({ id: 'ev-1', quand: '2026-09-14T08:00:00Z', type: 'campaign_activated', libelle: 'Campagne lancée', detail: null });
  });

  it('le total vient d’une requête `count(*)` séparée, pas de la page (une page vide garde le bon total)', async () => {
    const ctx = faux({
      'jr:activite_campagne_total': [{ n: 12 }],
      'jr:activite_campagne': [], // page au-delà de la dernière : aucune ligne renvoyée
    });
    const r = await listerActivite(ctx, { campagneId, page: 50 });
    expect(r.evenements).toHaveLength(0);
    expect(r.total).toBe(12);
  });

  it('restreint aux actions du filtre demandé (compte et page)', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerActivite(ctx, { campagneId, filtre: 'scoring' });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as [string, unknown[]][];
    expect(appels).toHaveLength(2);
    for (const [sql, params] of appels) {
      expect(sql).toMatch(/action = any\(\$3::text\[\]\)/);
      expect(params).toContainEqual(['scoring_batch']);
    }
  });
});

describe('creerCampagne', () => {
  it('refuse un viewer', async () => {
    await expect(
      creerCampagne(faux({}, 'viewer'), {
        name: 'Test',
        entryKind: 'source',
        entryId: '22222222-2222-2222-2222-222222222222',
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('crée la campagne puis relie ses thèmes', async () => {
    const ctx = faux({ 'jr:creer_campagne': [{ id: 'camp-1' }], 'jr:creer_campagne_sources': [] }, 'operator');
    const r = await creerCampagne(ctx, {
      name: 'Test',
      entryKind: 'source',
      entryId: '22222222-2222-2222-2222-222222222222',
      sourceIds: ['22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333'],
    });
    expect(r).toEqual({ id: 'camp-1' });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelSources = appels.find((a) => /jr:creer_campagne_sources/i.test(String(a[0])));
    expect(appelSources?.[1]).toEqual(['camp-1', '22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333']);
  });
});

describe('modifierReglagesCampagne', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un viewer', async () => {
    await expect(modifierReglagesCampagne(faux({}, 'viewer'), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:reglages_lire': [] }, 'operator');
    await expect(modifierReglagesCampagne(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('fusionne les nouvelles clés dans `entry_rules` sans perdre les existantes', async () => {
    const ctx = faux(
      { 'jr:reglages_lire': [{ entry_rules: { min_score: 70, autreCle: 'x' }, status: 'draft' }], 'jr:reglages_ecrire': [] },
      'operator',
    );
    const boiteId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    await modifierReglagesCampagne(ctx, { campagneId, relecturePremiersEnvois: 3, boiteIds: [boiteId] });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const ecriture = appels.find((a) => /jr:reglages_ecrire/i.test(String(a[0])));
    const entryRulesEcrites = JSON.parse((ecriture?.[1] as unknown[])[2] as string);
    expect(entryRulesEcrites).toEqual({ min_score: 70, autreCle: 'x', relecturePremiersEnvois: 3, boiteIds: [boiteId] });
  });

  it('refuse en ErreurConflit un changement de persona qui collide sur une campagne active', async () => {
    const personaId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const ctx = faux(
      {
        'jr:reglages_lire': [{ entry_rules: {}, status: 'active' }],
        'jr:collision_themes': [{ source_id: 'src-1' }],
        'jr:collision_autres': [{ id: 'camp-2', name: 'Autre campagne', entry_rules: { personas: [personaId] }, source_id: null }],
        'jr:collision_liens': [{ campaign_id: 'camp-2', source_id: 'src-1' }],
      },
      'operator',
    );
    await expect(
      modifierReglagesCampagne(ctx, { campagneId, personaIds: [personaId] }),
    ).rejects.toThrow(ErreurConflit);
  });
});

describe('manquesPourLancer', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un contexte sans rôle', async () => {
    await expect(manquesPourLancer(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('séquence vide : un seul manque, aucune autre requête', async () => {
    const ctx = faux({ 'jr:manques_etapes': [] });
    const r = await manquesPourLancer(ctx, { campagneId });
    expect(r).toEqual(['la séquence ne comporte aucune étape']);
    expect((ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('aucune boîte, clé SalesBlink absente : trois manques', async () => {
    const ctx = faux({
      'jr:manques_etapes': [{ position: 0, channel: 'email', template_parent_id: 'tpl-1' }],
      'jr:manques_genres': [],
      'jr:manques_cle': [],
      'jr:manques_boites': [],
    });
    const r = await manquesPourLancer(ctx, { campagneId });
    expect(r).toEqual([
      'aucun expéditeur email actif',
      'aucune clé SalesBlink configurée',
      'aucun expéditeur email relié à une boîte SalesBlink',
    ]);
  });

  it('signale les étapes sans message relié', async () => {
    const ctx = faux({
      'jr:manques_etapes': [
        { position: 0, channel: 'email', template_parent_id: null },
        { position: 1, channel: 'call', template_parent_id: null },
      ],
      'jr:manques_genres': [{ kind: 'email' }],
      'jr:manques_cle': [{ status: 'configured' }],
      'jr:manques_boites': [{ provider_ref: 'sblk-1', provider_state: { sending_enabled: true } }],
    });
    const r = await manquesPourLancer(ctx, { campagneId });
    expect(r).toEqual(['l’étape 1 n’a pas de message relié']);
  });

  it('ne signale rien quand tout est prêt', async () => {
    const ctx = faux({
      'jr:manques_etapes': [{ position: 0, channel: 'email', template_parent_id: 'tpl-1' }],
      'jr:manques_genres': [{ kind: 'email' }],
      'jr:manques_cle': [{ status: 'configured' }],
      'jr:manques_boites': [{ provider_ref: 'sblk-1', provider_state: { sending_enabled: true } }],
    });
    expect(await manquesPourLancer(ctx, { campagneId })).toEqual([]);
  });
});

describe('lancer', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un viewer', async () => {
    await expect(lancer(faux({}, 'viewer'), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable quand la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:lancer_lire': [] }, 'operator');
    await expect(lancer(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('refuse avec les manques et n’écrit rien', async () => {
    const ctx = faux(
      {
        'jr:lancer_lire': [{ entry_rules: {} }],
        'jr:collision_themes': [],
        'jr:manques_etapes': [],
      },
      'operator',
    );
    const r = await lancer(ctx, { campagneId });
    expect(r).toEqual({ ok: false, manques: ['la séquence ne comporte aucune étape'] });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /jr:lancer_activer/i.test(String(a[0])))).toBe(false);
    expect(appels.some((a) => /insert into audit_events/i.test(String(a[0])))).toBe(false);
  });

  it('accepte, active la campagne et écrit campaign_activated', async () => {
    const ctx = faux(
      {
        'jr:lancer_lire': [{ entry_rules: {} }],
        'jr:collision_themes': [],
        'jr:manques_etapes': [{ position: 0, channel: 'email', template_parent_id: 'tpl-1' }],
        'jr:manques_genres': [{ kind: 'email' }],
        'jr:manques_cle': [{ status: 'configured' }],
        'jr:manques_boites': [{ provider_ref: 'sblk-1', provider_state: { sending_enabled: true } }],
        'jr:lancer_activer': [{ id: campagneId }],
      },
      'operator',
    );
    const r = await lancer(ctx, { campagneId });
    expect(r).toEqual({ ok: true });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const journal = appels.find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual(['org-1', 'user-1', 'campaign', campagneId, 'campaign_activated', JSON.stringify({ libelle: 'Campagne lancée' })]);
  });

  it('refuse par collision de persona avant même de regarder les manques', async () => {
    const ctx = faux(
      {
        'jr:lancer_lire': [{ entry_rules: { personas: ['persona-1'] } }],
        'jr:collision_themes': [{ source_id: 'src-1' }],
        'jr:collision_autres': [{ id: 'camp-2', name: 'Autre campagne', entry_rules: { personas: ['persona-1'] }, source_id: null }],
        'jr:collision_liens': [{ campaign_id: 'camp-2', source_id: 'src-1' }],
      },
      'operator',
    );
    const r = await lancer(ctx, { campagneId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.manques[0]).toContain('Autre campagne');
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /jr:manques_etapes/i.test(String(a[0])))).toBe(false);
  });
});

describe('mettreEnPause', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un viewer', async () => {
    await expect(mettreEnPause(faux({}, 'viewer'), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:mettre_en_pause': [] }, 'operator');
    await expect(mettreEnPause(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('écrit campaign_paused', async () => {
    const ctx = faux({ 'jr:mettre_en_pause': [{ id: campagneId }] }, 'operator');
    await mettreEnPause(ctx, { campagneId });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const journal = appels.find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual(['org-1', 'user-1', 'campaign', campagneId, 'campaign_paused', JSON.stringify({ libelle: 'Campagne mise en pause' })]);
  });

  it('un échec du journal n’empêche jamais la mise en pause de réussir', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:mettre_en_pause/i.test(sql)) return { rows: [{ id: campagneId }], rowCount: 1 };
      if (/insert into audit_events/i.test(sql)) throw new Error('table audit_events indisponible');
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'operator' };
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(mettreEnPause(ctx, { campagneId })).resolves.toBeUndefined();
    expect(avertissement).toHaveBeenCalledWith('[journal] campaign_paused', expect.any(Error));
    avertissement.mockRestore();
  });
});

describe('archiver', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un operator (exige admin)', async () => {
    await expect(archiver(faux({}, 'operator'), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:archiver': [] }, 'admin');
    await expect(archiver(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('archive sans écrire d’événement de journal (comportement préservé)', async () => {
    const ctx = faux({ 'jr:archiver': [{ id: campagneId }] }, 'admin');
    await archiver(ctx, { campagneId });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /insert into audit_events/i.test(String(a[0])))).toBe(false);
  });
});

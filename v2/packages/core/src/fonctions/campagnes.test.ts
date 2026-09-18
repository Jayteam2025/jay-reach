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
  etapeAffichee,
  evenementsEnvoisGroupes,
  tauxSurPartis,
  trouverColonneIntitulePoste,
  lancer,
  lireVueDEnsemble,
  listerActivite,
  listerBoitesPourCampagne,
  listerCampagnes,
  listerContactsCampagne,
  listerFileDuJour,
  listerPersonasCampagne,
  listerPersonasOrganisation,
  manquesPourLancer,
  marqueBoite,
  mettreEnPause,
  modifierReglagesCampagne,
  motifPauseDe,
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

describe('tauxSurPartis (point 1, définitions uniques)', () => {
  it('arrondit au dixième', () => {
    expect(tauxSurPartis(1, 3)).toBe(33.3);
  });

  it('rend `null` (jamais 0) quand rien n’est parti — la page affiche « — »', () => {
    expect(tauxSurPartis(0, 0)).toBeNull();
  });

  it('100 % quand tout ce qui est parti a répondu/été livré', () => {
    expect(tauxSurPartis(2, 2)).toBe(100);
  });
});

describe('trouverColonneIntitulePoste (point 2, issue #120)', () => {
  it('trouve la colonne « Intitulé Poste » (accent, espace) via la normalisation', () => {
    expect(trouverColonneIntitulePoste({ 'Intitulé Poste': 'Responsable RH', Email: 'a@b.fr' })).toBe('Intitulé Poste');
  });

  it('trouve « Job Title » (déjà en anglais)', () => {
    expect(trouverColonneIntitulePoste({ 'Job Title': 'HR Manager', Email: 'a@b.fr' })).toBe('Job Title');
  });

  // Revue F5, constat important 4 : produit trilingue (fr/en/nl, parité stricte testée) —
  // un CSV importé avec un en-tête néerlandais ou anglais courant doit aussi être reconnu.
  it('trouve « Functietitel » (néerlandais)', () => {
    expect(trouverColonneIntitulePoste({ Functietitel: 'HR-manager', Email: 'a@b.fr' })).toBe('Functietitel');
  });

  it('trouve « Functie » (néerlandais, variante courte)', () => {
    expect(trouverColonneIntitulePoste({ Functie: 'HR-manager', Email: 'a@b.fr' })).toBe('Functie');
  });

  it('trouve « Functienaam » (néerlandais, variante longue)', () => {
    expect(trouverColonneIntitulePoste({ Functienaam: 'HR-manager', Email: 'a@b.fr' })).toBe('Functienaam');
  });

  it('trouve « Title » (anglais courant)', () => {
    expect(trouverColonneIntitulePoste({ Title: 'HR Manager', Email: 'a@b.fr' })).toBe('Title');
  });

  it('trouve « Position » (anglais courant)', () => {
    expect(trouverColonneIntitulePoste({ Position: 'HR Manager', Email: 'a@b.fr' })).toBe('Position');
  });

  it('trouve « Role » (anglais courant)', () => {
    expect(trouverColonneIntitulePoste({ Role: 'HR Manager', Email: 'a@b.fr' })).toBe('Role');
  });

  it('rend `null` sans colonne correspondante', () => {
    expect(trouverColonneIntitulePoste({ Nom: 'Dupont', Email: 'a@b.fr' })).toBeNull();
  });
});

describe('ORDRE_STATUTS', () => {
  it('respecte l’ordre de priorité de la spec (ne_plus_contacter en tête, a_contacter en dernier)', () => {
    expect(ORDRE_STATUTS).toEqual([
      'ne_plus_contacter',
      'rebond',
      'interesse',
      'a_repondu',
      'ecarte',
      'termine',
      'en_pause',
      'en_sequence',
      'sans_email',
      'a_contacter',
    ]);
  });
});

describe('motifPauseDe', () => {
  it('rend stop_reason quand il est posé', () => {
    expect(motifPauseDe('paused', 'email_gate:bouncer_invalid')).toBe('email_gate:bouncer_invalid');
  });

  it('rend "absence" pour un paused_absence sans motif propre', () => {
    expect(motifPauseDe('paused_absence', null)).toBe('absence');
  });

  it('rend "inconnu" en dernier repli (paused sans motif, ne devrait pas survenir)', () => {
    expect(motifPauseDe('paused', null)).toBe('inconnu');
  });
});

describe('marqueBoite', () => {
  it('reconnaît un domaine outlook', () => {
    expect(marqueBoite('camille@outlook.com')).toBe('outlook');
    expect(marqueBoite('camille@hotmail.fr')).toBe('outlook');
  });
  it('reconnaît un domaine gmail', () => {
    expect(marqueBoite('camille@gmail.com')).toBe('gmail');
  });
  it('renvoie null pour un domaine propre à l’organisation', () => {
    expect(marqueBoite('camille@exemple.fr')).toBeNull();
  });
  it('R63 (tour de correction 2) : inbox_provider microsoft_graph prime sur l’heuristique de domaine', () => {
    // Une boîte Microsoft 365 connectée en Graph a un domaine propre à
    // l'organisation (jamais outlook.com/hotmail.com), invisible à
    // l'heuristique seule — elle s'affichait en tuile « @ » avant ce correctif.
    expect(marqueBoite('camille@exemple.fr', 'microsoft_graph')).toBe('outlook');
  });
  it('R63 : sans inbox_provider microsoft_graph, l’heuristique de domaine reste inchangée', () => {
    expect(marqueBoite('camille@exemple.fr', null)).toBeNull();
    expect(marqueBoite('camille@gmail.com', null)).toBe('gmail');
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
          en_pause: 1,
          partis: 20,
          reponses: 2,
          interesses: 1,
          derniere_activite: '2026-09-14T10:00:00.000Z',
        },
      ],
      'jr:boites_actives': [{ id: 'send-1', identity: 'camille@outlook.com' }],
      'jr:tendance_livraisons': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r).toHaveLength(1);
    expect(r[0]!.boites).toEqual([{ id: 'send-1', identite: 'camille@outlook.com', marque: 'outlook' }]);
    expect(r[0]!.sources).toEqual([{ providerId: 'adzuna' }]);
    // Point 1 : taux sur les emails partis (dispatched+delivered), pas sur les contacts qualifiés.
    expect(r[0]!.tauxReponse).toBe(10);
    expect(r[0]!.enSequence).toBe(5);
    expect(r[0]!.enPause).toBe(1);
    expect(r[0]!.tendance7j).toHaveLength(7);
    expect(r[0]!.tendance7j.every((n) => n === 0)).toBe(true);
    // R31 : « Contacts » compte des personnes (`contacts`), pas les offres/signaux qualifiés (`qualifies`).
    expect(r[0]!.contacts).toBe(18);
    expect(r[0]!.interesses).toBe(1);
    expect(r[0]!.derniereActivite).toBe('2026-09-14T10:00:00.000Z');
  });

  // Revue F5, point 1 : la liste des campagnes montrait encore « aucune source » pour une
  // campagne à liste, faute de regarder `enrollments.list_id`/`campaigns.list_id`.
  it('point 1 (revue F5) : listeSource remplace « aucune source » pour une campagne à liste', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1',
          name: 'Jay coach - RH',
          status: 'active',
          entry_rules: {},
          sources: [],
          qualifies: 0,
          contacts: 167,
          en_sequence: 165,
          en_pause: 2,
          partis: 110,
          reponses: 1,
          interesses: 0,
          derniere_activite: null,
          liste_source: { nom: 'RH avril 2026', autres: 0 },
        },
      ],
      'jr:boites_actives': [],
      'jr:tendance_livraisons': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.listeSource).toEqual({ nom: 'RH avril 2026', autresListes: 0 });
  });

  it('sans liste (campagne à sources) : listeSource est `null`', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1', name: 'Directeur commercial', status: 'active', entry_rules: {}, sources: ['adzuna'],
          qualifies: 20, contacts: 18, en_sequence: 5, en_pause: 1, partis: 20, reponses: 2, interesses: 1, derniere_activite: null,
        },
      ],
      'jr:boites_actives': [],
      'jr:tendance_livraisons': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.listeSource).toBeNull();
  });

  it('la tendance 7 jours groupe par jour de l’organisation, pas par jour UTC du serveur (I5, revue finale)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T23:30:00.000Z')); // 00:30 à Paris le 15
    try {
      const ctx = faux({
        'jr:campagnes_liste': [
          {
            id: 'camp-1',
            name: 'C',
            status: 'active',
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
        'jr:tendance_livraisons': [{ campaign_id: 'camp-1', jour: '2026-01-15', n: 5 }],
      });
      const r = await listerCampagnes(ctx);
      expect(r[0]!.tendance7j.at(-1)).toBe(5);
      const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const appelTendance = appels.find((appel) => /jr:tendance_livraisons/i.test(String(appel[0])));
      expect(appelTendance?.[1]).toEqual([['camp-1'], 'Europe/Paris']);
    } finally {
      vi.useRealTimers();
    }
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

  it('R63 (tour de correction 2) : une boîte Microsoft 365 sur un domaine propre est marquée outlook via inbox_provider', async () => {
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
      'jr:boites_actives': [{ id: 'send-1', identity: 'boite@exemple.fr', inbox_provider: 'microsoft_graph' }],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.boites).toEqual([{ id: 'send-1', identite: 'boite@exemple.fr', marque: 'outlook' }]);
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

  it('point 1 (tour de correction 5) : zéro emails partis → tauxReponse `null` (jamais 0 %, jamais une division par zéro)', async () => {
    const ctx = faux({
      'jr:campagnes_liste': [
        {
          id: 'camp-1',
          name: 'Recette SalesBlink',
          status: 'active',
          entry_rules: {},
          sources: [],
          qualifies: 4,
          contacts: 2,
          en_sequence: 2,
          en_pause: 0,
          partis: 0,
          reponses: 1,
          interesses: 0,
          derniere_activite: null,
        },
      ],
      'jr:boites_actives': [],
    });
    const r = await listerCampagnes(ctx);
    expect(r[0]!.tauxReponse).toBeNull();
    expect(r[0]!.reponses).toBe(1);
  });

  it('point 4 (tour de correction 5) : les boîtes de l’organisation sont triées par adresse', async () => {
    const ctx = faux({ 'jr:campagnes_liste': [], 'jr:boites_actives': [] });
    await listerCampagnes(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appel = appels.find((a) => /jr:boites_actives/i.test(String(a[0])));
    expect(String(appel![0])).toMatch(/order by identity asc/i);
  });
});

describe('lireVueDEnsemble', () => {
  function ctxComplet(role: Contexte['role'] = 'viewer') {
    return faux(
      {
        'jr:campagne_entete': [{ id: 'camp-1', name: 'Directeur commercial', status: 'active', entry_rules: { min_score: 80 }, daily_cap: 40 }],
        'jr:boites_actives': [{ id: 'send-1', identity: 'camille@outlook.com' }],
        'organization_settings': [],
        'jr:entonnoir_commun': [{ list_id: null, en_sequence: 10, en_pause: 1, livres: 20, partis: 40, reponses: 4, interesses: 2 }],
        'jr:entonnoir_sources': [{ trouves: 100, qualifies: 40, contacts: 35 }],
        'jr:file_du_jour_campagne': [],
        'jr:sources_campagne_resume': [{ id: 'src-1', nom: 'Adzuna', provider_id: 'adzuna' }],
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
    expect(v.campagne.boites).toEqual([{ id: 'send-1', identite: 'camille@outlook.com', marque: 'outlook' }]);
    expect(v.entonnoir.origine).toBe('sources');
    if (v.entonnoir.origine !== 'sources') throw new Error('unreachable');
    expect(v.entonnoir.trouves).toBe(100);
    // Marche « Contacts identifiés » (R31), après « Contacts qualifiés » : des personnes, pas des offres.
    expect(v.entonnoir.contacts).toBe(35);
    // Point 1 : tauxLivres = livres / partis = 20/40 = 50 % ; tauxReponses = reponses / partis = 4/40 = 10 %.
    expect(v.entonnoir.tauxLivres).toBe(50);
    expect(v.entonnoir.tauxReponses).toBe(10);
    expect(v.entonnoir.enSequence).toBe(10);
    expect(v.entonnoir.enPause).toBe(1);
    expect(v.sources).toEqual([{ id: 'src-1', nom: 'Adzuna', providerId: 'adzuna' }]);
    // Compteur de l'onglet Sources (tâche 11) : nombre réel de lignes
    // `campaign_sources`, pas `sources.length` (distinct provider_id) — les
    // deux coïncident ici mais divergeraient avec deux thèmes du même
    // fournisseur.
    expect(v.nombreSources).toBe(1);
  });

  it('R70 (tour de correction 4) : une source sans aucun repère de fournisseur renvoie providerId null (jamais un plantage)', () => {
    const ctx = faux({
      'jr:campagne_entete': [{ id: 'camp-1', name: 'C', status: 'draft', entry_rules: {}, daily_cap: null }],
      'jr:boites_actives': [],
      organization_settings: [],
      'jr:entonnoir_commun': [{ list_id: null, en_sequence: 0, en_pause: 0, livres: 0, partis: 0, reponses: 0, interesses: 0 }],
      'jr:entonnoir_sources': [{ trouves: 0, qualifies: 0, contacts: 0 }],
      'jr:file_du_jour_campagne': [],
      // `SQL_PROVIDER_ID_AFFICHAGE` rend `null` quand ni `source_providers`, ni
      // `config.sourceType`, ni la colonne héritée `sources.provider_id` n'ont
      // de valeur — la page d'ensemble doit se rabattre sur 'lettre', pas planter.
      'jr:sources_campagne_resume': [{ provider_id: null }],
      'jr:sources_campagne_compte': [{ n: 1 }],
      'jr:activite_campagne': [],
      scored_today: [],
      enrich_today: [],
      'from actions': [],
      'from senders': [],
    });
    return expect(lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' })).resolves.toMatchObject({
      sources: [{ providerId: null }],
    });
  });

  describe('campagne à liste (point 2, issue #120)', () => {
    it('entonnoir "liste" (contacts importés → email vérifié), listeSource exposée, jamais "0 offres et profils trouvés"', async () => {
      const ctx = faux({
        'jr:campagne_entete': [{ id: 'camp-1', name: 'Jay coach - RH', status: 'active', entry_rules: {}, daily_cap: null }],
        'jr:boites_actives': [],
        organization_settings: [],
        'jr:campagne_liste_source': [{ list_id: 'liste-1', nom: 'RH avril 2026', importee_le: '2026-09-10T08:00:00.000Z', contacts: 167 }],
        'jr:entonnoir_commun': [{ en_sequence: 165, en_pause: 2, livres: 105, partis: 110, reponses: 1, interesses: 0 }],
        'jr:entonnoir_liste': [{ contacts_importes: 167, email_verifie: 160 }],
        'jr:file_du_jour_campagne': [],
        'jr:sources_campagne_resume': [],
        'jr:sources_campagne_compte': [{ n: 0 }],
        'jr:activite_campagne_tout_audit': [],
        'jr:activite_campagne_tout_envois': [],
        scored_today: [],
        enrich_today: [],
        'from actions': [],
        'from senders': [],
      });

      const v = await lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' });

      expect(v.listeSource).toEqual({ nom: 'RH avril 2026', contacts: 167, importeeLe: '2026-09-10T08:00:00.000Z', autresListes: 0 });
      expect(v.entonnoir.origine).toBe('liste');
      if (v.entonnoir.origine !== 'liste') throw new Error('unreachable');
      expect(v.entonnoir.contactsImportes).toBe(167);
      expect(v.entonnoir.emailVerifie).toBe(160);
      expect(v.entonnoir.enSequence).toBe(165);
      expect(v.entonnoir.enPause).toBe(2);
      // 105 livrés / 110 partis, jamais un dénominateur à zéro (constat (dd)).
      expect(v.entonnoir.tauxLivres).toBeCloseTo(95.5, 0);
      expect(v.entonnoir.tauxReponses).toBeCloseTo(0.9, 0);
    });

    it('sans liste (campagne à sources) : listeSource est `null`', async () => {
      const v = await lireVueDEnsemble(ctxComplet(), { campagneId: '11111111-1111-1111-1111-111111111111' });
      expect(v.listeSource).toBeNull();
    });

    // Revue F5, point 1 : la campagne réelle « Jay coach - RH » a `campaigns.list_id` ET
    // `campaigns.source_id` nuls — seules ses inscriptions portent `list_id`. Une campagne
    // peut aussi puiser dans plusieurs listes distinctes (import successif) : la dominante
    // (le plus d'inscriptions) fait le texte, les autres comptent dans `autresListes`.
    it('plusieurs listes distinctes (deux imports successifs) : la dominante fait le texte, les autres comptent', async () => {
      const ctx = faux({
        'jr:campagne_entete': [{ id: 'camp-1', name: 'Jay coach - RH', status: 'active', entry_rules: {}, daily_cap: null }],
        'jr:boites_actives': [],
        organization_settings: [],
        // La requête réelle trie déjà par nombre d'inscriptions décroissant : la dominante en tête.
        'jr:campagne_liste_source': [
          { list_id: 'liste-1', nom: 'RH avril 2026', importee_le: '2026-09-10T08:00:00.000Z', contacts: 167 },
          { list_id: 'liste-2', nom: 'RH complément mai', importee_le: '2026-09-15T08:00:00.000Z', contacts: 12 },
        ],
        'jr:entonnoir_commun': [{ en_sequence: 165, en_pause: 2, livres: 105, partis: 110, reponses: 1, interesses: 0 }],
        'jr:entonnoir_liste': [{ contacts_importes: 179, email_verifie: 170 }],
        'jr:file_du_jour_campagne': [],
        'jr:sources_campagne_resume': [],
        'jr:sources_campagne_compte': [{ n: 0 }],
        'jr:activite_campagne_tout_audit': [],
        'jr:activite_campagne_tout_envois': [],
        scored_today: [],
        enrich_today: [],
        'from actions': [],
        'from senders': [],
      });

      const v = await lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' });

      expect(v.listeSource).toEqual({ nom: 'RH avril 2026', contacts: 167, importeeLe: '2026-09-10T08:00:00.000Z', autresListes: 1 });
      expect(v.entonnoir.origine).toBe('liste');
      if (v.entonnoir.origine !== 'liste') throw new Error('unreachable');
      // Membres des DEUX listes (179), pas seulement de la dominante (167).
      expect(v.entonnoir.contactsImportes).toBe(179);
    });

    // Revue F5, point 1 : le bug réel corrigé — `campaigns.list_id` seul ne détecte rien sur
    // la campagne de production (« Jay coach - RH », `list_id`/`source_id` nuls), dont seules
    // les inscriptions portent `list_id`. Vérifie le TEXTE de la requête, pas seulement le
    // résultat rejoué par `faux()` : sans ce test, retirer la jointure `enrollments` ne ferait
    // échouer aucun autre test de ce bloc (tous rejouent une réponse déjà posée par le fixture).
    it('la requête résout la liste via enrollments.list_id, pas seulement campaigns.list_id', async () => {
      const queryMock = vi.fn(async (sql: string) => {
        if (/jr:campagne_liste_source/i.test(sql)) {
          return { rows: [{ list_id: 'liste-1', nom: 'RH avril 2026', importee_le: '2026-09-10T08:00:00.000Z', contacts: 167 }], rowCount: 1 };
        }
        if (/jr:campagne_entete/i.test(sql)) {
          return { rows: [{ id: 'camp-1', name: 'Jay coach - RH', status: 'active', entry_rules: {}, daily_cap: null }], rowCount: 1 };
        }
        if (/jr:entonnoir_commun/i.test(sql)) {
          return { rows: [{ en_sequence: 165, en_pause: 2, livres: 105, partis: 110, reponses: 1, interesses: 0 }], rowCount: 1 };
        }
        if (/jr:entonnoir_liste/i.test(sql)) return { rows: [{ contacts_importes: 167, email_verifie: 160 }], rowCount: 1 };
        if (/jr:sources_campagne_compte/i.test(sql)) return { rows: [{ n: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      });
      const query = queryMock as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

      const v = await lireVueDEnsemble(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' });

      expect(v.listeSource).not.toBeNull();
      expect(v.entonnoir.origine).toBe('liste');
      const appel = queryMock.mock.calls.find((a) => /jr:campagne_liste_source/i.test(String(a[0])));
      expect(String(appel![0])).toMatch(/from enrollments e/i);
      expect(String(appel![0])).toMatch(/e\.list_id is not null/i);
    });
  });
});

describe('etapeAffichee', () => {
  it('numérote 1-based une inscription en cours (current_step 0-based)', () => {
    expect(etapeAffichee(0, 4)).toBe(1);
    expect(etapeAffichee(2, 4)).toBe(3);
  });

  it('borne au nombre d’étapes une inscription qui les a toutes dépassées (R81)', () => {
    expect(etapeAffichee(1, 1)).toBe(1);
    expect(etapeAffichee(3, 3)).toBe(3);
  });

  it('reste `null` sans inscription', () => {
    expect(etapeAffichee(null, 4)).toBeNull();
  });

  it('ne borne pas quand le nombre d’étapes est inconnu (0)', () => {
    expect(etapeAffichee(0, 0)).toBe(1);
  });
});

describe('listerContactsCampagne', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';
  /**
   * I1 (Important, revue finale du 14/09) : `listerContactsCampagne` vérifie
   * désormais que la campagne appartient à l'organisation AVANT toute autre
   * requête — la plupart des tests de ce bloc portent sur autre chose, ce
   * garde le leur fournit sans le répéter.
   */
  const verifieeDansLOrganisation = { 'jr:contacts_campagne_verif': [{ id: campagneId }] };

  it('refuse un rôle insuffisant (aucun rôle)', async () => {
    await expect(listerContactsCampagne(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  // I1 (Important, revue finale du 14/09) : sans ce garde, une campagne d'une
  // autre organisation aurait rendu les noms, postes, entreprises, adresses,
  // scores et statuts de SA population — exactement le défaut que T29 avait
  // déjà corrigé sur `colonnesDeListeCampagne` (`sequence.ts`).
  it('lève ErreurIntrouvable pour une campagne d’une autre organisation, sans émettre les autres requêtes', async () => {
    const ctx = faux({ 'jr:contacts_campagne_verif': [] });
    await expect(listerContactsCampagne(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels).toHaveLength(1);
  });

  it('calcule les compteurs par statut, tous compris, et en fait le total (pas de la page)', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
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
      ...verifieeDansLOrganisation,
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 42 }],
      'jr:lignes_contacts_campagne': [], // page au-delà de la dernière : aucune ligne renvoyée
    });
    const r = await listerContactsCampagne(ctx, { campagneId, filtre: 'en_sequence', page: 50 });
    expect(r.lignes).toHaveLength(0);
    expect(r.total).toBe(42);
  });

  /** Même garde d'organisation que `verifieeDansLOrganisation`, pour un `vi.fn()` brut plutôt que `faux()`. */
  function queryVerifiee(): Executeur['query'] {
    return vi.fn(async (sql: string) => {
      if (/jr:contacts_campagne_verif/i.test(sql)) return { rows: [{ id: campagneId }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
  }

  it('la population est faite de personnes : jointure interne sur contacts, signaux non qualifiés exclus (R29)', async () => {
    const query = queryVerifiee();
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const [sql] = appels.find((a) => /jr:compteurs_contacts_campagne/i.test(String(a[0]))) as [string];
    expect(sql).toMatch(/join contacts c on c\.id = pop\.contact_id/);
    expect(sql).not.toMatch(/left join contacts/);
    expect(sql).toMatch(/s0\.status <> 'new'/);
  });

  it('la population inclut aussi les contacts inscrits sans signal (R36, tour de correction 1)', async () => {
    const query = queryVerifiee();
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const [sql] = appels.find((a) => /jr:compteurs_contacts_campagne/i.test(String(a[0]))) as [string];
    expect(sql).toMatch(/select e1\.contact_id, null::uuid\s+from enrollments e1/);
    expect(sql).toMatch(/left join signals s on s\.id = pop\.signal_id/);
  });

  it('la règle « sans email » couvre invalide, risqué et inconnu, pas seulement invalide (R27)', async () => {
    const query = queryVerifiee();
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const [sql] = appels.find((a) => /jr:compteurs_contacts_campagne/i.test(String(a[0]))) as [string];
    expect(sql).toMatch(/c\.email_status <> 'valid'/);
    expect(sql).not.toMatch(/email_status = 'invalid'/);
  });

  it('un contact `replied` avec un fil intéressé remonte comme `interesse` (priorité sur `a_repondu`)', async () => {
    // Le mock ne rejoue pas le `case` SQL : il simule ce que la requête renverrait déjà pour
    // cette situation, ORDRE_STATUTS faisant foi sur la priorité (interesse avant a_repondu).
    const ctx = faux({
      ...verifieeDansLOrganisation,
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
      ...verifieeDansLOrganisation,
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
      ...verifieeDansLOrganisation,
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: null,
          contact_id: 'contact-2',
          first_name: 'Camille',
          last_name: 'Recette',
          job_title: null,
          email: 'camille@exemple.fr',
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

  // T29, partie B : une ligne `en_pause` porte l'inscription, le motif de
  // pause (dérivé de `stop_reason`/`e_status`) et la date de reprise.
  it('une ligne en_pause (email_gate) expose inscriptionId, motifPause et repriseLe nul', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
      'jr:compteurs_contacts_campagne': [{ statut: 'en_pause', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: null,
          contact_id: 'contact-3',
          first_name: 'Sami',
          last_name: 'Nasri',
          job_title: null,
          email: 'sami@exemple.fr',
          entreprise: null,
          current_step: 1,
          statut: 'en_pause',
          score: null,
          pourquoi: null,
          enrollment_id: 'enr-1',
          e_status: 'paused',
          stop_reason: 'email_gate:bouncer_invalid',
          resume_at: null,
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]).toMatchObject({
      statut: 'en_pause',
      inscriptionId: 'enr-1',
      motifPause: 'email_gate:bouncer_invalid',
      repriseLe: null,
    });
  });

  it('une ligne en_pause (paused_absence, datée) retombe sur motifPause "absence" et porte repriseLe', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
      'jr:compteurs_contacts_campagne': [{ statut: 'en_pause', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: null,
          contact_id: 'contact-4',
          first_name: 'Léa',
          last_name: 'Petit',
          job_title: null,
          email: 'lea@exemple.fr',
          entreprise: null,
          current_step: 1,
          statut: 'en_pause',
          score: null,
          pourquoi: null,
          enrollment_id: 'enr-2',
          e_status: 'paused_absence',
          stop_reason: null,
          resume_at: '2026-09-22T00:00:00.000Z',
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]).toMatchObject({
      statut: 'en_pause',
      inscriptionId: 'enr-2',
      motifPause: 'absence',
      repriseLe: '2026-09-22T00:00:00.000Z',
    });
  });

  it('une ligne hors pause a motifPause et repriseLe nuls même si l’inscription en porte', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: null,
          contact_id: 'contact-5',
          first_name: 'Yanis',
          last_name: 'Roux',
          job_title: null,
          email: 'yanis@exemple.fr',
          entreprise: null,
          current_step: 1,
          statut: 'en_sequence',
          score: null,
          pourquoi: null,
          enrollment_id: 'enr-3',
          e_status: 'active',
          stop_reason: null,
          resume_at: null,
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]).toMatchObject({ statut: 'en_sequence', inscriptionId: 'enr-3', motifPause: null, repriseLe: null });
  });

  it('passe la pagination et le filtre à la requête (page 2, filtre en_sequence)', async () => {
    const query = queryVerifiee();
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerContactsCampagne(ctx, { campagneId, filtre: 'en_sequence', page: 2 });
    const appels = (query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelLignes = appels.find((a) => /jr:lignes_contacts_campagne/i.test(String(a[0])));
    expect(appelLignes?.[1]).toEqual([campagneId, 'en_sequence', null, 50, 50, null]);
  });

  // R81 : `current_step` peut dépasser le nombre d'étapes une fois la séquence
  // épuisée (`composeTick` avance `current_step` à `steps.length`) — sans
  // bornage, une campagne à une seule étape affichait « Étape 2 ».
  it('borne l’étape affichée au nombre d’étapes de la campagne (R81)', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
      'jr:total_etapes_campagne': [{ n: 1 }],
      'jr:compteurs_contacts_campagne': [{ statut: 'termine', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Léa',
          last_name: 'Fontaine',
          job_title: 'Head of Sales',
          email: 'lea@exemple.fr',
          entreprise: 'Ondine',
          current_step: 1,
          statut: 'termine',
          score: 77,
          pourquoi: 'SDR confirmé',
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]!.etape).toBe(1);
  });

  it('ne borne pas quand la campagne n’a pas encore d’étape connue (totalEtapes à 0, calcul d’origine conservé)', async () => {
    const ctx = faux({
      ...verifieeDansLOrganisation,
      'jr:total_etapes_campagne': [{ n: 0 }],
      'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 1 }],
      'jr:lignes_contacts_campagne': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: null,
          email: 'karim@exemple.fr',
          entreprise: null,
          current_step: 0,
          statut: 'en_sequence',
          score: null,
          pourquoi: null,
        },
      ],
    });
    const r = await listerContactsCampagne(ctx, { campagneId });
    expect(r.lignes[0]!.etape).toBe(1);
  });

  describe('point 2 (issue #120) : colonne « Pourquoi lui »/« Score » remplacée par l’intitulé de poste de la liste', () => {
    it('campagne à liste, colonne trouvée : `colonnePosteListe` à `true`, valeur par ligne, paramètres transmis à la requête', async () => {
      const queryMock = vi.fn(async (sql: string, _values?: unknown[]) => {
        if (/jr:contacts_campagne_verif/i.test(sql)) return { rows: [{ id: campagneId, list_id_echantillon: 'liste-1' }], rowCount: 1 };
        if (/jr:contacts_liste_echantillon/i.test(sql)) return { rows: [{ raw_row: { 'Intitulé Poste': 'Responsable RH', Email: 'a@b.fr' } }], rowCount: 1 };
        if (/jr:compteurs_contacts_campagne/i.test(sql)) return { rows: [{ statut: 'en_sequence', n: 1 }], rowCount: 1 };
        if (/jr:lignes_contacts_campagne/i.test(sql)) {
          return {
            rows: [
              {
                signal_id: null,
                contact_id: 'contact-1',
                first_name: 'Karim',
                last_name: 'Benali',
                job_title: null,
                email: 'karim@exemple.fr',
                entreprise: null,
                current_step: 0,
                statut: 'en_sequence',
                score: null,
                pourquoi: null,
                enrollment_id: 'enr-1',
                e_status: 'active',
                stop_reason: null,
                resume_at: null,
                intitule_poste_liste: 'Responsable RH',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      });
      const query = queryMock as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

      const r = await listerContactsCampagne(ctx, { campagneId });

      expect(r.colonnePosteListe).toBe(true);
      expect(r.lignes[0]!.intitulePosteListe).toBe('Responsable RH');
      const appelLignes = queryMock.mock.calls.find((a) => /jr:lignes_contacts_campagne/i.test(String(a[0])));
      expect(appelLignes![1]).toEqual([campagneId, 'tous', null, 50, 0, 'Intitulé Poste']);
    });

    it('campagne à liste, colonne absente du CSV : `colonnePosteListe` à `false`, `intitulePosteListe` à `null`', async () => {
      const ctx = faux({
        'jr:contacts_campagne_verif': [{ id: campagneId, list_id_echantillon: 'liste-1' }],
        'jr:contacts_liste_echantillon': [{ raw_row: { Nom: 'Dupont', Email: 'a@b.fr' } }],
        'jr:compteurs_contacts_campagne': [{ statut: 'en_sequence', n: 1 }],
        'jr:lignes_contacts_campagne': [
          {
            signal_id: null,
            contact_id: 'contact-1',
            first_name: 'Karim',
            last_name: 'Benali',
            job_title: null,
            email: 'karim@exemple.fr',
            entreprise: null,
            current_step: 0,
            statut: 'en_sequence',
            score: null,
            pourquoi: null,
            intitule_poste_liste: null,
          },
        ],
      });
      const r = await listerContactsCampagne(ctx, { campagneId });
      expect(r.colonnePosteListe).toBe(false);
      expect(r.lignes[0]!.intitulePosteListe).toBeNull();
    });

    it('campagne à sources (sans liste) : jamais de requête d’échantillon, `colonnePosteListe` à `false`', async () => {
      const queryMock = vi.fn(async (sql: string) => {
        if (/jr:contacts_campagne_verif/i.test(sql)) return { rows: [{ id: campagneId, list_id_echantillon: null }], rowCount: 1 };
        if (/jr:compteurs_contacts_campagne/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/jr:lignes_contacts_campagne/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      });
      const query = queryMock as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

      const r = await listerContactsCampagne(ctx, { campagneId });

      expect(r.colonnePosteListe).toBe(false);
      expect(queryMock.mock.calls.some((a) => /jr:contacts_liste_echantillon/i.test(String(a[0])))).toBe(false);
    });

    // Revue F5, point 1 : deux contacts de la MÊME campagne peuvent venir de deux listes
    // différentes — la jointure se corrèle par inscription (e.list_id), jamais par une
    // seule liste échantillon repérée en tête de fonction.
    it('deux contacts de deux listes différentes gardent chacun leur propre intitulé de poste', async () => {
      const queryMock = vi.fn(async (sql: string) => {
        if (/jr:contacts_campagne_verif/i.test(sql)) return { rows: [{ id: campagneId, list_id_echantillon: 'liste-1' }], rowCount: 1 };
        if (/jr:contacts_liste_echantillon/i.test(sql)) return { rows: [{ raw_row: { 'Intitulé Poste': 'Responsable RH' } }], rowCount: 1 };
        if (/jr:compteurs_contacts_campagne/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/jr:lignes_contacts_campagne/i.test(sql)) {
          return {
            rows: [
              { signal_id: null, contact_id: 'c1', first_name: 'A', last_name: 'B', job_title: null, email: 'a@b.fr', entreprise: null, current_step: 0, statut: 'en_sequence', score: null, pourquoi: null, enrollment_id: 'e1', e_status: 'active', stop_reason: null, resume_at: null, intitule_poste_liste: 'Responsable RH' },
              { signal_id: null, contact_id: 'c2', first_name: 'C', last_name: 'D', job_title: null, email: 'c@d.fr', entreprise: null, current_step: 0, statut: 'en_sequence', score: null, pourquoi: null, enrollment_id: 'e2', e_status: 'active', stop_reason: null, resume_at: null, intitule_poste_liste: 'Directeur commercial' },
            ],
            rowCount: 2,
          };
        }
        return { rows: [], rowCount: 0 };
      });
      const query = queryMock as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

      const r = await listerContactsCampagne(ctx, { campagneId });

      expect(r.lignes.map((l) => l.intitulePosteListe)).toEqual(['Responsable RH', 'Directeur commercial']);
      const appelLignes = queryMock.mock.calls.find((a) => /jr:lignes_contacts_campagne/i.test(String(a[0])));
      expect(String(appelLignes![0])).toMatch(/lm\.list_id = e\.list_id/);
    });
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

  it('à 00:30 Paris (23:30 UTC la veille), le jour retenu est celui de Paris, pas celui du serveur UTC (I5, revue finale)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-14T23:30:00.000Z'));
    try {
      const ctx = faux({
        organization_settings: [],
        'jr:file_du_jour_campagne': [],
        'jr:plafond_envois_org': [{ plafond: 90 }],
      });
      await listerFileDuJour(ctx, {});
      const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
      const appelFile = appels.find((appel) => /jr:file_du_jour_campagne/i.test(String(appel[0])));
      expect(appelFile?.[1]).toEqual(['org-1', '2026-01-15', 'Europe/Paris']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lève ErreurIntrouvable quand la campagne du plafond n’existe pas', async () => {
    const ctx = faux({ organization_settings: [], 'jr:file_du_jour_campagne': [], 'jr:file_du_jour_cap': [] });
    await expect(listerFileDuJour(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  describe('objet d’un envoi (point 5, tour de correction 5)', () => {
    it('un envoi parti garde l’objet déjà stocké sur l’action, jamais celui du gabarit', async () => {
      const ctx = faux({
        organization_settings: [],
        'jr:file_du_jour_campagne': [
          {
            id: 'a1', status: 'delivered', dispatched_at: '2026-09-14T08:00:00Z', scheduled_for: null, dispatch_after: null,
            channel: 'email', first_name: 'Nadia', last_name: 'Lemaire', campagne_nom: 'C', etape: 0, expediteur: 'x@exemple.fr',
            objet: 'Objet réellement envoyé', etape_sujet: 'Gabarit {{prenom}}',
          },
        ],
        'jr:plafond_envois_org': [{ plafond: 90 }],
      });
      const r = await listerFileDuJour(ctx, {});
      expect(r.partis[0]!.objet).toBe('Objet réellement envoyé');
    });

    it('un envoi prévu sans objet stocké rend l’objet du gabarit, variables connues substituées', async () => {
      const ctx = faux({
        organization_settings: [],
        'jr:file_du_jour_campagne': [
          {
            id: 'a1', status: 'scheduled', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00Z', dispatch_after: null,
            channel: 'email', first_name: 'Nadia', last_name: 'Lemaire', campagne_nom: 'C', etape: 0, expediteur: 'x@exemple.fr',
            objet: null, etape_sujet: 'Bonjour {{prenom}}, votre recrutement de {{liste_intitule_poste}}',
          },
        ],
        'jr:plafond_envois_org': [{ plafond: 90 }],
      });
      const r = await listerFileDuJour(ctx, {});
      // `prenom` est connu (déjà dans la requête) : substitué. `liste_intitule_poste` ne l'est
      // pas (pas de requête supplémentaire par ligne) : le gabarit brut reste visible.
      expect(r.prevus[0]!.objet).toBe('Bonjour Nadia, votre recrutement de {{liste_intitule_poste}}');
    });

    it('un envoi prévu sans gabarit (étape LinkedIn, ou introuvable) n’a pas d’objet', async () => {
      const ctx = faux({
        organization_settings: [],
        'jr:file_du_jour_campagne': [
          {
            id: 'a1', status: 'scheduled', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00Z', dispatch_after: null,
            channel: 'linkedin_message', first_name: 'Nadia', last_name: 'Lemaire', campagne_nom: 'C', etape: 0, expediteur: null,
            objet: null, etape_sujet: null,
          },
        ],
        'jr:plafond_envois_org': [{ plafond: 90 }],
      });
      const r = await listerFileDuJour(ctx, {});
      expect(r.prevus[0]!.objet).toBeNull();
    });
  });
});

describe('evenementsEnvoisGroupes (point 3.a, fil d’activité, lignes simulées)', () => {
  it('construit un libellé avec étape et nombre de boîtes', () => {
    const r = evenementsEnvoisGroupes([{ heure: '2026-09-17T08:00:00.000Z', etape: 0, n: 24, boites: 3 }]);
    expect(r).toEqual([
      { id: 'envois-2026-09-17T08:00:00.000Z-0', quand: '2026-09-17T08:00:00.000Z', type: 'action_sent', libelle: '24 email(s) envoyé(s) · étape 1 · 3 boîte(s)', detail: null },
    ]);
  });

  it('sans étape connue (action orpheline), le libellé ne mentionne pas d’étape', () => {
    const r = evenementsEnvoisGroupes([{ heure: '2026-09-17T08:00:00.000Z', etape: null, n: 2, boites: 1 }]);
    expect(r[0]!.libelle).toBe('2 email(s) envoyé(s) · 1 boîte(s)');
  });

  it('un groupe par ligne, plusieurs groupes restent distincts', () => {
    const r = evenementsEnvoisGroupes([
      { heure: '2026-09-17T08:00:00.000Z', etape: 0, n: 24, boites: 3 },
      { heure: '2026-09-17T09:00:00.000Z', etape: 1, n: 5, boites: 2 },
    ]);
    expect(r).toHaveLength(2);
    expect(r.map((e) => e.id)).toEqual(['envois-2026-09-17T08:00:00.000Z-0', 'envois-2026-09-17T09:00:00.000Z-1']);
  });

  // `date_trunc('hour', a.dispatched_at)` (`timestamptz`) revient de `pg` en objet `Date`, jamais
  // une chaîne (F4, `temps.ts`) : `quand` doit rester une chaîne ISO honnête malgré cette entrée.
  it('accepte un objet `Date` en provenance de `pg`, rend une chaîne ISO (F4, jamais l’objet tel quel)', () => {
    const r = evenementsEnvoisGroupes([{ heure: new Date('2026-09-17T08:00:00.000Z'), etape: 0, n: 24, boites: 3 }]);
    expect(r[0]!.quand).toBe('2026-09-17T08:00:00.000Z');
    expect(typeof r[0]!.quand).toBe('string');
  });
});

describe('listerActivite', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un rôle insuffisant', async () => {
    await expect(listerActivite(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  describe('filtre "tout" (point 3, tour de correction 5) : unit audit_events et les envois groupés', () => {
    it('mappe libellé et détail depuis `diff`, et les événements moteur (campagne activée)', async () => {
      const ctx = faux({
        'jr:activite_campagne_tout_audit': [
          { id: 'ev-1', created_at: '2026-09-14T08:00:00Z', entity_type: 'campaign', action: 'campaign_activated', diff: { libelle: 'Campagne lancée' } },
        ],
        'jr:activite_campagne_tout_envois': [],
      });
      const r = await listerActivite(ctx, { campagneId });
      expect(r.total).toBe(1);
      expect(r.evenements[0]).toEqual({ id: 'ev-1', quand: '2026-09-14T08:00:00.000Z', type: 'campaign_activated', libelle: 'Campagne lancée', detail: null });
    });

    it('reprend une réponse reçue, une pause et une reprise d’inscription (constat (ee), issue engine)', async () => {
      const ctx = faux({
        'jr:activite_campagne_tout_audit': [
          { id: 'ev-1', created_at: '2026-09-14T09:00:00Z', entity_type: 'contact', action: 'reply_received', diff: { libelle: 'Réponse reçue.' } },
          { id: 'ev-2', created_at: '2026-09-14T09:05:00Z', entity_type: 'contact', action: 'enrollment_paused', diff: { libelle: 'Inscription mise en pause.' } },
          { id: 'ev-3', created_at: '2026-09-14T09:10:00Z', entity_type: 'contact', action: 'enrollment_resumed', diff: { libelle: 'Inscription reprise.' } },
        ],
        'jr:activite_campagne_tout_envois': [],
      });
      const r = await listerActivite(ctx, { campagneId });
      expect(r.evenements.map((e) => e.type)).toEqual(['enrollment_resumed', 'enrollment_paused', 'reply_received']);
    });

    it('unit les envois groupés (dérivés de `actions`) avec `audit_events`, triés par date décroissante', async () => {
      const ctx = faux({
        'jr:activite_campagne_tout_audit': [
          { id: 'ev-1', created_at: '2026-09-14T07:00:00Z', entity_type: 'campaign', action: 'campaign_activated', diff: { libelle: 'Campagne lancée à 10h04.' } },
        ],
        'jr:activite_campagne_tout_envois': [{ heure: '2026-09-14T08:00:00.000Z', etape: 0, n: 24, boites: 3 }],
      });
      const r = await listerActivite(ctx, { campagneId });
      expect(r.total).toBe(2);
      // Le groupe d'envois (8h) est plus récent que le lancement (7h) : en tête.
      expect(r.evenements[0]!.libelle).toBe('24 email(s) envoyé(s) · étape 1 · 3 boîte(s)');
      expect(r.evenements[1]!.id).toBe('ev-1');
    });

    // `audit_events.created_at` et `date_trunc('hour', a.dispatched_at)` (`timestamptz`) reviennent
    // de `pg` en objets `Date`, jamais des chaînes (F4, `temps.ts`) — un tri qui les comparerait
    // avec `<`/`>` sans passer par `comparerInstantsDesc` resterait correct dans ce cas précis
    // (deux `Date`), mais la forme publique doit rester une chaîne ISO honnête dans tous les cas.
    it('trie correctement des lignes simulées en objets `Date` (pas des chaînes), rend une forme publique en chaîne', async () => {
      const ctx = faux({
        'jr:activite_campagne_tout_audit': [
          { id: 'ev-1', created_at: new Date('2026-09-14T07:00:00.000Z'), entity_type: 'campaign', action: 'campaign_activated', diff: { libelle: 'Campagne lancée.' } },
        ],
        'jr:activite_campagne_tout_envois': [{ heure: new Date('2026-09-14T08:00:00.000Z'), etape: 0, n: 24, boites: 3 }],
      });
      const r = await listerActivite(ctx, { campagneId });
      expect(r.evenements[0]!.libelle).toBe('24 email(s) envoyé(s) · étape 1 · 3 boîte(s)');
      expect(r.evenements[1]!.id).toBe('ev-1');
      expect(typeof r.evenements[0]!.quand).toBe('string');
      expect(typeof r.evenements[1]!.quand).toBe('string');
    });

    it('jamais un `action_sent`/`action_delivered` individuel dans "tout" (superflu, doublonnerait le groupe)', async () => {
      const query = vi.fn(async (sql: string) => {
        if (/jr:activite_campagne_tout_audit/i.test(sql)) return { rows: [], rowCount: 0 };
        if (/jr:activite_campagne_tout_envois/i.test(sql)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }) as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
      await listerActivite(ctx, { campagneId });
      const appelAudit = (query as unknown as ReturnType<typeof vi.fn>).mock.calls.find((a) =>
        /jr:activite_campagne_tout_audit/i.test(String(a[0])),
      );
      expect(appelAudit![0]).not.toMatch(/'action_sent'/);
      expect(appelAudit![0]).not.toMatch(/'action_delivered'/);
    });

    it('page 2 renvoie la tranche suivante du même ensemble trié', async () => {
      const evenements = Array.from({ length: 25 }, (_, i) => ({
        id: `ev-${i}`,
        created_at: new Date(2026, 8, 14, 8, i).toISOString(),
        entity_type: 'campaign' as const,
        action: 'campaign_activated' as const,
        diff: { libelle: `ev ${i}` },
      }));
      const ctx = faux({ 'jr:activite_campagne_tout_audit': evenements, 'jr:activite_campagne_tout_envois': [] });
      const r1 = await listerActivite(ctx, { campagneId, page: 1 });
      const r2 = await listerActivite(ctx, { campagneId, page: 2 });
      expect(r1.evenements).toHaveLength(20);
      expect(r2.evenements).toHaveLength(5);
      expect(r1.total).toBe(25);
      expect(r2.total).toBe(25);
      // Le plus récent (i=24) en tête de la page 1, jamais répété en page 2.
      expect(r1.evenements[0]!.id).toBe('ev-24');
      expect(r2.evenements.map((e) => e.id)).not.toContain('ev-24');
    });
  });

  it('restreint aux actions du filtre demandé (compte et page), inchangé pour les autres filtres', async () => {
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

describe('listerBoitesPourCampagne', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerBoitesPourCampagne(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('renvoie les boîtes email actives de l’organisation avec leur marque', async () => {
    const ctx = faux({
      'jr:boites_pour_campagne': [
        { id: 'b1', identity: 'camille@outlook.com', provider_id: 'salesblink', inbox_provider: null },
        { id: 'b2', identity: 'camille@exemple.fr', provider_id: null, inbox_provider: null },
      ],
    });
    const r = await listerBoitesPourCampagne(ctx, {});
    expect(r).toEqual([
      { id: 'b1', identite: 'camille@outlook.com', marque: 'outlook' },
      { id: 'b2', identite: 'camille@exemple.fr', marque: null },
    ]);
  });

  it('R63 (tour de correction 2) : une boîte Microsoft 365 (inbox_provider microsoft_graph) sur un domaine propre s’affiche en outlook, pas « @ »', async () => {
    const ctx = faux({
      'jr:boites_pour_campagne': [
        { id: 'b1', identity: 'boite@exemple.fr', provider_id: 'salesblink', inbox_provider: 'microsoft_graph' },
      ],
    });
    const r = await listerBoitesPourCampagne(ctx, {});
    expect(r).toEqual([{ id: 'b1', identite: 'boite@exemple.fr', marque: 'outlook' }]);
  });

  it('point 4 (tour de correction 5) : trie par adresse, un seul ordre pour toutes les pages', async () => {
    const queryMock = vi.fn(async () => ({ rows: [], rowCount: 0 }));
    const query = queryMock as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
    await listerBoitesPourCampagne(ctx, {});
    expect(String((queryMock.mock.calls[0] as unknown[])[0])).toMatch(/order by identity asc/i);
  });
});

describe('listerPersonasCampagne', () => {
  const campagneId = '11111111-1111-1111-1111-111111111111';

  it('refuse un rôle insuffisant', async () => {
    await expect(listerPersonasCampagne(faux({}, null), { campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:personas_campagne_lire': [] });
    await expect(listerPersonasCampagne(ctx, { campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('campagne sans persona ciblé -> liste vide', async () => {
    const ctx = faux({ 'jr:personas_campagne_lire': [{ entry_rules: {} }] });
    const r = await listerPersonasCampagne(ctx, { campagneId });
    expect(r).toEqual([]);
  });

  it('filtre la requête des personas par organisation ET par les ids ciblés', async () => {
    const personaId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const ctx = faux({
      'jr:personas_campagne_lire': [{ entry_rules: { personas: [personaId] } }],
      'jr:personas_campagne': [{ id: personaId, name: 'Directeur commercial' }],
    });
    const r = await listerPersonasCampagne(ctx, { campagneId });
    expect(r).toEqual([{ id: personaId, nom: 'Directeur commercial' }]);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelPersonas = appels.find((a) => /jr:personas_campagne\b/i.test(String(a[0])));
    expect(appelPersonas?.[1]).toEqual(['org-1', [personaId]]);
  });
});

// Tâche 14 : sélecteur « Qui cherchez-vous ? » de l'assistant de création —
// tous les personas actifs de l'organisation, sans dépendre d'une campagne
// existante (il n'y en a pas encore à ce stade).
describe('listerPersonasOrganisation', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerPersonasOrganisation(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('aucun persona actif -> liste vide', async () => {
    const ctx = faux({ 'jr:personas_organisation': [] });
    const r = await listerPersonasOrganisation(ctx, {});
    expect(r).toEqual([]);
  });

  it('filtre par organisation', async () => {
    const personaId = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const ctx = faux({ 'jr:personas_organisation': [{ id: personaId, name: 'Directeur commercial' }] });
    const r = await listerPersonasOrganisation(ctx, {});
    expect(r).toEqual([{ id: personaId, nom: 'Directeur commercial' }]);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appel = appels.find((a) => /jr:personas_organisation\b/i.test(String(a[0])));
    expect(appel?.[1]).toEqual(['org-1']);
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

  // Tâche 14 : l'assistant de création crée la campagne AVANT ses sources
  // (celles-ci n'existent pas encore), donc sans `entryKind`/`entryId`
  // (migration `20260831230000` : `campaigns_one_source` accepte `<= 1`).
  it('sans entryKind/entryId : crée une campagne sans thème hérité (assistant, tâche 14)', async () => {
    const ctx = faux({ 'jr:creer_campagne': [{ id: 'camp-2' }] }, 'operator');
    const r = await creerCampagne(ctx, { name: 'Sans thème', personaIds: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'] });
    expect(r).toEqual({ id: 'camp-2' });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels.some((a) => /jr:creer_campagne_sources/i.test(String(a[0])))).toBe(false);
    const appelCreation = appels.find((a) => /jr:creer_campagne\b/i.test(String(a[0])));
    expect(appelCreation?.[1]).toEqual(['org-1', 'Sans thème', null, null, JSON.stringify({ personas: ['bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'] }), null]);
  });

  it('refuse entryId sans entryKind (ErreurEntree)', async () => {
    const ctx = faux({}, 'operator');
    await expect(
      creerCampagne(ctx, { name: 'Test', entryId: '22222222-2222-2222-2222-222222222222' }),
    ).rejects.toThrow();
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
      {
        'jr:reglages_lire': [{ entry_rules: { min_score: 70, autreCle: 'x' }, status: 'draft' }],
        'jr:reglages_ecrire': [{ id: campagneId }],
      },
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

  it('lève ErreurIntrouvable si l’écriture ne touche aucune ligne (campagne d’une autre organisation), sans écriture superflue', async () => {
    const ctx = faux(
      { 'jr:reglages_lire': [{ entry_rules: {}, status: 'draft' }], 'jr:reglages_ecrire': [] },
      'operator',
    );
    await expect(modifierReglagesCampagne(ctx, { campagneId, dailyCap: 30 })).rejects.toThrow(ErreurIntrouvable);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    expect(appels).toHaveLength(2); // lecture + écriture, rien après l'échec
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

  it('pose run_requested_at sur les sources rattachées, après l’activation (R72 : premier passage dès le lancement)', async () => {
    const ctx = faux(
      {
        'jr:lancer_lire': [{ entry_rules: {} }],
        'jr:collision_themes': [],
        'jr:manques_etapes': [{ position: 0, channel: 'email', template_parent_id: 'tpl-1' }],
        'jr:manques_genres': [{ kind: 'email' }],
        'jr:manques_cle': [{ status: 'configured' }],
        'jr:manques_boites': [{ provider_ref: 'sblk-1', provider_state: { sending_enabled: true } }],
        'jr:lancer_activer': [{ id: campagneId }],
        'jr:lancer_premier_passage': [],
      },
      'operator',
    );
    const r = await lancer(ctx, { campagneId });
    expect(r).toEqual({ ok: true });
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const iActivation = appels.findIndex((a) => /jr:lancer_activer/i.test(String(a[0])));
    const iPassage = appels.findIndex((a) => /jr:lancer_premier_passage/i.test(String(a[0])));
    expect(iActivation).toBeGreaterThanOrEqual(0);
    expect(iPassage).toBeGreaterThan(iActivation);
    expect(String(appels[iPassage]![0])).toMatch(/run_requested_at\s*=\s*now\(\)/i);
    expect(appels[iPassage]![1]).toEqual([campagneId]);
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

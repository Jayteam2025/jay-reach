import { afterEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import {
  boitesSalesBlinkNonReliees,
  listerBoites,
  listerComptesLinkedIn,
  modifierBoite,
  modifierCompteLinkedIn,
  relierBoite,
} from './expediteurs.js';

/** Même convention que `campagnes.test.ts` : un motif de requête (le tag `jr:...`) associé à ses lignes. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'admin'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

const BOITE_BASE = {
  id: 'boite-1',
  identity: 'camille@exemple.fr',
  display_name: null,
  daily_quota: 30,
  hourly_quota: 5,
  timezone: 'Europe/Paris',
  business_hours: { startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] },
  is_active: true,
  provider_ref: 'sb-1',
  inbox_provider: null,
  used_today: 3,
  created_at: '2026-09-01T08:00:00.000Z',
};

describe('listerBoites', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(listerBoites(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('accepte un viewer (lecture seule)', async () => {
    const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] }, 'viewer');
    const boites = await listerBoites(ctx);
    expect(boites).toHaveLength(1);
  });

  it('mappe la marque, les quotas et la fenêtre depuis les colonnes de la boîte', async () => {
    const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] });
    const [boite] = await listerBoites(ctx);
    expect(boite).toMatchObject({
      id: 'boite-1',
      identite: 'camille@exemple.fr',
      marque: 'autre',
      quotas: { jour: 30, heure: 5 },
      usageDuJour: 3,
      heures: { debut: '09:00', fin: '18:00', jours: [1, 2, 3, 4, 5], fuseau: 'Europe/Paris' },
    });
  });

  it('R63 : une boîte microsoft_graph se marque outlook même sur un domaine propre à l’organisation', async () => {
    const ctx = faux({
      'jr:expediteurs_boites': [{ ...BOITE_BASE, inbox_provider: 'microsoft_graph' }],
      'jr:expediteurs_releve': [],
    });
    const [boite] = await listerBoites(ctx);
    expect(boite!.marque).toBe('outlook');
    expect(boite!.inboxProvider).toBe('microsoft_graph');
  });

  it('sans providerRef, la santé est « sans_objet » et la relève absente', async () => {
    const ctx = faux({
      'jr:expediteurs_boites': [{ ...BOITE_BASE, provider_ref: null }],
      'jr:expediteurs_releve': [],
    });
    const [boite] = await listerBoites(ctx);
    expect(boite!.sante).toEqual({ etat: 'sans_objet' });
    expect(boite!.derniereReleve).toBeNull();
  });

  it('avec providerRef mais sans lecteur de santé injecté, la santé est « indisponible »', async () => {
    const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] });
    const [boite] = await listerBoites(ctx);
    expect(boite!.sante).toEqual({ etat: 'indisponible' });
  });

  it('lit la santé via le lecteur injecté quand il répond à temps', async () => {
    const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] });
    const lireSante = vi.fn(async () => ({ connectee: true, score: 92 }));
    const [boite] = await listerBoites(ctx, lireSante);
    expect(lireSante).toHaveBeenCalledWith('sb-1');
    expect(boite!.sante).toEqual({ etat: 'connue', connectee: true, score: 92 });
  });

  describe('délai de 3 s', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('bascule sur « indisponible » quand le lecteur de santé ne répond pas dans les 3 s', async () => {
      vi.useFakeTimers();
      const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] });
      const lireSante = vi.fn(() => new Promise<{ connectee: boolean; score: number | null }>(() => {}));

      const promesse = listerBoites(ctx, lireSante);
      await vi.advanceTimersByTimeAsync(3000);
      const [boite] = await promesse;

      expect(boite!.sante).toEqual({ etat: 'indisponible' });
    });

    it('reste « connue » quand le lecteur répond juste avant 3 s', async () => {
      vi.useFakeTimers();
      const ctx = faux({ 'jr:expediteurs_boites': [BOITE_BASE], 'jr:expediteurs_releve': [] });
      const lireSante = vi.fn(
        () =>
          new Promise<{ connectee: boolean; score: number | null }>((resolve) => {
            setTimeout(() => resolve({ connectee: true, score: 50 }), 500);
          }),
      );

      const promesse = listerBoites(ctx, lireSante);
      await vi.advanceTimersByTimeAsync(500);
      const [boite] = await promesse;

      expect(boite!.sante).toEqual({ etat: 'connue', connectee: true, score: 50 });
    });
  });

  it('pige la relève sur le fournisseur salesblink par défaut, microsoft_graph si inbox_provider le dit', async () => {
    const ctx = faux({
      'jr:expediteurs_boites': [{ ...BOITE_BASE, inbox_provider: 'microsoft_graph' }],
      'jr:expediteurs_releve': [
        { provider: 'salesblink', last_run_at: '2026-09-16T08:00:00.000Z', last_error: null },
        { provider: 'microsoft_graph', last_run_at: '2026-09-16T09:00:00.000Z', last_error: 'oups' },
      ],
    });
    const [boite] = await listerBoites(ctx);
    expect(boite!.derniereReleve).toEqual({ quand: '2026-09-16T09:00:00.000Z', erreur: 'oups' });
  });
});

describe('modifierBoite', () => {
  const ENTREE_VALIDE = {
    boiteId: '11111111-1111-1111-1111-111111111111',
    quotaJour: 30,
    quotaHeure: 5,
    heures: { debut: '09:00', fin: '18:00', jours: [1, 2, 3, 4, 5], fuseau: 'Europe/Paris' },
    active: true,
    inboxProvider: null,
  };

  it('refuse un opérateur (droit administrateur requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(modifierBoite(ctx, ENTREE_VALIDE)).rejects.toThrow(ForbiddenError);
  });

  it('refuse une entrée invalide', async () => {
    const ctx = faux({});
    await expect(modifierBoite(ctx, { ...ENTREE_VALIDE, boiteId: 'pas-un-uuid' })).rejects.toThrow(ErreurEntree);
  });

  it('refuse une heure de fin qui ne vient pas après le début', async () => {
    const ctx = faux({});
    await expect(
      modifierBoite(ctx, { ...ENTREE_VALIDE, heures: { ...ENTREE_VALIDE.heures, debut: '18:00', fin: '09:00' } }),
    ).rejects.toThrow(/après l'heure de début/);
  });

  it('refuse une heure qui n’est pas une heure pleine', async () => {
    const ctx = faux({});
    await expect(
      modifierBoite(ctx, { ...ENTREE_VALIDE, heures: { ...ENTREE_VALIDE.heures, debut: '09:30' } }),
    ).rejects.toThrow(/heures pleines/);
  });

  it('lève ErreurIntrouvable si aucune ligne ne correspond', async () => {
    const ctx = faux({});
    await expect(modifierBoite(ctx, ENTREE_VALIDE)).rejects.toThrow(ErreurIntrouvable);
  });

  it('persiste inboxProvider avec la mise à jour', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 1 })) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await modifierBoite(ctx, { ...ENTREE_VALIDE, inboxProvider: 'microsoft_graph' });

    expect(query).toHaveBeenCalledWith(expect.stringContaining('update senders'), [
      ENTREE_VALIDE.boiteId,
      'org-1',
      30,
      5,
      JSON.stringify({ startHour: 9, endHour: 18, days: [1, 2, 3, 4, 5] }),
      'Europe/Paris',
      true,
      'microsoft_graph',
    ]);
  });
});

describe('boitesSalesBlinkNonReliees', () => {
  it('refuse un opérateur', async () => {
    const ctx = faux({}, 'operator');
    await expect(boitesSalesBlinkNonReliees(ctx, async () => [])).rejects.toThrow(ForbiddenError);
  });

  it('écarte les boîtes distantes déjà reliées à un expéditeur', async () => {
    const ctx = faux({
      'jr:expediteurs_boites_reliees': [{ provider_ref: 'sb-1' }],
    });
    const distantes = [
      { providerRef: 'sb-1', email: 'deja@exemple.fr', nom: 'Déjà reliée' },
      { providerRef: 'sb-2', email: 'libre@exemple.fr', nom: 'Libre' },
    ];
    const resultat = await boitesSalesBlinkNonReliees(ctx, async () => distantes);
    expect(resultat).toEqual([{ providerRef: 'sb-2', email: 'libre@exemple.fr', nom: 'Libre' }]);
  });
});

describe('relierBoite', () => {
  const ENTREE = { providerRef: 'sb-9', identite: 'nouvelle@exemple.fr' };

  it('refuse un opérateur', async () => {
    const ctx = faux({}, 'operator');
    await expect(relierBoite(ctx, ENTREE, async () => {})).rejects.toThrow(ForbiddenError);
  });

  it('refuse une identité déjà utilisée par un expéditeur', async () => {
    const ctx = faux({ 'jr:expediteurs_relier_dedup': [{ id: 'existant' }] });
    await expect(relierBoite(ctx, ENTREE, async () => {})).rejects.toThrow(/déjà cette identité/);
  });

  it('crée l’expéditeur puis appelle activerInbox avec le providerRef', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:expediteurs_relier_dedup/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into senders/i.test(sql)) return { rows: [{ id: 'nouvelle-boite' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };
    const activerInbox = vi.fn(async () => {});

    const resultat = await relierBoite(ctx, ENTREE, activerInbox);

    expect(resultat).toEqual({ id: 'nouvelle-boite' });
    expect(activerInbox).toHaveBeenCalledWith('sb-9');
  });

  it('n’appelle pas activerInbox si la création échoue', async () => {
    const ctx = faux({ 'jr:expediteurs_relier_dedup': [] });
    const activerInbox = vi.fn(async () => {});
    await expect(relierBoite(ctx, { providerRef: '', identite: 'nouvelle@exemple.fr' }, activerInbox)).rejects.toThrow(
      ErreurEntree,
    );
    expect(activerInbox).not.toHaveBeenCalled();
  });

  it('retire l’expéditeur tout juste créé si activerInbox échoue (pas de boîte reliée sans lecture activée)', async () => {
    const appels: string[] = [];
    const query = vi.fn(async (sql: string) => {
      appels.push(sql);
      if (/jr:expediteurs_relier_dedup/i.test(sql)) return { rows: [], rowCount: 0 };
      if (/insert into senders/i.test(sql)) return { rows: [{ id: 'nouvelle-boite' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };
    const activerInbox = vi.fn(async () => {
      throw new Error('SalesBlink indisponible');
    });

    await expect(relierBoite(ctx, ENTREE, activerInbox)).rejects.toThrow('SalesBlink indisponible');
    expect(appels.some((s) => /delete from senders/i.test(s))).toBe(true);
  });
});

/** `extension_tokens.token_hash` (migration `20260828140000_extension_token_hash.sql`) : jamais `token`. */
const UTILISATEUR_1 = '11111111-1111-1111-1111-111111111111';
const UTILISATEUR_2 = '22222222-2222-2222-2222-222222222222';

describe('listerComptesLinkedIn', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(listerComptesLinkedIn(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('applique les réglages par défaut sans ligne linkedin_settings', async () => {
    const ctx = faux({
      'jr:expediteurs_comptes_linkedin': [
        { user_id: UTILISATEUR_1, linkedin_profile_name: 'Camille Roussel', last_used_at: '2026-09-16T08:00:00.000Z', is_active: true },
      ],
      'jr:expediteurs_reglages_linkedin': [],
    });
    const [compte] = await listerComptesLinkedIn(ctx);
    expect(compte).toEqual({
      id: UTILISATEUR_1,
      nom: 'Camille Roussel',
      connecte: true,
      derniereActivite: '2026-09-16T08:00:00.000Z',
      active: true,
      quotas: { parJour: 25, parSemaine: 100 },
      heures: { debut: '09:00', fin: '18:00', jours: [1, 2, 3, 4, 5], fuseau: 'Europe/Paris' },
    });
  });

  it('un jeton jamais utilisé n’est pas « connecté »', async () => {
    const ctx = faux({
      'jr:expediteurs_comptes_linkedin': [
        { user_id: UTILISATEUR_2, linkedin_profile_name: null, last_used_at: null, is_active: true },
      ],
      'jr:expediteurs_reglages_linkedin': [],
    });
    const [compte] = await listerComptesLinkedIn(ctx);
    expect(compte!.connecte).toBe(false);
    expect(compte!.nom).toBe('Compte LinkedIn');
  });

  it('trie les comptes par dernière activité, les jamais-utilisés en dernier', async () => {
    const ctx = faux({
      'jr:expediteurs_comptes_linkedin': [
        { user_id: UTILISATEUR_1, linkedin_profile_name: 'Ancien', last_used_at: '2026-09-10T08:00:00.000Z', is_active: true },
        { user_id: UTILISATEUR_2, linkedin_profile_name: 'Jamais connecté', last_used_at: null, is_active: true },
      ],
      'jr:expediteurs_reglages_linkedin': [],
    });
    const comptes = await listerComptesLinkedIn(ctx);
    expect(comptes.map((c) => c.nom)).toEqual(['Ancien', 'Jamais connecté']);
  });

  it('interroge token_hash, jamais la colonne token (retirée par la migration du 28/08)', async () => {
    const appels: string[] = [];
    const query = vi.fn(async (sql: string) => {
      appels.push(sql);
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

    await listerComptesLinkedIn(ctx);

    const requeteJetons = appels.find((s) => /extension_tokens/i.test(s));
    expect(requeteJetons).toBeDefined();
    // Une colonne « token » nue (pas suivie de « _hash ») trahirait un retour
    // à l'ancien nom de colonne, absent depuis la migration du 28/08.
    expect(/\btoken\b(?!_hash)/i.test(requeteJetons!)).toBe(false);
  });
});

describe('modifierCompteLinkedIn', () => {
  const ENTREE = {
    compteId: UTILISATEUR_1,
    active: false,
    quotaJour: 20,
    quotaSemaine: 80,
    heures: { debut: '10:00', fin: '17:00', jours: [1, 2, 3], fuseau: 'Europe/Paris' },
  };

  it('refuse un opérateur', async () => {
    const ctx = faux({}, 'operator');
    await expect(modifierCompteLinkedIn(ctx, ENTREE)).rejects.toThrow(ForbiddenError);
  });

  it('refuse un compteId qui n’est pas un identifiant valide', async () => {
    const ctx = faux({});
    await expect(modifierCompteLinkedIn(ctx, { ...ENTREE, compteId: 'tok-1' })).rejects.toThrow(ErreurEntree);
  });

  it('lève ErreurIntrouvable si le jeton n’appartient pas à l’organisation', async () => {
    const ctx = faux({});
    await expect(modifierCompteLinkedIn(ctx, ENTREE)).rejects.toThrow(ErreurIntrouvable);
  });

  it('met à jour le jeton le plus récent de l’utilisateur (jamais un autre) puis les réglages partagés', async () => {
    const appels: string[] = [];
    const query = vi.fn(async (sql: string) => {
      appels.push(sql);
      if (/update extension_tokens/i.test(sql)) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await modifierCompteLinkedIn(ctx, ENTREE);

    const requeteJeton = appels.find((s) => /update extension_tokens/i.test(s));
    expect(requeteJeton).toBeDefined();
    expect(requeteJeton).toContain('token_hash');
    expect(requeteJeton).toContain('user_id = $1');
    expect(requeteJeton).not.toMatch(/\btoken\b(?!_hash)\s*=/i);
    expect(appels.some((s) => /insert into linkedin_settings/i.test(s))).toBe(true);
  });
});

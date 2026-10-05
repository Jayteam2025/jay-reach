import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree } from './contexte.js';
import {
  enregistrerCle,
  ErreurFournisseurNonConfigure,
  listerFournisseurs,
  modifierConfigFournisseur,
  schemaEnregistrerCle,
  schemaModifierConfigFournisseur,
  schemaTesterFournisseur,
  testerFournisseur,
} from './fournisseurs.js';

/** Même convention que `plafonds.test.ts`/`contacts.test.ts` : un motif (regex, ou tag `/* jr:nom *\/`) associé aux lignes renvoyées. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'admin'): Contexte {
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

describe('listerFournisseurs', () => {
  // I7 (Important, revue finale du 14/09) : seule lecture du module sans
  // contrôle de rôle — elle rend pourtant l'état de chaque clé de
  // fournisseur, la date du dernier test et la consommation du jour.
  it('refuse un rôle insuffisant (aucun rôle)', async () => {
    const ctx = faux({}, null);
    await expect(listerFournisseurs(ctx)).rejects.toThrow(ForbiddenError);
  });

  it('rend les dix fournisseurs connus, classés dans les six catégories de l’écran', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    expect(fournisseurs).toHaveLength(10);
    const categories = new Set(fournisseurs.map((f) => f.categorie));
    expect(categories).toEqual(new Set(['ia', 'enrichissement', 'envoi', 'offres', 'linkedin', 'reception']));
    expect(fournisseurs.find((f) => f.providerId === 'anthropic')?.categorie).toBe('ia');
    expect(fournisseurs.find((f) => f.providerId === 'microsoft_graph')?.categorie).toBe('reception');
    expect(fournisseurs.find((f) => f.providerId === 'apify')?.categorie).toBe('linkedin');
  });

  it('un fournisseur sans ligne credentials est « à renseigner », clé absente', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    const apify = fournisseurs.find((f) => f.providerId === 'apify');
    expect(apify?.cle).toEqual({ presente: false, testeeLe: null, statut: 'a_renseigner', dernierCaracteres: null });
  });

  it('un fournisseur configuré sans erreur de relève est « valide »', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [
        { provider_id: 'anthropic', status: 'configured', last_checked_at: '2026-09-16T09:02:00.000Z', config: {}, last4: '7f3a' },
      ],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    const anthropic = fournisseurs.find((f) => f.providerId === 'anthropic');
    expect(anthropic?.cle).toEqual({
      presente: true,
      testeeLe: '2026-09-16T09:02:00.000Z',
      statut: 'valide',
      dernierCaracteres: '7f3a',
    });
  });

  it('un fournisseur de relève configuré avec une erreur récente est « en échec »', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [
        { provider_id: 'microsoft_graph', status: 'configured', last_checked_at: null, config: {} },
      ],
      'jr:lister_fournisseurs_releve': [
        { provider: 'microsoft_graph', last_run_at: '2026-09-16T09:00:00.000Z', last_error: 'jeton expiré' },
      ],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    const graph = fournisseurs.find((f) => f.providerId === 'microsoft_graph');
    expect(graph?.cle.statut).toBe('echec');
    expect(graph?.releve).toEqual({ dernierPassage: '2026-09-16T09:00:00.000Z', derniereErreur: 'jeton expiré' });
  });

  it('un fournisseur non relevé (Adzuna, Apify…) n’a pas de bloc `releve`', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    expect(fournisseurs.find((f) => f.providerId === 'adzuna')?.releve).toBeNull();
  });

  it('reprend les jauges de lireConsommationDuJour pour anthropic, fullenrich et salesblink, null pour les autres', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
      scored_today: [{ n: 112 }],
      enrich_today: [{ n: 24 }],
      'from actions': [{ n: 32 }],
      'from senders': [{ plafond: 90 }],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    expect(fournisseurs.find((f) => f.providerId === 'anthropic')?.consommationDuJour).toEqual({ utilise: 112, plafond: 300 });
    expect(fournisseurs.find((f) => f.providerId === 'fullenrich')?.consommationDuJour).toEqual({ utilise: 24, plafond: 30 });
    expect(fournisseurs.find((f) => f.providerId === 'salesblink')?.consommationDuJour).toEqual({ utilise: 32, plafond: 90 });
    expect(fournisseurs.find((f) => f.providerId === 'adzuna')?.consommationDuJour).toBeNull();
    expect(fournisseurs.find((f) => f.providerId === 'apify')?.consommationDuJour).toBeNull();
  });

  it('lienPlafond ne pointe vers Réglages › Plafonds que pour anthropic et fullenrich', async () => {
    const ctx = faux({
      'jr:lister_fournisseurs_credentials': [],
      'jr:lister_fournisseurs_releve': [],
      'from organization_settings': [],
    });
    const fournisseurs = await listerFournisseurs(ctx);
    expect(fournisseurs.find((f) => f.providerId === 'anthropic')?.lienPlafond).toBe('/settings/limits');
    expect(fournisseurs.find((f) => f.providerId === 'fullenrich')?.lienPlafond).toBe('/settings/limits');
    expect(fournisseurs.find((f) => f.providerId === 'salesblink')?.lienPlafond).toBeNull();
  });
});

describe('enregistrerCle', () => {
  it('refuse un opérateur (rôle admin requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(enregistrerCle(ctx, { providerId: 'anthropic', secret: 'sk-abc123' })).rejects.toThrow(ForbiddenError);
  });

  it('refuse un providerId inconnu', async () => {
    const ctx = faux({});
    await expect(enregistrerCle(ctx, { providerId: 'inconnu', secret: 'sk-abc123' })).rejects.toThrow(ErreurEntree);
  });

  it('refuse une clé vide', async () => {
    const ctx = faux({});
    await expect(enregistrerCle(ctx, { providerId: 'anthropic', secret: '' })).rejects.toThrow(ErreurEntree);
  });

  it('appelle set_provider_credential avec la clé de chiffrement de l’environnement', async () => {
    const ancienne = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = 'clé-de-test';
    try {
      const ctx = faux({ set_provider_credential: [{ set_provider_credential: 'a1b2' }] });
      await enregistrerCle(ctx, { providerId: 'adzuna', secret: 'app-key-secrete', config: { app_id: 'app-123' } });
      const appels = appelsDe(ctx);
      const appel = appels.find((a) => /set_provider_credential/i.test(a.sql));
      expect(appel?.params).toEqual(['org-1', 'adzuna', 'app-key-secrete', 'clé-de-test', JSON.stringify({ app_id: 'app-123' })]);
    } finally {
      if (ancienne === undefined) delete process.env.ENCRYPTION_KEY;
      else process.env.ENCRYPTION_KEY = ancienne;
    }
  });

  it('échoue sans ENCRYPTION_KEY dans l’environnement, sans jamais appeler la base', async () => {
    const ancienne = process.env.ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;
    try {
      const ctx = faux({});
      await expect(enregistrerCle(ctx, { providerId: 'anthropic', secret: 'sk-abc123' })).rejects.toThrow(/chiffrement/i);
      expect(ctx.ex.query).not.toHaveBeenCalled();
    } finally {
      if (ancienne !== undefined) process.env.ENCRYPTION_KEY = ancienne;
    }
  });

  it('ne renvoie jamais le secret dans sa sortie', async () => {
    process.env.ENCRYPTION_KEY = 'clé-de-test';
    const ctx = faux({ set_provider_credential: [{ set_provider_credential: 'a1b2' }] });
    const secret = 'sk-ultra-secret-jamais-affiche';
    const sortie = await enregistrerCle(ctx, { providerId: 'anthropic', secret });
    expect(JSON.stringify(sortie ?? null)).not.toContain(secret);
  });
});

describe('modifierConfigFournisseur (relecture tâche 21, point 2 : champs non secrets sans ressaisir la clé)', () => {
  it('refuse un opérateur (rôle admin requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(modifierConfigFournisseur(ctx, { providerId: 'salesblink', config: { sync_interval_min: '10' } })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('refuse un providerId inconnu', async () => {
    const ctx = faux({});
    await expect(modifierConfigFournisseur(ctx, { providerId: 'inconnu', config: {} })).rejects.toThrow(ErreurEntree);
  });

  it('appelle merge_provider_config (jamais set_provider_credential) — aucun secret en jeu', async () => {
    const ctx = faux({ merge_provider_config: [{ merge_provider_config: null }] });
    await modifierConfigFournisseur(ctx, { providerId: 'microsoft_graph', config: { sync_interval_min: '10' } });
    const appels = appelsDe(ctx);
    expect(appels).toHaveLength(1);
    expect(appels[0]?.sql).toMatch(/merge_provider_config/i);
    expect(appels[0]?.params).toEqual(['org-1', 'microsoft_graph', JSON.stringify({ sync_interval_min: '10' })]);
  });

  it('accepte plusieurs champs non secrets à la fois', async () => {
    const ctx = faux({ merge_provider_config: [{ merge_provider_config: null }] });
    await modifierConfigFournisseur(ctx, {
      providerId: 'salesblink',
      config: { sync_interval_min: '5', reply_max_delay_h: '6' },
    });
    const appels = appelsDe(ctx);
    expect(appels[0]?.params?.[2]).toBe(JSON.stringify({ sync_interval_min: '5', reply_max_delay_h: '6' }));
  });
});

describe('schemaModifierConfigFournisseur', () => {
  it('accepte une config vide (aucun champ à changer)', () => {
    expect(schemaModifierConfigFournisseur.safeParse({ providerId: 'salesblink', config: {} }).success).toBe(true);
  });

  it('rejette un providerId inconnu', () => {
    expect(schemaModifierConfigFournisseur.safeParse({ providerId: 'inconnu', config: {} }).success).toBe(false);
  });
});

describe('testerFournisseur', () => {
  it('refuse un opérateur (rôle admin requis)', async () => {
    const ctx = faux({}, 'operator');
    await expect(testerFournisseur(ctx, { providerId: 'anthropic' })).rejects.toThrow(ForbiddenError);
  });

  it('refuse un providerId inconnu', async () => {
    const ctx = faux({});
    await expect(testerFournisseur(ctx, { providerId: 'inconnu' })).rejects.toThrow(ErreurEntree);
  });

  it('lève ErreurFournisseurNonConfigure quand aucune clé n’est enregistrée', async () => {
    const ctx = faux({ 'update credentials': [] });
    await expect(testerFournisseur(ctx, { providerId: 'apify' })).rejects.toThrow(ErreurFournisseurNonConfigure);
  });

  it('avance last_checked_at quand une clé est enregistrée, sans appeler aucun fournisseur en réel', async () => {
    const ctx = faux({ 'update credentials': [{ last_checked_at: '2026-09-16T10:00:00.000Z' }] });
    const resultat = await testerFournisseur(ctx, { providerId: 'anthropic' });
    expect(resultat).toEqual({ testeeLe: '2026-09-16T10:00:00.000Z' });
    const appels = appelsDe(ctx);
    expect(appels).toHaveLength(1);
    expect(appels[0]?.sql).toMatch(/update credentials/i);
  });
});

describe('schémas', () => {
  it('schemaEnregistrerCle : config est optionnel', () => {
    expect(schemaEnregistrerCle.safeParse({ providerId: 'anthropic', secret: 'sk-abc' }).success).toBe(true);
  });

  it('schemaTesterFournisseur : rejette un id vide', () => {
    expect(schemaTesterFournisseur.safeParse({ providerId: '' }).success).toBe(false);
  });
});

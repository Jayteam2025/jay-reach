import { describe, expect, it, vi } from 'vitest';
import type { Contexte } from '../fonctions/contexte.js';
import type { Executeur } from '../executeur.js';
import {
  enregistrerHeuresEnvoiLinkedIn,
  HEURES_ENVOI_LINKEDIN_PAR_DEFAUT,
  lireHeuresEnvoiLinkedIn,
} from './reglages-envoi.js';

/**
 * Ce que ce fichier prouve, et ce qu'il ne prouve PAS.
 *
 * Il éprouve la validation et la forme publique, qui sont du code TypeScript pur.
 * Il n'éprouve pas le SQL : un faux exécuteur ne l'exécute jamais, et ce dépôt a
 * déjà vu une jointure fausse passer sous huit tests verts de ce genre. L'upsert
 * de `enregistrerHeuresEnvoiLinkedIn` et la lecture se prouvent sur un vrai
 * Postgres, dans le harnais `test/pg-verify/linkedin-file.sh`.
 */
function faux(rows: Record<string, unknown>[], role: Contexte['role'] = 'admin'): Contexte {
  const query = vi.fn(async () => ({ rows, rowCount: rows.length })) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

const LIGNE = { send_from_hour: 10, send_to_hour: 17, send_days: [2, 1, 4], timezone: 'Europe/Brussels' };

describe('lireHeuresEnvoiLinkedIn', () => {
  it('rend la fenêtre enregistrée, jours triés', async () => {
    const ctx = faux([LIGNE]);
    await expect(lireHeuresEnvoiLinkedIn(ctx)).resolves.toEqual({
      debutHeure: 10,
      finHeure: 17,
      jours: [1, 2, 4],
      fuseau: 'Europe/Brussels',
    });
  });

  it('rend les valeurs par défaut quand aucune ligne n existe, jamais du vide', async () => {
    // Le cas d'une instance neuve : le moteur applique bien une fenêtre, l'écran
    // doit montrer laquelle au lieu de champs vides qui laisseraient croire qu'il
    // n'y en a aucune.
    const ctx = faux([]);
    await expect(lireHeuresEnvoiLinkedIn(ctx)).resolves.toEqual({ ...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT, jours: [1, 2, 3, 4, 5] });
  });

  it('écarte un jour hors bornes trouvé en base, et retombe sur les jours par défaut s il ne reste rien', async () => {
    const ctx = faux([{ ...LIGNE, send_days: [0, 9] }]);
    const lu = await lireHeuresEnvoiLinkedIn(ctx);
    expect(lu.jours).toEqual([1, 2, 3, 4, 5]);
  });

  it('refuse un rôle sous viewer', async () => {
    await expect(lireHeuresEnvoiLinkedIn(faux([LIGNE], null))).rejects.toThrow();
  });
});

describe('enregistrerHeuresEnvoiLinkedIn', () => {
  it('écrit la fenêtre, jours dédoublonnés et triés', async () => {
    const ctx = faux([]);
    await enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 8, finHeure: 20, jours: [5, 1, 5, 3], fuseau: 'Europe/Paris' });
    const appel = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(String(appel[0])).toContain('insert into linkedin_settings');
    expect(appel[1]).toEqual(['org-1', 8, 20, [1, 3, 5], 'Europe/Paris']);
  });

  it('n écrit AUCUN plafond : deux endroits qui règlent le volume seraient deux vérités', async () => {
    const ctx = faux([]);
    await enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 9, finHeure: 18, jours: [1], fuseau: 'Europe/Paris' });
    const sql = String((ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]);
    expect(sql).not.toContain('daily_cap');
    expect(sql).not.toContain('weekly_cap');
  });

  it('refuse une fin antérieure ou égale au début', async () => {
    const ctx = faux([]);
    await expect(
      enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 18, finHeure: 18, jours: [1], fuseau: 'Europe/Paris' }),
    ).rejects.toThrow();
    expect(ctx.ex.query).not.toHaveBeenCalled();
  });

  it('refuse une semaine sans jour', async () => {
    const ctx = faux([]);
    await expect(
      enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 9, finHeure: 18, jours: [], fuseau: 'Europe/Paris' }),
    ).rejects.toThrow();
    expect(ctx.ex.query).not.toHaveBeenCalled();
  });

  it('refuse une heure hors bornes plutôt que de la ramener en silence', async () => {
    const ctx = faux([]);
    await expect(
      enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: -1, finHeure: 18, jours: [1], fuseau: 'Europe/Paris' }),
    ).rejects.toThrow();
    await expect(
      enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 9, finHeure: 25, jours: [1], fuseau: 'Europe/Paris' }),
    ).rejects.toThrow();
  });

  it('refuse un rôle operator : régler le volume d envoi est un geste d administrateur', async () => {
    const ctx = faux([], 'operator');
    await expect(
      enregistrerHeuresEnvoiLinkedIn(ctx, { debutHeure: 9, finHeure: 18, jours: [1], fuseau: 'Europe/Paris' }),
    ).rejects.toThrow();
    expect(ctx.ex.query).not.toHaveBeenCalled();
  });
});

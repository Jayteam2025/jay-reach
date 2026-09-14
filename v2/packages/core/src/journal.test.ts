import { describe, it, expect, vi } from 'vitest';
import type { Executeur } from './executeur.js';
import { ecrireEvenement, nettoyerMessageErreurJournal } from './journal.js';

function executeurFactice(): { ex: Executeur; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => ({ rows: [], rowCount: 0 }));
  return { ex: { query } as unknown as Executeur, query };
}

describe('ecrireEvenement', () => {
  it('insère dans audit_events avec les bonnes colonnes et valeurs', async () => {
    const { ex, query } = executeurFactice();

    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'source',
      entityId: 'source-1',
      action: 'source_run',
      diff: { libelle: 'Passage Adzuna : 58 offres lues, 6 retenues' },
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, valeurs] = query.mock.calls[0]!;
    expect(sql).toMatch(/insert into audit_events/i);
    expect(sql).toContain('organization_id');
    expect(sql).toContain('actor_id');
    expect(sql).toContain('entity_type');
    expect(sql).toContain('entity_id');
    expect(sql).toContain('action');
    expect(sql).toContain('diff');
    expect(valeurs).toEqual([
      'org-1',
      null,
      'source',
      'source-1',
      'source_run',
      JSON.stringify({ libelle: 'Passage Adzuna : 58 offres lues, 6 retenues' }),
    ]);
  });

  it("passe actorId à null quand l'événement est produit par le moteur seul", async () => {
    const { ex, query } = executeurFactice();

    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'engine',
      entityId: null,
      action: 'engine_error',
      diff: { libelle: 'Erreur générique' },
    });

    const valeurs = query.mock.calls[0]![1] as unknown[];
    expect(valeurs[1]).toBeNull();
    expect(valeurs[3]).toBeNull();
  });

  it("porte l'utilisateur qui a agi quand actorId est fourni (campagne activée depuis l'écran)", async () => {
    const { ex, query } = executeurFactice();

    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'campaign',
      entityId: 'campagne-1',
      action: 'campaign_activated',
      diff: { libelle: 'Campagne activée.' },
      actorId: 'utilisateur-1',
    });

    const valeurs = query.mock.calls[0]![1] as unknown[];
    expect(valeurs[1]).toBe('utilisateur-1');
  });

  it("pose created_at quand occurredAt est fourni, sinon laisse la base l'alimenter par défaut", async () => {
    const { ex, query } = executeurFactice();
    const quand = new Date('2026-09-14T10:00:00.000Z');

    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'contact',
      entityId: 'contact-1',
      action: 'action_sent',
      diff: { libelle: 'Email envoyé.' },
      occurredAt: quand,
    });

    const [sqlAvecDate, valeursAvecDate] = query.mock.calls[0]!;
    expect(sqlAvecDate).toContain('created_at');
    expect(valeursAvecDate).toContain(quand);

    query.mockClear();
    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'contact',
      entityId: 'contact-1',
      action: 'action_sent',
      diff: { libelle: 'Email envoyé.' },
    });
    const sqlSansDate = query.mock.calls[0]![0] as string;
    expect(sqlSansDate).not.toContain('created_at');
  });

  it('sérialise diff en JSON pour le paramètre jsonb', async () => {
    const { ex, query } = executeurFactice();

    await ecrireEvenement(ex, {
      organisationId: 'org-1',
      entityType: 'source',
      entityId: null,
      action: 'scoring_batch',
      diff: { libelle: 'Scoring : 12 signaux notés, 3 retenus au-dessus du seuil', notes: 12, retenus: 3 },
    });

    const valeurs = query.mock.calls[0]![1] as unknown[];
    expect(valeurs[5]).toBe(JSON.stringify({ libelle: 'Scoring : 12 signaux notés, 3 retenus au-dessus du seuil', notes: 12, retenus: 3 }));
  });
});

describe('nettoyerMessageErreurJournal', () => {
  it('masque une adresse email', () => {
    const nettoye = nettoyerMessageErreurJournal("Échec d'envoi vers jean.dupont@exemple.fr : refusé");
    expect(nettoye).not.toContain('jean.dupont@exemple.fr');
    expect(nettoye).toContain('[email masqué]');
  });

  it("masque les paramètres d'une URL (clé API) sans retirer l'URL elle-même", () => {
    const nettoye = nettoyerMessageErreurJournal(
      'Appel refusé : https://api.exemple.fr/v1/campagnes?api_key=abc123&autre=1',
    );
    expect(nettoye).not.toContain('abc123');
    expect(nettoye).toContain('https://api.exemple.fr/v1/campagnes?[paramètres masqués]');
  });

  it('tronque un message trop long à 200 caractères', () => {
    const long = 'x'.repeat(500);
    const nettoye = nettoyerMessageErreurJournal(long);
    expect(nettoye).toHaveLength(200);
  });

  it('laisse un message court et neutre inchangé', () => {
    expect(nettoyerMessageErreurJournal('Connexion refusée par la base')).toBe('Connexion refusée par la base');
  });
});

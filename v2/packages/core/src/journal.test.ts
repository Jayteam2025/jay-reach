import { describe, it, expect, vi } from 'vitest';
import type { Executeur } from './executeur.js';
import { ecrireEvenement, nettoyerMessageErreurJournal, journaliserErreurMoteur } from './journal.js';

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

describe('journaliserErreurMoteur (journal, tâche 6, tour de correction 1 — R23)', () => {
  function executeurAvecOrganisations(ids: string[]): { ex: Executeur; query: ReturnType<typeof vi.fn> } {
    const query = vi.fn(async (sql: string) => {
      if (/select id from organizations/i.test(sql)) {
        return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
      }
      return { rows: [], rowCount: 0 };
    });
    return { ex: { query } as unknown as Executeur, query };
  }

  it('écrit un engine_error par organisation, avec le contexte en detail', async () => {
    const { ex, query } = executeurAvecOrganisations(['org-1', 'org-2']);

    await journaliserErreurMoteur(ex, new Error('Panne de connexion à la base'), 'cycle de production');

    const inserts = query.mock.calls.filter(([sql]) => /insert into audit_events/i.test(sql as string));
    expect(inserts).toHaveLength(2);
    const [, valeurs1] = inserts[0]!;
    expect((valeurs1 as unknown[])[0]).toBe('org-1');
    expect((valeurs1 as unknown[])[2]).toBe('engine');
    expect((valeurs1 as unknown[])[3]).toBeNull();
    expect((valeurs1 as unknown[])[4]).toBe('engine_error');
    const diff1 = JSON.parse((valeurs1 as unknown[])[5] as string) as { libelle: string; detail: string };
    expect(diff1.libelle).toBe('Panne de connexion à la base');
    expect(diff1.detail).toBe('cycle de production');
    const [, valeurs2] = inserts[1]!;
    expect((valeurs2 as unknown[])[0]).toBe('org-2');
  });

  it('nettoie et tronque le message comme les autres erreurs du journal', async () => {
    const { ex, query } = executeurAvecOrganisations(['org-1']);
    const message = `Échec vers jean.dupont@exemple.fr : ${'x'.repeat(250)}`;

    await journaliserErreurMoteur(ex, new Error(message), 'tick');

    const insert = query.mock.calls.find(([sql]) => /insert into audit_events/i.test(sql as string))!;
    const diff = JSON.parse((insert[1] as unknown[])[5] as string) as { libelle: string };
    expect(diff.libelle).not.toContain('jean.dupont@exemple.fr');
    expect(diff.libelle).toContain('[email masqué]');
    expect(diff.libelle.length).toBe(200);
  });

  it("n'échoue jamais, même si la lecture des organisations ou l'écriture échoue", async () => {
    const query = vi.fn(async () => {
      throw new Error('base indisponible');
    });
    const ex = { query } as unknown as Executeur;

    await expect(journaliserErreurMoteur(ex, new Error('x'), 'tick')).resolves.toBeUndefined();
  });

  it("n'écrit aucune ligne quand aucune organisation n'existe", async () => {
    const { ex, query } = executeurAvecOrganisations([]);

    await journaliserErreurMoteur(ex, new Error('x'), 'tick');

    expect(query.mock.calls.filter(([sql]) => /insert into audit_events/i.test(sql as string))).toHaveLength(0);
  });

  it('omet detail quand aucun contexte n’est fourni', async () => {
    const { ex, query } = executeurAvecOrganisations(['org-1']);

    await journaliserErreurMoteur(ex, new Error('Erreur sans contexte'));

    const insert = query.mock.calls.find(([sql]) => /insert into audit_events/i.test(sql as string))!;
    const diff = JSON.parse((insert[1] as unknown[])[5] as string) as Record<string, unknown>;
    expect(diff).not.toHaveProperty('detail');
  });
});

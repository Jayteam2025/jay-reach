import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable } from './contexte.js';
import {
  ajouterAListe,
  ajouterNote,
  ajouterSuppression,
  chercherEmail,
  ErreurEnrichissementImpossible,
  exporterCsv,
  lireFiche,
  listerClientsEtExclusions,
  listerContacts,
  listerEntreprises,
  nePlusContacter,
} from './contacts.js';

/** Même convention que `campagnes.test.ts`/`file-du-jour.test.ts` : un motif (tag `/* jr:nom *\/` ou fragment unique) associé aux lignes à renvoyer. */
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

/** Même convention que `assistant-campagne.test.ts` : un faux POOL, `connect()` compris (R47/R69). */
function fauxConnectable(
  rows: Record<string, unknown[]>,
  role: Contexte['role'] = 'operator',
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
  const ctx: Contexte = { ex: ex as unknown as Executeur, organisationId: 'org-1', utilisateurId: 'user-1', role };
  return {
    ctx,
    appelsClient: () => (clientQuery.mock.calls as unknown[][]).map((a) => String(a[0])),
    releases: () => releases,
  };
}

const contactId = '11111111-1111-1111-1111-111111111111';
const campagneId = '22222222-2222-2222-2222-222222222222';
const accountId = '33333333-3333-3333-3333-333333333333';
const personaId = '44444444-4444-4444-4444-444444444444';
const enrollmentId = '55555555-5555-5555-5555-555555555555';
const signalId = '66666666-6666-6666-6666-666666666666';

describe('lireFiche', () => {
  it('refuse un appelant sans rôle', async () => {
    await expect(lireFiche(faux({}, null), { contactId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si le contact n’existe pas (ou hors organisation)', async () => {
    const ctx = faux({ 'jr:fiche_contact': [] });
    await expect(lireFiche(ctx, { contactId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('assemble tous les blocs pour un contact en séquence dans une campagne', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'Head of Sales',
          email: 'k.benali@exemple.fr',
          email_status: 'valid',
          linkedin_url: 'https://linkedin.com/in/karim',
          photo_url: null,
          account_id: accountId,
          source_signal_id: signalId,
          status: 'active',
          entreprise: 'Woodpecker Studio',
          ville: 'Nantes',
        },
      ],
      'jr:fiche_statut_campagne': [
        {
          statut: 'en_sequence',
          enrollment_id: enrollmentId,
          current_step: 2,
          e_status: 'active',
          signal_id: signalId,
          score: 91,
          score_reason: 'Cible directe pour Jay.',
          title: 'Business developer senior',
          provider_id: 'adzuna',
          occurred_at: '2026-09-04T00:00:00.000Z',
          url: 'https://exemple.fr/offre',
          raw: JSON.stringify({ description: 'Nous recrutons un profil commercial senior.' }),
        },
      ],
      'jr:fiche_etapes': [{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3 }],
      'jr:fiche_boite': [{ identity: 'alex@exemple.fr', inbox_provider: 'microsoft_graph' }],
      'jr:fiche_fils': [{ id: 'fil-1', last_message_at: '2026-09-13T10:00:00.000Z' }],
      'jr:fiche_messages': [
        { id: 'msg-1', direction: 'out', body: 'Bonjour Karim', sent_at: '2026-09-11T09:00:00.000Z' },
        { id: 'msg-2', direction: 'in', body: 'Merci Alex', sent_at: '2026-09-13T10:22:00.000Z' },
      ],
      'jr:fiche_notes': [{ id: 'note-1', body: 'À relancer', created_at: '2026-09-12T08:00:00.000Z', auteur_nom: 'Alexandre' }],
      'jr:fiche_historique': [{ id: 'evt-1', created_at: '2026-09-13T10:22:00.000Z', action: 'reply_received', diff: { libelle: 'Réponse reçue.' } }],
      'jr:fiche_campagnes': [{ id: campagneId, nom: 'Directeur commercial' }],
    });

    const fiche = await lireFiche(ctx, { contactId, campagneId });

    expect(fiche.contact).toMatchObject({ prenom: 'Karim', nom: 'Benali', entreprise: 'Woodpecker Studio', ville: 'Nantes', telephone: null });
    expect(fiche.statut).toBe('en_sequence');
    expect(fiche.score).toEqual({ valeur: 91, explication: 'Cible directe pour Jay.' });
    expect(fiche.pourquoi).toEqual({
      providerId: 'adzuna',
      titre: 'Business developer senior',
      date: '2026-09-04T00:00:00.000Z',
      url: 'https://exemple.fr/offre',
      extrait: 'Nous recrutons un profil commercial senior.',
    });
    // current_step = 2, inscription « active » (vivante) -> positions 1 et 2 (1-based) faites,
    // position 3 (= current_step) en_cours, position 4 à venir.
    expect(fiche.sequence).toEqual({
      etapes: [
        { position: 1, etat: 'faite' },
        { position: 2, etat: 'faite' },
        { position: 3, etat: 'en_cours' },
        { position: 4, etat: 'a_venir' },
      ],
      boite: { identite: 'alex@exemple.fr', marque: 'outlook' },
    });
    expect(fiche.echanges).toEqual([
      { id: 'msg-1', direction: 'out', corps: 'Bonjour Karim', quand: '2026-09-11T09:00:00.000Z' },
      { id: 'msg-2', direction: 'in', corps: 'Merci Alex', quand: '2026-09-13T10:22:00.000Z' },
    ]);
    expect(fiche.filId).toBe('fil-1');
    expect(fiche.notes).toEqual([{ id: 'note-1', texte: 'À relancer', quand: '2026-09-12T08:00:00.000Z', auteurNom: 'Alexandre' }]);
    expect(fiche.historique).toEqual([{ id: 'evt-1', quand: '2026-09-13T10:22:00.000Z', type: 'reply_received', libelle: 'Réponse reçue.', detail: null }]);
    expect(fiche.campagnes).toEqual([{ id: campagneId, nom: 'Directeur commercial' }]);
  });

  it('sans inscription dans la campagne demandée, la séquence est nulle', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Claire',
          last_name: 'Moreau',
          job_title: null,
          email: null,
          email_status: 'unknown',
          linkedin_url: null,
          photo_url: null,
          account_id: null,
          source_signal_id: null,
          status: 'active',
          entreprise: null,
          ville: null,
        },
      ],
      // Aucune ligne renvoyée par `jr:fiche_statut_campagne` : hors population de cette campagne.
    });

    const fiche = await lireFiche(ctx, { contactId, campagneId });

    expect(fiche.statut).toBe('sans_email');
    expect(fiche.sequence).toBeNull();
    expect(fiche.score).toBeNull();
    expect(fiche.pourquoi).toBeNull();
    expect(fiche.echanges).toEqual([]);
    expect(fiche.filId).toBeNull();
  });

  it('sans campagneId, lit le signal d’origine directement (pas de séquence)', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Nadia',
          last_name: 'Lemaire',
          job_title: 'Directrice du développement',
          email: 'n.lemaire@exemple.fr',
          email_status: 'valid',
          linkedin_url: null,
          photo_url: null,
          account_id: accountId,
          source_signal_id: signalId,
          status: 'active',
          entreprise: 'Kairn',
          ville: null,
        },
      ],
      'jr:fiche_signal_direct': [
        {
          id: signalId,
          score: 88,
          score_reason: null,
          title: 'A commenté le post du 8 sept.',
          provider_id: 'linkedin',
          occurred_at: '2026-09-08T00:00:00.000Z',
          url: null,
          raw: null,
        },
      ],
    });

    const fiche = await lireFiche(ctx, { contactId });

    expect(fiche.statut).toBe('a_contacter');
    expect(fiche.sequence).toBeNull();
    expect(fiche.score).toEqual({ valeur: 88, explication: null });
    expect(fiche.pourquoi?.titre).toBe('A commenté le post du 8 sept.');
  });
});

describe('ajouterNote', () => {
  it('refuse un viewer', async () => {
    await expect(ajouterNote(faux({}, 'viewer'), { contactId, texte: 'Une note' })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si le contact n’existe pas', async () => {
    const ctx = faux({ 'jr:note_contact': [] }, 'operator');
    await expect(ajouterNote(ctx, { contactId, texte: 'Une note' })).rejects.toThrow(ErreurIntrouvable);
  });

  it('insère la note et journalise l’ajout', async () => {
    const ctx = faux(
      {
        'jr:note_contact': [{ id: contactId }],
        'jr:note_creer': [{ id: 'note-1' }],
      },
      'operator',
    );
    const res = await ajouterNote(ctx, { contactId, texte: 'À relancer jeudi' });
    expect(res).toEqual({ id: 'note-1' });

    const insertion = appelsDe(ctx).find((a) => /jr:note_creer/i.test(a.sql));
    expect(insertion?.params).toEqual([contactId, 'user-1', 'À relancer jeudi']);

    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(a.sql));
    expect(journal?.params).toEqual(['org-1', 'user-1', 'contact', contactId, 'contact.note_added', JSON.stringify({ libelle: 'Note ajoutée par l’opérateur.' })]);
  });
});

describe('nePlusContacter', () => {
  it('refuse un viewer', async () => {
    await expect(nePlusContacter(faux({}, 'viewer'), { contactId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si le contact n’existe pas', async () => {
    const { ctx } = fauxConnectable({ 'jr:dnc_contact': [] });
    await expect(nePlusContacter(ctx, { contactId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('écrit les trois effets en une transaction (statut, suppression email, inscriptions arrêtées + envois annulés)', async () => {
    const { ctx, appelsClient, releases } = fauxConnectable({
      'jr:dnc_contact': [{ id: contactId, email: 'k.benali@exemple.fr' }],
      'jr:dnc_inscriptions': [{ id: enrollmentId }],
    });

    await nePlusContacter(ctx, { contactId });

    const appels = appelsClient();
    expect(appels.some((s) => /update contacts/i.test(s) && /do_not_contact/i.test(s))).toBe(true);
    expect(appels.some((s) => /insert into suppressions/i.test(s))).toBe(true);
    expect(appels.some((s) => /jr:dnc_inscriptions/i.test(s))).toBe(true);
    expect(appels.some((s) => /jr:dnc_actions/i.test(s))).toBe(true);
    expect(releases()).toBe(1);
  });

  it('sans email, aucune suppression n’est écrite', async () => {
    const { ctx, appelsClient } = fauxConnectable({
      'jr:dnc_contact': [{ id: contactId, email: null }],
    });

    await nePlusContacter(ctx, { contactId });

    expect(appelsClient().some((s) => /insert into suppressions/i.test(s))).toBe(false);
  });

  it('sans inscription vivante, aucune action n’est touchée', async () => {
    const { ctx, appelsClient } = fauxConnectable({
      'jr:dnc_contact': [{ id: contactId, email: null }],
      'jr:dnc_inscriptions': [],
    });

    await nePlusContacter(ctx, { contactId });

    expect(appelsClient().some((s) => /jr:dnc_actions/i.test(s))).toBe(false);
  });
});

describe('chercherEmail', () => {
  it('refuse un viewer', async () => {
    await expect(chercherEmail(faux({}, 'viewer'), { contactId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si le contact n’existe pas', async () => {
    const ctx = faux({ 'jr:chercher_email_contact': [] }, 'operator');
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('refuse un contact sans entreprise rattachée', async () => {
    const ctx = faux(
      { 'jr:chercher_email_contact': [{ id: contactId, account_id: null, persona_id: null, source_signal_id: null }] },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
  });

  it('refuse une entreprise déjà enrichie', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: null, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: null, country: null, enriched_at: '2026-09-01T00:00:00.000Z' }],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
  });

  it('refuse sans persona active à intitulés de poste', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: null, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: null, country: null, enriched_at: null }],
        'jr:chercher_email_persona_active': [],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
  });

  it('refuse un job déjà en file d’enrichissement', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: personaId, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: null, country: null, enriched_at: null }],
        'jr:chercher_email_persona_contact': [{ id: personaId, name: 'Directeur commercial', title_patterns: ['head of sales'] }],
        'jr:chercher_email_deja_en_file': [{ deja: true }],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
  });

  it('refuse au plafond du jour atteint', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: personaId, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: null, country: null, enriched_at: null }],
        'jr:chercher_email_persona_contact': [{ id: personaId, name: 'Directeur commercial', title_patterns: ['head of sales'] }],
        'jr:chercher_email_deja_en_file': [{ deja: false }],
        // `lireConsommationDuJour` (plafonds.ts) : plafond par défaut 30, déjà consommé 30 -> refus.
        enrich_today: [{ n: 30 }],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
    expect(appelsDe(ctx).some((a) => /jr:chercher_email_enfiler/i.test(a.sql))).toBe(false);
  });

  it('sous le plafond, décompte le crédit et enfile l’enrichissement', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: personaId, source_signal_id: signalId }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: 'woodpecker-studio.example', country: 'FR', enriched_at: null }],
        'jr:chercher_email_persona_contact': [{ id: personaId, name: 'Directeur commercial', title_patterns: ['head of sales'] }],
        'jr:chercher_email_deja_en_file': [{ deja: false }],
        enrich_today: [{ n: 5 }],
        'jr:chercher_email_credit_maj': [{ used: 6 }],
      },
      'operator',
    );

    await chercherEmail(ctx, { contactId });

    const enfiler = appelsDe(ctx).find((a) => /jr:chercher_email_enfiler/i.test(a.sql));
    expect(enfiler?.params).toEqual([
      'org-1',
      accountId,
      'Woodpecker Studio',
      'woodpecker-studio.example',
      'FR',
      personaId,
      ['head of sales'],
      signalId,
    ]);
  });

  it('la course au plafond entre la lecture et l’écriture est refusée (update sans effet)', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: personaId, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Woodpecker Studio', domain: null, country: null, enriched_at: null }],
        'jr:chercher_email_persona_contact': [{ id: personaId, name: 'Directeur commercial', title_patterns: ['head of sales'] }],
        'jr:chercher_email_deja_en_file': [{ deja: false }],
        enrich_today: [{ n: 5 }],
        'jr:chercher_email_credit_maj': [], // plafond atteint entre-temps par un autre appel : aucune ligne mise à jour.
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(ErreurEnrichissementImpossible);
    expect(appelsDe(ctx).some((a) => /jr:chercher_email_enfiler/i.test(a.sql))).toBe(false);
  });
});

describe('listerContacts', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerContacts(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('organisation sans campagne : total 0, aucune ligne, aucune requête de lignes', async () => {
    const ctx = faux({ 'jr:contacts_globale_campagnes': [] });
    const r = await listerContacts(ctx, {});
    expect(r).toEqual({ total: 0, lignes: [] });
  });

  it('fusionne les lignes de plusieurs campagnes, chacune porte sa campagne d’origine et son étape bornée', async () => {
    const ctx = faux({
      'jr:contacts_globale_campagnes': [
        { id: 'camp-1', nom: 'Directeur commercial' },
        { id: 'camp-2', nom: 'DRH PME' },
      ],
      'jr:lignes_contacts_globale': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'Head of Sales',
          email: 'karim@exemple.fr',
          entreprise: 'Woodpecker Studio',
          current_step: 1,
          statut: 'en_sequence',
          score: 91,
          pourquoi: 'Business developer senior',
          provider_id: 'adzuna',
          quand: '2026-09-10T00:00:00.000Z',
        },
      ],
      'jr:total_etapes_campagne': [{ n: 3 }],
    });
    const r = await listerContacts(ctx, {});
    // Même fixture rejouée pour les deux campagnes (le double mock ne distingue pas par
    // paramètre) : une ligne par campagne, chacune avec SA campagne d'origine.
    expect(r.total).toBe(2);
    expect(r.lignes.map((l) => l.campagneId).sort()).toEqual(['camp-1', 'camp-2']);
    expect(r.lignes[0]).toMatchObject({ nom: 'Karim Benali', etape: 2 });
  });

  it('restreint à une seule campagne quand `campagneId` est fourni (pas de requête « toutes campagnes »)', async () => {
    const ctx = faux({
      'jr:contacts_globale_campagne_unique': [{ id: campagneId, nom: 'Directeur commercial' }],
      'jr:lignes_contacts_globale': [],
    });
    const r = await listerContacts(ctx, { campagneId });
    expect(r).toEqual({ total: 0, lignes: [] });
    const appels = appelsDe(ctx);
    expect(appels.some((a) => /jr:contacts_globale_campagne_unique/.test(a.sql))).toBe(true);
    expect(appels.some((a) => /jr:contacts_globale_campagnes\b/.test(a.sql))).toBe(false);
  });

  it('trie la liste fusionnée par instant décroissant (plus récent d’abord)', async () => {
    const ligne = (id: string, quand: string) => ({
      signal_id: `sig-${id}`,
      contact_id: `contact-${id}`,
      first_name: 'Prénom',
      last_name: id,
      job_title: null,
      email: null,
      entreprise: null,
      current_step: null,
      statut: 'a_contacter' as const,
      score: null,
      pourquoi: null,
      provider_id: null,
      quand,
    });
    const ctx = faux({
      'jr:contacts_globale_campagnes': [{ id: 'camp-1', nom: 'Campagne' }],
      'jr:lignes_contacts_globale': [
        ligne('ancien', '2026-09-01T00:00:00.000Z'),
        ligne('recent', '2026-09-14T00:00:00.000Z'),
        ligne('milieu', '2026-09-07T00:00:00.000Z'),
      ],
    });
    const r = await listerContacts(ctx, {});
    expect(r.lignes.map((l) => l.contactId)).toEqual(['contact-recent', 'contact-milieu', 'contact-ancien']);
  });
});

describe('listerEntreprises', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerEntreprises(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('mappe les colonnes (secteur = code NAF brut, aucun libellé sectoriel inventé)', async () => {
    const ctx = faux({
      'jr:total_entreprises': [{ n: 1 }],
      'jr:lignes_entreprises': [
        {
          id: 'compte-1',
          name: 'Woodpecker Studio',
          naf_code: '6201Z',
          headcount: 42,
          city: 'Nantes',
          domain: 'woodpecker-studio.example',
          linkedin_url: 'https://linkedin.com/company/woodpecker',
          contacts_connus: 2,
        },
      ],
    });
    const r = await listerEntreprises(ctx, {});
    expect(r.total).toBe(1);
    expect(r.lignes[0]).toMatchObject({
      nom: 'Woodpecker Studio',
      secteur: '6201Z',
      effectif: 42,
      ville: 'Nantes',
      domaine: 'woodpecker-studio.example',
      contactsConnus: 2,
    });
  });
});

describe('listerClientsEtExclusions', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerClientsEtExclusions(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('fusionne clients et suppressions, ignore un scope hors email/domaine/linkedin (ex. `account`)', async () => {
    const ctx = faux({
      'jr:clients_entreprises': [
        {
          id: 'entree-1',
          domain: 'woodpecker-studio.example',
          raw_name: null,
          siren: null,
          created_at: '2026-09-01T00:00:00.000Z',
        },
      ],
      'jr:exclusions': [
        {
          id: 'sup-1',
          scope: 'email',
          value: 'p.martin@exemple.fr',
          reason: 'a demandé à ne plus être contacté',
          created_at: '2026-09-12T00:00:00.000Z',
        },
        { id: 'sup-2', scope: 'account', value: 'compte-2', reason: null, created_at: '2026-09-02T00:00:00.000Z' },
      ],
    });
    const r = await listerClientsEtExclusions(ctx, {});
    expect(r.lignes).toHaveLength(2);
    expect(r.lignes.find((l) => l.id === 'sup-2')).toBeUndefined();
    expect(r.lignes.find((l) => l.id === 'entree-1')).toMatchObject({
      type: 'client',
      valeur: 'woodpecker-studio.example',
    });
    expect(r.lignes.find((l) => l.id === 'sup-1')).toMatchObject({ type: 'email', valeur: 'p.martin@exemple.fr' });
  });
});

describe('ajouterSuppression', () => {
  it('refuse un rôle insuffisant (viewer)', async () => {
    await expect(ajouterSuppression(faux({}, 'viewer'), { scope: 'email', value: 'a@b.fr' })).rejects.toThrow(
      ForbiddenError,
    );
  });

  it('insère avec une garde anti-doublon, email mis en minuscule', async () => {
    const ctx = faux({}, 'operator');
    await ajouterSuppression(ctx, { scope: 'email', value: 'Person@Exemple.FR' });
    const appels = appelsDe(ctx);
    const insertion = appels.find((a) => /jr:contacts_ajouter_suppression/.test(a.sql));
    expect(insertion?.sql).toMatch(/not exists/);
    expect(insertion?.params).toEqual(['org-1', 'email', 'person@exemple.fr', null]);
  });

  it('conserve la casse d’un identifiant LinkedIn (sensible à la casse dans son chemin)', async () => {
    const ctx = faux({}, 'operator');
    await ajouterSuppression(ctx, { scope: 'linkedin', value: 'linkedin.com/in/JeanDupont' });
    const appels = appelsDe(ctx);
    const insertion = appels.find((a) => /jr:contacts_ajouter_suppression/.test(a.sql));
    expect(insertion?.params).toEqual(['org-1', 'linkedin', 'linkedin.com/in/JeanDupont', null]);
  });
});

describe('ajouterAListe', () => {
  it('refuse un rôle operator — RLS de `customer_lists`/`customer_list_entries` : admin requis (écart documenté avec le plan de tâche)', async () => {
    const { ctx } = fauxConnectable({}, 'operator');
    await expect(ajouterAListe(ctx, { domaine: 'acme.example' })).rejects.toThrow(ForbiddenError);
  });

  it('normalise une URL saisie (protocole, `www.`, chemin retirés, mis en minuscule)', async () => {
    const appels: { sql: string; params: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      appels.push({ sql, params: params ?? [] });
      if (/jr:contacts_liste_manuelle_existante/.test(sql)) return { rows: [{ id: 'liste-1' }], rowCount: 1 };
      if (/jr:contacts_liste_manuelle_ajouter/.test(sql)) return { rows: [{ id: 'entree-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const ex = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'],
      connect: vi.fn(async () => ({ query: clientQuery as unknown as Executeur['query'], release: vi.fn() })),
    };
    const ctx: Contexte = { ex: ex as unknown as Executeur, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    const r = await ajouterAListe(ctx, { domaine: 'https://www.Acme.example/a-propos' });
    expect(r).toEqual({ id: 'entree-1' });
    const insertion = appels.find((a) => /jr:contacts_liste_manuelle_ajouter/.test(a.sql));
    expect(insertion?.params).toEqual(['liste-1', 'org-1', 'acme.example']);
  });

  it('extrait le domaine d’une adresse email saisie', async () => {
    const appels: { sql: string; params: unknown[] }[] = [];
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      appels.push({ sql, params: params ?? [] });
      if (/jr:contacts_liste_manuelle_existante/.test(sql)) return { rows: [{ id: 'liste-1' }], rowCount: 1 };
      if (/jr:contacts_liste_manuelle_ajouter/.test(sql)) return { rows: [{ id: 'entree-1' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const ex = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })) as unknown as Executeur['query'],
      connect: vi.fn(async () => ({ query: clientQuery as unknown as Executeur['query'], release: vi.fn() })),
    };
    const ctx: Contexte = { ex: ex as unknown as Executeur, organisationId: 'org-1', utilisateurId: 'user-1', role: 'admin' };

    await ajouterAListe(ctx, { domaine: 'Jean@ACME.example' });
    const insertion = appels.find((a) => /jr:contacts_liste_manuelle_ajouter/.test(a.sql));
    expect(insertion?.params).toEqual(['liste-1', 'org-1', 'acme.example']);
  });

  it('réutilise la liste manuelle existante plutôt que d’en créer une seconde', async () => {
    const { ctx, appelsClient } = fauxConnectable(
      {
        'jr:contacts_liste_manuelle_existante': [{ id: 'liste-1' }],
        'jr:contacts_liste_manuelle_ajouter': [{ id: 'entree-1' }],
      },
      'admin',
    );
    await ajouterAListe(ctx, { domaine: 'acme.example' });
    expect(appelsClient().some((sql) => /jr:contacts_liste_manuelle_creer/.test(sql))).toBe(false);
  });

  it('crée la liste manuelle au premier ajout (aucune existante)', async () => {
    const { ctx, appelsClient } = fauxConnectable(
      {
        'jr:contacts_liste_manuelle_existante': [],
        'jr:contacts_liste_manuelle_creer': [{ id: 'liste-neuve' }],
        'jr:contacts_liste_manuelle_ajouter': [{ id: 'entree-1' }],
      },
      'admin',
    );
    const r = await ajouterAListe(ctx, { domaine: 'acme.example' });
    expect(r).toEqual({ id: 'entree-1' });
    expect(appelsClient().some((sql) => /jr:contacts_liste_manuelle_creer/.test(sql))).toBe(true);
  });
});

describe('exporterCsv', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(exporterCsv(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('BOM en tête, en-têtes français, séparateur `;`, guillemets doublés (`;` et `"` dans un champ)', async () => {
    const ctx = faux({
      'jr:contacts_globale_campagnes': [{ id: 'camp-1', nom: 'Direction commerciale; France' }],
      'jr:lignes_contacts_globale': [
        {
          signal_id: 'sig-1',
          contact_id: 'contact-1',
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: 'Head of Sales',
          email: 'karim@exemple.fr',
          entreprise: 'Woodpecker Studio',
          current_step: 0,
          statut: 'a_contacter',
          score: 91,
          pourquoi: 'Recrute "vite"; profil senior',
          provider_id: 'adzuna',
          quand: '2026-09-10T00:00:00.000Z',
        },
      ],
      'jr:total_etapes_campagne': [{ n: 0 }],
    });
    const csv = await exporterCsv(ctx, {});
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lignes = csv.slice(1).split('\r\n');
    expect(lignes[0]).toBe('"Nom";"Poste";"Entreprise";"Email";"État";"Étape";"Campagne";"Score";"Pourquoi lui"');
    expect(lignes[1]).toContain('"Recrute ""vite""; profil senior"');
    expect(lignes[1]).toContain('"Direction commerciale; France"');
    expect(lignes[1]).toContain('"Karim Benali"');
    expect(lignes[1]).toContain('"À contacter"');
  });
});

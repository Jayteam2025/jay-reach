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
  SQL_CONTACTS_GLOBAUX,
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
): { ctx: Contexte; appelsClient: () => string[]; valeursClient: (motif: RegExp) => unknown[][]; releases: () => number } {
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
    valeursClient: (motif) =>
      (clientQuery.mock.calls as unknown[][]).filter((a) => motif.test(String(a[0]))).map((a) => (a[1] ?? []) as unknown[]),
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

  // M9 (Mineur, revue finale du 14/09) : le contact est vérifié
  // (`jr:fiche_contact`), mais la campagne, elle, ne l'était pas — sans ce
  // garde, une campagne d'une autre organisation aurait rendu son propre
  // nombre d'étapes de séquence. Aligné sur le correctif I1
  // (`listerContactsCampagne`, campagnes.ts).
  it('filtre les étapes de séquence par organisation (jr:fiche_etapes joint campaigns.organization_id)', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: null,
          email: 'karim@exemple.fr',
          email_status: 'valid',
          linkedin_url: null,
          photo_url: null,
          account_id: null,
          source_signal_id: null,
          status: 'active',
          entreprise: null,
          ville: null,
        },
      ],
      'jr:fiche_statut_campagne': [
        {
          statut: 'en_sequence',
          enrollment_id: enrollmentId,
          current_step: 0,
          e_status: 'active',
          signal_id: null,
          score: null,
          score_reason: null,
          title: null,
          provider_id: null,
          occurred_at: null,
          url: null,
          raw: null,
        },
      ],
      'jr:fiche_etapes': [{ position: 0 }],
    });

    await lireFiche(ctx, { contactId, campagneId });

    const appel = appelsDe(ctx).find((a) => /jr:fiche_etapes/i.test(a.sql));
    expect(appel).toBeDefined();
    expect(appel!.sql).toMatch(/join campaigns camp on camp\.id = ss\.campaign_id and camp\.organization_id = \$2/i);
    expect(appel!.params).toEqual([campagneId, 'org-1']);
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
          next_action_at: '2026-09-20T09:00:00.000Z',
        },
      ],
      'jr:fiche_etapes': [{ position: 0 }, { position: 1 }, { position: 2 }, { position: 3 }],
      'jr:fiche_boite': [{ identity: 'camille@exemple.fr', inbox_provider: 'microsoft_graph' }],
      'jr:fiche_fils': [{ id: 'fil-1', last_message_at: '2026-09-13T10:00:00.000Z' }],
      'jr:fiche_messages': [
        { id: 'msg-1', direction: 'out', body: 'Bonjour Karim', sent_at: '2026-09-11T09:00:00.000Z' },
        { id: 'msg-2', direction: 'in', body: 'Merci Camille', sent_at: '2026-09-13T10:22:00.000Z' },
      ],
      'jr:fiche_notes': [{ id: 'note-1', body: 'À relancer', created_at: '2026-09-12T08:00:00.000Z', auteur_nom: 'Camille' }],
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
      boite: { identite: 'camille@exemple.fr', marque: 'outlook' },
      pause: null,
      // F11 : `next_action_at` de l'inscription active exposé tel quel, apps/web le formate.
      prochainMessageLe: '2026-09-20T09:00:00.000Z',
    });
    expect(fiche.echanges).toEqual([
      { id: 'msg-1', direction: 'out', corps: 'Bonjour Karim', quand: '2026-09-11T09:00:00.000Z' },
      { id: 'msg-2', direction: 'in', corps: 'Merci Camille', quand: '2026-09-13T10:22:00.000Z' },
    ]);
    expect(fiche.filId).toBe('fil-1');
    expect(fiche.notes).toEqual([{ id: 'note-1', texte: 'À relancer', quand: '2026-09-12T08:00:00.000Z', auteurNom: 'Camille' }]);
    expect(fiche.historique).toEqual([{ id: 'evt-1', quand: '2026-09-13T10:22:00.000Z', type: 'reply_received', libelle: 'Réponse reçue.', detail: null }]);
    expect(fiche.campagnes).toEqual([{ id: campagneId, nom: 'Directeur commercial' }]);
  });

  // F4 (recette visuelle du 17/09) : `threads.last_message_at` est un
  // `timestamptz`, renvoyé par `pg` comme un objet `Date` — pas une chaîne
  // malgré le type déclaré des lignes brutes. Avant correctif, le tri de
  // `fils` (`(b.last_message_at ?? '').localeCompare(...)`) explose dès que
  // le contact a deux fils.
  it('sélectionne le fil le plus récent même quand `last_message_at` est un objet Date (comme le renvoie pg)', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Karim',
          last_name: 'Benali',
          job_title: null,
          email: null,
          email_status: null,
          linkedin_url: null,
          photo_url: null,
          account_id: null,
          source_signal_id: null,
          status: 'active',
          entreprise: null,
          ville: null,
        },
      ],
      'jr:fiche_fils': [
        { id: 'fil-ancien', last_message_at: new Date('2026-09-01T00:00:00.000Z') },
        { id: 'fil-recent', last_message_at: new Date('2026-09-13T10:00:00.000Z') },
      ],
    });

    const fiche = await lireFiche(ctx, { contactId });

    expect(fiche.filId).toBe('fil-recent');
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

  // T29, partie B : une inscription `paused` (gate email) expose `sequence.pause`
  // avec le motif brut (`stop_reason`) tel quel — `libelleMotifPause` (apps/web)
  // le traduit à l'écran, `lireFiche` ne fait aucune traduction.
  it('une inscription paused (email_gate) expose sequence.pause avec le motif brut', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Sami',
          last_name: 'Nasri',
          job_title: null,
          email: 'sami@exemple.fr',
          email_status: 'invalid',
          linkedin_url: null,
          photo_url: null,
          account_id: null,
          source_signal_id: null,
          status: 'active',
          entreprise: null,
          ville: null,
        },
      ],
      'jr:fiche_statut_campagne': [
        {
          statut: 'en_pause',
          enrollment_id: enrollmentId,
          current_step: 1,
          e_status: 'paused',
          stop_reason: 'email_gate:bouncer_invalid',
          resume_at: null,
          // F11 : présent en base (le worker ne l'efface pas en posant la pause) mais sans
          // signification pour une inscription en pause — ne doit jamais fuiter en `prochainMessageLe`.
          next_action_at: '2026-09-19T09:00:00.000Z',
          signal_id: null,
          score: null,
          score_reason: null,
          title: null,
          provider_id: null,
          occurred_at: null,
          url: null,
          raw: null,
        },
      ],
      'jr:fiche_etapes': [{ position: 0 }, { position: 1 }],
      'jr:fiche_boite': [],
    });

    const fiche = await lireFiche(ctx, { contactId, campagneId });
    expect(fiche.statut).toBe('en_pause');
    expect(fiche.sequence?.pause).toEqual({
      motif: 'email_gate:bouncer_invalid',
      repriseLe: null,
      inscriptionId: enrollmentId,
    });
    expect(fiche.sequence?.prochainMessageLe).toBeNull();
  });

  it('une inscription paused_absence sans stop_reason retombe sur le motif "absence", avec repriseLe', async () => {
    const ctx = faux({
      'jr:fiche_contact': [
        {
          id: contactId,
          first_name: 'Léa',
          last_name: 'Petit',
          job_title: null,
          email: 'lea@exemple.fr',
          email_status: 'valid',
          linkedin_url: null,
          photo_url: null,
          account_id: null,
          source_signal_id: null,
          status: 'active',
          entreprise: null,
          ville: null,
        },
      ],
      'jr:fiche_statut_campagne': [
        {
          statut: 'en_pause',
          enrollment_id: enrollmentId,
          current_step: 0,
          e_status: 'paused_absence',
          stop_reason: null,
          resume_at: '2026-09-22T00:00:00.000Z',
          signal_id: null,
          score: null,
          score_reason: null,
          title: null,
          provider_id: null,
          occurred_at: null,
          url: null,
          raw: null,
        },
      ],
      'jr:fiche_etapes': [{ position: 0 }],
      'jr:fiche_boite': [],
    });

    const fiche = await lireFiche(ctx, { contactId, campagneId });
    expect(fiche.sequence?.pause).toEqual({
      motif: 'absence',
      repriseLe: '2026-09-22T00:00:00.000Z',
      inscriptionId: enrollmentId,
    });
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

  it('un contact avec une adresse LinkedIn : suppression de portée linkedin, sur cette adresse', async () => {
    const adresse = 'https://www.linkedin.com/in/k-benali';
    const { ctx, appelsClient } = fauxConnectable({
      'jr:dnc_contact': [{ id: contactId, email: null, linkedin_url: adresse }],
    });

    await nePlusContacter(ctx, { contactId });

    const appel = appelsClient().find((s) => /jr:dnc_suppression_linkedin/i.test(s));
    expect(appel).toBeDefined();
    expect(appel).toMatch(/'linkedin'/);
  });

  it('l’opposition porte les DEUX graphies : l’adresse du contact et celle que la collecte déduit de son identifiant de membre', async () => {
    const { ctx, valeursClient } = fauxConnectable({
      'jr:dnc_contact': [
        { id: contactId, email: null, linkedin_url: 'https://www.linkedin.com/in/k-benali', linkedin_provider_id: 'ACoAAAbc123' },
      ],
    });

    await nePlusContacter(ctx, { contactId });

    const posees = valeursClient(/jr:dnc_suppression_linkedin/i).map((v) => v[1]);
    expect(posees).toEqual(['https://www.linkedin.com/in/k-benali', 'https://www.linkedin.com/in/ACoAAAbc123']);
  });

  it('une adresse déjà déduite n’est posée qu’une fois', async () => {
    const { ctx, valeursClient } = fauxConnectable({
      'jr:dnc_contact': [
        { id: contactId, email: null, linkedin_url: 'https://www.linkedin.com/in/ACoAAAbc123', linkedin_provider_id: 'ACoAAAbc123' },
      ],
    });

    await nePlusContacter(ctx, { contactId });

    expect(valeursClient(/jr:dnc_suppression_linkedin/i)).toHaveLength(1);
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

  // Constat produit (18/09, tour de correction G4) : avec `enrichissements_par_jour = 0`,
  // l'utilisateur recevait « Sqwad a déjà été enrichie » — la mauvaise cause, puisque le
  // plafond bloquait TOUT contact ce jour-là, pas seulement celui-ci. Le plafond (état de
  // l'instance) doit être vérifié avant « déjà enrichie » (état de ce contact précis).
  it('le plafond à 0 est vérifié avant « déjà enrichie » — nomme la bonne cause, sans même résoudre le contact', async () => {
    const ctx = faux(
      {
        'from organization_settings': [{ key: 'enrichissements_par_jour', value: 0 }],
        // Si l'ordre était resté celui d'avant, ces fixtures auraient laissé passer l'appel
        // jusqu'à « déjà enrichie » : présentes pour prouver que ce n'est PAS cette branche qui
        // répond, pas parce qu'elles seraient nécessaires ici.
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: null, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Sqwad', domain: null, country: null, enriched_at: '2026-09-18T00:19:09.000Z' }],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(
      'L’enrichissement est en pause (plafond à 0). Relevez-le dans Fournisseurs pour enrichir.',
    );
    // Fail-fast : le plafond (état de l'instance) tranche avant toute lecture propre à ce contact.
    expect(appelsDe(ctx).some((a) => /jr:chercher_email_contact/i.test(a.sql))).toBe(false);
  });

  it('« déjà enrichie » nomme la cause pour CE contact, ne renvoie plus vers Contacts (constat produit, 18/09)', async () => {
    const ctx = faux(
      {
        'jr:chercher_email_contact': [{ id: contactId, account_id: accountId, persona_id: null, source_signal_id: null }],
        'jr:chercher_email_compte': [{ id: accountId, name: 'Sqwad', domain: null, country: null, enriched_at: '2026-09-18T00:19:09.000Z' }],
      },
      'operator',
    );
    await expect(chercherEmail(ctx, { contactId })).rejects.toThrow(
      'Sqwad est déjà enrichie et n’a pas donné d’adresse pour ce contact : rien de plus à tenter aujourd’hui.',
    );
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

  it('#118 : le décompte du crédit journalier utilise le jour de l’organisation, pas UTC (tour de correction 5)', async () => {
    vi.useFakeTimers();
    // 23:30 UTC le 14/01 = 00:30 le 15/01 à Paris.
    vi.setSystemTime(new Date('2026-01-14T23:30:00.000Z'));
    try {
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

      const upsert = appelsDe(ctx).find((a) => /jr:chercher_email_credit_upsert/i.test(a.sql));
      const maj = appelsDe(ctx).find((a) => /jr:chercher_email_credit_maj/i.test(a.sql));
      expect(upsert?.params).toEqual(['org-1', 30, '2026-01-15']);
      expect(maj?.params).toEqual(['org-1', '2026-01-15']);
    } finally {
      vi.useRealTimers();
    }
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

/**
 * Ligne telle que la requête unique `SQL_CONTACTS_GLOBAUX` la renvoie. Dédoublonnage, tri, total et
 * pagination sont faits par Postgres : ces tests (faux pool, le SQL n'y est pas exécuté) vérifient
 * le MAPPAGE, la fenêtre demandée et le nombre de requêtes. Que le SQL dédoublonne et trie comme
 * l'ancienne boucle en mémoire est prouvé sur une vraie base par
 * `test/pg-verify/contacts-globaux.sh` (comparaison ancien / nouveau, preuve par retrait).
 */
function ligneSql(id: string, surcharge: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    total_contacts: 1,
    campagne_id: 'camp-1',
    campagne_nom: 'Directeur commercial',
    total_etapes: 3,
    nombre_campagnes: 1,
    signal_id: `sig-${id}`,
    contact_id: `contact-${id}`,
    first_name: 'Karim',
    last_name: 'Benali',
    job_title: null,
    email: null,
    entreprise: null,
    current_step: null,
    statut: 'a_contacter',
    score: null,
    pourquoi: null,
    provider_id: null,
    quand: '2026-09-10T00:00:00.000Z',
    enrollment_id: null,
    e_status: null,
    stop_reason: null,
    resume_at: null,
    next_action_at: null,
    ...surcharge,
  };
}

describe('listerContacts', () => {
  it('refuse un rôle insuffisant', async () => {
    await expect(listerContacts(faux({}, null), {})).rejects.toThrow(ForbiddenError);
  });

  it('aucun contact : la ligne vide de la jointure externe n’est pas une ligne', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [{ total_contacts: 0, contact_id: null, campagne_id: null }] });
    expect(await listerContacts(ctx, {})).toEqual({ total: 0, lignes: [], tronque: false });
  });

  it('UNE seule requête, quel que soit le nombre de campagnes (plus de boucle par campagne)', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1')] });
    await listerContacts(ctx, {});
    const appels = appelsDe(ctx);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.sql).toMatch(/jr:contacts_globaux_page/);
  });

  it('mappe la ligne : campagne représentative, étape bornée par SES étapes, nombreCampagnes, nom complet', async () => {
    const ctx = faux({
      'jr:contacts_globaux_page': [
        ligneSql('1', { total_contacts: 2, current_step: 1, total_etapes: 3, nombre_campagnes: 2, campagne_id: 'camp-2', campagne_nom: 'DRH PME' }),
        ligneSql('2', { total_contacts: 2, current_step: 5, total_etapes: 2, first_name: null, last_name: null }),
      ],
    });
    const r = await listerContacts(ctx, {});
    expect(r.total).toBe(2);
    expect(r.lignes[0]).toMatchObject({
      contactId: 'contact-1',
      nom: 'Karim Benali',
      campagneId: 'camp-2',
      campagneNom: 'DRH PME',
      nombreCampagnes: 2,
      etape: 2,
      intitulePosteListe: null,
    });
    // `etapeAffichee` : 5 + 1 borné au nombre d'étapes de la campagne (2).
    expect(r.lignes[1]).toMatchObject({ nom: '—', etape: 2, nombreCampagnes: 1 });
  });

  // F11 : `next_action_at` devient `prochainMessageLe` seulement pour une ligne `en_sequence` ;
  // le motif et la reprise ne sortent que pour `en_pause`.
  it('expose prochainMessageLe pour en_sequence, motifPause et repriseLe pour en_pause', async () => {
    const ctx = faux({
      'jr:contacts_globaux_page': [
        ligneSql('1', { total_contacts: 2, statut: 'en_sequence', e_status: 'active', next_action_at: '2026-09-25T09:00:00.000Z', resume_at: '2026-10-01T00:00:00.000Z' }),
        ligneSql('2', { total_contacts: 2, statut: 'en_pause', e_status: 'paused_absence', stop_reason: null, next_action_at: '2026-09-25T09:00:00.000Z', resume_at: '2026-10-01T00:00:00.000Z' }),
      ],
    });
    const r = await listerContacts(ctx, {});
    expect(r.lignes[0]).toMatchObject({ prochainMessageLe: '2026-09-25T09:00:00.000Z', motifPause: null, repriseLe: null });
    expect(r.lignes[1]).toMatchObject({ prochainMessageLe: null, motifPause: 'absence', repriseLe: '2026-10-01T00:00:00.000Z' });
  });

  it('demande la fenêtre de la page à Postgres (offset/limit) et transmet les filtres comme paramètres', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1', { total_contacts: 130 })] });
    await listerContacts(ctx, { page: 3, filtre: 'en_sequence', campagneId, source: 'adzuna', email: 'verifie', recherche: '50%' });
    const [appel] = appelsDe(ctx);
    expect(appel!.params).toEqual(['org-1', campagneId, 'en_sequence', '%50\\%%', 'adzuna', 'verifie', 100, 50]);
  });

  it('sans filtre : campagne, recherche, source et email valent null, page 1 = offset 0 limit 50', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1')] });
    await listerContacts(ctx, {});
    expect(appelsDe(ctx)[0]!.params).toEqual(['org-1', null, 'tous', null, null, null, 0, 50]);
  });

  // LIMITE_CONTACTS_GLOBAL (tour de correction 1, mineur 6) : `total` s'arrête au plafond, `tronque`
  // dit qu'il y en a davantage, et aucune page ne va au-delà des 5 000 premiers contacts.
  it('au-delà de 5 000 contacts distincts : tronque vrai, total plafonné', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1', { total_contacts: 5001 })] });
    const r = await listerContacts(ctx, {});
    expect(r.tronque).toBe(true);
    expect(r.total).toBe(5000);
  });

  it('exactement 5 000 contacts : rien de coupé', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1', { total_contacts: 5000 })] });
    const r = await listerContacts(ctx, {});
    expect(r.tronque).toBe(false);
    expect(r.total).toBe(5000);
  });

  it('la dernière page atteignable (100) s’arrête au 5 000e contact ; la 101e demande zéro ligne', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1', { total_contacts: 9000 })] });
    await listerContacts(ctx, { page: 100 });
    await listerContacts(ctx, { page: 101 });
    const [p100, p101] = appelsDe(ctx);
    expect(p100!.params.slice(-2)).toEqual([4950, 50]);
    expect(p101!.params.slice(-2)).toEqual([5000, 0]);
  });

  // Garde-fou de la requête elle-même (le faux pool ne l'exécute pas, `contacts-globaux.sh` si).
  it('SQL_CONTACTS_GLOBAUX rejoue la population par campagne via camp.id et ne garde qu’un `$1` (l’organisation)', () => {
    expect(SQL_CONTACTS_GLOBAUX).toMatch(/cs0\.campaign_id = camp\.id/);
    expect(SQL_CONTACTS_GLOBAUX).toMatch(/e2\.campaign_id = camp\.id/);
    expect(SQL_CONTACTS_GLOBAUX.match(/\$1\b/g)).toHaveLength(1);
    expect(SQL_CONTACTS_GLOBAUX).toMatch(/distinct on \(contact_id\)/);
    // Ordre total (pagination stable) : instant décroissant puis identifiant du contact.
    expect(SQL_CONTACTS_GLOBAUX).toMatch(/order by d\.quand desc nulls last, d\.contact_id desc/);
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
    expect(r.tronque).toBe(false);
    expect(r.lignes).toHaveLength(2);
    expect(r.lignes.find((l) => l.id === 'sup-2')).toBeUndefined();
    expect(r.lignes.find((l) => l.id === 'entree-1')).toMatchObject({
      type: 'client',
      valeur: 'woodpecker-studio.example',
    });
    expect(r.lignes.find((l) => l.id === 'sup-1')).toMatchObject({ type: 'email', valeur: 'p.martin@exemple.fr' });
  });

  // Tour de correction 1, Important 2 : même plafond (`LIMITE_CONTACTS_GLOBAL`, 5 000) que
  // `listerContacts`, exposé par `tronque` — sur des compteurs, pas une base réelle.
  it('`tronque` est vrai quand `customer_list_entries` dépasse le plafond (5 000)', async () => {
    const ctx = faux({
      'jr:total_clients_entreprises': [{ n: 5001 }],
      'jr:total_exclusions': [{ n: 0 }],
    });
    const r = await listerClientsEtExclusions(ctx, {});
    expect(r.tronque).toBe(true);
  });

  it('`tronque` est vrai quand `suppressions` (email/domaine/linkedin) dépasse le plafond (5 000)', async () => {
    const ctx = faux({
      'jr:total_clients_entreprises': [{ n: 0 }],
      'jr:total_exclusions': [{ n: 5001 }],
    });
    const r = await listerClientsEtExclusions(ctx, {});
    expect(r.tronque).toBe(true);
  });

  it('`tronque` est faux sous le plafond des deux côtés', async () => {
    const ctx = faux({
      'jr:total_clients_entreprises': [{ n: 42 }],
      'jr:total_exclusions': [{ n: 20 }],
    });
    const r = await listerClientsEtExclusions(ctx, {});
    expect(r.tronque).toBe(false);
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
      'jr:contacts_globaux_page': [
        ligneSql('1', {
          campagne_nom: 'Direction commerciale; France',
          job_title: 'Head of Sales',
          email: 'karim@exemple.fr',
          entreprise: 'Woodpecker Studio',
          current_step: 0,
          total_etapes: 0,
          score: 91,
          pourquoi: 'Recrute "vite"; profil senior',
          provider_id: 'adzuna',
        }),
      ],
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

  // G4 : le nom d'une seule campagne mentirait pour un contact candidat à plusieurs à la fois.
  it('un contact dans deux campagnes : la colonne Campagne dit combien, pas le nom d’une seule', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1', { campagne_nom: 'DRH PME', nombre_campagnes: 2 })] });
    const csv = await exporterCsv(ctx, {});
    const lignes = csv.slice(1).split('\r\n');
    expect(lignes).toHaveLength(2);
    expect(lignes[1]).toContain('"2 campagnes"');
    expect(lignes[1]).not.toContain('DRH PME');
  });

  // L'export veut TOUT (jusqu'au plafond), pas une page : une seule requête, fenêtre 0..5 000.
  it('ne pagine pas : une seule requête qui demande les 5 000 premiers contacts', async () => {
    const ctx = faux({ 'jr:contacts_globaux_page': [ligneSql('1'), ligneSql('2')] });
    await exporterCsv(ctx, {});
    const appels = appelsDe(ctx);
    expect(appels).toHaveLength(1);
    expect(appels[0]!.params.slice(-2)).toEqual([0, 5000]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable } from './contexte.js';
import { ErreurReponseImpossible } from '../inbox/repondre-au-fil.js';
import { calculerReponsePossible, lireFil, listerFils, marquerInteret, marquerTraite, repondre } from './reception.js';

/** Capture chaque appel `query` (texte + valeurs) — utile pour vérifier le SQL émis, pas seulement son résultat. */
function contexteCapturant(
  reponses: (appel: { text: string; values: unknown[] }) => { rows: unknown[]; rowCount: number } | undefined,
  role: Contexte['role'] = 'operator',
): { ctx: Contexte; appels: { text: string; values: unknown[] }[] } {
  const appels: { text: string; values: unknown[] }[] = [];
  const query = vi.fn(async (text: string, values: unknown[] = []) => {
    appels.push({ text, values });
    return reponses({ text, values }) ?? { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ctx: { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role }, appels };
}

describe('calculerReponsePossible', () => {
  it("canal LinkedIn : impossible, quel que soit l'historique", () => {
    expect(calculerReponsePossible('linkedin', [{ direction: 'in', transport: null, graphMessageId: null, salesblinkInboxMessageId: 'x' }])).toEqual({
      possible: false,
      raison: 'reception.fil.raisonReponseImpossible.canalNonEmail',
      transport: null,
    });
  });

  it('aucun message entrant : impossible', () => {
    expect(calculerReponsePossible('email', [{ direction: 'out', transport: null, graphMessageId: null, salesblinkInboxMessageId: null }])).toEqual({
      possible: false,
      raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu',
      transport: null,
    });
  });

  it('microsoft_graph avec identifiant Graph : possible, transport microsoft_graph', () => {
    expect(
      calculerReponsePossible('email', [{ direction: 'in', transport: 'microsoft_graph', graphMessageId: 'g-1', salesblinkInboxMessageId: null }]),
    ).toEqual({ possible: true, raison: null, transport: 'microsoft_graph' });
  });

  it('microsoft_graph sans identifiant Graph : impossible', () => {
    expect(
      calculerReponsePossible('email', [{ direction: 'in', transport: 'microsoft_graph', graphMessageId: null, salesblinkInboxMessageId: null }]),
    ).toEqual({ possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null });
  });

  it("salesblink avec l'identifiant de tâche /inbox : possible, transport salesblink", () => {
    expect(
      calculerReponsePossible('email', [{ direction: 'in', transport: null, graphMessageId: null, salesblinkInboxMessageId: 'inbox-1' }]),
    ).toEqual({ possible: true, raison: null, transport: 'salesblink' });
  });

  it("salesblink sans identifiant de tâche /inbox : impossible", () => {
    expect(
      calculerReponsePossible('email', [{ direction: 'in', transport: null, graphMessageId: null, salesblinkInboxMessageId: null }]),
    ).toEqual({ possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null });
  });

  it('ne regarde que le DERNIER message entrant, pas les précédents', () => {
    expect(
      calculerReponsePossible('email', [
        { direction: 'in', transport: null, graphMessageId: null, salesblinkInboxMessageId: 'ancien' },
        { direction: 'out', transport: null, graphMessageId: null, salesblinkInboxMessageId: null },
        { direction: 'in', transport: null, graphMessageId: null, salesblinkInboxMessageId: null },
      ]),
    ).toEqual({ possible: false, raison: 'reception.fil.raisonReponseImpossible.messageOrigineInconnu', transport: null });
  });
});

describe('listerFils', () => {
  it('refuse un rôle inférieur à viewer', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }), null);
    await expect(listerFils(ctx, {})).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("filtre 'a_traiter' (par défaut) : la requête des compteurs ET celle de la liste portent la condition classification/handled_at", async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.includes('jr:compteurs_reception')) return { rows: [{ a_traiter: 2, interesses: 1, absences: 0, traites: 3, tous: 6 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });
    const resultat = await listerFils(ctx, {});
    expect(resultat.compteurs).toEqual({ a_traiter: 2, interesses: 1, absences: 0, traites: 3, tous: 6 });

    const compteurs = appels.find((a) => a.text.includes('jr:compteurs_reception'))!;
    const liste = appels.find((a) => a.text.includes('jr:liste_fils'))!;
    expect(compteurs.text).toContain(`classification = 'human_reply'`);
    expect(compteurs.text).toContain('handled_at is null');
    expect(liste.text).toContain(`classification = 'human_reply'`);
    expect(liste.text).toContain('handled_at is null');
  });

  it("filtre 'interesses' : la condition de la liste porte sur interest = 'interested'", async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await listerFils(ctx, { filtre: 'interesses' });
    const liste = appels.find((a) => a.text.includes('jr:liste_fils'))!;
    expect(liste.text).toContain(`interest = 'interested'`);
  });

  it("filtre 'absences' : condition sur classification = 'auto_absence'", async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await listerFils(ctx, { filtre: 'absences' });
    const liste = appels.find((a) => a.text.includes('jr:liste_fils'))!;
    expect(liste.text).toContain(`classification = 'auto_absence'`);
  });

  it("filtre 'traites' : condition sur handled_at is not null", async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await listerFils(ctx, { filtre: 'traites' });
    const liste = appels.find((a) => a.text.includes('jr:liste_fils'))!;
    expect(liste.text).toContain('handled_at is not null');
  });

  it("campagneId : les deux requêtes reçoivent l'identifiant en second paramètre", async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await listerFils(ctx, { campagneId: '11111111-1111-1111-1111-111111111111' });
    for (const a of appels) {
      expect(a.values[1]).toBe('11111111-1111-1111-1111-111111111111');
    }
  });

  it('assemble une ligne de fil (nom, canal, aperçu, intérêt, traité)', async () => {
    const { ctx } = contexteCapturant(({ text }) => {
      if (text.includes('jr:compteurs_reception')) return { rows: [{ a_traiter: 1, interesses: 0, absences: 0, traites: 0, tous: 1 }], rowCount: 1 };
      if (text.includes('jr:liste_fils')) {
        return {
          rows: [
            {
              id: 'fil-1',
              contact_id: 'contact-1',
              channel: 'email',
              classification: 'human_reply',
              interest: null,
              handled_at: null,
              last_message_at: '2026-09-16T09:00:00.000Z',
              resume_at: null,
              first_name: 'Karim',
              last_name: 'Benali',
              job_title: 'Head of Sales',
              account_name: 'Exemple SAS',
              campagne_nom: 'Directeur commercial',
              dernier_message: 'Merci, ça me parle.',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const { fils } = await listerFils(ctx, {});
    expect(fils).toEqual([
      {
        id: 'fil-1',
        contactId: 'contact-1',
        nom: 'Karim Benali',
        poste: 'Head of Sales',
        entreprise: 'Exemple SAS',
        canal: 'email',
        classification: 'human_reply',
        apercu: 'Merci, ça me parle.',
        quand: '2026-09-16T09:00:00.000Z',
        interet: null,
        traite: false,
        relanceLe: null,
        campagneNom: 'Directeur commercial',
      },
    ]);
  });
});

describe('lireFil', () => {
  it('refuse un rôle inférieur à viewer', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }), null);
    await expect(lireFil(ctx, { filId: '11111111-1111-1111-1111-111111111111' })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fil introuvable (hors organisation ou inexistant) : ErreurIntrouvable', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await expect(lireFil(ctx, { filId: '11111111-1111-1111-1111-111111111111' })).rejects.toBeInstanceOf(ErreurIntrouvable);
  });

  it('reponsePossible reflète calculerReponsePossible sur les messages lus (pas de second appel réseau)', async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.includes('jr:fil_entete')) {
        return {
          rows: [
            {
              id: 'fil-1',
              contact_id: 'contact-1',
              channel: 'email',
              interest: null,
              handled_at: null,
              first_name: 'Karim',
              last_name: 'Benali',
              job_title: 'Head of Sales',
              email: 'k.benali@exemple.fr',
              email_status: 'valid',
              linkedin_url: null,
              source_signal_id: null,
              account_name: 'Exemple SAS',
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('jr:fil_messages')) {
        return {
          rows: [
            {
              id: 'm-1',
              direction: 'in',
              body: 'Merci, ça me parle.',
              sent_at: '2026-09-16T09:00:00.000Z',
              objet: null,
              repond_depuis: null,
              transport: null,
              graph_message_id: null,
              salesblink_inbox_message_id: 'inbox-1',
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const fil = await lireFil(ctx, { filId: '11111111-1111-1111-1111-111111111111' });
    expect(fil.canal).toBe('email');
    expect(fil.reponsePossible).toBe(true);
    expect(fil.raisonReponseImpossible).toBeNull();
    expect(fil.transportReponse).toBe('salesblink');
    // Une seule lecture des messages : `jr:fil_messages` n'apparaît qu'une fois.
    expect(appels.filter((a) => a.text.includes('jr:fil_messages'))).toHaveLength(1);
  });

  it("canal 'linkedin_message' de threads.channel -> canal 'linkedin' (pas dérivé des coordonnées du contact)", async () => {
    const { ctx } = contexteCapturant(({ text }) => {
      if (text.includes('jr:fil_entete')) {
        return {
          rows: [
            {
              id: 'fil-1',
              contact_id: 'contact-1',
              channel: 'linkedin_message',
              interest: null,
              handled_at: null,
              first_name: 'Nadia',
              last_name: 'Lemaire',
              job_title: null,
              email: 'nadia@exemple.fr',
              email_status: 'valid',
              linkedin_url: 'https://linkedin.com/in/nadia',
              source_signal_id: null,
              account_name: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const fil = await lireFil(ctx, { filId: '11111111-1111-1111-1111-111111111111' });
    expect(fil.canal).toBe('linkedin');
    // Canal non-email : impossible de répondre depuis l'application, quel que soit l'historique de messages.
    expect(fil.reponsePossible).toBe(false);
    expect(fil.raisonReponseImpossible).toBe('reception.fil.raisonReponseImpossible.canalNonEmail');
  });

  it('reponsePossible à false avec la raison quand aucun message entrant', async () => {
    const { ctx } = contexteCapturant(({ text }) => {
      if (text.includes('jr:fil_entete')) {
        return {
          rows: [
            {
              id: 'fil-1',
              contact_id: null,
              channel: 'email',
              interest: null,
              handled_at: null,
              first_name: null,
              last_name: null,
              job_title: null,
              email: null,
              email_status: null,
              linkedin_url: null,
              source_signal_id: null,
              account_name: null,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
    const fil = await lireFil(ctx, { filId: '11111111-1111-1111-1111-111111111111' });
    expect(fil.reponsePossible).toBe(false);
    expect(fil.raisonReponseImpossible).toBe('reception.fil.raisonReponseImpossible.messageOrigineInconnu');
    expect(fil.transportReponse).toBeNull();
    expect(fil.contact.nom).toBe('—');
    expect(fil.campagne).toBeNull();
    expect(fil.boite).toBeNull();
  });
});

describe('repondre', () => {
  function transportsFactices() {
    return { graph: vi.fn(async () => {}), salesblink: vi.fn(async () => ({ idTache: 'tache-1' })) };
  }

  it('refuse un rôle inférieur à operator', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }), 'viewer');
    await expect(repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'bonjour' }, transportsFactices())).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("fil non répondable (aucun message d'origine) : ErreurReponseImpossible, aucun insert ni événement", async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.trim().startsWith('select t.channel')) return { rows: [], rowCount: 0 };
      return undefined;
    });
    await expect(
      repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'bonjour' }, transportsFactices()),
    ).rejects.toBeInstanceOf(ErreurReponseImpossible);
    expect(appels.some((a) => a.text.trim().startsWith('insert into thread_messages'))).toBe(false);
    expect(appels.some((a) => a.text.trim().startsWith('insert into audit_events'))).toBe(false);
  });

  it("corps fait uniquement d'espaces : ErreurEntree, aucun appel à repondreAuFil (le trim porte sur le texte, pas la longueur brute)", async () => {
    const { ctx, appels } = contexteCapturant(() => undefined);
    await expect(
      repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: '   ' }, transportsFactices()),
    ).rejects.toBeInstanceOf(ErreurEntree);
    expect(appels).toHaveLength(0);
  });

  it("nominal : délègue à repondreAuFil (choix du transport, insert, update) PUIS journalise 'reply_sent'", async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.trim().startsWith('select t.channel')) {
        return { rows: [{ channel: 'email', transport: null, mailbox: null, salesblink_inbox_message_id: 'inbox-1' }], rowCount: 1 };
      }
      if (text.trim().startsWith('insert into thread_messages')) return { rows: [{ id: 'message-sortant-1' }], rowCount: 1 };
      if (text.trim().startsWith('update threads')) return { rows: [], rowCount: 1 };
      if (text.includes('jr:repondre_contact_pour_journal')) return { rows: [{ contact_id: 'contact-1' }], rowCount: 1 };
      if (text.trim().startsWith('insert into audit_events')) return { rows: [], rowCount: 1 };
      return undefined;
    });
    const transports = transportsFactices();
    const resultat = await repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'Bonjour Karim' }, transports);

    expect(resultat).toEqual({ messageId: 'message-sortant-1' });
    expect(transports.salesblink).toHaveBeenCalledWith('inbox-1', expect.any(String));

    const evenement = appels.find((a) => a.text.trim().startsWith('insert into audit_events'));
    expect(evenement).toBeDefined();
    expect(evenement!.values).toEqual(
      expect.arrayContaining(['org-1', 'user-1', 'contact', 'contact-1', 'reply_sent']),
    );

    // Ordre : le transport (donc l'insert du message sortant et la mise à jour du fil) avant le journal.
    const indexInsert = appels.findIndex((a) => a.text.trim().startsWith('insert into thread_messages'));
    const indexJournal = appels.findIndex((a) => a.text.trim().startsWith('insert into audit_events'));
    expect(indexInsert).toBeGreaterThanOrEqual(0);
    expect(indexJournal).toBeGreaterThan(indexInsert);
  });

  it('une erreur au moment de journaliser ne fait pas échouer une réponse déjà envoyée', async () => {
    const { ctx } = contexteCapturant(({ text }) => {
      if (text.trim().startsWith('select t.channel')) {
        return { rows: [{ channel: 'email', transport: null, mailbox: null, salesblink_inbox_message_id: 'inbox-1' }], rowCount: 1 };
      }
      if (text.trim().startsWith('insert into thread_messages')) return { rows: [{ id: 'message-sortant-1' }], rowCount: 1 };
      if (text.trim().startsWith('update threads')) return { rows: [], rowCount: 1 };
      if (text.includes('jr:repondre_contact_pour_journal')) return { rows: [{ contact_id: 'contact-1' }], rowCount: 1 };
      if (text.trim().startsWith('insert into audit_events')) throw new Error('panne du journal');
      return undefined;
    });
    await expect(
      repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'Bonjour Karim' }, transportsFactices()),
    ).resolves.toEqual({ messageId: 'message-sortant-1' });
  });

  it('après un envoi réussi, le fil est marqué traité (M2, revue finale du 17/09) — sinon il reste dans « À traiter »', async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.trim().startsWith('select t.channel')) {
        return { rows: [{ channel: 'email', transport: null, mailbox: null, salesblink_inbox_message_id: 'inbox-1' }], rowCount: 1 };
      }
      if (text.trim().startsWith('insert into thread_messages')) return { rows: [{ id: 'message-sortant-1' }], rowCount: 1 };
      if (text.trim().startsWith('update threads')) return { rows: [], rowCount: 1 };
      if (text.includes('jr:repondre_contact_pour_journal')) return { rows: [{ contact_id: 'contact-1' }], rowCount: 1 };
      if (text.trim().startsWith('insert into audit_events')) return { rows: [], rowCount: 1 };
      return undefined;
    });

    await repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'Bonjour Karim' }, transportsFactices());

    const marquage = appels.find((a) => a.text.includes('handled_at = now()'));
    expect(marquage).toBeDefined();
    expect(marquage!.values).toEqual(['11111111-1111-1111-1111-111111111111', 'org-1']);
  });

  it("fil non répondable : aucun envoi, donc jamais de marquage traité", async () => {
    const { ctx, appels } = contexteCapturant(({ text }) => {
      if (text.trim().startsWith('select t.channel')) return { rows: [], rowCount: 0 };
      return undefined;
    });
    await expect(
      repondre(ctx, { filId: '11111111-1111-1111-1111-111111111111', corps: 'bonjour' }, transportsFactices()),
    ).rejects.toBeInstanceOf(ErreurReponseImpossible);
    expect(appels.some((a) => a.text.includes('handled_at = now()'))).toBe(false);
  });
});

describe('marquerTraite', () => {
  it('refuse un rôle inférieur à operator', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }), 'viewer');
    await expect(marquerTraite(ctx, { filId: '11111111-1111-1111-1111-111111111111', traite: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('fil introuvable (mauvaise organisation) : ErreurIntrouvable', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await expect(marquerTraite(ctx, { filId: '11111111-1111-1111-1111-111111111111', traite: true })).rejects.toBeInstanceOf(ErreurIntrouvable);
  });

  it('traite: true pose handled_at à maintenant ; traite: false le remet à null (rouvre)', async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [{ id: 'fil-1' }], rowCount: 1 }));
    await marquerTraite(ctx, { filId: '11111111-1111-1111-1111-111111111111', traite: true });
    await marquerTraite(ctx, { filId: '11111111-1111-1111-1111-111111111111', traite: false });
    expect(appels[0]!.values).toEqual(['11111111-1111-1111-1111-111111111111', 'org-1', true]);
    expect(appels[1]!.values).toEqual(['11111111-1111-1111-1111-111111111111', 'org-1', false]);
  });
});

describe('marquerInteret', () => {
  it('refuse un rôle inférieur à operator', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }), 'viewer');
    await expect(marquerInteret(ctx, { filId: '11111111-1111-1111-1111-111111111111', interet: 'interested' })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it('fil introuvable : ErreurIntrouvable', async () => {
    const { ctx } = contexteCapturant(() => ({ rows: [], rowCount: 0 }));
    await expect(marquerInteret(ctx, { filId: '11111111-1111-1111-1111-111111111111', interet: 'interested' })).rejects.toBeInstanceOf(
      ErreurIntrouvable,
    );
  });

  it('accepte null (retire le marquage)', async () => {
    const { ctx, appels } = contexteCapturant(() => ({ rows: [{ id: 'fil-1' }], rowCount: 1 }));
    await marquerInteret(ctx, { filId: '11111111-1111-1111-1111-111111111111', interet: null });
    expect(appels[0]!.values).toEqual(['11111111-1111-1111-1111-111111111111', 'org-1', null]);
  });
});

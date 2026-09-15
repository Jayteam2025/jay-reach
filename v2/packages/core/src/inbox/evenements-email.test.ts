import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import type { EvenementEmail } from '../email-transport/rapports.js';
import { traiterEvenementEmail } from './evenements-email.js';

interface ReponsesFactices {
  contactExistant?: { id: string } | null;
}

function creerExecuteurFactice(reponses: ReponsesFactices): { ex: Executeur; appels: { text: string; values: unknown[] }[] } {
  const appels: { text: string; values: unknown[] }[] = [];
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      appels.push({ text, values });
      const t = text.trim();
      if (t.startsWith('select id from contacts')) {
        const trouve = reponses.contactExistant ?? null;
        return { rows: (trouve ? [trouve] : []) as T[], rowCount: trouve ? 1 : 0 };
      }
      if (t.startsWith('select id from threads')) return { rows: [] as T[], rowCount: 0 };
      if (t.startsWith('insert into threads')) return { rows: [{ id: 'thread-nouveau' }] as T[], rowCount: 1 };
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { ex, appels };
}

const REBOND: EvenementEmail = { type: 'rebond', email: 'marie@exemple.fr', aMs: 1000 };
const REPONDU: EvenementEmail = { type: 'repondu', email: 'marie@exemple.fr', corps: 'Merci, on se rappelle.', messageId: null, aMs: 1000 };
const ENVOYE: EvenementEmail = { type: 'envoye', email: 'marie@exemple.fr', sequenceId: 'seq-1', messageId: null, aMs: 1000 };
const ERREUR: EvenementEmail = { type: 'erreur', email: 'marie@exemple.fr', sequenceId: 'seq-1', motif: 'panne', aMs: 1000 };

describe('traiterEvenementEmail', () => {
  it('contact inconnu → rien de stocké', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: null });
    const resultat = await traiterEvenementEmail(ex, 'org-1', REBOND, 'SalesBlink');
    expect(resultat).toEqual({ stored: false, reason: 'unknown_contact' });
    expect(appels.some((a) => a.text.includes('insert into suppressions'))).toBe(false);
  });

  it('rebond → suppression puis arrêt d’inscription (deux requêtes)', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const resultat = await traiterEvenementEmail(ex, 'org-1', REBOND, 'SalesBlink');
    expect(resultat).toEqual({ stored: true, effect: 'bounce' });
    const ecritures = appels.filter((a) => a.text.includes('insert into suppressions') || a.text.includes('update enrollments'));
    expect(ecritures).toHaveLength(2);
  });

  it('désinscrit → suppression puis arrêt d’inscription', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const resultat = await traiterEvenementEmail(ex, 'org-1', { type: 'desinscrit', email: 'marie@exemple.fr', aMs: 1 }, 'SalesBlink');
    expect(resultat).toEqual({ stored: true, effect: 'unsubscribe' });
    expect(appels.some((a) => a.text.includes('insert into suppressions'))).toBe(true);
    expect(appels.some((a) => a.text.includes('update enrollments'))).toBe(true);
  });

  it('répondu → recordInboundReply est appelé (fil créé, message inséré)', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const resultat = await traiterEvenementEmail(ex, 'org-1', REPONDU, 'SalesBlink');
    expect(resultat.stored).toBe(true);
    expect((resultat as { effect: string }).effect).toBe('reply');
    expect(appels.some((a) => a.text.includes('insert into thread_messages'))).toBe(true);
    expect(appels.some((a) => a.text.includes('insert into notifications'))).toBe(true);
  });

  it('répondu avec sujet (tâche 10) : passe par headers sans changer la classification', async () => {
    const { ex } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const repondu: EvenementEmail = { ...REPONDU, sujet: 'Re: Prise de contact' };
    const resultat = await traiterEvenementEmail(ex, 'org-1', repondu, 'SalesBlink');
    expect(resultat.stored).toBe(true);
    expect((resultat as { effect: string; classification: string }).classification).toBe('human_reply');
  });

  it('répondu avec headers (lot 3 bis, Graph) : priment sur sujet et sont transmis tels quels', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const repondu: EvenementEmail = {
      ...REPONDU,
      sujet: 'Re: Prise de contact',
      headers: { transport: 'microsoft_graph', mailbox: 'ventes@exemple.fr', graph_message_id: 'msg-1' },
    };
    const resultat = await traiterEvenementEmail(ex, 'org-1', repondu, 'microsoft_graph');
    expect(resultat.stored).toBe(true);
    const insertion = appels.find((a) => a.text.includes('insert into thread_messages'));
    expect(insertion).toBeDefined();
    const headersEcrits = JSON.parse(insertion!.values[3] as string) as Record<string, string>;
    expect(headersEcrits).toEqual({ transport: 'microsoft_graph', mailbox: 'ventes@exemple.fr', graph_message_id: 'msg-1' });
  });

  it('répondu : le message est horodaté à sa réception réelle, pas à l’instant de la relève', async () => {
    const { ex, appels } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const recuA = Date.parse('2026-09-15T08:30:00.000Z');
    const repondu: EvenementEmail = { ...REPONDU, aMs: recuA };

    await traiterEvenementEmail(ex, 'org-1', repondu, 'microsoft_graph');

    const insertion = appels.find((a) => a.text.includes('insert into thread_messages'));
    expect(insertion).toBeDefined();
    // `sent_at` est le dernier paramètre de l'insert. La relève SalesBlink
    // détecte une réponse des heures après sa réception : l'horodater à
    // l'instant du passage fausse l'ordre du fil et le choix du transport,
    // qui prend le dernier message reçu.
    expect(insertion!.values[5]).toBe(new Date(recuA).toISOString());
  });

  it('répondu avec headers d’auto-réponse (Graph) : change la classification, contrairement à sujet seul', async () => {
    const { ex } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const repondu: EvenementEmail = {
      ...REPONDU,
      headers: { transport: 'microsoft_graph', 'auto-submitted': 'auto-replied' },
    };
    const resultat = await traiterEvenementEmail(ex, 'org-1', repondu, 'microsoft_graph');
    expect((resultat as { effect: string; classification: string }).classification).toBe('auto_absence');
  });

  it('envoyé → ignoré (traité par la relève, pas ici)', async () => {
    const { ex } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const resultat = await traiterEvenementEmail(ex, 'org-1', ENVOYE, 'SalesBlink');
    expect(resultat).toEqual({ stored: false, reason: 'ignored' });
  });

  it('erreur → ignoré (traité par la relève, pas ici)', async () => {
    const { ex } = creerExecuteurFactice({ contactExistant: { id: 'contact-1' } });
    const resultat = await traiterEvenementEmail(ex, 'org-1', ERREUR, 'SalesBlink');
    expect(resultat).toEqual({ stored: false, reason: 'ignored' });
  });
});

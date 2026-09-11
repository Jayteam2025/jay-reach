import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import { LIVE_STATUSES, notifier, notifyReply, recordInboundReply } from './record-reply.js';

interface ReponsesFactices {
  threadExistant?: { id: string } | null;
  messageDejaConnu?: { id: string } | null;
  filDuMessageConnu?: { id: string } | null;
}

/** Exécuteur factice qui enregistre chaque requête et répond selon des scénarios déclarés à l'avance. */
function creerExecuteurFactice(reponses: ReponsesFactices): { ex: Executeur; appels: { text: string; values: unknown[] }[] } {
  const appels: { text: string; values: unknown[] }[] = [];
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      appels.push({ text, values });
      const t = text.trim();
      if (t.startsWith('select m.id from thread_messages')) {
        const trouve = reponses.messageDejaConnu ?? null;
        return { rows: (trouve ? [trouve] : []) as T[], rowCount: trouve ? 1 : 0 };
      }
      if (t.startsWith('select thread_id as id from thread_messages')) {
        const trouve = reponses.filDuMessageConnu ?? null;
        return { rows: (trouve ? [trouve] : []) as T[], rowCount: trouve ? 1 : 0 };
      }
      if (t.startsWith('select id from threads')) {
        const trouve = reponses.threadExistant ?? null;
        return { rows: (trouve ? [trouve] : []) as T[], rowCount: trouve ? 1 : 0 };
      }
      if (t.startsWith('insert into threads')) {
        return { rows: [{ id: 'thread-nouveau' }] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { ex, appels };
}

describe('recordInboundReply', () => {
  it('crée un fil, enregistre le message et arrête la séquence pour une réponse humaine', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    const resultat = await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Bonjour, merci pour votre message, on se rappelle la semaine prochaine.',
    });

    expect(resultat.isNew).toBe(true);
    expect(resultat.classification).toBe('human_reply');
    expect(resultat.threadId).toBe('thread-nouveau');
    expect(appels.some((a) => a.text.includes('insert into thread_messages'))).toBe(true);
    expect(appels.some((a) => a.text.includes('update enrollments'))).toBe(true);
    expect(appels.some((a) => a.text.includes('insert into outcomes'))).toBe(true);
  });

  it('un message déjà connu ne réinsère rien et renvoie isNew: false', async () => {
    const { ex, appels } = creerExecuteurFactice({
      messageDejaConnu: { id: 'msg-1' },
      filDuMessageConnu: { id: 'thread-existant' },
    });
    const resultat = await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Bonjour',
      providerMessageId: 'ext-123',
    });

    expect(resultat).toEqual({ threadId: 'thread-existant', classification: 'human_reply', isNew: false });
    expect(appels.some((a) => a.text.includes('insert into thread_messages'))).toBe(false);
  });
});

describe('notifyReply', () => {
  it('insère une notification pour l’organisation avec l’événement contact.replied', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await notifyReply(ex, 'org-1', 'Nouvelle réponse', 'Extrait du message');

    expect(appels).toHaveLength(1);
    expect(appels[0]!.text).toContain('insert into notifications');
    expect(appels[0]!.values).toEqual(['org-1', JSON.stringify({ title: 'Nouvelle réponse', body: 'Extrait du message' }), 'contact.replied']);
  });
});

describe('notifier', () => {
  it('insère une notification avec l’événement fourni, distinct de contact.replied', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await notifier(ex, 'org-1', 'sender.disconnected', 'Expéditeur email déconnecté', 'expediteur@exemple.fr');

    expect(appels).toHaveLength(1);
    expect(appels[0]!.values[2]).toBe('sender.disconnected');
  });
});

describe('LIVE_STATUSES', () => {
  it('couvre les statuts qu’une réponse peut encore interrompre', () => {
    expect(LIVE_STATUSES).toContain('active');
    expect(LIVE_STATUSES).toContain('paused');
  });
});

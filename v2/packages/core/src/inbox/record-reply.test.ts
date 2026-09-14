import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import { LIVE_STATUSES, REPLY_STATUSES, assurerFil, notifier, notifyReply, recordInboundReply } from './record-reply.js';

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

  it('une réponse humaine passe aussi une inscription completed en replied (décision 3)', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Bonjour, merci pour votre message, on se rappelle la semaine prochaine.',
    });

    const maj = appels.find((a) => a.text.includes('update enrollments'));
    expect(maj).toBeDefined();
    expect(maj!.text).toContain(REPLY_STATUSES);
    expect(REPLY_STATUSES).toContain('completed');
  });

  it('une absence automatique reste sur LIVE_STATUSES (ne rouvre pas une inscription completed)', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    const resultat = await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Je suis actuellement en congés, de retour le 20.',
    });

    expect(resultat.classification).toBe('auto_absence');
    const maj = appels.find((a) => a.text.includes('update enrollments'));
    expect(maj).toBeDefined();
    expect(maj!.text).toContain(LIVE_STATUSES);
    expect(maj!.text).not.toContain('completed');
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

describe('assurerFil', () => {
  it('un fil créé pour un envoi sortant naît lu (fix round 2)', async () => {
    const { ex, appels } = creerExecuteurFactice({});

    const threadId = await assurerFil(ex, 'org-1', 'contact-1', 'email');

    expect(threadId).toBe('thread-nouveau');
    const insertion = appels.find((a) => a.text.includes('insert into threads'));
    expect(insertion).toBeDefined();
    expect(insertion!.values).toEqual(['org-1', 'contact-1', 'email']);
    expect(insertion!.text).toContain('now(), true');
  });

  it('un fil déjà existant est renvoyé tel quel, sans être reclassé ni marqué non lu', async () => {
    const { ex, appels } = creerExecuteurFactice({ threadExistant: { id: 'thread-existant' } });

    const threadId = await assurerFil(ex, 'org-1', 'contact-1', 'email');

    expect(threadId).toBe('thread-existant');
    expect(appels.some((a) => a.text.includes('update threads'))).toBe(false);
  });
});

describe('LIVE_STATUSES', () => {
  it('couvre les statuts qu’une réponse peut encore interrompre', () => {
    expect(LIVE_STATUSES).toContain('active');
    expect(LIVE_STATUSES).toContain('paused');
  });
});

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

  it('headers (tâche 10, par exemple le sujet) est persisté dans thread_messages.headers', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Merci pour votre message.',
      headers: { subject: 'Re: Prise de contact' },
    });

    const insertion = appels.find((a) => a.text.includes('insert into thread_messages'));
    expect(insertion).toBeDefined();
    expect(insertion!.text).toContain('headers');
    expect(JSON.parse(insertion!.values[3] as string)).toEqual({ subject: 'Re: Prise de contact' });
  });

  it('sans headers, thread_messages.headers reste NULL (pas la chaîne "null")', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Merci pour votre message.',
    });

    const insertion = appels.find((a) => a.text.includes('insert into thread_messages'));
    expect(insertion!.values[3]).toBeNull();
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

  it(
    'une réponse humaine marque skipped les actions encore scheduled de l’inscription ' +
      '(le balayage de rejeu ne les reprendrait plus jamais)',
    async () => {
      const { ex, appels } = creerExecuteurFactice({});
      await recordInboundReply(ex, 'org-1', {
        contactId: 'contact-1',
        channel: 'email',
        body: 'Bonjour, merci pour votre message, on se rappelle la semaine prochaine.',
      });

      const maj = appels.find((a) => a.text.includes("update actions set status = 'skipped'"));
      expect(maj).toBeDefined();
      expect(maj!.values).toEqual(['org-1', 'contact-1']);
      expect(maj!.text).toContain('enrollment_inactive');
    },
  );

  it('une absence automatique ne touche pas aux actions scheduled (l’inscription reste vivante)', async () => {
    const { ex, appels } = creerExecuteurFactice({});
    await recordInboundReply(ex, 'org-1', {
      contactId: 'contact-1',
      channel: 'email',
      body: 'Je suis actuellement en congés, de retour le 20.',
    });

    expect(appels.some((a) => a.text.includes("update actions set status = 'skipped'"))).toBe(false);
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

/**
 * Exécuteur factice à mémoire : il garde les messages réellement insérés et
 * évalue la garde de dédoublonnage sur ses PARAMÈTRES (organisation, liste
 * d'identifiants connus, `internet_message_id`, `salesblink_reply_id`), pas
 * sur le texte SQL. Deux appels successifs de `recordInboundReply` se
 * comportent donc comme deux passages de relève sur la même base — ce que le
 * scénario « la même réponse détectée par Graph puis par SalesBlink »
 * demande, et qu'un exécuteur à réponses figées ne sait pas jouer.
 */
function creerBaseFactice(): { ex: Executeur; messages: { providerMessageId: string | null; headers: Record<string, unknown> | null }[] } {
  const messages: { providerMessageId: string | null; headers: Record<string, unknown> | null }[] = [];
  let prochainFil = 0;
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      const t = text.trim();
      if (t.startsWith('select m.id from thread_messages')) {
        const identifiants = (values[1] as string[]) ?? [];
        const internetMessageId = (values[2] as string | null) ?? null;
        const salesblinkReplyId = (values[3] as string | null) ?? null;
        const trouve = messages.find((m) => {
          if (m.providerMessageId !== null && identifiants.includes(m.providerMessageId)) return true;
          if (internetMessageId !== null && m.headers?.internet_message_id === internetMessageId) return true;
          if (salesblinkReplyId !== null && m.headers?.salesblink_reply_id === salesblinkReplyId) return true;
          return false;
        });
        return { rows: (trouve ? [{ id: 'message-connu' }] : []) as T[], rowCount: trouve ? 1 : 0 };
      }
      if (t.startsWith('select thread_id as id from thread_messages')) {
        return { rows: [{ id: 'thread-1' }] as T[], rowCount: 1 };
      }
      if (t.startsWith('select id from threads')) {
        return prochainFil > 0
          ? { rows: [{ id: 'thread-1' }] as T[], rowCount: 1 }
          : { rows: [] as T[], rowCount: 0 };
      }
      if (t.startsWith('insert into threads')) {
        prochainFil += 1;
        return { rows: [{ id: 'thread-1' }] as T[], rowCount: 1 };
      }
      if (t.startsWith('insert into thread_messages')) {
        const brut = values[3] as string | null;
        messages.push({
          providerMessageId: (values[2] as string | null) ?? null,
          headers: brut ? (JSON.parse(brut) as Record<string, unknown>) : null,
        });
        return { rows: [] as T[], rowCount: 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { ex, messages };
}

describe('recordInboundReply — une réponse détectée deux fois ne fait qu’un message', () => {
  const base = { contactId: 'contact-1', channel: 'email' as const, body: 'Bonjour, on peut en parler jeudi ?' };

  it('Graph puis SalesBlink : SalesBlink retrouve le message par salesblink_inbox_message_id', async () => {
    const { ex, messages } = creerBaseFactice();
    await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'graph-msg-1',
      headers: { transport: 'microsoft_graph', graph_message_id: 'graph-msg-1', internet_message_id: '<abc@exemple.fr>' },
    });
    const second = await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-1',
      headers: { subject: 'Re: bonjour', salesblink_reply_id: 'r-1', salesblink_inbox_message_id: 'graph-msg-1' },
    });

    expect(second.isNew).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('SalesBlink puis Graph : Graph retrouve le message déjà écrit sous l’identifiant de la tâche', async () => {
    const { ex, messages } = creerBaseFactice();
    await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-1',
      headers: { subject: 'Re: bonjour', salesblink_reply_id: 'r-1', salesblink_inbox_message_id: 'inbox-1' },
    });
    const second = await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-1',
      headers: { transport: 'microsoft_graph', graph_message_id: 'inbox-1', internet_message_id: '<abc@exemple.fr>' },
    });

    expect(second.isNew).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('SalesBlink sans tâche appariée puis avec : le même salesblink_reply_id suffit', async () => {
    const { ex, messages } = creerBaseFactice();
    // Premier passage : aucune tâche /inbox appariée, l'identifiant du journal fait office de repli.
    await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'r-1',
      headers: { subject: null, salesblink_reply_id: 'r-1', salesblink_inbox_message_id: null },
    });
    // Passage suivant : la tâche est arrivée, l'identifiant change — seul `salesblink_reply_id` rapproche les deux.
    const second = await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-1',
      headers: { subject: 'Re: bonjour', salesblink_reply_id: 'r-1', salesblink_inbox_message_id: 'inbox-1' },
    });

    expect(second.isNew).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('deux passages Graph sur le même message : le même internet_message_id suffit', async () => {
    const { ex, messages } = creerBaseFactice();
    await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'graph-msg-1',
      headers: { transport: 'microsoft_graph', graph_message_id: 'graph-msg-1', internet_message_id: '<abc@exemple.fr>' },
    });
    // Même message, identifiant Graph différent (boîte archivée puis relue) : l'en-tête Internet fait foi.
    const second = await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'graph-msg-2',
      headers: { transport: 'microsoft_graph', graph_message_id: 'graph-msg-2', internet_message_id: '<abc@exemple.fr>' },
    });

    expect(second.isNew).toBe(false);
    expect(messages).toHaveLength(1);
  });

  it('deux réponses distinctes du même contact restent deux messages', async () => {
    const { ex, messages } = creerBaseFactice();
    await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-1',
      headers: { salesblink_reply_id: 'r-1', salesblink_inbox_message_id: 'inbox-1' },
    });
    const second = await recordInboundReply(ex, 'org-1', {
      ...base,
      providerMessageId: 'inbox-2',
      headers: { salesblink_reply_id: 'r-2', salesblink_inbox_message_id: 'inbox-2' },
    });

    expect(second.isNew).toBe(true);
    expect(messages).toHaveLength(2);
  });

  it('sans aucun identifiant connu, aucune requête de dédoublonnage n’est faite', async () => {
    const { ex } = creerBaseFactice();
    const appels: string[] = [];
    const espion: Executeur = {
      async query(text, values) {
        appels.push(text.trim());
        return ex.query(text, values);
      },
    };
    const resultat = await recordInboundReply(espion, 'org-1', { ...base });

    expect(resultat.isNew).toBe(true);
    expect(appels.some((t) => t.startsWith('select m.id from thread_messages'))).toBe(false);
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

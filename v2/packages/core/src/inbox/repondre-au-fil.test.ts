import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ErreurEntree, choisirTransport, repondreAuFil, texteVersHtml } from './repondre-au-fil.js';

interface LigneDernierEntrant {
  transport?: string | null;
  mailbox?: string | null;
  graph_message_id?: string | null;
  provider_message_id?: string | null;
  salesblink_inbox_message_id?: string | null;
  salesblink_reply_id?: string | null;
  /** Canal du fil. Email par défaut : c'est le seul cas que la plupart des scénarios veulent décrire. */
  channel?: string;
}

/** Exécuteur factice : le dernier message entrant du fil est déclaré à l'avance. */
function creerExecuteurFactice(
  dernierEntrant: LigneDernierEntrant | null,
  options: { rowCountUpdate?: number } = {},
): { ex: Executeur; appels: { text: string; values: unknown[] }[] } {
  const appels: { text: string; values: unknown[] }[] = [];
  const ligne = dernierEntrant ? { channel: 'email', ...dernierEntrant } : null;
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      appels.push({ text, values });
      const t = text.trim();
      if (t.startsWith('select t.channel')) {
        return { rows: (ligne ? [ligne] : []) as T[], rowCount: ligne ? 1 : 0 };
      }
      if (t.startsWith('insert into thread_messages')) {
        return { rows: [{ id: 'message-sortant-1' }] as T[], rowCount: 1 };
      }
      if (t.startsWith('update threads')) {
        return { rows: [] as T[], rowCount: options.rowCountUpdate ?? 1 };
      }
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { ex, appels };
}

function creerTransportsFactices() {
  return {
    graph: vi.fn(async () => {}),
    salesblink: vi.fn(async () => ({ idTache: 'tache-1' })),
  };
}

describe('choisirTransport', () => {
  it("renvoie null quand le fil n'a aucun message entrant", async () => {
    const { ex } = creerExecuteurFactice(null);
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).resolves.toBeNull();
  });

  it('microsoft_graph : lit la boîte et l’identifiant Graph dans les en-têtes', async () => {
    const { ex } = creerExecuteurFactice({
      transport: 'microsoft_graph',
      mailbox: 'contact@exemple.fr',
      graph_message_id: 'graph-msg-1',
    });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).resolves.toEqual({
      transport: 'microsoft_graph',
      messageId: 'graph-msg-1',
      mailbox: 'contact@exemple.fr',
    });
  });

  it("salesblink : lit provider_message_id quand les en-têtes ne portent pas d'origine Graph", async () => {
    const { ex } = creerExecuteurFactice({ provider_message_id: 'sb-msg-1' });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).resolves.toEqual({
      transport: 'salesblink',
      messageId: 'sb-msg-1',
      mailbox: null,
    });
  });

  it('salesblink sans provider_message_id : ErreurEntree', async () => {
    const { ex } = creerExecuteurFactice({ provider_message_id: null });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).rejects.toBeInstanceOf(ErreurEntree);
  });

  it("salesblink : l'identifiant de la tâche /inbox prime sur provider_message_id", async () => {
    const { ex } = creerExecuteurFactice({
      provider_message_id: 'inbox-1',
      salesblink_inbox_message_id: 'inbox-1',
      salesblink_reply_id: 'r-1',
    });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).resolves.toEqual({
      transport: 'salesblink',
      messageId: 'inbox-1',
      mailbox: null,
    });
  });

  it("fil LinkedIn : ErreurEntree, la réponse depuis Jay Reach n'existe que pour l'email", async () => {
    const { ex } = creerExecuteurFactice({ channel: 'linkedin_message', provider_message_id: 'li-msg-1' });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).rejects.toBeInstanceOf(ErreurEntree);
  });

  it("salesblink : sans tâche /inbox appariée, provider_message_id n'est que l'identifiant du journal → ErreurEntree", async () => {
    const { ex } = creerExecuteurFactice({
      provider_message_id: 'r-1',
      salesblink_inbox_message_id: null,
      salesblink_reply_id: 'r-1',
    });
    await expect(choisirTransport(ex, 'org-1', 'fil-1')).rejects.toBeInstanceOf(ErreurEntree);
  });
});

describe('repondreAuFil', () => {
  it("fil sans message entrant : ErreurEntree, aucun insert ni transport appelé", async () => {
    const { ex, appels } = creerExecuteurFactice(null);
    const transports = creerTransportsFactices();

    await expect(
      repondreAuFil(ex, 'org-1', { threadId: 'fil-1', corpsHtml: '<p>Bonjour</p>' }, transports),
    ).rejects.toBeInstanceOf(ErreurEntree);

    expect(appels.some((a) => a.text.trim().startsWith('insert into thread_messages'))).toBe(false);
    expect(transports.graph).not.toHaveBeenCalled();
    expect(transports.salesblink).not.toHaveBeenCalled();
  });

  it('fil LinkedIn : ErreurEntree, aucun transport appelé, aucun insert', async () => {
    const { ex, appels } = creerExecuteurFactice({ channel: 'linkedin_message', provider_message_id: 'li-msg-1' });
    const transports = creerTransportsFactices();

    await expect(
      repondreAuFil(ex, 'org-1', { threadId: 'fil-1', corpsHtml: '<p>Bonjour</p>' }, transports),
    ).rejects.toBeInstanceOf(ErreurEntree);

    expect(transports.graph).not.toHaveBeenCalled();
    expect(transports.salesblink).not.toHaveBeenCalled();
    expect(appels.some((a) => a.text.trim().startsWith('insert into thread_messages'))).toBe(false);
  });

  it('message entrant Graph : transport graph appelé avec la boîte et l’id, insert marqué microsoft_graph, update vérifié', async () => {
    const { ex, appels } = creerExecuteurFactice({
      transport: 'microsoft_graph',
      mailbox: 'contact@exemple.fr',
      graph_message_id: 'graph-msg-1',
    });
    const transports = creerTransportsFactices();

    const resultat = await repondreAuFil(ex, 'org-1', { threadId: 'fil-1', corpsHtml: '<p>Bonjour</p>' }, transports);

    expect(transports.graph).toHaveBeenCalledWith('contact@exemple.fr', 'graph-msg-1', '<p>Bonjour</p>');
    expect(transports.salesblink).not.toHaveBeenCalled();
    expect(resultat).toEqual({ messageId: 'message-sortant-1', transport: 'microsoft_graph' });

    const insertion = appels.find((a) => a.text.trim().startsWith('insert into thread_messages'));
    expect(insertion).toBeTruthy();
    expect(insertion!.values).toContain(null); // provider_message_id : rien côté Graph
    expect(String(insertion!.values.find((v) => typeof v === 'string' && v.includes('microsoft_graph')))).toContain(
      'microsoft_graph',
    );

    const maj = appels.find((a) => a.text.trim().startsWith('update threads'));
    expect(maj).toBeTruthy();
    expect(maj!.values).toEqual(['fil-1', 'org-1']);
  });

  it('message entrant SalesBlink : transport salesblink appelé, provider_message_id = idTache', async () => {
    const { ex, appels } = creerExecuteurFactice({ provider_message_id: 'sb-msg-1' });
    const transports = creerTransportsFactices();

    const resultat = await repondreAuFil(ex, 'org-1', { threadId: 'fil-1', corpsHtml: '<p>Bonjour</p>' }, transports);

    expect(transports.salesblink).toHaveBeenCalledWith('sb-msg-1', '<p>Bonjour</p>');
    expect(transports.graph).not.toHaveBeenCalled();
    expect(resultat).toEqual({ messageId: 'message-sortant-1', transport: 'salesblink' });

    const insertion = appels.find((a) => a.text.trim().startsWith('insert into thread_messages'));
    expect(insertion!.values).toContain('tache-1');
  });

  it("l'update threads qui ne touche pas exactement une ligne fait échouer la réponse", async () => {
    const { ex } = creerExecuteurFactice({ provider_message_id: 'sb-msg-1' }, { rowCountUpdate: 0 });
    const transports = creerTransportsFactices();

    await expect(
      repondreAuFil(ex, 'org-1', { threadId: 'fil-1', corpsHtml: '<p>Bonjour</p>' }, transports),
    ).rejects.toThrow();
  });
});

describe('texteVersHtml', () => {
  it('échappe < et &', () => {
    expect(texteVersHtml('Bonjour <toi> & bienvenue')).toContain('&lt;toi&gt;');
    expect(texteVersHtml('Bonjour <toi> & bienvenue')).toContain('&amp;');
    expect(texteVersHtml('Bonjour <toi> & bienvenue')).not.toContain('<toi>');
  });

  it('une ligne vide sépare deux paragraphes, un simple retour devient <br>', () => {
    expect(texteVersHtml('Ligne 1\nLigne 2\n\nLigne 3')).toBe('<p>Ligne 1<br>Ligne 2</p><p>Ligne 3</p>');
  });
});

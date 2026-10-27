import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';

// `classifyReply` ne rend jamais `auto_other` ni `unclassified` aujourd'hui (une réponse non reconnue
// vaut `human_reply`) : la seule façon de prouver que ces classes n'excluent pas est d'imposer la
// classification. Le harnais Postgres ne le peut pas, faute de point d'injection.
const classification = vi.hoisted(() => ({ valeur: 'auto_other' }));
vi.mock('./classify.js', () => ({ classifyReply: () => ({ classification: classification.valeur }) }));

const { recordInboundReply } = await import('./record-reply.js');

describe('recordInboundReply : auto_other et réponse non classée n’excluent pas', () => {
  it.each(['auto_other', 'unclassified'])('%s : fil et message enregistrés, aucune exclusion, séquence intacte', async (valeur) => {
    classification.valeur = valeur;
    const appels: string[] = [];
    const ex: Executeur = {
      async query<T>(text: string) {
        appels.push(text);
        if (text.trim().startsWith('insert into threads')) return { rows: [{ id: 'fil-1' }] as T[], rowCount: 1 };
        return { rows: [] as T[], rowCount: 0 };
      },
    };
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'Ceci est un message automatique.' });
    expect(r).toMatchObject({ classification: valeur, isNew: true });
    expect(appels.some((t) => t.includes('insert into thread_messages'))).toBe(true);
    expect(appels.some((t) => t.includes('do_not_contact') || t.includes('suppressions') || t.includes('exclusion_reponse'))).toBe(false);
    expect(appels.some((t) => t.includes('update enrollments'))).toBe(false);
  });
});

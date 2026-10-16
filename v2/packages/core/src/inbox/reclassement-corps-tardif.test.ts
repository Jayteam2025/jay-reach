import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import { recordInboundReply } from './record-reply.js';
import { rejouerClassement } from './rejouer-classement.js';

type Rep = { rows: unknown[]; rowCount: number };
const vide: Rep = { rows: [], rowCount: 0 };

/** Fausse base : `repondre` répond par préfixe de requête, tout le reste est consigné et vide. */
function faux(repondre: (t: string) => Rep | undefined) {
  const appels: string[] = [];
  const ex: Executeur = {
    async query<T>(text: string) {
      const t = text.trim();
      appels.push(t);
      return (repondre(t) ?? vide) as { rows: T[]; rowCount: number | null };
    },
  };
  const ecritures = () => appels.filter((t) => /^(update|insert|delete)/.test(t));
  return { ex, appels, ecritures };
}

const CONNU = (t: string): Rep | undefined =>
  t.startsWith('select m.id from thread_messages')
    ? { rows: [{ id: 'm-1' }], rowCount: 1 }
    : t.startsWith('select thread_id as id')
      ? { rows: [{ id: 'f-1' }], rowCount: 1 }
      : undefined;

function etat(o: { corpsVide: boolean; classification?: string; dernier?: boolean }) {
  return (t: string): Rep | undefined => {
    if (t.includes('as vide')) return { rows: [{ vide: o.corpsVide }], rowCount: 1 };
    if (t.includes('as corps_vide')) {
      return {
        rows: [{ contact_id: 'c-1', classification: o.classification ?? 'auto_absence', corps_vide: o.corpsVide, est_dernier: o.dernier ?? true }],
        rowCount: 1,
      };
    }
    return CONNU(t);
  };
}

const AUTO = { 'auto-submitted': 'auto-replied' };

describe('recordInboundReply : le corps arrive après le message', () => {
  it('un départ d’entreprise arrivé sans corps puis avec : fil reclassé, séquence arrêtée', async () => {
    const { ex, appels } = faux(etat({ corpsVide: true }));
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'I am no longer with Pluxee.', providerMessageId: 'p-1', headers: AUTO });
    expect(r).toMatchObject({ isNew: false, classification: 'auto_left_company', threadId: 'f-1', reclasse: true });
    expect(appels.some((t) => t.startsWith('update thread_messages set body'))).toBe(true);
    expect(appels.some((t) => t.startsWith('update threads set classification'))).toBe(true);
    expect(appels.some((t) => t.includes("set status = 'stopped', stop_reason = 'contact_left'"))).toBe(true);
    expect(appels.some((t) => t.includes('insert into thread_messages'))).toBe(false);
  });

  it('une réponse humaine retrouvée exclut le contact', async () => {
    const { ex, appels } = faux(etat({ corpsVide: true }));
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'Oui, rappelez-moi demain.', providerMessageId: 'p-1' });
    expect(r).toMatchObject({ classification: 'human_reply', reclasse: true });
    expect(appels.some((t) => t.includes('jr:exclusion_reponse_contact'))).toBe(true);
  });

  it('un corps déjà stocké : rien n’est réécrit', async () => {
    const { ex, ecritures } = faux(etat({ corpsVide: false }));
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'I am no longer with Pluxee.', providerMessageId: 'p-1', headers: AUTO });
    expect(r.isNew).toBe(false);
    expect(ecritures()).toEqual([]);
  });

  it('un corps vide apporté : on ne cherche même pas', async () => {
    const { ex, appels, ecritures } = faux(etat({ corpsVide: true }));
    await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: '   ', providerMessageId: 'p-1', headers: AUTO });
    expect(appels.some((t) => t.includes('as vide'))).toBe(false);
    expect(ecritures()).toEqual([]);
  });

  it('une classification qui ne change pas : le corps est complété, rien d’autre', async () => {
    const { ex, ecritures } = faux(etat({ corpsVide: true }));
    await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'Out of office until 12/11.', providerMessageId: 'p-1', headers: AUTO });
    expect(ecritures()).toEqual([expect.stringMatching(/^update thread_messages set body/)]);
  });

  it('un message qui n’est pas le dernier du fil : corps complété, fil intact', async () => {
    const { ex, ecritures } = faux(etat({ corpsVide: true, dernier: false }));
    await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'I am no longer with Pluxee.', providerMessageId: 'p-1', headers: AUTO });
    expect(ecritures()).toEqual([expect.stringMatching(/^update thread_messages set body/)]);
  });

  it('une réponse humaine déjà classée n’est jamais déclassée par un corps tardif', async () => {
    const { ex, ecritures } = faux(etat({ corpsVide: true, classification: 'human_reply' }));
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'c-1', channel: 'email', body: 'I am no longer with Pluxee.', providerMessageId: 'p-1' });
    expect(r.isNew).toBe(false);
    expect(ecritures().some((t) => t.startsWith('update threads'))).toBe(false);
  });
});

describe('rejouerClassement', () => {
  const FIL = { id: 'f-1', contact_id: 'c-1', classification: 'auto_absence', body: 'I am no longer with Pluxee.', headers: AUTO, sent_at: new Date('2026-10-01') };
  const base = (fils: unknown[]) => (t: string): Rep | undefined => {
    if (t.includes('from threads t')) return { rows: fils, rowCount: fils.length };
    if (t.includes('from contacts')) return { rows: [{ linkedin_url: null, linkedin_provider_id: null, status: 'active' }], rowCount: 1 };
    if (t.includes('jr:apercu_envois_annules')) return { rows: [{ n: 2 }], rowCount: 1 };
    if (t.includes('jr:apercu_sequences_arretees')) return { rows: [{ n: 1 }], rowCount: 1 };
    return undefined;
  };

  it('à blanc par défaut : compte-rendu complet, aucune écriture', async () => {
    const { ex, ecritures } = faux(base([FIL, { ...FIL, id: 'f-2', body: 'Oui, rappelez-moi.', headers: null }]));
    const r = await rejouerClassement(ex, 'org-1');
    expect(r).toEqual({ relus: 2, reclasses: 2, exclus: 1, envoisAnnules: 2, sequencesArretees: 1, notifications: 2, echecs: 0 });
    expect(ecritures()).toEqual([]);
  });

  it('appliqué : même compte-rendu, et le reclassement s’écrit', async () => {
    const { ex, ecritures } = faux(base([FIL, { ...FIL, id: 'f-2', body: 'Oui, rappelez-moi.', headers: null }]));
    const r = await rejouerClassement(ex, 'org-1', { appliquer: true });
    expect(r).toEqual({ relus: 2, reclasses: 2, exclus: 1, envoisAnnules: 2, sequencesArretees: 1, notifications: 2, echecs: 0 });
    expect(ecritures().filter((t) => t.startsWith('update threads set classification'))).toHaveLength(2);
  });

  it('un contact à deux fils n’est compté qu’une fois', async () => {
    const { ex } = faux(base([{ ...FIL, body: 'Oui.', headers: null }, { ...FIL, id: 'f-2', body: 'Oui.', headers: null }]));
    expect(await rejouerClassement(ex, 'org-1')).toMatchObject({ reclasses: 2, exclus: 1, envoisAnnules: 2, sequencesArretees: 1, notifications: 2 });
  });

  it('un fil dont la classification ne change pas n’est pas reclassé', async () => {
    const { ex, ecritures } = faux(base([{ ...FIL, body: 'Out of office until 12/11.' }]));
    expect(await rejouerClassement(ex, 'org-1', { appliquer: true })).toMatchObject({ relus: 1, reclasses: 0 });
    expect(ecritures()).toEqual([]);
  });

  it('un fil empoisonné est compté en échec, les suivants aboutissent, les compteurs survivent', async () => {
    const { ex } = faux((t) => {
      if (t.startsWith('update threads set classification') ) return undefined;
      return base([{ ...FIL, id: 'f-0' }, { ...FIL, id: 'f-1', contact_id: 'c-2' }])(t);
    });
    const empoisonne: Executeur = {
      async query<T>(text: string, values?: unknown[]) {
        if (text.trim().startsWith('update threads set classification') && values?.[0] === 'f-0') throw new Error('poison');
        return ex.query<T>(text, values);
      },
    };
    const r = await rejouerClassement(empoisonne, 'org-1', { appliquer: true });
    expect(r).toMatchObject({ relus: 2, reclasses: 1, echecs: 1, notifications: 1 });
  });
});

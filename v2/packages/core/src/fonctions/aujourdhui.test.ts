import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { lireAujourdhui } from './aujourdhui.js';

/** Même fabrique de contexte factice que plafonds.test.ts : un motif (regex) par requête attendue. */
function faux(rows: Record<string, unknown[]>): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };
}

describe('lireAujourdhui', () => {
  it('compte les fils à traiter et en garde un aperçu', async () => {
    const ctx = faux({
      'jr:threads_a_traiter': [
        { id: 't1', channel: 'email', classification: 'human_reply', last_message_at: '2026-09-14T09:22:00.000Z', first_name: 'Karim', last_name: 'Benali', job_title: 'Head of Sales', account_name: 'Woodpecker', dernier_message: 'On se cale jeudi ?' },
        { id: 't2', channel: 'linkedin_message', classification: 'unclassified', last_message_at: '2026-09-14T08:51:00.000Z', first_name: 'Claire', last_name: 'Moreau', job_title: null, account_name: null, dernier_message: 'Pas le bon moment' },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.aTraiter.total).toBe(2);
    expect(a.aTraiter.fils).toHaveLength(2);
    expect(a.aTraiter.fils[0]).toMatchObject({ id: 't1', contactNom: 'Karim Benali', canal: 'email', classification: 'human_reply' });
    expect(a.aTraiter.fils[1]).toMatchObject({ id: 't2', contactNom: 'Claire Moreau', canal: 'linkedin' });
  });

  it("calcule la dernière heure d'envoi dans le fuseau de l'organisation", async () => {
    const ctx = faux({
      'from organization_settings': [{ key: 'fuseau', value: 'Europe/Paris' }],
      'jr:file_du_jour': [
        { id: 'a1', dispatched_at: '2026-09-14T08:30:00.000Z', scheduled_for: null, dispatch_after: null, status: 'dispatched', channel: 'email', first_name: 'Claire', last_name: 'Moreau', campagne_nom: 'Directeur commercial', etape: 1, expediteur: 'a.declercq' },
        { id: 'a2', dispatched_at: '2026-09-14T10:05:00.000Z', scheduled_for: null, dispatch_after: null, status: 'dispatched', channel: 'email', first_name: 'Karim', last_name: 'Benali', campagne_nom: 'Directeur commercial', etape: 2, expediteur: 'alexandre' },
      ],
    });
    const a = await lireAujourdhui(ctx);
    // 2026-09-14T10:05:00Z est un lundi de septembre : Europe/Paris est alors en heure d'été (UTC+2) → 12:05.
    expect(a.fileDuJour.derniereHeure).toBe('12:05');
    expect(a.fileDuJour.dejaPartis).toBe(2);
    expect(a.fileDuJour.total).toBe(2);
  });

  it('lève une alerte moteur_silencieux quand le dernier tour date de plus de 15 minutes', async () => {
    const ctx = faux({
      'jr:engine_status': [{ version: 'abc', last_tick_at: new Date(Date.now() - 30 * 60_000).toISOString(), last_error: null }],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.moteur.enMarche).toBe(false);
    expect(a.alertes.some((al) => al.type === 'moteur_silencieux')).toBe(true);
  });

  it('ne lève pas d’alerte moteur_silencieux quand le dernier tour est récent', async () => {
    const ctx = faux({
      'jr:engine_status': [{ version: 'abc', last_tick_at: new Date(Date.now() - 60_000).toISOString(), last_error: null }],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.moteur.enMarche).toBe(true);
    expect(a.alertes.some((al) => al.type === 'moteur_silencieux')).toBe(false);
  });

  it("lève une alerte source_orpheline quand une source active n'alimente aucune campagne", async () => {
    const ctx = faux({ 'jr:sources_orphelines': [{ n: 1 }] });
    const a = await lireAujourdhui(ctx);
    expect(a.alertes.some((al) => al.type === 'source_orpheline')).toBe(true);
  });

  it("ne lève pas d'alerte source_orpheline quand toutes les sources actives alimentent une campagne", async () => {
    const ctx = faux({ 'jr:sources_orphelines': [{ n: 0 }] });
    const a = await lireAujourdhui(ctx);
    expect(a.alertes.some((al) => al.type === 'source_orpheline')).toBe(false);
  });

  it('reprend les campagnes de l’organisation avec leurs compteurs', async () => {
    const ctx = faux({
      'jr:campagnes_resume': [
        { id: 'c1', name: 'Directeur commercial', status: 'active', etapes: 4, boites: 3, sources: ['adzuna', 'francetravail'], qualifies: 412, en_sequence: 186, reponses: 9 },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.campagnes).toHaveLength(1);
    expect(a.campagnes[0]).toMatchObject({ id: 'c1', nom: 'Directeur commercial', statut: 'active', qualifies: 412, enSequence: 186, reponses: 9 });
    // Taux de réponse = réponses / qualifiés, arrondi à une décimale.
    expect(a.campagnes[0]?.tauxReponse).toBeCloseTo(2.2, 1);
  });

  it('renvoie une liste vide de campagnes sans compteur quand il n’y en a aucune', async () => {
    const a = await lireAujourdhui(faux({}));
    expect(a.campagnes).toEqual([]);
    expect(a.aTraiter).toEqual({ total: 0, fils: [] });
  });
});

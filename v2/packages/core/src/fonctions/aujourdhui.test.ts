import { describe, expect, it, vi } from 'vitest';
import type { Executeur } from '../executeur.js';
import { ForbiddenError } from '../roles.js';
import type { Contexte } from './contexte.js';
import { lireAujourdhui } from './aujourdhui.js';

/** Même fabrique de contexte factice que plafonds.test.ts : un motif (regex) par requête attendue. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'viewer'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

describe('lireAujourdhui', () => {
  it('refuse un contexte sans rôle', async () => {
    await expect(lireAujourdhui(faux({}, null))).rejects.toThrow(ForbiddenError);
  });

  it('compte les fils à traiter et en garde un aperçu', async () => {
    const ctx = faux({
      'jr:threads_a_traiter': [
        // `last_message_at` en objet Date (comme le renvoie pg pour ce timestamptz) : la forme
        // publique `FilResume.quand` doit ressortir en chaîne ISO, jamais l'objet lui-même.
        { id: 't1', channel: 'email', classification: 'human_reply', last_message_at: new Date('2026-09-14T09:22:00.000Z'), first_name: 'Karim', last_name: 'Benali', job_title: 'Head of Sales', account_name: 'Woodpecker', dernier_message: 'On se cale jeudi ?' },
        { id: 't2', channel: 'linkedin_message', classification: 'unclassified', last_message_at: '2026-09-14T08:51:00.000Z', first_name: 'Claire', last_name: 'Moreau', job_title: null, account_name: null, dernier_message: 'Pas le bon moment' },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.aTraiter.total).toBe(2);
    expect(a.aTraiter.fils).toHaveLength(2);
    expect(a.aTraiter.fils[0]).toMatchObject({ id: 't1', contactNom: 'Karim Benali', canal: 'email', classification: 'human_reply', quand: '2026-09-14T09:22:00.000Z' });
    expect(a.aTraiter.fils[1]).toMatchObject({ id: 't2', contactNom: 'Claire Moreau', canal: 'linkedin', quand: '2026-09-14T08:51:00.000Z' });
  });

  it("n'attribue aucune pastille de canal au courrier ni à l'appel (pas de repli sur email)", async () => {
    const ctx = faux({
      'jr:threads_a_traiter': [
        { id: 't3', channel: 'letter', classification: 'unclassified', last_message_at: null, first_name: 'Une', last_name: 'Entreprise', job_title: null, account_name: null, dernier_message: null },
        { id: 't4', channel: 'call', classification: 'unclassified', last_message_at: null, first_name: 'Une', last_name: 'Autre', job_title: null, account_name: null, dernier_message: null },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.aTraiter.fils[0]?.canal).toBeUndefined();
    expect(a.aTraiter.fils[1]?.canal).toBeUndefined();
  });

  it(
    "R77 (tour de correction 1) : compte « à traiter » avec la règle canonique de la Réception " +
      "(classification = 'human_reply' et handled_at nul) — un fil marqué traité par marquerTraite " +
      'en sort donc, ce que is_read/resume_at (l’ancienne condition) ne garantissait pas',
    async () => {
      const appels: { text: string }[] = [];
      const query = vi.fn(async (text: string) => {
        appels.push({ text });
        if (/jr:threads_a_traiter/i.test(text)) return { rows: [], rowCount: 0 };
        return { rows: [], rowCount: 0 };
      }) as unknown as Executeur['query'];
      const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

      await lireAujourdhui(ctx);

      const requete = appels.find((a) => /jr:threads_a_traiter/i.test(a.text))!.text;
      expect(requete).toContain("t.classification = 'human_reply'");
      expect(requete).toContain('t.handled_at is null');
      expect(requete).not.toContain('is_read');
      expect(requete).not.toContain('resume_at');
    },
  );

  it("calcule la dernière heure d'envoi dans le fuseau de l'organisation", async () => {
    const ctx = faux({
      'from organization_settings': [{ key: 'fuseau', value: 'Europe/Paris' }],
      'jr:file_du_jour': [
        { id: 'a1', dispatched_at: '2026-09-14T08:30:00.000Z', scheduled_for: null, dispatch_after: null, status: 'dispatched', channel: 'email', first_name: 'Claire', last_name: 'Moreau', campagne_nom: 'Directeur commercial', etape: 0, expediteur: 'prospection@exemple.fr' },
        { id: 'a2', dispatched_at: '2026-09-14T10:05:00.000Z', scheduled_for: null, dispatch_after: null, status: 'dispatched', channel: 'email', first_name: 'Karim', last_name: 'Benali', campagne_nom: 'Directeur commercial', etape: 1, expediteur: 'ventes@exemple.fr' },
      ],
    });
    const a = await lireAujourdhui(ctx);
    // 2026-09-14T10:05:00Z est un lundi de septembre : Europe/Paris est alors en heure d'été (UTC+2) → 12:05.
    expect(a.fileDuJour.derniereHeure).toBe('12:05');
    expect(a.fileDuJour.dejaPartis).toBe(2);
    expect(a.fileDuJour.total).toBe(2);
  });

  it("numérote l'étape à partir de 1 pour l'humain (position stockée à partir de 0)", async () => {
    const ctx = faux({
      'jr:file_du_jour': [
        { id: 'a1', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'email', first_name: 'Claire', last_name: 'Moreau', campagne_nom: 'Directeur commercial', etape: 0, expediteur: 'prospection@exemple.fr' },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.fileDuJour.envois[0]?.etape).toBe(1);
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

  it("lève une alerte pause_envoi quand l'organisation a un arrêt global des envois", async () => {
    const ctx = faux({
      'jr:pause_envoi': [{ sending_paused_at: '2026-09-14T08:00:00.000Z', sending_paused_reason: 'import douteux' }],
    });
    const a = await lireAujourdhui(ctx);
    const alerte = a.alertes.find((al) => al.type === 'pause_envoi');
    expect(alerte).toBeDefined();
    expect(alerte?.texte).toContain('import douteux');
  });

  it("ne lève pas d'alerte pause_envoi quand les envois ne sont pas en pause", async () => {
    const ctx = faux({ 'jr:pause_envoi': [{ sending_paused_at: null, sending_paused_reason: null }] });
    const a = await lireAujourdhui(ctx);
    expect(a.alertes.some((al) => al.type === 'pause_envoi')).toBe(false);
  });

  it('lève une alerte boite_deconnectee par boîte email active dont l’envoi est coupé', async () => {
    const ctx = faux({
      'jr:boites_deconnectees': [{ identity: 'prospection@exemple.fr' }, { identity: 'ventes@exemple.fr' }],
    });
    const a = await lireAujourdhui(ctx);
    const alertesBoites = a.alertes.filter((al) => al.type === 'boite_deconnectee');
    expect(alertesBoites).toHaveLength(2);
    expect(alertesBoites[0]?.texte).toContain('prospection@exemple.fr');
    expect(alertesBoites[1]?.texte).toContain('ventes@exemple.fr');
  });

  it("ne lève pas d'alerte boite_deconnectee quand aucune boîte active n'est coupée", async () => {
    const ctx = faux({ 'jr:boites_deconnectees': [] });
    const a = await lireAujourdhui(ctx);
    expect(a.alertes.some((al) => al.type === 'boite_deconnectee')).toBe(false);
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

  it('ne lit `organization_settings` qu’une seule fois (réglages passés à lireConsommationDuJour, pas relus)', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: 'fuseau', value: 'Europe/Paris' }] });
    await lireAujourdhui(ctx);
    const appels = (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    const appelsReglages = appels.filter((appel) => /from organization_settings/i.test(String(appel[0])));
    expect(appelsReglages).toHaveLength(1);
  });
});

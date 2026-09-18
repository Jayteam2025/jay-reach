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

  // F4 (tour de correction 3) : `dispatched_at` (`timestamptz`) peut être un
  // objet Date (pilote pg). Avant correctif, `derniereEnvoyee` triait ces
  // valeurs avec `.sort()` par défaut, qui compare `Date.prototype.toString()`
  // (« Mon Sep 21 2026 … » / « Tue Sep 08 2026 … ») : lexicographiquement,
  // « Mon » < « Tue », donc le 21/09 (lundi, le plus récent) passait AVANT le
  // 08/09 (mardi, plus ancien) — `.at(-1)` renvoyait alors le 08/09 (11:00
  // Paris) au lieu du 21/09 (12:00 Paris), la mauvaise « dernière envoyée ».
  it("calcule la dernière heure d'envoi même quand `dispatched_at` trierait mal lexicographiquement (objets Date, comme pg)", async () => {
    const ctx = faux({
      'jr:file_du_jour': [
        {
          id: 'a-milieu',
          dispatched_at: '2026-09-14T08:00:00.000Z',
          scheduled_for: null,
          dispatch_after: null,
          status: 'dispatched',
          channel: 'email',
          first_name: 'Claire',
          last_name: 'Moreau',
          campagne_nom: 'Directeur commercial',
          etape: 0,
          expediteur: 'prospection@exemple.fr',
        },
        {
          id: 'a-recent',
          dispatched_at: new Date('2026-09-21T10:00:00.000Z'), // lundi : le plus récent
          scheduled_for: null,
          dispatch_after: null,
          status: 'dispatched',
          channel: 'email',
          first_name: 'Karim',
          last_name: 'Benali',
          campagne_nom: 'Directeur commercial',
          etape: 1,
          expediteur: 'ventes@exemple.fr',
        },
        {
          id: 'a-ancien',
          dispatched_at: new Date('2026-09-08T09:00:00.000Z'), // mardi : le plus ancien, mais après « Mon » lexicographiquement
          scheduled_for: null,
          dispatch_after: null,
          status: 'dispatched',
          channel: 'email',
          first_name: 'Une',
          last_name: 'Autre',
          campagne_nom: 'Directeur commercial',
          etape: 0,
          expediteur: 'ventes@exemple.fr',
        },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.fileDuJour.derniereHeure).toBe('12:00');
    expect(a.fileDuJour.dejaPartis).toBe(3);
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

  it('la file du jour lit le jour calendaire dans le fuseau de l’organisation, plus jamais celui du serveur (revue F5, point 10)', async () => {
    const appels: { text: string }[] = [];
    const query = vi.fn(async (text: string) => {
      appels.push({ text });
      if (/from organization_settings/i.test(text)) return { rows: [{ key: 'fuseau', value: 'Europe/Paris' }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'viewer' };

    await lireAujourdhui(ctx);

    const requete = appels.find((a) => /jr:file_du_jour\b/i.test(a.text))!.text;
    expect(requete).toMatch(/\$2::date at time zone \$3/);
    expect(requete).not.toContain("date_trunc('day', now())");
  });

  describe('projection de la file du jour (revue F5, point 10)', () => {
    it('borne « possible aujourd’hui » au plafond journalier restant de la boîte, le reste est reporté', async () => {
      const ctx = faux({
        'jr:file_du_jour': [
          { id: 'a1', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'email', sender_id: 'sender-1', first_name: 'A', last_name: 'A', campagne_nom: 'C', etape: 0, expediteur: 'a@exemple.fr' },
          { id: 'a2', dispatched_at: null, scheduled_for: '2026-09-14T10:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'email', sender_id: 'sender-1', first_name: 'B', last_name: 'B', campagne_nom: 'C', etape: 0, expediteur: 'a@exemple.fr' },
          { id: 'a3', dispatched_at: null, scheduled_for: '2026-09-14T11:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'email', sender_id: 'sender-1', first_name: 'D', last_name: 'D', campagne_nom: 'C', etape: 0, expediteur: 'a@exemple.fr' },
        ],
        'jr:contraintes_senders_jour': [{ sender_id: 'sender-1', daily_quota: 2, used_today: 1 }],
      });
      const a = await lireAujourdhui(ctx);
      // Plafond 2, déjà 1 utilisé aujourd'hui : une seule place restante pour trois envois pas encore partis.
      expect(a.fileDuJour.possiblesAujourdhui).toBe(1);
      expect(a.fileDuJour.reportesProchainCreneau).toBe(2);
    });

    it('un canal sans boîte email suivie (LinkedIn) n’est jamais reporté par ce calcul', async () => {
      const ctx = faux({
        'jr:file_du_jour': [
          { id: 'a1', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'linkedin_message', sender_id: null, first_name: 'A', last_name: 'A', campagne_nom: 'C', etape: 0, expediteur: null },
        ],
        'jr:contraintes_senders_jour': [],
      });
      const a = await lireAujourdhui(ctx);
      expect(a.fileDuJour.possiblesAujourdhui).toBe(1);
      expect(a.fileDuJour.reportesProchainCreneau).toBe(0);
    });

    it('une boîte sans plafond réglé (daily_quota nul) n’est jamais reportée par ce calcul', async () => {
      const ctx = faux({
        'jr:file_du_jour': [
          { id: 'a1', dispatched_at: null, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, status: 'scheduled', channel: 'email', sender_id: 'sender-1', first_name: 'A', last_name: 'A', campagne_nom: 'C', etape: 0, expediteur: 'a@exemple.fr' },
        ],
        'jr:contraintes_senders_jour': [{ sender_id: 'sender-1', daily_quota: null, used_today: 5 }],
      });
      const a = await lireAujourdhui(ctx);
      expect(a.fileDuJour.possiblesAujourdhui).toBe(1);
      expect(a.fileDuJour.reportesProchainCreneau).toBe(0);
    });

    it('un envoi déjà parti n’entre jamais dans ce calcul (seuls les pas-encore-partis comptent)', async () => {
      const ctx = faux({
        'jr:file_du_jour': [
          { id: 'a1', dispatched_at: '2026-09-14T08:00:00.000Z', scheduled_for: null, dispatch_after: null, status: 'dispatched', channel: 'email', sender_id: 'sender-1', first_name: 'A', last_name: 'A', campagne_nom: 'C', etape: 0, expediteur: 'a@exemple.fr' },
        ],
        'jr:contraintes_senders_jour': [{ sender_id: 'sender-1', daily_quota: 1, used_today: 1 }],
      });
      const a = await lireAujourdhui(ctx);
      expect(a.fileDuJour.dejaPartis).toBe(1);
      expect(a.fileDuJour.possiblesAujourdhui).toBe(0);
      expect(a.fileDuJour.reportesProchainCreneau).toBe(0);
    });
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
        { id: 'c1', name: 'Directeur commercial', status: 'active', etapes: 4, boites: 3, sources: ['adzuna', 'francetravail'], contacts: 412, en_sequence: 186, partis: 412, reponses: 9 },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.campagnes).toHaveLength(1);
    expect(a.campagnes[0]).toMatchObject({ id: 'c1', nom: 'Directeur commercial', statut: 'active', contacts: 412, enSequence: 186, reponses: 9 });
    // Point 1 : taux de réponse = réponses / emails PARTIS, arrondi à une décimale.
    expect(a.campagnes[0]?.tauxReponse).toBeCloseTo(2.2, 1);
  });

  it('point 1 (tour de correction 5) : zéro email parti → tauxReponse `null`, jamais 0 %', async () => {
    const ctx = faux({
      'jr:campagnes_resume': [
        { id: 'c1', name: 'Recette SalesBlink', status: 'active', etapes: 1, boites: 1, sources: [], contacts: 2, en_sequence: 2, partis: 0, reponses: 1 },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.campagnes[0]?.tauxReponse).toBeNull();
  });

  // Revue F5, point 1 : la colonne Sources d'Aujourd'hui montrait encore « aucune source »
  // pour une campagne à liste, faute de regarder `enrollments.list_id`/`campaigns.list_id`.
  it('point 1 (revue F5) : listeSource remplace « aucune source » pour une campagne à liste', async () => {
    const ctx = faux({
      'jr:campagnes_resume': [
        { id: 'c1', name: 'Jay coach - RH', status: 'active', etapes: 4, boites: 3, sources: [], contacts: 167, en_sequence: 165, partis: 110, reponses: 1, liste_source: { nom: 'RH avril 2026', autres: 0 } },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.campagnes[0]!.listeSource).toEqual({ nom: 'RH avril 2026', autresListes: 0 });
  });

  it('sans liste (campagne à sources) : listeSource est `null`', async () => {
    const ctx = faux({
      'jr:campagnes_resume': [
        { id: 'c1', name: 'Directeur commercial', status: 'active', etapes: 4, boites: 3, sources: ['adzuna'], contacts: 412, en_sequence: 186, partis: 412, reponses: 9 },
      ],
    });
    const a = await lireAujourdhui(ctx);
    expect(a.campagnes[0]!.listeSource).toBeNull();
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

  // Correctif du 18/09 : la coquille et la page Aujourd'hui formataient « Dernier/prochain
  // passage » du moteur avec `FUSEAU_PAR_DEFAUT` (constante `Europe/Paris`, apps/web), jamais le
  // fuseau réel de l'organisation — `lireAujourdhui` le lisait déjà pour `jourRef`/`formatterHeure`
  // sans jamais l'exposer. Rougirait si `fuseau` disparaissait du retour ou restait figé.
  it('expose le fuseau de l’organisation déjà lu, pour que le web formate le moteur avec', async () => {
    const ctx = faux({ 'from organization_settings': [{ key: 'fuseau', value: 'Pacific/Auckland' }] });
    const a = await lireAujourdhui(ctx);
    expect(a.fuseau).toBe('Pacific/Auckland');
  });

  it('sans fuseau réglé en base : le défaut Europe/Paris', async () => {
    const a = await lireAujourdhui(faux({}));
    expect(a.fuseau).toBe('Europe/Paris');
  });
});

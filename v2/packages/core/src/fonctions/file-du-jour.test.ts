import { describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../roles.js';
import type { Executeur } from '../executeur.js';
import type { Contexte } from './contexte.js';
import { ErreurIntrouvable } from './contexte.js';
import {
  apercuEnvoi,
  approuverEnvoi,
  ecarterDuneCampagne,
  masquerEmail,
  rejeterEnvoi,
  reporterEnvoi,
} from './file-du-jour.js';

/** Même convention que `campagnes.test.ts` : un motif (le tag `/* jr:nom *\/`) associé aux lignes à renvoyer. */
function faux(rows: Record<string, unknown[]>, role: Contexte['role'] = 'operator'): Contexte {
  const query = vi.fn(async (sql: string) => {
    for (const [motif, r] of Object.entries(rows)) {
      if (new RegExp(motif, 'i').test(sql)) return { rows: r, rowCount: r.length };
    }
    return { rows: [], rowCount: 0 };
  }) as unknown as Executeur['query'];
  return { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role };
}

function appelsDe(ctx: Contexte): unknown[][] {
  return (ctx.ex.query as unknown as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
}

const actionId = '11111111-1111-1111-1111-111111111111';
const contactId = '22222222-2222-2222-2222-222222222222';
const campagneId = '33333333-3333-3333-3333-333333333333';

describe('masquerEmail', () => {
  it('tronque la partie locale et garde le domaine en clair', () => {
    expect(masquerEmail('n.lemaire@kairn.example')).toBe('n.…@kairn.example');
  });
  it('garde une partie locale d’un seul caractère telle quelle', () => {
    expect(masquerEmail('a@exemple.fr')).toBe('a…@exemple.fr');
  });
  it('renvoie la chaîne telle quelle si elle ne contient pas d’arobase', () => {
    expect(masquerEmail('pas-un-email')).toBe('pas-un-email');
  });
});

describe('reporterEnvoi', () => {
  it('refuse un viewer', async () => {
    await expect(reporterEnvoi(faux({}, 'viewer'), { actionId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable quand l’action n’existe pas ou n’est plus reportable', async () => {
    const ctx = faux({ 'jr:reporter_lire': [] });
    await expect(reporterEnvoi(ctx, { actionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('décale scheduled_for d’un jour (déjà dans les heures ouvrées de l’expéditeur)', async () => {
    const ctx = faux({
      'jr:reporter_lire': [
        {
          id: actionId,
          scheduled_for: '2026-09-14T09:00:00.000Z',
          dispatch_after: '2026-09-14T09:00:00.000Z',
          sender_id: 'send-1',
          contact_id: contactId,
        },
      ],
      'jr:reporter_expediteur': [{ timezone: 'UTC', business_hours: { startHour: 8, endHour: 19, days: [1, 2, 3, 4, 5] } }],
      'jr:reporter_ecrire': [],
    });
    await reporterEnvoi(ctx, { actionId });
    const ecriture = appelsDe(ctx).find((a) => /jr:reporter_ecrire/i.test(String(a[0])));
    expect(ecriture?.[1]).toEqual([actionId, '2026-09-15T09:00:00.000Z', '2026-09-15T09:00:00.000Z']);
  });

  it('conserve l’écart entre dispatch_after et scheduled_for (lead time du canal)', async () => {
    const ctx = faux({
      'jr:reporter_lire': [
        {
          id: actionId,
          scheduled_for: '2026-09-14T09:00:00.000Z',
          dispatch_after: '2026-09-11T09:00:00.000Z', // 72h de lead time (courrier)
          sender_id: null,
          contact_id: contactId,
        },
      ],
      'jr:reporter_ecrire': [],
    });
    await reporterEnvoi(ctx, { actionId });
    const ecriture = appelsDe(ctx).find((a) => /jr:reporter_ecrire/i.test(String(a[0])));
    expect(ecriture?.[1]).toEqual([actionId, '2026-09-15T09:00:00.000Z', '2026-09-12T09:00:00.000Z']);
  });

  it('sans expéditeur lié, retombe sur les heures ouvrées par défaut (9-18, lun-ven)', async () => {
    const ctx = faux({
      'jr:reporter_lire': [
        { id: actionId, scheduled_for: '2026-09-14T20:00:00.000Z', dispatch_after: null, sender_id: null, contact_id: contactId },
      ],
      'jr:reporter_ecrire': [],
    });
    await reporterEnvoi(ctx, { actionId });
    const ecriture = appelsDe(ctx).find((a) => /jr:reporter_ecrire/i.test(String(a[0])));
    // + 1 jour -> 15/09 20h, hors 9-18 -> recalé au lendemain (16/09) 9h.
    expect((ecriture?.[1] as unknown[] | undefined)?.[1]).toBe('2026-09-16T09:00:00.000Z');
  });

  it('écrit action_rescheduled avec le contact', async () => {
    const ctx = faux({
      'jr:reporter_lire': [
        { id: actionId, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, sender_id: null, contact_id: contactId },
      ],
      'jr:reporter_ecrire': [],
    });
    await reporterEnvoi(ctx, { actionId });
    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual([
      'org-1',
      'user-1',
      'contact',
      contactId,
      'action_rescheduled',
      JSON.stringify({ libelle: 'Envoi reporté d’un jour par l’opérateur.' }),
    ]);
  });

  it('un échec du journal n’empêche jamais le report de réussir', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:reporter_lire/i.test(sql)) {
        return {
          rows: [{ id: actionId, scheduled_for: '2026-09-14T09:00:00.000Z', dispatch_after: null, sender_id: null, contact_id: contactId }],
          rowCount: 1,
        };
      }
      if (/insert into audit_events/i.test(sql)) throw new Error('table audit_events indisponible');
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'operator' };
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(reporterEnvoi(ctx, { actionId })).resolves.toBeUndefined();
    expect(avertissement).toHaveBeenCalledWith('[journal] action_rescheduled', expect.any(Error));
    avertissement.mockRestore();
  });
});

describe('ecarterDuneCampagne', () => {
  it('refuse un viewer', async () => {
    await expect(ecarterDuneCampagne(faux({}, 'viewer'), { contactId, campagneId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si la campagne n’existe pas', async () => {
    const ctx = faux({ 'jr:ecarter_campagne': [] });
    await expect(ecarterDuneCampagne(ctx, { contactId, campagneId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('marque le signal d’origine du contact comme écarté, avec les bons paramètres', async () => {
    const ctx = faux({ 'jr:ecarter_campagne': [{ id: campagneId }] });
    await ecarterDuneCampagne(ctx, { contactId, campagneId });
    const ecritureSignal = appelsDe(ctx).find((a) => /jr:ecarter_signal/i.test(String(a[0])));
    expect(ecritureSignal?.[1]).toEqual([contactId, campagneId, 'org-1']);
  });

  it('arrête les inscriptions actives et écarte leurs envois pas encore partis', async () => {
    const ctx = faux({
      'jr:ecarter_campagne': [{ id: campagneId }],
      'jr:ecarter_inscriptions': [{ id: 'enr-1' }, { id: 'enr-2' }],
    });
    await ecarterDuneCampagne(ctx, { contactId, campagneId });
    const ecritureActions = appelsDe(ctx).find((a) => /jr:ecarter_actions/i.test(String(a[0])));
    expect(ecritureActions?.[1]).toEqual([['enr-1', 'enr-2']]);
  });

  it('n’écrit aucune annulation d’action quand le contact n’a aucune inscription active', async () => {
    const ctx = faux({ 'jr:ecarter_campagne': [{ id: campagneId }], 'jr:ecarter_inscriptions': [] });
    await ecarterDuneCampagne(ctx, { contactId, campagneId });
    expect(appelsDe(ctx).some((a) => /jr:ecarter_actions/i.test(String(a[0])))).toBe(false);
  });

  it('écrit action_skipped avec la campagne en détail', async () => {
    const ctx = faux({ 'jr:ecarter_campagne': [{ id: campagneId }] });
    await ecarterDuneCampagne(ctx, { contactId, campagneId });
    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual([
      'org-1',
      'user-1',
      'contact',
      contactId,
      'action_skipped',
      JSON.stringify({ libelle: 'Contact écarté de la campagne.', campagneId }),
    ]);
  });

  it('un échec du journal n’empêche jamais l’écart de réussir', async () => {
    const query = vi.fn(async (sql: string) => {
      if (/jr:ecarter_campagne/i.test(sql)) return { rows: [{ id: campagneId }], rowCount: 1 };
      if (/insert into audit_events/i.test(sql)) throw new Error('table audit_events indisponible');
      return { rows: [], rowCount: 0 };
    }) as unknown as Executeur['query'];
    const ctx: Contexte = { ex: { query }, organisationId: 'org-1', utilisateurId: 'user-1', role: 'operator' };
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(ecarterDuneCampagne(ctx, { contactId, campagneId })).resolves.toBeUndefined();
    expect(avertissement).toHaveBeenCalledWith('[journal] action_skipped', expect.any(Error));
    avertissement.mockRestore();
  });
});

describe('approuverEnvoi', () => {
  it('refuse un viewer', async () => {
    await expect(approuverEnvoi(faux({}, 'viewer'), { actionId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si aucun envoi en attente ne correspond', async () => {
    const ctx = faux({ 'jr:approuver_envoi': [] });
    await expect(approuverEnvoi(ctx, { actionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('passe l’action à approved et écrit action_approved', async () => {
    const ctx = faux({ 'jr:approuver_envoi': [{ contact_id: contactId }] });
    await approuverEnvoi(ctx, { actionId });
    const ecriture = appelsDe(ctx).find((a) => /jr:approuver_envoi/i.test(String(a[0])));
    expect(ecriture?.[1]).toEqual([actionId, 'org-1', 'user-1']);
    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual([
      'org-1',
      'user-1',
      'contact',
      contactId,
      'action_approved',
      JSON.stringify({ libelle: 'Envoi validé par l’opérateur.' }),
    ]);
  });
});

describe('rejeterEnvoi', () => {
  it('refuse un viewer', async () => {
    await expect(rejeterEnvoi(faux({}, 'viewer'), { actionId })).rejects.toThrow(ForbiddenError);
  });

  it('lève ErreurIntrouvable si aucun envoi en attente ne correspond', async () => {
    const ctx = faux({ 'jr:rejeter_envoi': [] });
    await expect(rejeterEnvoi(ctx, { actionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('passe l’action à cancelled et écrit action_rejected', async () => {
    const ctx = faux({ 'jr:rejeter_envoi': [{ contact_id: contactId }] });
    await rejeterEnvoi(ctx, { actionId });
    const journal = appelsDe(ctx).find((a) => /insert into audit_events/i.test(String(a[0])));
    expect(journal?.[1]).toEqual([
      'org-1',
      'user-1',
      'contact',
      contactId,
      'action_rejected',
      JSON.stringify({ libelle: 'Envoi rejeté par l’opérateur.' }),
    ]);
  });
});

describe('apercuEnvoi', () => {
  it('accepte un viewer (lecture)', async () => {
    const ctx = faux({ 'jr:apercu_lire': [] }, 'viewer');
    await expect(apercuEnvoi(ctx, { actionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('lève ErreurIntrouvable quand l’action n’existe pas', async () => {
    const ctx = faux({ 'jr:apercu_lire': [] });
    await expect(apercuEnvoi(ctx, { actionId })).rejects.toThrow(ErreurIntrouvable);
  });

  it('rend l’objet et le corps avec les valeurs du contact, et masque le destinataire', async () => {
    const ctx = faux({
      'jr:apercu_lire': [
        { id: actionId, contact_id: contactId, campaign_id: campagneId, template_parent_id: 'tpl-1', locale: 'fr', expediteur: 'alexandre@get-jay.fr' },
      ],
      'jr:valeurs_contact\\b': [
        {
          first_name: 'Nadia',
          last_name: 'Lemaire',
          job_title: null,
          email: 'n.lemaire@kairn.example',
          locale: 'fr',
          company_name: 'Kairn',
          domain: null,
          city: null,
          headcount: null,
          postal_code: null,
          country: null,
          persona_angle: null,
          signal_title: null,
          signal_location: null,
          signal_url: null,
          signal_occurred_at: null,
          context_note: null,
        },
      ],
      'jr:valeurs_contact_extraits': [],
      'jr:apercu_gabarit': [{ body: 'Bonjour {{prenom}}, chez {{entreprise}}.', subject: 'Objet pour {{prenom}}', name: 'Gabarit' }],
    });
    const r = await apercuEnvoi(ctx, { actionId });
    expect(r).toEqual({
      objet: 'Objet pour Nadia',
      corps: 'Bonjour Nadia, chez Kairn.',
      expediteur: 'alexandre@get-jay.fr',
      destinataireMasque: 'n.…@kairn.example',
    });
  });

  it('sans gabarit relié à l’étape, renvoie un objet et un corps vides plutôt que d’échouer', async () => {
    const ctx = faux({
      'jr:apercu_lire': [
        { id: actionId, contact_id: contactId, campaign_id: campagneId, template_parent_id: null, locale: null, expediteur: null },
      ],
      'jr:valeurs_contact\\b': [],
    });
    const r = await apercuEnvoi(ctx, { actionId });
    expect(r.objet).toBe('');
    expect(r.corps).toBe('');
    expect(r.destinataireMasque).toBeNull();
  });
});

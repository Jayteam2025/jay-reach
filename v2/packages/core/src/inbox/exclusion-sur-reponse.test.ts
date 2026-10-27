import { describe, expect, it } from 'vitest';
import type { Executeur } from '../executeur.js';
import { exclureApresReponse, poserExclusion } from './exclusion-sur-reponse.js';
import { recordInboundReply } from './record-reply.js';

interface Appel {
  readonly text: string;
  readonly values: unknown[];
}

/** Exécuteur factice : un contact, et chaque insertion de suppression compte pour une ligne. */
function creerExecuteur(contact: { email: string | null; linkedin_url: string | null; linkedin_provider_id?: string | null; status?: string } | null): {
  ex: Executeur;
  appels: Appel[];
} {
  const appels: Appel[] = [];
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      appels.push({ text, values });
      if (text.includes('jr:exclusion_reponse_contact')) {
        return { rows: (contact ? [{ linkedin_provider_id: null, status: 'active', ...contact }] : []) as T[], rowCount: contact ? 1 : 0 };
      }
      if (text.includes('insert into suppressions')) return { rows: [] as T[], rowCount: 1 };
      return { rows: [] as T[], rowCount: 0 };
    },
  };
  return { ex, appels };
}

const suppressions = (appels: Appel[], scope: 'email' | 'linkedin') =>
  appels.filter((a) => a.text.includes('insert into suppressions') && a.text.includes(`'${scope}'`));

describe('exclureApresReponse', () => {
  it('pose le statut et les deux suppressions, marquées reponse_recue / api', async () => {
    const { ex, appels } = creerExecuteur({ email: 'a@exemple.test', linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont/' });
    const posees = await exclureApresReponse(ex, 'org-1', 'contact-1');

    expect(posees).toEqual({ email: 1, linkedin: 1 });
    expect(appels.some((a) => a.text.includes("set status = 'do_not_contact'") && a.values[0] === 'contact-1')).toBe(true);
    const email = suppressions(appels, 'email');
    const linkedin = suppressions(appels, 'linkedin');
    expect(email[0]!.values).toEqual(['org-1', 'a@exemple.test', 'reponse_recue', 'api']);
    // L'adresse posée est la forme normalisée du profil réel (sans barre finale).
    expect(linkedin[0]!.values).toEqual(['org-1', 'https://www.linkedin.com/in/jeanne-dupont', 'reponse_recue', 'api']);
  });

  it('chaque insertion se dédoublonne (la table n’a aucune contrainte d’unicité)', async () => {
    const { ex, appels } = creerExecuteur({ email: 'a@exemple.test', linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont' });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    for (const a of appels.filter((x) => x.text.includes('insert into suppressions'))) {
      expect(a.text).toMatch(/where not exists/);
    }
  });

  it('un contact sans adresse LinkedIn n’a qu’une exclusion email', async () => {
    const { ex, appels } = creerExecuteur({ email: 'a@exemple.test', linkedin_url: null });
    expect(await exclureApresReponse(ex, 'org-1', 'contact-1')).toEqual({ email: 1, linkedin: 0 });
    expect(suppressions(appels, 'linkedin')).toHaveLength(0);
  });

  it('une adresse qui n’est pas un profil LinkedIn ne produit AUCUNE opposition LinkedIn', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: 'https://exemple.test/in/quelquun' });
    expect(await exclureApresReponse(ex, 'org-1', 'contact-1')).toEqual({ email: 0, linkedin: 0 });
    expect(suppressions(appels, 'linkedin')).toHaveLength(0);
    expect(suppressions(appels, 'email')).toHaveLength(0);
  });

  it('un identifiant de membre reconnu ajoute la graphie déduite : deux oppositions LinkedIn distinctes', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont', linkedin_provider_id: 'ACoAAbcdef123' });
    expect(await exclureApresReponse(ex, 'org-1', 'contact-1')).toEqual({ email: 0, linkedin: 2 });
    expect(suppressions(appels, 'linkedin').map((a) => a.values[1])).toEqual([
      'https://www.linkedin.com/in/jeanne-dupont',
      'https://www.linkedin.com/in/ACoAAbcdef123',
    ]);
  });

  it('un identifiant de membre reconnu sans adresse publique : la graphie déduite seule', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: null, linkedin_provider_id: 'ACoAAbcdef123' });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    expect(suppressions(appels, 'linkedin').map((a) => a.values[1])).toEqual(['https://www.linkedin.com/in/ACoAAbcdef123']);
  });

  it('un identifiant FullEnrich (UUID) ne fabrique AUCUNE adresse : seule l’adresse réelle est opposée', async () => {
    const { ex, appels } = creerExecuteur({
      email: null,
      linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont',
      linkedin_provider_id: '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b',
    });
    expect(await exclureApresReponse(ex, 'org-1', 'contact-1')).toEqual({ email: 0, linkedin: 1 });
    expect(suppressions(appels, 'linkedin').map((a) => a.values[1])).toEqual(['https://www.linkedin.com/in/jeanne-dupont']);
  });

  it('un identifiant non reconnu et aucune adresse : rien côté LinkedIn', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: null, linkedin_provider_id: 'undefined' });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    expect(suppressions(appels, 'linkedin')).toHaveLength(0);
  });

  it('écrit un événement distinct de l’action manuelle, sans acteur, marqué automatique', async () => {
    const { ex, appels } = creerExecuteur({ email: 'a@exemple.test', linkedin_url: null });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    const ev = appels.find((a) => a.text.includes('insert into audit_events'));
    expect(ev).toBeDefined();
    expect(ev!.values.slice(0, 5)).toEqual(['org-1', null, 'contact', 'contact-1', 'contact.excluded_after_reply']);
    expect(JSON.parse(ev!.values[5] as string)).toMatchObject({ automatique: true, motif: 'reponse_recue' });
  });

  it('un contact déjà exclu et dont rien ne change : pas de second événement', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: null, status: 'do_not_contact' });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    expect(appels.some((a) => a.text.includes('insert into audit_events'))).toBe(false);
  });

  it('un contact introuvable dans l’organisation : rien n’est écrit', async () => {
    const { ex, appels } = creerExecuteur(null);
    expect(await exclureApresReponse(ex, 'org-1', 'contact-x')).toEqual({ email: 0, linkedin: 0 });
    expect(appels).toHaveLength(1);
  });

  it('la lecture du contact est filtrée par organisation', async () => {
    const { ex, appels } = creerExecuteur({ email: null, linkedin_url: null });
    await exclureApresReponse(ex, 'org-1', 'contact-1');
    expect(appels[0]!.text).toContain('organization_id = $2');
    expect(appels[0]!.values).toEqual(['contact-1', 'org-1']);
  });
});

describe('poserExclusion', () => {
  it('ne pose qu’une fois une adresse répétée', async () => {
    const { ex, appels } = creerExecuteur(null);
    await poserExclusion(ex, 'org-1', 'c', {
      email: null,
      adressesLinkedin: ['https://www.linkedin.com/in/a', 'https://www.linkedin.com/in/a'],
      motif: 'm',
      origine: 'manual',
    });
    expect(suppressions(appels, 'linkedin')).toHaveLength(1);
  });
});

/** Exécuteur qui répond aux requêtes de recordInboundReply et enregistre celles de l'exclusion. */
function creerExecuteurReponse(): { ex: Executeur; appels: Appel[] } {
  const base = creerExecuteur({ email: 'a@exemple.test', linkedin_url: 'https://www.linkedin.com/in/jeanne-dupont' });
  const ex: Executeur = {
    async query<T>(text: string, values: unknown[] = []) {
      if (text.trim().startsWith('insert into threads')) {
        base.appels.push({ text, values });
        return { rows: [{ id: 'fil-1' }] as T[], rowCount: 1 };
      }
      return base.ex.query<T>(text, values);
    },
  };
  return { ex, appels: base.appels };
}

describe('recordInboundReply : seule human_reply exclut', () => {
  const exclut = (appels: Appel[]) => appels.some((a) => a.text.includes("set status = 'do_not_contact'"));
  const cas: [string, string, boolean][] = [
    ['human_reply', 'Bonjour, merci, on se rappelle la semaine prochaine.', true],
    ['auto_absence', 'Je suis actuellement en congés, de retour le 20.', false],
    ['auto_left_company', 'Je ne suis plus en poste dans cette entreprise.', false],
  ];
  it.each(cas)('%s', async (classification, body, attendu) => {
    const { ex, appels } = creerExecuteurReponse();
    const r = await recordInboundReply(ex, 'org-1', { contactId: 'contact-1', channel: 'linkedin_message', body });
    expect(r.classification).toBe(classification);
    expect(exclut(appels)).toBe(attendu);
  });

  it('un message déjà connu n’écrit rien, exclusion comprise', async () => {
    const { ex, appels } = creerExecuteurReponse();
    const rejoue: Executeur = {
      async query<T>(text: string, values: unknown[] = []) {
        if (text.trim().startsWith('select m.id from thread_messages')) return { rows: [{ id: 'm' }] as T[], rowCount: 1 };
        if (text.trim().startsWith('select thread_id as id')) return { rows: [{ id: 'fil-1' }] as T[], rowCount: 1 };
        return ex.query<T>(text, values);
      },
    };
    const r = await recordInboundReply(rejoue, 'org-1', { contactId: 'contact-1', channel: 'email', body: 'Bonjour', providerMessageId: 'x' });
    expect(r.isNew).toBe(false);
    expect(exclut(appels)).toBe(false);
  });

  it('l’exclusion partage la transaction du message : un échec d’exclusion annule le tout', async () => {
    const journal: string[] = [];
    const client = {
      release: () => journal.push('release'),
      async query<T>(text: string) {
        const t = text.trim();
        if (t === 'begin' || t === 'commit' || t === 'rollback') journal.push(t);
        if (t.startsWith('insert into threads')) return { rows: [{ id: 'fil-1' }] as T[], rowCount: 1 };
        if (t.startsWith('select email, linkedin_url')) throw new Error('echec exclusion');
        return { rows: [] as T[], rowCount: 0 };
      },
    };
    const pool = {
      async connect() {
        return client;
      },
      query: client.query,
    } as unknown as Executeur;
    await expect(
      recordInboundReply(pool, 'org-1', { contactId: 'c', channel: 'email', body: 'Bonjour, ok pour jeudi.' }),
    ).rejects.toThrow('echec exclusion');
    expect(journal).toContain('begin');
    expect(journal).toContain('rollback');
    expect(journal).not.toContain('commit');
  });
});

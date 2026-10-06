/**
 * Enrichissement d'un contact DÉJÀ identifié (file `enrichment.contact_connu`).
 *
 * Ce fichier ne prouve que ce qu'un pool factice peut prouver : l'enchaînement
 * des décisions et CE QU'ON ENVOIE au fournisseur. Le SQL lui-même — la
 * sélection du producteur, la colonne de coût, le conflit d'unicité, la marque
 * `enriched_at` — est exécuté sur un vrai Postgres par
 * `test/pg-verify/linkedin-enrichissement.sh`, qui est la preuve.
 *
 * Aucun test ne peut appeler FullEnrich : l'achat est une dépendance injectée.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Pool } from 'pg';
import type { FullEnrichContactInput, FullEnrichContactResult, FullEnrichJobResult } from '@jay-reach/providers/enrichment';
import type * as ModuleEnrichment from '@jay-reach/providers/enrichment';

// Les deux appels RÉSEAU de `dependancesEnrichissementReelles`, et eux seuls : le
// reste du module reste le vrai. Sans ce faux, la lecture du coût rendu par
// FullEnrich — la seule ligne qui distingue « coût absent » de « coût nul » —
// n'est exercée par AUCUNE preuve, le harnais Postgres injectant l'achat.
let reponseFullEnrich: () => FullEnrichJobResult = () => {
  throw new Error('réponse FullEnrich non posée');
};
vi.mock('@jay-reach/providers/enrichment', async (importOriginal) => ({
  ...(await importOriginal<typeof ModuleEnrichment>()),
  submitBulkEnrichment: vi.fn(async () => 'bulk-1'),
  pollBulkEnrichment: vi.fn(async () => reponseFullEnrich()),
}));

import {
  enrichirContactConnu,
  raisonDeNePasAcheter,
  dependancesEnrichissementReelles,
  MSG,
  type AchatFullEnrich,
  type DependancesEnrichissementContact,
} from './enrichment-contact-connu.js';
import { enqueueEnrichmentContactsConnus } from '../producer.js';

const ORG = '11111111-1111-4111-8111-111111111111';
const CONTACT = '22222222-2222-4222-8222-222222222222';

interface LigneContact {
  readonly first_name?: string | null;
  readonly last_name?: string | null;
  readonly linkedin_url?: string | null;
  readonly linkedin_provider_id?: string | null;
  readonly email?: string | null;
}

interface Options {
  readonly contact?: LigneContact | null;
  readonly creditAccorde?: boolean;
  readonly plafondSaisi?: number | null;
  readonly achat?: AchatFullEnrich;
  readonly achatLeve?: Error;
  readonly conflitEmail?: boolean;
  readonly coutEnregistre?: boolean;
  readonly cle?: string | null;
}

const RESULTAT_AVEC_EMAIL: FullEnrichContactResult = {
  input: {},
  contact_info: { most_probable_work_email: { email: 'ada@acme.fr', status: 'DELIVERABLE' } },
};

function monde(opts: Options = {}) {
  const etat = {
    sql: [] as string[],
    params: [] as unknown[][],
    achats: [] as FullEnrichContactInput[],
    couts: [] as number[],
    majContact: [] as unknown[][],
    marquesSeules: 0,
  };
  const contact =
    opts.contact === null
      ? null
      : {
          id: CONTACT,
          first_name: 'Ada',
          last_name: 'Lovelace',
          linkedin_url: 'https://www.linkedin.com/in/ada-lovelace',
          linkedin_provider_id: 'ACoAAada',
          email: null,
          ...opts.contact,
        };

  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    etat.sql.push(sql);
    etat.params.push(p);
    if (/from contacts/i.test(sql)) {
      return { rows: contact ? [contact] : [], rowCount: contact ? 1 : 0 };
    }
    if (/from organization_settings/i.test(sql)) {
      if (/'fuseau'/.test(sql)) return { rows: [{ value: 'Europe/Paris' }], rowCount: 1 };
      return { rows: opts.plafondSaisi == null ? [] : [{ value: opts.plafondSaisi }], rowCount: 1 };
    }
    if (/from credentials/i.test(sql)) return { rows: [], rowCount: 0 };
    if (/consume_provider_credit/i.test(sql)) {
      return { rows: [{ ok: opts.creditAccorde ?? true }], rowCount: 1 };
    }
    if (/record_provider_cost/i.test(sql)) {
      etat.couts.push(Number(p[2]));
      return { rows: [{ ok: opts.coutEnregistre ?? true }], rowCount: 1 };
    }
    if (/update contacts/i.test(sql)) {
      if (/email\s*=\s*\$3/.test(sql)) {
        if (opts.conflitEmail) throw Object.assign(new Error('duplicate key'), { code: '23505' });
        etat.majContact.push(p);
      } else {
        etat.marquesSeules += 1;
      }
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });

  const deps: DependancesEnrichissementContact = {
    pool: { query } as unknown as Pool,
    cleFullEnrich: async () => (opts.cle === undefined ? 'cle-de-test' : opts.cle),
    acheter: async (_apiKey, entree) => {
      etat.achats.push(entree);
      if (opts.achatLeve) throw opts.achatLeve;
      return opts.achat ?? { resultat: RESULTAT_AVEC_EMAIL, credits: 1.5 };
    },
  };
  return { deps, etat };
}

/** Capture ce que l'opérateur LIT, pas seulement l'état où le handler le laisse. */
function journal() {
  const lignes: string[] = [];
  const warn = vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void lignes.push(a.join(' ')));
  const log = vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void lignes.push(a.join(' ')));
  return { lignes, rendre: () => { warn.mockRestore(); log.mockRestore(); } };
}

describe('raisonDeNePasAcheter', () => {
  const base = { linkedinUrl: 'https://www.linkedin.com/in/ada-lovelace', linkedinProviderId: 'ACoAAada', firstName: 'Ada', lastName: 'Lovelace' };

  it('laisse passer un contact à adresse publique et nom complet', () => {
    expect(raisonDeNePasAcheter(base)).toBeNull();
  });

  it('refuse une adresse fabriquée à partir de l’identifiant interne LinkedIn', () => {
    expect(raisonDeNePasAcheter({ ...base, linkedinUrl: 'https://www.linkedin.com/in/ACoAAada' })).toBe('adresse_deduite');
  });

  it('refuse un nom de famille réduit à son initiale, avec ou sans point', () => {
    expect(raisonDeNePasAcheter({ ...base, lastName: 'L.' })).toBe('nom_tronque');
    expect(raisonDeNePasAcheter({ ...base, lastName: 'L' })).toBe('nom_tronque');
  });

  it('accepte un vrai nom de famille court et un contact sans nom de famille', () => {
    // « Wu », « Li », « Xu » sont des noms entiers : une règle fondée sur la
    // longueur les refuserait, et on n'achèterait jamais pour ces personnes.
    expect(raisonDeNePasAcheter({ ...base, lastName: 'Wu' })).toBeNull();
    expect(raisonDeNePasAcheter({ ...base, lastName: null })).toBeNull();
  });

  it('refuse un contact sans adresse de profil', () => {
    expect(raisonDeNePasAcheter({ ...base, linkedinUrl: null })).toBe('sans_adresse');
  });
});

describe('enrichirContactConnu', () => {
  it('le handler appelle FullEnrich avec linkedin_url, prenom et nom', async () => {
    const { deps, etat } = monde();
    const j = journal();
    await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(etat.achats).toEqual([
      { first_name: 'Ada', last_name: 'Lovelace', linkedin_url: 'https://www.linkedin.com/in/ada-lovelace' },
    ]);
  });

  it('le handler respecte le plafond enrichissements_par_jour', async () => {
    const { deps, etat } = monde({ creditAccorde: false });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('plafond');
    // Rien n'est parti chez le fournisseur, et le contact n'est PAS marqué :
    // il doit repartir demain.
    expect(etat.achats).toEqual([]);
    expect(etat.marquesSeules).toBe(0);
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.plafond(ORG)}`);
  });

  it('le plafond est demandé avec la valeur saisie par l’opérateur et le jour de son fuseau', async () => {
    const { deps, etat } = monde({ plafondSaisi: 7 });
    const j = journal();
    await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    const i = etat.sql.findIndex((s) => /consume_provider_credit/.test(s));
    expect(etat.params[i]).toEqual([ORG, 'fullenrich', 7, expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
  });

  it('le cout reel rendu par l’API est ajoute a provider_daily_usage.credits_spent', async () => {
    const { deps, etat } = monde({ achat: { resultat: RESULTAT_AVEC_EMAIL, credits: 2.25 } });
    const j = journal();
    await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(etat.couts).toEqual([2.25]);
  });

  it('un cout absent de la reponse se voit, au lieu de passer pour zero', async () => {
    const { deps, etat } = monde({ achat: { resultat: RESULTAT_AVEC_EMAIL, credits: undefined } });
    const j = journal();
    await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(etat.couts).toEqual([]);
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.coutAbsent(CONTACT)}`);
  });

  it('un cout qui ne trouve aucune ligne de consommation est signale, pas avale', async () => {
    const { deps } = monde({ coutEnregistre: false });
    const j = journal();
    await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.coutPerdu(ORG, 1.5)}`);
  });

  it('une adresse deja portee par un autre contact laisse le contact sans email et ne fait pas tomber le passage', async () => {
    const { deps, etat } = monde({ conflitEmail: true });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('email_deja_pris');
    expect(etat.majContact).toEqual([]);
    // Marqué traité quand même : la fiche ne sera pas rachetée demain.
    expect(etat.marquesSeules).toBe(1);
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.emailDejaPris(CONTACT)}`);
  });

  it('une panne du fournisseur ne fait pas rejouer le job, et ne dit que le type de l’erreur', async () => {
    const { deps } = monde({ achatLeve: new TypeError('https://api.fullenrich.com/?api_key=secret') });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('panne_fournisseur');
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.panne(CONTACT, 'TypeError')}`);
    expect(j.lignes.join(' ')).not.toContain('api_key');
  });

  it('un contact refuse ne consomme aucun credit et n’appelle pas le fournisseur', async () => {
    const { deps, etat } = monde({ contact: { linkedin_url: 'https://www.linkedin.com/in/ACoAAada' } });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('refuse');
    expect(etat.achats).toEqual([]);
    expect(etat.sql.some((s) => /consume_provider_credit/.test(s))).toBe(false);
    expect(j.lignes).toContain(`${MSG.prefixe} ${MSG.refus(CONTACT, 'adresse_deduite')}`);
  });

  it('un contact qui a deja un email n’est pas rachete', async () => {
    const { deps, etat } = monde({ contact: { email: 'ada@acme.fr' } });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('deja_enrichi');
    expect(etat.achats).toEqual([]);
  });

  it('sans cle FullEnrich, aucun credit n’est consomme', async () => {
    const { deps, etat } = monde({ cle: null });
    const j = journal();
    const issue = await enrichirContactConnu(deps, { organizationId: ORG, contactId: CONTACT });
    j.rendre();
    expect(issue).toBe('sans_cle');
    expect(etat.sql.some((s) => /consume_provider_credit/.test(s))).toBe(false);
  });

  it('une charge utile sans contactId est refusee avant toute requete', async () => {
    const { deps, etat } = monde();
    await expect(enrichirContactConnu(deps, { organizationId: ORG })).rejects.toThrow();
    expect(etat.sql).toEqual([]);
  });
});

// --------------------------------------------------------------- producteur

interface LigneCandidat {
  readonly organization_id: string;
  readonly contact_id: string;
}

function producteur(candidats: LigneCandidat[]) {
  const sql: string[] = [];
  const query = vi.fn(async (texte: string) => {
    sql.push(texte);
    if (/from organization_settings/i.test(texte)) return { rows: [{ value: 'Europe/Paris' }], rowCount: 1 };
    if (/from contacts/i.test(texte)) return { rows: candidats, rowCount: candidats.length };
    return { rows: [], rowCount: 0 };
  });
  const jobs: { name: string; id: string; data: unknown }[] = [];
  const boss = { insert: async (lot: typeof jobs) => void jobs.push(...lot) };
  return { pool: { query } as unknown as Pool, boss, jobs, sql };
}

describe('enqueueEnrichmentContactsConnus', () => {
  it('le producteur enfile un job pour un contact a linkedin_url sans email ne d’un signal qualified', async () => {
    const { pool, boss, jobs, sql } = producteur([{ organization_id: ORG, contact_id: CONTACT }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux boss réduit à `insert`
    const n = await enqueueEnrichmentContactsConnus(boss as any, pool);
    expect(n).toBe(1);
    expect(jobs).toEqual([
      { name: 'enrichment.contact_connu', id: expect.any(String), data: { organizationId: ORG, contactId: CONTACT } },
    ]);
    // Les trois conditions de sélection sont bien celles qu'on croit. Leur
    // EFFET est prouvé sur Postgres (test/pg-verify/linkedin-enrichissement.sh) ;
    // ici on ne vérifie que la file visée, à un caractère de `enrichment.contacts`.
    const requete = sql.find((s) => /from contacts/i.test(s)) ?? '';
    expect(requete).toMatch(/s\.status = 'qualified'/);
  });

  it('le producteur n’enfile rien pour un contact qui a deja un email', async () => {
    // La sélection vit en SQL : un contact avec email ne remonte pas. Ce qui se
    // vérifie ici, c'est qu'aucun job ne part quand la requête ne rend rien —
    // la preuve que la requête l'exclut est sur Postgres réel.
    const { pool, boss, jobs } = producteur([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux boss réduit à `insert`
    const n = await enqueueEnrichmentContactsConnus(boss as any, pool);
    expect(n).toBe(0);
    expect(jobs).toEqual([]);
  });

  it('deux contacts de la meme organisation ne lisent le fuseau qu’une fois', async () => {
    const autre = '33333333-3333-4333-8333-333333333333';
    const { pool, boss, sql } = producteur([
      { organization_id: ORG, contact_id: CONTACT },
      { organization_id: ORG, contact_id: autre },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux boss réduit à `insert`
    await enqueueEnrichmentContactsConnus(boss as any, pool);
    expect(sql.filter((s) => /from organization_settings/i.test(s))).toHaveLength(1);
  });

  it('l’identifiant de job porte le jour : un contact non traité repart demain', async () => {
    const { pool, boss, jobs } = producteur([{ organization_id: ORG, contact_id: CONTACT }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux boss réduit à `insert`
    await enqueueEnrichmentContactsConnus(boss as any, pool);
    const hier = { ...jobs[0] };
    jobs.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 36 * 3600_000));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- faux boss réduit à `insert`
    await enqueueEnrichmentContactsConnus(boss as any, pool);
    vi.useRealTimers();
    expect(jobs[0]?.id).not.toBe(hier.id);
  });
});

describe('dependancesEnrichissementReelles : la lecture du coût', () => {
  const reponse = (cost?: { credits?: number }): FullEnrichJobResult => ({
    id: 'bulk-1',
    name: 'n',
    status: 'FINISHED',
    ...(cost ? { cost } : {}),
    data: [{ input: {}, custom: { contact_key: 'c_0' }, contact_info: { most_probable_work_email: { email: 'ada@acme.fr' } } }],
  });

  it('rend le coût TEL QUEL quand la réponse en porte un', async () => {
    reponseFullEnrich = () => reponse({ credits: 3.5 });
    const deps = dependancesEnrichissementReelles({} as unknown as Pool, undefined);
    expect((await deps.acheter('k', { linkedin_url: 'u' })).credits).toBe(3.5);
  });

  it('rend `undefined`, et surtout PAS zéro, quand la réponse ne porte aucun coût', async () => {
    reponseFullEnrich = () => reponse();
    const deps = dependancesEnrichissementReelles({} as unknown as Pool, undefined);
    const achat = await deps.acheter('k', { linkedin_url: 'u' });
    expect(achat.credits).toBeUndefined();
    // Un `?? 0` ici rendrait un appel facturé indiscernable d'un appel gratuit.
    expect(achat.credits).not.toBe(0);
    expect(achat.resultat?.contact_info?.most_probable_work_email?.email).toBe('ada@acme.fr');
  });

  it('rend un coût nul quand la réponse dit zéro', async () => {
    reponseFullEnrich = () => reponse({ credits: 0 });
    const deps = dependancesEnrichissementReelles({} as unknown as Pool, undefined);
    expect((await deps.acheter('k', { linkedin_url: 'u' })).credits).toBe(0);
  });
});

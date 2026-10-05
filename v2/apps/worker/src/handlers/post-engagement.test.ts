import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Pool } from 'pg';

vi.mock('@jay-reach/providers/enrichment', () => ({
  resolveCompanyNaf: vi.fn(async () => ({ siren: '123456789', naf_code: '7010Z' })),
}));

import { resolveCompanyNaf } from '@jay-reach/providers/enrichment';
import { normaliserUrlPost } from '@jay-reach/core';
import { ecarterEngageur, enregistrerEngageur, type Engageur } from './post-engagement.js';
import { runQualify } from './qualify.js';
import { runScore } from './score.js';

afterEach(() => {
  vi.clearAllMocks();
});

const ORG = 'org-1';
const SOURCE = 'source-1';
const URL_POST = 'https://www.linkedin.com/posts/jean-dupont_cold-email-abcd';
const CAMPAGNE = { id: 'campagne-1', personaId: 'persona-1' };
const ALICE: Engageur = { urn: 'urn:li:fsd_profile:ACoAAalice', nom: 'Alice Martin', intitule: 'Directrice commerciale chez Acme' };

interface Contact {
  id: string;
  email: string | null;
  linkedin_url: string | null;
  linkedin_provider_id: string | null;
  source_signal_id: string | null;
  persona_id: string | null;
  first_name: string | null;
}

/**
 * Modèle EN MÉMOIRE des quatre tables touchées, adossé à un pool factice. Il
 * ne prouve que l'enchaînement des décisions : le SQL lui-même est exécuté sur
 * Postgres par test/pg-verify/linkedin-chemin-personne.sh.
 */
function modele(init: { contacts?: Contact[]; ecartes?: string[]; enrolled?: string[] } = {}) {
  const etat = {
    contacts: [...(init.contacts ?? [])],
    signals: new Map<string, string>(), // external_id -> id
    ecartes: new Set(init.ecartes ?? []),
    enrolled: new Set(init.enrolled ?? []), // linkedin_url déjà en campagne
    suppressions: [] as string[],
    insertsContact: 0,
    insertsSignal: 0,
  };
  let n = 0;
  const query = vi.fn(async (sql: string, p: unknown[] = []) => {
    if (/from linkedin_engageurs_ecartes/i.test(sql)) {
      return { rows: etat.ecartes.has(String(p[1])) ? [{ one: 1 }] : [], rowCount: 0 };
    }
    if (/from signals/i.test(sql) && /post_engagement/i.test(sql) && /^\s*select/i.test(sql)) {
      const id = etat.signals.get(String(p[1]));
      return { rows: id ? [{ id }] : [], rowCount: id ? 1 : 0 };
    }
    if (/from enrollments/i.test(sql)) {
      return { rows: etat.enrolled.has(String(p[1])) ? [{ one: 1 }] : [], rowCount: 0 };
    }
    if (/insert into signals/i.test(sql)) {
      etat.insertsSignal++;
      const id = `signal-${++n}`;
      etat.signals.set(String(p[2]), id);
      return { rows: [{ id }], rowCount: 1 };
    }
    if (/^\s*select[\s\S]*from contacts/i.test(sql)) {
      const c = etat.contacts.find((x) => x.linkedin_url === p[1] || (p[2] && x.linkedin_provider_id === p[2]));
      return { rows: c ? [{ id: c.id }] : [], rowCount: c ? 1 : 0 };
    }
    if (/update contacts/i.test(sql)) {
      const c = etat.contacts.find((x) => x.id === p[1]);
      if (c) {
        c.linkedin_url = c.linkedin_url ?? String(p[2]);
        c.linkedin_provider_id = c.linkedin_provider_id ?? String(p[3]);
      }
      return { rows: [], rowCount: 1 };
    }
    if (/insert into contacts/i.test(sql)) {
      etat.insertsContact++;
      etat.contacts.push({
        id: `contact-${++n}`,
        email: null,
        linkedin_url: String(p[5]),
        linkedin_provider_id: String(p[6]),
        source_signal_id: String(p[7]),
        persona_id: String(p[1]),
        first_name: String(p[2]),
      });
      return { rows: [], rowCount: 1 };
    }
    if (/delete from contacts/i.test(sql)) {
      etat.contacts = etat.contacts.filter((c) => c.source_signal_id !== p[1]);
      return { rows: [], rowCount: 1 };
    }
    if (/delete from signals/i.test(sql)) {
      for (const [ext, id] of etat.signals) if (id === p[1]) etat.signals.delete(ext);
      return { rows: [{ source_id: SOURCE }], rowCount: 1 };
    }
    if (/insert into linkedin_engageurs_ecartes/i.test(sql)) {
      // Forme insert ... select : l'external_id est lu sur le signal, par son id.
      for (const [ext, id] of etat.signals) if (id === p[1]) etat.ecartes.add(ext);
      return { rows: [], rowCount: 1 };
    }
    if (/update source_runs/i.test(sql)) return { rows: [], rowCount: 1 };
    throw new Error(`requête non prévue par le test :\n${sql}`);
  });
  return { etat, query, pool: { query } as unknown as Pool };
}

const ctxDe = (pool: Pool) => ({ pool, organizationId: ORG, sourceId: SOURCE });

describe('enregistrerEngageur', () => {
  it('un engageur nouveau devient un signal et un contact portant persona, signal d origine et adresse', async () => {
    const m = modele();
    const r = await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    expect(r).toBe('nouveau');
    expect(m.etat.insertsSignal).toBe(1);
    expect(m.etat.contacts).toHaveLength(1);
    expect(m.etat.contacts[0]).toMatchObject({
      persona_id: 'persona-1',
      source_signal_id: 'signal-1',
      linkedin_provider_id: 'ACoAAalice',
      first_name: 'Alice',
    });
    expect(m.etat.contacts[0]?.linkedin_url).toContain('ACoAAalice');
  });

  it('un engageur deja connu comme contact par un signal d entreprise est rattache, pas duplique', async () => {
    const connu: Contact = {
      id: 'contact-0',
      email: 'alice@acme.fr',
      linkedin_url: null,
      linkedin_provider_id: 'ACoAAalice',
      source_signal_id: 'signal-entreprise',
      persona_id: 'persona-1',
      first_name: 'Alice',
    };
    const m = modele({ contacts: [connu] });
    const r = await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    expect(r).toBe('nouveau');
    expect(m.etat.insertsContact).toBe(0);
    expect(m.etat.contacts).toHaveLength(1);
    expect(m.etat.contacts[0]).toMatchObject({
      email: 'alice@acme.fr',
      source_signal_id: 'signal-entreprise',
    });
    expect(m.etat.contacts[0]?.linkedin_url).toContain('ACoAAalice');
  });

  it('le meme engageur sur le meme post rend doublon au second passage', async () => {
    const m = modele();
    expect(await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST)).toBe('nouveau');
    expect(await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST)).toBe('doublon');
    expect(m.etat.insertsSignal).toBe(1);
    expect(m.etat.contacts).toHaveLength(1);
  });

  it('un engageur deja ecarte n\'est pas rescore au passage suivant', async () => {
    const m = modele();
    await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    await ecarterEngageur(m.pool, ORG, 'signal-1');
    const avant = m.etat.insertsSignal;
    const r = await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    expect(r).toBe('ecarte');
    expect(m.etat.insertsSignal).toBe(avant);
  });

  it('une personne deja inscrite en campagne n\'est pas recreee', async () => {
    const m = modele({ enrolled: ['https://www.linkedin.com/in/ACoAAalice'] });
    const r = await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    expect(r).toBe('deja_en_campagne');
    expect(m.etat.insertsSignal).toBe(0);
  });
});

describe('normalisation et adresse de profil', () => {
  it('deux ecritures du meme post donnent un seul signal', async () => {
    const m = modele();
    const c = ctxDe(m.pool);
    const brut = `${URL_POST}/?utm_source=share`;
    expect(await enregistrerEngageur(c, ALICE, CAMPAGNE, URL_POST)).toBe('nouveau');
    expect(await enregistrerEngageur(c, ALICE, CAMPAGNE, brut)).toBe('doublon');
    expect(m.etat.insertsSignal).toBe(1);
    // L'external_id est construit sur l'adresse normalisée, jamais sur la brute.
    expect([...m.etat.signals.keys()][0]).toBe(`${normaliserUrlPost(URL_POST)}:${ALICE.urn}`);
  });

  it('une adresse de profil fournie est utilisee telle quelle', async () => {
    const m = modele();
    const e: Engageur = { ...ALICE, urlProfil: 'https://www.linkedin.com/in/alice-martin-123' };
    await enregistrerEngageur(ctxDe(m.pool), e, CAMPAGNE, URL_POST);
    expect(m.etat.contacts[0]?.linkedin_url).toBe('https://www.linkedin.com/in/alice-martin-123');
    // Le rattachement garde l'identifiant de membre tiré de l'URN.
    expect(m.etat.contacts[0]?.linkedin_provider_id).toBe('ACoAAalice');
  });

  it('une adresse fournie sous une autre forme est ramenee a la forme canonique', async () => {
    const m = modele();
    const e: Engageur = { ...ALICE, urlProfil: 'HTTPS://fr.linkedin.com/in/alice-martin-123/?trk=x' };
    await enregistrerEngageur(ctxDe(m.pool), e, CAMPAGNE, URL_POST);
    expect(m.etat.contacts[0]?.linkedin_url).toBe('https://www.linkedin.com/in/alice-martin-123');
  });
});

describe('ecarterEngageur', () => {
  it('un engageur ecarte est efface avec son contact, et son external_id reste dans linkedin_engageurs_ecartes', async () => {
    const m = modele();
    await enregistrerEngageur(ctxDe(m.pool), ALICE, CAMPAGNE, URL_POST);
    expect(m.etat.contacts).toHaveLength(1);

    await ecarterEngageur(m.pool, ORG, 'signal-1');

    expect(m.etat.contacts).toHaveLength(0);
    expect(m.etat.signals.size).toBe(0);
    const ordre = m.query.mock.calls.map((c) => String(c[0]).trim().split(/\s+/).slice(0, 3).join(' ').toLowerCase());
    // La mémoire d'écart est posée AVANT l'effacement : un arrêt entre les deux
    // laisse un signal rescorable, jamais un engageur recréé.
    expect(ordre.findIndex((o) => o.includes('into linkedin_engageurs_ecartes'))).toBeLessThan(
      ordre.findIndex((o) => /^delete from signals/.test(o)),
    );
    expect([...m.etat.ecartes]).toEqual([`${normaliserUrlPost(URL_POST)}:${ALICE.urn}`]);
  });
});

describe('qualify', () => {
  it('qualify ne tente aucune resolution INSEE pour le kind post_engagement', async () => {
    const r = await runQualify({ organizationId: ORG, companyName: 'Acme', signalId: 's', kind: 'post_engagement' });
    expect(r).toBeNull();
    expect(resolveCompanyNaf).not.toHaveBeenCalled();
  });

  it('qualify résout toujours l entreprise pour un signal d entreprise', async () => {
    await runQualify({ organizationId: ORG, companyName: 'Acme', signalId: 's' });
    expect(resolveCompanyNaf).toHaveBeenCalledTimes(1);
  });
});

describe('score', () => {
  it('score.ts selectionne les signaux post_engagement et juge l\'intitule avec la consigne du persona', async () => {
    const CONSIGNE_PERSONA = 'Tu juges un directeur commercial pour une offre de formation. '.repeat(5);
    const requetes: string[] = [];
    const pool = {
      query: vi.fn(async (sql: string) => {
        requetes.push(sql);
        if (/from public\.signals s/i.test(sql) && /post_engagement/.test(sql) && /limit \$2/i.test(sql)) {
          return {
            rows: [
              {
                id: 'signal-1', company: null, title: 'Directrice commerciale chez Acme', location: null,
                description: null, occurred_at: new Date().toISOString(), naf_code: null, opposition: null,
                source_id: SOURCE, kind: 'post_engagement', scoring_prompt: CONSIGNE_PERSONA, match_threshold: null,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    } as unknown as Pool;
    const scorer = vi.fn(async (ps: readonly { id: string }[], _consigne: string) => ps.map((p) => ({ id: p.id, score: 80, reason: 'ok' })));

    const r = await runScore({ pool, organizationId: ORG, scorer });

    expect(scorer).toHaveBeenCalledTimes(1);
    expect(scorer.mock.calls[0]?.[1]).toBe(CONSIGNE_PERSONA);
    expect(r.qualified).toBe(1);
    const selection = requetes.find((s) => /limit \$2/i.test(s)) ?? '';
    expect(selection).toMatch(/s\.kind = 'post_engagement'/);
    expect(selection).toMatch(/personas/);
  });
});

// Vérifie la couche de persistance de l'enrichissement (nouveau schéma) sur un
// vrai Postgres, sans toucher à l'API FullEnrich : on injecte directement les
// formes de résultats et on contrôle ce qui atterrit dans accounts / contacts.
import { Pool } from 'pg';
import {
  persistCompanyEnrichment,
  persistEnrichedContact,
  mapEmailStatus,
} from './_enrich-persist.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'OK' : 'FAIL'} ${name}`);
  if (!cond) failures += 1;
}

async function newAccount(name) {
  const r = await pool.query(
    `insert into accounts (organization_id, name, resolution_status) values ($1,$2,'resolved') returning id`,
    [ORG, name],
  );
  return r.rows[0].id;
}

// 0. Mapping des statuts (pur).
check('map-deliverable-valid', mapEmailStatus('DELIVERABLE').status === 'valid');
check('map-catchall-risky', mapEmailStatus('CATCH_ALL').status === 'risky');
check('map-unknown-default', mapEmailStatus(null).status === 'unknown');

// 1. Enrichissement entreprise.
const accA = await newAccount('Alpha SAS');
await persistCompanyEnrichment(pool, ORG, accA, {
  domain: 'alpha.fr', headcount: 120, city: 'Lyon', industry: 'BTP', providerId: 'fe-123', matchScore: 0.95,
});
const a = (await pool.query(`select domain, headcount, city, enrichment, enriched_at from accounts where id=$1`, [accA])).rows[0];
check('company-domain', a.domain === 'alpha.fr');
check('company-headcount', a.headcount === 120);
check('company-enrichment-jsonb', a.enrichment?.industry === 'BTP' && a.enrichment?.providerId === 'fe-123');
check('company-enriched-at', a.enriched_at !== null);

// 2. Collision de domaine (index unique org,domain) → garde le reste sans le domaine.
const accB = await newAccount('Alpha Homonyme');
await persistCompanyEnrichment(pool, ORG, accB, { domain: 'alpha.fr', headcount: 50, industry: 'Autre' });
const b = (await pool.query(`select domain, headcount, enrichment from accounts where id=$1`, [accB])).rows[0];
check('company-domain-collision-null', b.domain === null);
check('company-domain-collision-keeps-rest', b.headcount === 50 && b.enrichment?.industry === 'Autre');

// 3. Contact enrichi avec email → statut mappé + confiance.
const id1 = await persistEnrichedContact(pool, ORG, accA, {
  firstName: 'Jean', lastName: 'Martin', jobTitle: 'DAF',
  email: 'jean@alpha.fr', emailStatusRaw: 'DELIVERABLE', linkedinUrl: 'https://lnkd/in/jm',
});
check('contact-inserted', typeof id1 === 'string');
const c1 = (await pool.query(`select email_status, email_confidence, job_title, account_id from contacts where email='jean@alpha.fr'`)).rows[0];
check('contact-status-valid', c1.email_status === 'valid');
check('contact-confidence', Number(c1.email_confidence) === 0.9);
check('contact-linked-to-account', c1.account_id === accA);

// 4. Dédup : même email → mise à jour, pas de doublon.
await persistEnrichedContact(pool, ORG, accA, { firstName: 'Jean', lastName: 'Martin', jobTitle: 'Directeur Financier', email: 'jean@alpha.fr', emailStatusRaw: 'CATCH_ALL' });
const cnt = (await pool.query(`select count(*)::int n from contacts where organization_id=$1 and lower(email)='jean@alpha.fr'`, [ORG])).rows[0].n;
check('contact-dedup-single-row', cnt === 1);
const c2 = (await pool.query(`select email_status, job_title from contacts where email='jean@alpha.fr'`)).rows[0];
check('contact-dedup-updates-status', c2.email_status === 'risky' && c2.job_title === 'Directeur Financier');

// 5. Sans email → pas de ligne, retour null.
const before = (await pool.query(`select count(*)::int n from contacts where organization_id=$1`, [ORG])).rows[0].n;
const idNull = await persistEnrichedContact(pool, ORG, accA, { firstName: 'Sans', lastName: 'Email', email: null });
const after = (await pool.query(`select count(*)::int n from contacts where organization_id=$1`, [ORG])).rows[0].n;
check('contact-no-email-null', idNull === null && before === after);

await pool.end();
if (failures > 0) {
  console.log(`=== ENRICH PERSIST FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('=== ENRICH PERSIST OK ===');

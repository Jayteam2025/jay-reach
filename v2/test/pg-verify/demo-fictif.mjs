// Démo FICTIVE de la chaîne moteur complète, SANS aucune clé d'API.
// On simule les providers externes (scraper d'offres, FullEnrich) par des
// données inventées, mais on exécute le VRAI code de persistance + chaînage
// du worker contre la vraie base locale, puis on montre l'état final.
//
// Bundles produits par le .sh : ./_demo-db.mjs et ./_demo-persist.mjs
import { Pool } from 'pg';
import { insertSignals, upsertResolvedAccount, startSourceRun, finishSourceRun } from './_demo-db.mjs';
import { persistCompanyEnrichment, persistEnrichedContact } from './_demo-persist.mjs';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const SOURCE = process.env.TEST_SOURCE;

// ── Données INVENTÉES (ce que renverraient les providers avec de vraies clés) ──
const FIXTURES = [
  { company: 'Atelier Vernier', job: 'Responsable ADV H/F', city: 'Lyon (69)', siren: '843291774', naf: '46.90Z',
    domain: 'atelier-vernier.fr', headcount: 45, industry: 'Négoce', first: 'Julien', last: 'Ferrand', title: 'Directeur Administratif et Financier', email: 'julien.ferrand@atelier-vernier.fr', status: 'DELIVERABLE' },
  { company: 'Groupe Halden', job: 'Directeur commercial', city: 'Paris (75)', siren: '512874109', naf: '70.22Z',
    domain: 'groupe-halden.com', headcount: 220, industry: 'Conseil', first: 'Sofia', last: 'Meunier', title: 'VP Sales', email: 'sofia.meunier@groupe-halden.com', status: 'CATCH_ALL' },
  { company: 'Novaterre', job: 'Ingénieur avant-vente', city: 'Nantes (44)', siren: '790451226', naf: '62.01Z',
    domain: 'novaterre.fr', headcount: 88, industry: 'Logiciel', first: 'Marc', last: 'Delaunay', title: 'Head of Sales', email: 'marc.delaunay@novaterre.fr', status: 'DELIVERABLE' },
  { company: 'Camille & Fils', job: 'Chargé de développement', city: 'Bordeaux (33)', siren: '331005478', naf: '46.90Z',
    domain: 'camille-fils.fr', headcount: 30, industry: 'Distribution', first: 'Camille', last: 'Rousseau', title: 'Directrice commerciale', email: 'c.rousseau@camille-fils.fr', status: 'DELIVERABLE' },
  // Cas sans email : l'enrichissement ne le persiste pas (garde-fou), on le montre.
  { company: 'Société Témoin', job: 'Commercial itinérant', city: 'Lyon (69)', siren: '843291775', naf: '46.90Z',
    domain: 'societe-temoin.fr', headcount: 60, industry: 'Négoce', first: 'Inès', last: 'Baron', title: 'Responsable des ventes', email: null, status: null },
];

function fakeSignals() {
  return FIXTURES.map((f, i) => ({
    signal_type: 'job_posting',
    source_url: `https://mock.francetravail/offre/${f.siren}-${i}`,
    extracted_data: { company_name: f.company, job_title: f.job, location: f.city, posted_date: null },
  }));
}

const log = (s) => console.log(s);
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

async function main() {
  // Repartir propre pour cette org.
  await pool.query('delete from contacts where organization_id = $1', [ORG]);
  await pool.query('delete from accounts where organization_id = $1', [ORG]);
  await pool.query('delete from signals where organization_id = $1', [ORG]);

  log('=== DÉMO FICTIVE — chaîne complète, SANS clés d’API ===\n');

  // 1. Détection (mock scraper) → écriture des signaux (vrai code).
  log('[1/4] Détection  : 5 offres simulées (scraper mocké, pas de clé)');
  const runId = await startSourceRun(pool, SOURCE);
  const signals = fakeSignals();
  const inserted = await insertSignals(pool, ORG, SOURCE, 'francetravail', signals);
  log(`[2/4] Signaux    : ${inserted.length} nouveaux écrits en base (dédup incluse)`);

  // 2. Qualification (SIREN/NAF fictifs) → comptes résolus (vrai code + chaînage).
  let resolved = 0;
  let enrichedCompanies = 0;
  let contactsSaved = 0;
  let contactsSkipped = 0;

  for (const sig of inserted) {
    const f = FIXTURES.find((x) => x.company === sig.companyName);
    if (!f) continue;
    const accountId = await upsertResolvedAccount(pool, {
      organizationId: ORG,
      name: f.company,
      siren: f.siren,
      nafCode: f.naf,
      trusted: true,
    });
    resolved += 1;

    // 3. Enrichissement entreprise (firmographie fictive).
    await persistCompanyEnrichment(pool, ORG, accountId, {
      domain: f.domain,
      headcount: f.headcount,
      city: f.city,
      industry: f.industry,
    });
    enrichedCompanies += 1;

    // 4. Enrichissement contact (email fictif). Sans email → non persisté (garde-fou).
    const id = await persistEnrichedContact(pool, ORG, accountId, {
      firstName: f.first,
      lastName: f.last,
      jobTitle: f.title,
      email: f.email,
      emailStatusRaw: f.status,
      linkedinUrl: `https://linkedin.com/in/${f.first}-${f.last}`.toLowerCase(),
      sourceSignalId: sig.signalId,
    });
    if (id) contactsSaved += 1;
    else contactsSkipped += 1;
  }

  await finishSourceRun(pool, runId, { found: signals.length, added: inserted.length, status: 'success' });

  log(`[3/4] Qualif.    : ${resolved} entreprises résolues (SIREN + NAF)`);
  log(`[4/4] Enrichiss. : ${enrichedCompanies} entreprises enrichies · ${contactsSaved} contacts avec email · ${contactsSkipped} sans email (ignoré)\n`);

  // ── État final réel de la base ──
  const counts = await pool.query(
    `select
       (select count(*) from signals  where organization_id=$1) as signaux,
       (select count(*) from accounts where organization_id=$1) as comptes,
       (select count(*) from contacts where organization_id=$1) as contacts`,
    [ORG],
  );
  const c = counts.rows[0];
  log(`--- État final de la base ---  signaux=${c.signaux}  comptes=${c.comptes}  contacts=${c.contacts}\n`);

  const rows = await pool.query(
    `select a.name as company, a.siren, a.naf_code, a.domain,
            ct.first_name, ct.last_name, ct.job_title, ct.email, ct.email_status, ct.email_confidence
       from contacts ct join accounts a on a.id = ct.account_id
      where ct.organization_id = $1
      order by a.name`,
    [ORG],
  );
  log(pad('ENTREPRISE', 18) + pad('SIREN', 11) + pad('CONTACT', 20) + pad('EMAIL', 34) + pad('STATUT', 8) + 'CONF');
  log('─'.repeat(97));
  for (const r of rows.rows) {
    log(
      pad(r.company, 18) +
        pad(r.siren, 11) +
        pad(`${r.first_name} ${r.last_name}`, 20) +
        pad(r.email, 34) +
        pad(r.email_status, 8) +
        String(r.email_confidence ?? ''),
    );
  }

  await pool.end();
  log('\n=== DÉMO FICTIVE OK — toute la chaîne « trouver + préparer » a tourné sans une seule clé ===');
}

main().catch((err) => {
  console.error('DÉMO FAIL', err);
  process.exit(1);
});

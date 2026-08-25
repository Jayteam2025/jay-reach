// Démo de bout en bout : résout de vraies entreprises (API INSEE réelle),
// écrit comptes + signaux dans le nouveau schéma, puis affiche les lignes écrites.
import { createPool, insertSignals, upsertResolvedAccount } from '../src/db.js';
import { resolveCompanyNaf } from '@jay-reach/providers/enrichment';

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error('DATABASE_URL manquant');
  process.exit(2);
}
const pool = createPool(cs);

const org = await pool.query<{ id: string }>(
  `insert into organizations (name, slug) values ('Démo', 'demo-chain') returning id`,
);
const orgId = org.rows[0]!.id;

console.log('→ Qualification (API INSEE réelle) + écriture en base…');
for (const nom of ['La Poste', 'Decathlon', 'Blablacar']) {
  const r = await resolveCompanyNaf(nom);
  await upsertResolvedAccount(pool, {
    organizationId: orgId,
    name: nom,
    siren: r?.siren ?? null,
    nafCode: r?.naf_code ?? null,
    trusted: r?.trusted ?? false,
  });
}

console.log('→ Détection (échantillon) + écriture des signaux…');
const src = await pool.query<{ id: string }>(
  `insert into sources (organization_id, provider_id, name) values ($1, 'adzuna', 'Démo') returning id`,
  [orgId],
);
await insertSignals(pool, orgId, src.rows[0]!.id, 'adzuna', [
  {
    signal_type: 'job_posting' as const,
    source: 'adzuna',
    source_url: 'https://demo.test/offre/1',
    raw_content: '',
    extracted_data: { company_name: 'La Poste', job_title: 'Commercial itinérant H/F', location: 'Paris', posted_date: null },
  },
]);

console.log('\n════════ TABLE accounts (comptes réellement écrits) ════════');
const accs = await pool.query(
  `select name, siren, naf_code, resolution_status as statut from accounts where organization_id = $1 order by name`,
  [orgId],
);
console.table(accs.rows);

console.log('════════ TABLE signals (signaux réellement écrits) ════════');
const sigs = await pool.query(
  `select provider_id as source, title, company_hint as entreprise, location as lieu, status as statut from signals where organization_id = $1`,
  [orgId],
);
console.table(sigs.rows);

await pool.end();
process.exit(0);

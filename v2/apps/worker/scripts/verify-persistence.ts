// Test d'intégration : la résolution d'entreprise s'écrit bien dans le nouveau
// schéma. Exécuté par tsx contre un Postgres où les migrations sont appliquées.
import { createPool, insertSignals, upsertResolvedAccount } from '../src/db.js';

const cs = process.env.DATABASE_URL;
if (!cs) {
  console.error('DATABASE_URL manquant');
  process.exit(2);
}

const pool = createPool(cs);

try {
  const org = await pool.query<{ id: string }>(
    `insert into organizations (name, slug) values ('Persist Test', 'persist-test') returning id`,
  );
  const orgId = org.rows[0]!.id;

  // 1) Rapprochement fiable → compte `resolved` avec SIREN + NAF.
  const id1 = await upsertResolvedAccount(pool, {
    organizationId: orgId,
    name: 'Société X',
    siren: '123456789',
    nafCode: '62.01Z',
    trusted: true,
  });
  const a1 = await pool.query<{ siren: string; resolution_status: string }>(
    `select siren, resolution_status from accounts where id = $1`,
    [id1],
  );
  if (a1.rows[0]!.siren !== '123456789' || a1.rows[0]!.resolution_status !== 'resolved') {
    console.error('FAIL resolved', a1.rows[0]);
    process.exit(1);
  }
  console.log('OK compte résolu écrit (SIREN + NAF, statut resolved)');

  // 2) Rapprochement non fiable (weak) → compte `unresolved`, sans SIREN.
  const id2 = await upsertResolvedAccount(pool, {
    organizationId: orgId,
    name: 'Société Y',
    siren: '999999999',
    nafCode: '00.00Z',
    trusted: false,
  });
  const a2 = await pool.query<{ siren: string | null; resolution_status: string }>(
    `select siren, resolution_status from accounts where id = $1`,
    [id2],
  );
  if (a2.rows[0]!.siren !== null || a2.rows[0]!.resolution_status !== 'unresolved') {
    console.error('FAIL unresolved', a2.rows[0]);
    process.exit(1);
  }
  console.log('OK rapprochement non fiable → unresolved sans SIREN (arbitrage)');

  // 3) Upsert idempotent : même SIREN → même compte, pas de doublon.
  const id3 = await upsertResolvedAccount(pool, {
    organizationId: orgId,
    name: 'Société X (maj)',
    siren: '123456789',
    nafCode: '62.02A',
    trusted: true,
  });
  if (id3 !== id1) {
    console.error('FAIL idempotence', { id1, id3 });
    process.exit(1);
  }
  console.log('OK upsert idempotent (même SIREN → même compte)');

  // 4) Écriture des signaux détectés + déduplication par (source, url).
  const src = await pool.query<{ id: string }>(
    `insert into sources (organization_id, provider_id, name) values ($1, 'adzuna', 'Source test') returning id`,
    [orgId],
  );
  const sourceId = src.rows[0]!.id;
  const sample = [
    { signal_type: 'job_posting' as const, source: 'adzuna', source_url: 'https://x.test/1', raw_content: 'a', extracted_data: { company_name: 'Alpha', job_title: 'Commercial', location: 'Lyon', posted_date: null } },
    { signal_type: 'job_posting' as const, source: 'adzuna', source_url: 'https://x.test/2', raw_content: 'b', extracted_data: { company_name: 'Beta', job_title: 'BizDev', location: 'Paris', posted_date: null } },
  ];
  const n1 = await insertSignals(pool, orgId, sourceId, 'adzuna', sample);
  const n2 = await insertSignals(pool, orgId, sourceId, 'adzuna', sample); // rejeu -> dédup
  const cnt = await pool.query<{ c: number }>(
    `select count(*)::int as c from signals where source_id = $1`,
    [sourceId],
  );
  if (n1 !== 2 || n2 !== 0 || cnt.rows[0]!.c !== 2) {
    console.error('FAIL signals', { n1, n2, count: cnt.rows[0]?.c });
    process.exit(1);
  }
  console.log('OK signaux détectés écrits (2) puis dédupliqués (rejeu → 0 nouveau)');

  console.log('=== PERSISTENCE_OK ===');
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error('FAIL', err);
  process.exit(1);
}

// Vérifie l'orchestration du worker sur un vrai Postgres, de façon hermétique
// (aucune API externe) :
//  - le producteur enfile 1 job par source ACTIVE avec mots-clés (exclut
//    inactives et sans mots-clés), et dédup sur une même fenêtre temporelle ;
//  - le payload ne contient JAMAIS de secret ;
//  - insertSignals ne garde que les job_postings, dédup, et retourne les
//    nouveaux (pour le chaînage) ; seuls ceux avec entreprise partent en qualif ;
//  - le cycle de vie source_runs (running -> success + compteurs).
//
// Les modules du worker sont bundlés par le .sh vers ./_orch-*.mjs.
import PgBoss from 'pg-boss';
import { Pool } from 'pg';
import { enqueueDiscoverForActiveSources } from './_orch-producer.mjs';
import { insertSignals, startSourceRun, finishSourceRun } from './_orch-db.mjs';

const connectionString = process.env.DATABASE_URL;
const ORG = process.env.TEST_ORG;

const pool = new Pool({ connectionString });
let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'OK' : 'FAIL'} ${name}`);
  if (!cond) failures += 1;
}

// --- Jeu d'essai : 4 sources (2 actives+kw, 1 inactive, 1 active sans kw) ---
await pool.query(
  `insert into sources (organization_id, provider_id, name, config, is_active) values
     ($1, 'adzuna',        'A active kw',   '{"keywords":["dev"],"location":"Lyon (69)"}', true),
     ($1, 'francetravail', 'B active kw',   '{"keywords":["commercial"]}',                 true),
     ($1, 'adzuna',        'C inactive',    '{"keywords":["x"]}',                          false),
     ($1, 'adzuna',        'D active nokw', '{}',                                          true)`,
  [ORG],
);
const srcA = (await pool.query(`select id from sources where organization_id=$1 and name='A active kw'`, [ORG])).rows[0].id;

const boss = new PgBoss({ connectionString });
boss.on('error', (e) => console.error('[pg-boss]', e));
await boss.start();
await boss.createQueue('sources.discover', { name: 'sources.discover', retryLimit: 5, retryBackoff: true });
await boss.createQueue('signals.qualify', { name: 'signals.qualify', retryLimit: 5, retryBackoff: true });

// 1. Le producteur enfile 2 jobs (A + B ; exclut C inactive et D sans mots-clés).
const n1 = await enqueueDiscoverForActiveSources(boss, pool, { bucket: 'W1' });
check('producer-enqueues-2-active-with-keywords', n1 === 2);

// 2. Idempotence : rejouer dans la MÊME fenêtre ne crée pas de doublon.
await enqueueDiscoverForActiveSources(boss, pool, { bucket: 'W1' });
const sizeW1 = await boss.getQueueSize('sources.discover');
check('producer-idempotent-same-window', sizeW1 === 2);

// 3. Nouvelle fenêtre => nouveaux jobs.
await enqueueDiscoverForActiveSources(boss, pool, { bucket: 'W2' });
const sizeW2 = await boss.getQueueSize('sources.discover');
check('producer-new-window-new-jobs', sizeW2 === 4);

// 4. Le payload ne contient aucun secret (org/provider/keywords seulement).
const payload = (await pool.query(`select data from pgboss.job where name='sources.discover' limit 1`)).rows[0].data;
const keys = Object.keys(payload).sort().join(',');
const noSecret = !('credentials' in payload) && !('apiKey' in payload) && !('api_key' in payload);
check('discover-payload-no-secret', noSecret);
check('discover-payload-shape', keys.includes('organizationId') && keys.includes('provider') && keys.includes('keywords'));

// 5. insertSignals : garde les job_postings, retourne les nouveaux.
const fakeSignals = [
  { signal_type: 'job_posting', source_url: 'https://x/1', extracted_data: { company_name: 'Alpha SAS', job_title: 'Dev', location: 'Lyon' } },
  { signal_type: 'job_posting', source_url: 'https://x/2', extracted_data: { company_name: null, job_title: 'Sans entreprise' } },
  { signal_type: 'company_news', source_url: 'https://x/3', extracted_data: { company_name: 'Beta' } },
];
const ins = await insertSignals(pool, ORG, srcA, 'adzuna', fakeSignals);
check('insertSignals-keeps-only-jobpostings', ins.length === 2);
check('insertSignals-carries-company', ins.filter((s) => s.companyName).length === 1);

// 6. Dédup : réinsérer les mêmes => 0 nouveau.
const ins2 = await insertSignals(pool, ORG, srcA, 'adzuna', fakeSignals);
check('insertSignals-dedup', ins2.length === 0);

// 7. Cycle de vie source_runs.
const runId = await startSourceRun(pool, srcA);
const running = (await pool.query(`select status from source_runs where id=$1`, [runId])).rows[0].status;
check('source-run-running', running === 'running');
await finishSourceRun(pool, runId, { found: 3, added: 2, status: 'success' });
const done = (await pool.query(`select status, items_found, items_new, finished_at from source_runs where id=$1`, [runId])).rows[0];
check('source-run-finished', done.status === 'success' && done.items_new === 2 && done.items_found === 3 && done.finished_at !== null);

await boss.stop({ graceful: true });
await pool.end();
if (failures > 0) {
  console.log(`=== ORCHESTRATION FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('=== ORCHESTRATION OK ===');

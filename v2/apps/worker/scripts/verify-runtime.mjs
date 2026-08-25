// Test d'intégration du runtime pg-boss contre un vrai Postgres.
// Prouve : traitement d'un job + idempotence (dédup par id de job) + arrêt propre.
import PgBoss from 'pg-boss';
import { randomUUID } from 'node:crypto';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL manquant');
  process.exit(2);
}

const boss = new PgBoss({ connectionString });
boss.on('error', (err) => console.error('[pg-boss]', err));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  await boss.start();

  // 1. Idempotence : deux insertions avec le même id de job => un seul job
  // (un tick rejoué ne crée pas deux actions).
  await boss.createQueue('idem.q', { name: 'idem.q', retryLimit: 3, retryBackoff: true });
  const jobId = randomUUID();
  await boss.insert([{ name: 'idem.q', id: jobId, data: {} }]);
  await boss.insert([{ name: 'idem.q', id: jobId, data: {} }]);
  const size = await boss.getQueueSize('idem.q');
  if (size !== 1) {
    console.error(`FAIL idempotence : ${size} jobs au lieu de 1`);
    process.exit(1);
  }
  console.log('OK idempotence (2 insertions même id -> 1 job)');

  // 2. Traitement : un job envoyé est bien traité par le worker.
  await boss.createQueue('work.q', { name: 'work.q', retryLimit: 3, retryBackoff: true });
  let processed = 0;
  await boss.work('work.q', async () => {
    processed += 1;
  });
  await boss.send('work.q', { hello: 1 });
  const start = Date.now();
  while (processed < 1 && Date.now() - start < 20000) {
    await sleep(200);
  }
  if (processed < 1) {
    console.error('FAIL traitement : job non traité dans le délai');
    process.exit(1);
  }
  console.log('OK traitement (job pris en charge par le worker)');

  await boss.stop({ graceful: true });
  console.log('=== PGBOSS RUNTIME OK ===');
  process.exit(0);
} catch (err) {
  console.error('FAIL runtime', err);
  process.exit(1);
}

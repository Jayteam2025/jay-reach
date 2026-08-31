/** Mesure le cout d'une insertion de signal, telle que insertSignals la fait. */
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const N = Number(process.argv[2] ?? 20);
const t0 = Date.now();
for (let i = 0; i < N; i++) {
  await pool.query(
    `select 1 from signals
      where organization_id = $1 and fingerprint = $2
        and occurred_at > now() - interval '30 days' limit 1`,
    ['eee8d760-63ed-4f14-8867-5d38c5602dc4', `mesure-${i}`],
  );
}
const dt = Date.now() - t0;
console.log(`${N} requetes en ${dt} ms  ->  ${(dt / N).toFixed(1)} ms par requete`);
console.log(`extrapolation pour 978 signaux : ${((dt / N) * 978 / 1000).toFixed(1)} s`);
await pool.end();

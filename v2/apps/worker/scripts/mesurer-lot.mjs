/** Compare l'insertion ligne par ligne et l'insertion par lots, sans rien ecrire. */
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = 'eee8d760-63ed-4f14-8867-5d38c5602dc4';
const N = 200;

// Ligne par ligne : une requete de verification par signal.
let t = Date.now();
for (let i = 0; i < N; i++) {
  await pool.query(
    `select 1 from signals where organization_id = $1 and fingerprint = $2
       and occurred_at > now() - interval '30 days' limit 1`,
    [ORG, `mesure-${i}`],
  );
}
const unParUn = Date.now() - t;

// Par lots de 100 : deux requetes pour les memes 200.
t = Date.now();
for (let d = 0; d < N; d += 100) {
  const lot = Array.from({ length: 100 }, (_, i) => `mesure-${d + i}`);
  const lignes = lot.map((_, n) => `($${n + 2}::text)`).join(', ');
  await pool.query(
    `select v.fp from (values ${lignes}) as v(fp)
      where not exists (select 1 from signals s where s.organization_id = $1
              and s.fingerprint = v.fp and s.occurred_at > now() - interval '30 days')`,
    [ORG, ...lot],
  );
}
const parLots = Date.now() - t;

console.log(`${N} signaux`);
console.log(`  ligne par ligne : ${unParUn} ms`);
console.log(`  par lots de 100 : ${parLots} ms`);
console.log(`  gain : x${(unParUn / parLots).toFixed(1)}`);
console.log(`  extrapolation 978 signaux : ${(unParUn / N * 978 / 1000).toFixed(1)} s -> ${(parLots / N * 978 / 1000).toFixed(1)} s`);
await pool.end();

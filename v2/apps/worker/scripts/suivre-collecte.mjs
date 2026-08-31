import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const depuis = '2026-08-31 12:01:00+00';
for (let i = 0; i < 40; i++) {
  const r = await pool.query(
    `select status, items_found, items_new,
            extract(epoch from (coalesce(finished_at, now()) - started_at))::int as duree_s,
            started_at::timestamp(0)::text as debut
       from source_runs sr
      where started_at > $1 order by started_at desc limit 1`,
    [depuis],
  );
  const l = r.rows[0];
  if (l) {
    console.log(`${l.debut} | ${l.status} | ${l.duree_s}s | ${l.items_found} trouves, ${l.items_new} nouveaux`);
    if (l.status !== 'running') break;
  } else {
    console.log('en attente de la releve…');
  }
  await new Promise((r) => setTimeout(r, 6000));
}
await pool.end();

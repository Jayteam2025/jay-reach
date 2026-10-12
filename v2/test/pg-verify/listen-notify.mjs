// Deux connexions : une écoute, l'autre émet. Délai 10 s, échec bruyant. Aucun secret affiché.
import pg from 'pg';

const CANAL = 'jr_linkedin_connexion';
const DELAI_MS = 10_000;
const port = process.env.PORT;
const u = new URL(process.env.DATABASE_URL);
u.port = port;
const cs = u.toString();
const charge = JSON.stringify({ id: `essai-${Date.now()}`, v: 'é' });

const ecoute = new pg.Client({ connectionString: cs });
const emet = new pg.Client({ connectionString: cs });
let rc = 1;
try {
  await ecoute.connect();
  await emet.connect();
  const recu = new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('delai')), DELAI_MS);
    ecoute.on('notification', (m) => { clearTimeout(t); resolve(m); });
  });
  recu.catch(() => {});
  await ecoute.query(`LISTEN ${CANAL}`);
  const pidA = (await ecoute.query('select pg_backend_pid() p')).rows[0].p;
  const pidB = (await emet.query('select pg_backend_pid() p')).rows[0].p;
  await emet.query('select pg_notify($1, $2)', [CANAL, charge]);
  const m = await recu;
  const ok = m.channel === CANAL && m.payload === charge;
  console.log(`[listen] port ${port} : ${ok ? 'PASS reçu à l\'identique' : 'FAIL charge différente'} (canal ${m.channel}, pid écoute ${pidA}, pid émission ${pidB})`);
  rc = ok ? 0 : 1;
} catch (e) {
  const motif = e instanceof Error && e.message === 'delai' ? `FAIL rien reçu en ${DELAI_MS / 1000} s` : `FAIL ${e instanceof Error ? e.code ?? e.name : 'erreur'}`;
  console.log(`[listen] port ${port} : ${motif}`);
} finally {
  await ecoute.end().catch(() => {});
  await emet.end().catch(() => {});
}
process.exit(rc);

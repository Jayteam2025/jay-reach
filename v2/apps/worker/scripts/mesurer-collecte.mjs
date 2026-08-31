/** Mesure la collecte France Travail avec un budget, avec les vraies clefs du coffre. */
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = 'eee8d760-63ed-4f14-8867-5d38c5602dc4';
const r = await pool.query(
  `select app.get_credential($1, 'francetravail', $2) as secret,
          (select config from credentials where organization_id = $1 and provider_id = 'francetravail') as config`,
  [ORG, process.env.ENCRYPTION_KEY],
);
await pool.end();
const secret = r.rows[0]?.secret;
const config = r.rows[0]?.config ?? {};
if (!secret) { console.error('pas de credential francetravail en base'); process.exit(1); }
// Le coffre porte le secret ; le reste (client_id) vit dans `config`.
const creds = { ...config, client_secret: secret };
console.log('clefs recuperees :', Object.keys(creds).join(', '));

const { franceTravailScraper } = await import('/Users/jayb/DEV/Jay/jay-reach/v2/packages/providers/src/signals/france-travail.ts');
const motsCles = (process.argv[2] ?? 'commercial').split(',');
const budget = Number(process.argv[3] ?? 25000);
console.log(`mots-cles : ${motsCles.length}, budget : ${budget} ms`);

const t0 = Date.now();
const res = await franceTravailScraper.fetch(motsCles, { credentials: creds, budgetMs: budget });
console.log(`duree reelle : ${Date.now() - t0} ms`);
console.log(`signaux : ${res.signals.length}`);
console.log(`erreurs : ${res.errors.length ? res.errors.join(' | ').slice(0, 300) : 'aucune'}`);

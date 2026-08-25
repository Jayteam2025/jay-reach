// Vérifie le pont de résolution des credentials du worker sur un vrai Postgres :
//  - un secret chiffré (coffre) est déchiffré et mappé sur le champ `secret` ;
//  - les champs non-secrets viennent de `config` (jsonb) ;
//  - le repli sur variable d'environnement fonctionne (provider sans ligne) ;
//  - un provider requis mais absent → null (job ignoré proprement).
//
// Le resolver est bundlé par le script .sh (esbuild) vers ./_cred-bridge.mjs.
import { Pool } from 'pg';
import { resolveProviderCredentials } from './_cred-bridge.mjs';

const CONN = process.env.DATABASE_URL;
const ORG = process.env.TEST_ORG;
const KEY = process.env.TEST_KEY;

const pool = new Pool({ connectionString: CONN });
let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`OK ${name}`);
  } else {
    console.log(`FAIL ${name}`);
    failures += 1;
  }
}

// 1. Smartlead : un seul champ secret (api_key), stocké au coffre.
const sl = await resolveProviderCredentials(pool, ORG, 'smartlead', { encryptionKey: KEY });
check('smartlead-secret-roundtrip', sl?.api_key === 'sk-live-9999');

// 2. France Travail : client_id (config) + client_secret (coffre).
const ft = await resolveProviderCredentials(pool, ORG, 'francetravail', { encryptionKey: KEY });
check('francetravail-config-field', ft?.client_id === 'FT-CLIENT-42');
check('francetravail-secret-field', ft?.client_secret === 'ft-secret-XYZ');

// 3. Adzuna : aucune ligne en base → repli sur l'environnement.
process.env.ADZUNA_APP_ID = 'env-app-id';
process.env.ADZUNA_APP_KEY = 'env-app-key';
const az = await resolveProviderCredentials(pool, ORG, 'adzuna', { encryptionKey: KEY });
check('adzuna-env-fallback', az?.app_id === 'env-app-id' && az?.app_key === 'env-app-key');

// 4. Dropcontact : ni coffre ni env → null (champ requis manquant).
delete process.env.DROPCONTACT_API_KEY;
const dc = await resolveProviderCredentials(pool, ORG, 'dropcontact', { encryptionKey: KEY });
check('dropcontact-unconfigured-null', dc === null);

// 5. Sans clé de chiffrement : le coffre est ignoré, seul l'env répond.
const slNoKey = await resolveProviderCredentials(pool, ORG, 'smartlead', {});
check('smartlead-no-key-ignores-vault', slNoKey === null);

await pool.end();
if (failures > 0) {
  console.log(`=== CRED BRIDGE FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('=== CRED BRIDGE OK ===');

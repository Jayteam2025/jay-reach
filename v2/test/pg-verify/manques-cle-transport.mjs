// G7 : preuve par exécution réelle que `manquesPourLancer` lit le statut
// SalesBlink depuis une relation que le pool de service (`ctx.ex`, sans
// contexte Supabase Auth) peut effectivement voir.
//
// `credentials_public` filtre sur `organization_id in (select app.user_orgs())`,
// qui dépend de `auth.uid()` — NULL sur une connexion `pg` brute. Un test qui
// simulerait cette vue avec un faux pool ne verrait jamais ce défaut : il faut
// un vrai Postgres, sans `set_config('test.user_id', ...)`, exactement comme
// en production.
//
// Le bundle est produit par le script .sh (esbuild) vers ./_manques-bundle.mjs.
import { Pool } from 'pg';
import { manquesPourLancer } from './_manques-bundle.mjs';

const CONN = process.env.DATABASE_URL;
const ORG_AVEC_CLE = process.env.TEST_ORG_AVEC_CLE;
const CAMPAGNE_AVEC_CLE = process.env.TEST_CAMPAGNE_AVEC_CLE;
const ORG_SANS_CLE = process.env.TEST_ORG_SANS_CLE;
const CAMPAGNE_SANS_CLE = process.env.TEST_CAMPAGNE_SANS_CLE;

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

function ctxPour(organisationId) {
  // Même forme que `apps/web/lib/contexte.ts` : `ex` = pool `pg` direct, sans
  // aucune session Supabase Auth (jamais de `set_config('test.user_id', …)`).
  return { ex: pool, organisationId, utilisateurId: null, role: 'viewer' };
}

// 1. Organisation avec `credentials.status = 'configured'` pour salesblink :
// le manque « aucune clé SalesBlink configurée » ne doit PAS apparaître.
const manquesAvecCle = await manquesPourLancer(ctxPour(ORG_AVEC_CLE), { campagneId: CAMPAGNE_AVEC_CLE });
check('cle-configuree-aucun-manque', !manquesAvecCle.includes('aucune clé SalesBlink configurée'));

// 2. Organisation SANS ligne credentials pour salesblink : le manque doit
// rester signalé (la correction ne doit pas transformer le contrôle en no-op).
const manquesSansCle = await manquesPourLancer(ctxPour(ORG_SANS_CLE), { campagneId: CAMPAGNE_SANS_CLE });
check('sans-cle-manque-signale', manquesSansCle.includes('aucune clé SalesBlink configurée'));

await pool.end();
if (failures > 0) {
  console.log(`=== MANQUES CLE TRANSPORT FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('=== MANQUES CLE TRANSPORT OK ===');

// Vérif hermétique des RPC de versionnage des templates (T19, éditeur) :
// création de lignée, nouvelle version (désactive l'ancienne), retour arrière,
// indépendance des langues, et unicité « une active par (lignée, langue) ».
// Aucun envoi, aucune UI : on exerce app.save_message_template_version /
// app.activate_message_template_version comme le fera la server action.
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const OWNER = process.env.TEST_USER;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  const c = await pool.connect();
  const q = (sql, params) => c.query(sql, params);

  // Nettoyage (postgres, hors RLS).
  await q(`reset role`);
  await q(`delete from message_templates where organization_id=$1 and name like 'TPLVERIF%'`, [ORG]);

  // Contexte auth : owner de l'org (rang >= admin).
  await q(`set role authenticated`);
  await q(`select set_config('test.user_id', $1, false)`, [OWNER]);

  const save = async (family, body, locale = 'fr') =>
    (
      await q(`select app.save_message_template_version($1,$2,'TPLVERIF Relance','linkedin_message',$3,null,$4) as id`, [
        ORG,
        family,
        locale,
        body,
      ])
    ).rows[0].id;

  console.log('[tpl] 1. Création de lignée + versions');
  const v1 = await save(null, 'Bonjour {{prenom}} — v1');
  const family = v1; // racine : la lignée = son id
  const v2 = await save(family, 'Bonjour {{prenom}} — v2');

  await q(`reset role`);
  const frRows = (
    await q(
      `select id, version, is_active, body from message_templates
        where coalesce(parent_id,id)=$1 and locale='fr' order by version`,
      [family],
    )
  ).rows;
  check('2 versions fr', frRows.length === 2, `n=${frRows.length}`);
  check('seule la v2 est active', frRows.filter((r) => r.is_active).length === 1 && frRows.find((r) => r.is_active)?.version === 2);
  check('la v2 porte le nouveau corps', frRows.find((r) => r.version === 2)?.body.includes('v2'));

  console.log('\n[tpl] 2. Retour arrière (réactiver la v1)');
  await q(`set role authenticated`);
  await q(`select set_config('test.user_id', $1, false)`, [OWNER]);
  await q(`select app.activate_message_template_version($1)`, [v1]);
  await q(`reset role`);
  const afterRollback = (
    await q(`select version, is_active from message_templates where coalesce(parent_id,id)=$1 and locale='fr' order by version`, [family])
  ).rows;
  check('v1 active, v2 désactivée', afterRollback.find((r) => r.version === 1)?.is_active === true && afterRollback.find((r) => r.version === 2)?.is_active === false);

  console.log('\n[tpl] 3. Langue indépendante (variante nl)');
  await q(`set role authenticated`);
  await q(`select set_config('test.user_id', $1, false)`, [OWNER]);
  await save(family, 'Hallo {{prenom}} — nl v1', 'nl');
  await q(`reset role`);
  const actives = (
    await q(`select locale, count(*)::int n from message_templates where coalesce(parent_id,id)=$1 and is_active group by locale order by locale`, [family])
  ).rows;
  check('une active par langue (fr + nl)', actives.length === 2 && actives.every((r) => r.n === 1), JSON.stringify(actives));

  console.log('\n[tpl] 4. Unicité : deux actives pour une même (lignée, langue) impossible');
  let rejected = false;
  try {
    // v2 fr est inactive (après rollback) ; l'activer sans désactiver v1 → viol index.
    await q(`update message_templates set is_active=true where id=$1`, [v2]);
  } catch (e) {
    rejected = e.code === '23505';
  }
  check('collision rejetée (23505)', rejected);

  // Nettoyage.
  await q(`delete from message_templates where organization_id=$1 and name like 'TPLVERIF%'`, [ORG]);
  c.release();
  await pool.end();
  console.log(`\n[tpl] ${failures === 0 ? 'OK — tout est vert' : `ÉCHEC — ${failures} rouge(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[tpl] erreur:', e);
  process.exit(2);
});

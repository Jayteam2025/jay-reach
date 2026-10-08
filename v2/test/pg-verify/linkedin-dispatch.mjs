// Vérif du routage LinkedIn du dispatch : un job `actions.dispatch` de canal LinkedIn
// n'appelle AUCUNE API — il enfile l'action dans linkedin_action_queue, avec la méthode
// `serveur`, et c'est la file `linkedin.envoi` qui l'exécute ensuite. Schéma complet
// (toutes les migrations), données fictives, aucun envoi réel.
//
// Mutations qui font rougir :
//   1. dispatch.ts : `method: 'serveur'` -> `'extension_auto'` : 1b, 1c, 3b rougissent
//      (et la base de ce harnais ne le refuse pas : le check admet encore extension_auto).
//   2. dispatch.ts : rendre la methode du job (`job.linkedin.method`) : 1c rougit.
//   3. migration 20261007130000 retiree : la ligne n'est plus serveur par defaut, mais 1b reste
//      vert (la methode est explicite) ; c'est `linkedin-envoi.sh` (1e) qui tient ce defaut.
import pg from 'pg';
import { runLinkedInDispatch } from './_lkd.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
let ORG;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}

async function main() {
  console.log('[lkd] préparation…');
  ORG = (await pool.query(`insert into organizations (name, slug) values ('Dispatch', 'dispatch-' || gen_random_uuid()) returning id`)).rows[0].id;
  const c1 = (
    await pool.query(
      `insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/carla-fictif') returning id`,
      [ORG],
    )
  ).rows[0].id;

  console.log('\n[lkd] 1. Canal invitation → ligne enfilée (kind=invite)');
  const id1 = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_invite',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1 },
  });
  check('invitation enfilée', typeof id1 === 'string', id1 ?? 'null');
  const row1 = (await pool.query(`select kind, status, message_body from linkedin_action_queue where id = $1`, [id1])).rows[0];
  check('kind=invite, status=pending, sans corps', row1?.kind === 'invite' && row1?.status === 'pending' && row1?.message_body === null);
  const m1 = (await pool.query(`select method from linkedin_action_queue where id = $1`, [id1])).rows[0].method;
  check('1b. la ligne enfilée porte method = serveur', m1 === 'serveur', m1);

  // Un job déposé AVANT le déploiement porte encore l'ancienne méthode : elle n'est plus honorée.
  const ancien = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_invite',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/ancien-job', method: 'extension_auto' },
  });
  const mAncien = (await pool.query(`select method from linkedin_action_queue where id = $1`, [ancien])).rows[0].method;
  check('1c. la méthode portée par un ancien job est ignorée', mAncien === 'serveur', mAncien);
  await pool.query(`delete from linkedin_action_queue where id = $1`, [ancien]);

  console.log('\n[lkd] 2. Dédup : même contact + invite → null');
  const dup = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_invite',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1 },
  });
  check('doublon refusé', dup === null);

  console.log('\n[lkd] 3. Canal message → ligne enfilée (kind=message + corps)');
  const id2 = await runLinkedInDispatch(pool, {
    organizationId: ORG,
    channel: 'linkedin_message',
    linkedin: { linkedinUrl: 'https://www.linkedin.com/in/carla-fictif', contactId: c1, messageBody: 'Bonjour Carla.' },
  });
  check('message enfilé', typeof id2 === 'string', id2 ?? 'null');
  const row2 = (await pool.query(`select kind, message_body from linkedin_action_queue where id = $1`, [id2])).rows[0];
  check('kind=message + corps conservé', row2?.kind === 'message' && row2?.message_body === 'Bonjour Carla.');
  const m2 = (await pool.query(`select method from linkedin_action_queue where id = $1`, [id2])).rows[0].method;
  check('3b. le message porte aussi method = serveur', m2 === 'serveur', m2);

  console.log('\n[lkd] 4. Aucun envoi : tout reste en pending');
  const pending = (await pool.query(`select count(*)::int n from linkedin_action_queue where organization_id = $1 and status = 'pending'`, [ORG])).rows[0].n;
  check('2 actions en attente (rien d’envoyé)', pending === 2, `pending=${pending}`);

  console.log(`\n[lkd] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[lkd] ERREUR', e);
  process.exit(2);
});

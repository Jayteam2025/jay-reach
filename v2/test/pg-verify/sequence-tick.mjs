// Vérif hermétique de la chaîne séquenceur → file LinkedIn (T22 / séquenceur) :
// inscription → tick → action idempotente → job de dispatch → linkedin_action_queue.
// Données fictives ; aucun envoi réel (les lignes restent en pending dans la file).
import pg from 'pg';
import { enrollContact, tickDueEnrollments } from './_seq.mjs';
import { runLinkedInDispatch } from './_lkd.mjs';

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const ORG = process.env.TEST_ORG;
const SOURCE = process.env.TEST_SOURCE;

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? '✅' : '❌'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures++;
}
const q = (sql, params) => pool.query(sql, params);

// Les `next_action_at` sont écrits par la base (`now()`), mais le tick reçoit une
// date calculée par ce processus. Les deux horloges ne sont pas forcément la même :
// sous Colima, celle de la VM Postgres était en avance de ~70 ms, assez pour qu'une
// inscription créée à l'instant ne soit pas encore « due » et que tout le harnais
// échoue. On mesure l'écart une fois et on raisonne dans le temps de la base.
let clockSkew = 0;
async function syncClock() {
  const r = await q('select now() as n');
  clockSkew = new Date(r.rows[0].n).getTime() - Date.now();
}
/** Instant, dans le temps de la base, décalé de `ms`. */
const at = (ms = 0) => new Date(Date.now() + clockSkew + ms);

async function seedCampaign(name, steps) {
  const camp = (
    await q(
      `insert into campaigns (organization_id, name, source_id, status) values ($1,$2,$3,'active') returning id`,
      [ORG, name, SOURCE],
    )
  ).rows[0].id;
  let tplParent = null;
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    let tpl = null;
    if (s.body) {
      tplParent = (
        await q(
          `insert into message_templates (organization_id, name, channel, locale, body) values ($1,$2,$3,'fr',$4) returning id`,
          [ORG, `${name}-tpl-${i}`, s.channel, s.body],
        )
      ).rows[0].id;
      tpl = tplParent;
    }
    await q(
      `insert into sequence_steps (campaign_id, position, channel, delay_hours, template_parent_id) values ($1,$2,$3,$4,$5)`,
      [camp, i, s.channel, s.delay_hours ?? 0, tpl],
    );
  }
  return camp;
}

async function newContact(vanity) {
  return (
    await q(`insert into contacts (organization_id, linkedin_url, email) values ($1,$2,$3) returning id`, [
      ORG,
      `https://www.linkedin.com/in/${vanity}`,
      `${vanity}@example.test`,
    ])
  ).rows[0].id;
}

async function main() {
  await syncClock();
  console.log('[seq] nettoyage + préparation…');
  await q(`delete from actions where organization_id=$1`, [ORG]);
  await q(`delete from enrollments where organization_id=$1`, [ORG]);
  await q(`delete from sequence_steps where campaign_id in (select id from campaigns where organization_id=$1)`, [ORG]);
  await q(`delete from linkedin_action_queue where organization_id=$1`, [ORG]);
  await q(`delete from suppressions where organization_id=$1`, [ORG]);
  await q(`delete from message_templates where organization_id=$1`, [ORG]);
  await q(`delete from smartlead_campaign_mappings where organization_id=$1`, [ORG]);
  await q(`delete from contact_sender_bindings where contact_id in (select id from contacts where organization_id=$1)`, [ORG]);
  await q(`delete from senders where organization_id=$1 and identity like 'SEQ %'`, [ORG]);
  await q(`delete from campaigns where organization_id=$1`, [ORG]);
  await q(`delete from contacts where organization_id=$1 and email like '%@example.test'`, [ORG]);
  await q(`delete from personas where organization_id=$1 and name like 'SEQ %'`, [ORG]);
  await q(`delete from accounts where organization_id=$1 and name like 'SEQ %'`, [ORG]);

  // Le tick exige un expéditeur actif du bon type pour émettre un envoi
  // (docs/04). Sans celui-ci, toute la chaîne LinkedIn partirait en pause.
  await q(
    `insert into senders (organization_id, kind, identity, is_active)
     values ($1,'linkedin','SEQ li-base',true), ($1,'email','SEQ mail-base',true)`,
    [ORG],
  );

  const camp = await seedCampaign('LK fictive', [
    { channel: 'linkedin_invite', delay_hours: 0 },
    { channel: 'linkedin_message', delay_hours: 0, body: 'Bonjour, ravi de vous connecter.' },
  ]);
  const c1 = await newContact('alice-seq');

  console.log('\n[seq] 1. Inscription + dédup');
  const enr = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c1 });
  check('inscription créée', typeof enr === 'string', enr ?? 'null');
  const dup = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c1 });
  check('2e inscription du même contact refusée', dup === null);

  console.log('\n[seq] 2. Tick 1 → étape invitation');
  const jobs1 = await tickDueEnrollments(pool, at());
  check('1 job de dispatch (invite)', jobs1.length === 1 && jobs1[0].channel === 'linkedin_invite', JSON.stringify(jobs1.map((j) => j.channel)));
  const a1 = (await q(`select channel, status from actions where enrollment_id=$1 order by created_at`, [enr])).rows;
  check('action invite enregistrée (scheduled)', a1.length === 1 && a1[0].channel === 'linkedin_invite' && a1[0].status === 'scheduled');
  const e1 = (await q(`select current_step, status from enrollments where id=$1`, [enr])).rows[0];
  check('inscription avancée à l’étape 1', e1.current_step === 1 && e1.status === 'active', `step=${e1.current_step} ${e1.status}`);

  console.log('\n[seq] 3. Dispatch du job → file LinkedIn');
  const qid = await runLinkedInDispatch(pool, jobs1[0]);
  check('invitation enfilée dans linkedin_action_queue', typeof qid === 'string');
  const lk = (await q(`select kind, status from linkedin_action_queue where id=$1`, [qid])).rows[0];
  check('kind=invite, status=pending (aucun envoi)', lk.kind === 'invite' && lk.status === 'pending');

  console.log('\n[seq] 4. Tick 2 → étape message (corps du template)');
  const jobs2 = await tickDueEnrollments(pool, at(1000));
  check('1 job de dispatch (message + corps)', jobs2.length === 1 && jobs2[0].channel === 'linkedin_message' && jobs2[0].linkedin.messageBody === 'Bonjour, ravi de vous connecter.', JSON.stringify(jobs2[0]?.linkedin));
  const e2 = (await q(`select current_step, status, next_action_at from enrollments where id=$1`, [enr])).rows[0];
  check('inscription terminée (completed)', e2.status === 'completed' && e2.next_action_at === null, e2.status);

  console.log('\n[seq] 5. Idempotence : tick rejoué → aucune nouvelle action');
  const before = (await q(`select count(*)::int n from actions where organization_id=$1`, [ORG])).rows[0].n;
  await tickDueEnrollments(pool, at(2000));
  const after = (await q(`select count(*)::int n from actions where organization_id=$1`, [ORG])).rows[0].n;
  check('nombre d’actions inchangé', before === after, `${before}→${after}`);

  console.log('\n[seq] 6. Suppression → action bloquée + arrêt');
  const c2 = await newContact('bob-seq');
  await q(`insert into suppressions (organization_id, scope, value, origin) values ($1,'linkedin',$2,'manual')`, [
    ORG,
    'https://www.linkedin.com/in/bob-seq',
  ]);
  const enr2 = await enrollContact(pool, { organizationId: ORG, campaignId: camp, contactId: c2 });
  const jobs3 = await tickDueEnrollments(pool, at(3000));
  const blocked = (await q(`select status, block_reason from actions where enrollment_id=$1`, [enr2])).rows[0];
  check('aucun job de dispatch pour le contact supprimé', jobs3.every((j) => j.linkedin?.contactId !== c2));
  check('action bloquée (suppression)', blocked?.status === 'blocked' && blocked?.block_reason === 'suppression');
  const e3 = (await q(`select status, stop_reason from enrollments where id=$1`, [enr2])).rows[0];
  check('inscription arrêtée', e3.status === 'stopped' && e3.stop_reason === 'suppression');

  // --- Étape 7 : canal email → Smartlead, mapping PAR PERSONA (review #20) ------
  console.log('\n[seq] 7. Canal email : campagne Smartlead résolue par persona');
  const persona = (
    await q(`insert into personas (organization_id, name) values ($1,'SEQ Directeur de site') returning id`, [ORG])
  ).rows[0].id;
  const account = (
    await q(`insert into accounts (organization_id, name, domain) values ($1,'SEQ Usine Nord','usine-nord.fr') returning id`, [ORG])
  ).rows[0].id;
  // email_status pilote le gate de délivrabilité : seul 'valid' passe vers Smartlead.
  const mkMailContact = async (v, emailStatus = 'valid') =>
    (
      await q(
        `insert into contacts (organization_id, persona_id, account_id, email, email_status, first_name, last_name)
         values ($1,$2,$3,$4,$5::email_status,'Jean','Test') returning id`,
        [ORG, persona, account, `seqmail-${v}@example.test`, emailStatus],
      )
    ).rows[0].id;

  const mailCamp = await seedCampaign('SEQ email', [{ channel: 'email', delay_hours: 0 }]);

  // Mapping activé (persona → campagne Smartlead SL-EMAIL-77).
  await q(
    `insert into smartlead_campaign_mappings (organization_id, persona_id, campaign_id, campaign_name, enabled)
     values ($1,$2,'SL-EMAIL-77','Prospection Directeurs',true)`,
    [ORG, persona],
  );
  const cm1 = await mkMailContact('on');
  const enrM1 = await enrollContact(pool, { organizationId: ORG, campaignId: mailCamp, contactId: cm1 });
  const jobsM1 = (await tickDueEnrollments(pool, at(10000))).filter((j) => j.channel === 'email');
  check(
    '1 job email vers la campagne Smartlead de la persona (SL-EMAIL-77)',
    jobsM1.length === 1 && jobsM1[0].campaignId === 'SL-EMAIL-77',
    JSON.stringify(jobsM1.map((j) => j.campaignId)),
  );
  check(
    'lead assemblé (email + société depuis le compte)',
    jobsM1[0]?.leads?.[0]?.email === 'seqmail-on@example.test' && jobsM1[0]?.leads?.[0]?.company_name === 'SEQ Usine Nord',
    JSON.stringify(jobsM1[0]?.leads?.[0]),
  );
  const aM1 = (await q(`select channel, status from actions where enrollment_id=$1`, [enrM1])).rows[0];
  check('action email enregistrée', aM1?.channel === 'email');

  // Gate de délivrabilité : un email NON `valid` (ici invalid) ne part jamais.
  const cmBad = await mkMailContact('bad', 'invalid');
  const enrBad = await enrollContact(pool, { organizationId: ORG, campaignId: mailCamp, contactId: cmBad });
  const jobsBad = (await tickDueEnrollments(pool, at(10500))).filter(
    (j) => j.channel === 'email' && j.leads?.[0]?.email === 'seqmail-bad@example.test',
  );
  check('email invalide → aucun push Smartlead', jobsBad.length === 0);
  const aBad = (await q(`select status, block_reason from actions where enrollment_id=$1`, [enrBad])).rows[0];
  check(
    'action bloquée par le gate (email_gate)',
    aBad?.status === 'blocked' && String(aBad?.block_reason).startsWith('email_gate:'),
    `${aBad?.status}/${aBad?.block_reason}`,
  );

  // Mapping désactivé (enabled=false) : suspension sans perte d'identifiant.
  await q(`update smartlead_campaign_mappings set enabled=false where organization_id=$1 and persona_id=$2`, [ORG, persona]);
  const cm2 = await mkMailContact('off');
  await enrollContact(pool, { organizationId: ORG, campaignId: mailCamp, contactId: cm2 });
  const jobsM2 = (await tickDueEnrollments(pool, at(11000))).filter(
    (j) => j.channel === 'email' && j.leads?.[0]?.email === 'seqmail-off@example.test',
  );
  check('mapping désactivé → aucun envoi dispatché (action planifiée)', jobsM2.length === 0);
  const stillMapped = (
    await q(`select campaign_id from smartlead_campaign_mappings where organization_id=$1 and persona_id=$2`, [ORG, persona])
  ).rows[0];
  check('identifiant Smartlead conservé malgré la suspension', stillMapped?.campaign_id === 'SL-EMAIL-77');

  // --- Étape 8 : rendu des variables + blocage missing_variable/missing_locale (T19) -
  console.log('\n[seq] 8. Variables de message : rendu, blocage variable/langue');
  // Campagne message LinkedIn avec un corps à variables (template locale fr créé
  // par seedCampaign). {{prenom}} et {{entreprise}} sont « always ».
  const varCamp = await seedCampaign('SEQ variables', [
    { channel: 'linkedin_message', delay_hours: 0, body: 'Bonjour {{prenom}} chez {{entreprise}}' },
  ]);
  const mkVarContact = async (v, { locale, firstName }) =>
    (
      await q(
        `insert into contacts (organization_id, persona_id, account_id, linkedin_url, email, first_name, last_name, locale)
         values ($1,$2,$3,$4,$5,$6,'Test',$7) returning id`,
        [ORG, persona, account, `https://www.linkedin.com/in/${v}`, `seqmail-${v}@example.test`, firstName, locale],
      )
    ).rows[0].id;

  // (a) fr + prénom présent → rendu substitué, dispatché.
  const cvOk = await mkVarContact('var-ok', { locale: 'fr', firstName: 'Marie' });
  const enrOk = await enrollContact(pool, { organizationId: ORG, campaignId: varCamp, contactId: cvOk });
  const jOk = (await tickDueEnrollments(pool, at(20000))).filter(
    (j) => j.channel === 'linkedin_message' && j.linkedin?.contactId === cvOk,
  );
  check(
    'variables substituées dans le corps dispatché',
    jOk.length === 1 && jOk[0].linkedin.messageBody === 'Bonjour Marie chez SEQ Usine Nord',
    JSON.stringify(jOk[0]?.linkedin?.messageBody),
  );
  const aOk = (await q(`select template_id from actions where enrollment_id=$1`, [enrOk])).rows[0];
  check('version de template tracée (actions.template_id)', aOk?.template_id != null);

  // (b) fr + prénom manquant → bloqué missing_variable, pas de dispatch.
  const cvMiss = await mkVarContact('var-miss', { locale: 'fr', firstName: null });
  const enrMiss = await enrollContact(pool, { organizationId: ORG, campaignId: varCamp, contactId: cvMiss });
  const jMiss = (await tickDueEnrollments(pool, at(21000))).filter(
    (j) => j.channel === 'linkedin_message' && j.linkedin?.contactId === cvMiss,
  );
  check('variable manquante → aucun dispatch', jMiss.length === 0);
  const aMiss = (await q(`select status, block_reason, payload from actions where enrollment_id=$1`, [enrMiss])).rows[0];
  check(
    'action bloquée missing_variable, champ nommé (prenom)',
    aMiss?.status === 'blocked' && aMiss?.block_reason === 'missing_variable' && JSON.stringify(aMiss?.payload?.missingVariables) === '["prenom"]',
    `${aMiss?.status}/${aMiss?.block_reason}/${JSON.stringify(aMiss?.payload?.missingVariables)}`,
  );
  const eMiss = (await q(`select status from enrollments where id=$1`, [enrMiss])).rows[0];
  check('inscription non arrêtée (récupérable)', eMiss?.status === 'active');

  // (c) langue sans variante (nl) → bloqué missing_locale.
  const cvLoc = await mkVarContact('var-loc', { locale: 'nl', firstName: 'Jan' });
  const enrLoc = await enrollContact(pool, { organizationId: ORG, campaignId: varCamp, contactId: cvLoc });
  const jLoc = (await tickDueEnrollments(pool, at(22000))).filter(
    (j) => j.channel === 'linkedin_message' && j.linkedin?.contactId === cvLoc,
  );
  check('langue absente → aucun dispatch', jLoc.length === 0);
  const aLoc = (await q(`select status, block_reason from actions where enrollment_id=$1`, [enrLoc])).rows[0];
  check('action bloquée missing_locale', aLoc?.status === 'blocked' && aLoc?.block_reason === 'missing_locale', `${aLoc?.status}/${aLoc?.block_reason}`);


  console.log('\n[seq] 9. Attribution de l’expéditeur (lien à vie par canal)');
  // On écarte l'expéditeur de base pour que le duel A/B soit sans ambiguïté.
  await q(`update senders set is_active=false where organization_id=$1 and kind='linkedin'`, [ORG]);
  // Deux expéditeurs LinkedIn : le moins consommé doit gagner la première attribution.
  const sndA = (await q(
    `insert into senders (organization_id, kind, identity, is_active) values ($1,'linkedin','SEQ li-A',true) returning id`,
    [ORG],
  )).rows[0].id;
  const sndB = (await q(
    `insert into senders (organization_id, kind, identity, is_active) values ($1,'linkedin','SEQ li-B',true) returning id`,
    [ORG],
  )).rows[0].id;
  // On charge artificiellement A pour que B soit le moins consommé.
  await q(
    `insert into actions (organization_id, enrollment_id, channel, status, idempotency_key, sender_id)
     select $1, id, 'linkedin_invite', 'dispatched', 'seq-charge-'||id, $2 from enrollments where organization_id=$1 limit 1`,
    [ORG, sndA],
  );

  const sndCamp = await seedCampaign('LK expediteur', [
    { channel: 'linkedin_invite', delay_hours: 0 },
    { channel: 'linkedin_message', delay_hours: 0, body: 'Suite de la conversation.' },
  ]);
  const cSnd = await newContact('sender-seq');
  const enrSnd = await enrollContact(pool, { organizationId: ORG, campaignId: sndCamp, contactId: cSnd });
  await tickDueEnrollments(pool, at(30000));

  const sndA1 = (await q(
    `select sender_id, status from actions where enrollment_id=$1 order by created_at asc limit 1`,
    [enrSnd],
  )).rows[0];
  check('action portée par le moins consommé', sndA1?.sender_id === sndB, `${sndA1?.sender_id} (attendu ${sndB})`);

  const sndLien = (await q(
    `select sender_id, sender_kind from contact_sender_bindings where contact_id=$1`,
    [cSnd],
  )).rows;
  check('lien créé pour le canal LinkedIn', sndLien.length === 1 && sndLien[0].sender_id === sndB && sndLien[0].sender_kind === 'linkedin');

  // Deuxième étape du même contact : le sndLien doit tenir, même si A est désormais
  // moins consommé que B.
  await tickDueEnrollments(pool, at(60000));
  const sndA2 = (await q(
    `select sender_id from actions where enrollment_id=$1 order by created_at desc limit 1`,
    [enrSnd],
  )).rows[0];
  check('même expéditeur à l’étape suivante (lien à vie)', sndA2?.sender_id === sndB, `${sndA2?.sender_id}`);

  // Expéditeur lié désactivé : l'inscription passe en pause, jamais de réattribution.
  const cOff = await newContact('sender-off');
  const enrOff = await enrollContact(pool, { organizationId: ORG, campaignId: sndCamp, contactId: cOff });
  await tickDueEnrollments(pool, at(90000));
  const sndLienOff = (await q(`select sender_id from contact_sender_bindings where contact_id=$1`, [cOff])).rows[0];
  await q(`update senders set is_active=false where id=$1`, [sndLienOff.sender_id]);
  await q(`update enrollments set next_action_at=now() where id=$1`, [enrOff]);
  const sndAvant = (await q(`select count(*)::int as n from actions where enrollment_id=$1`, [enrOff])).rows[0].n;
  await tickDueEnrollments(pool, at(120000));
  const sndApres = (await q(`select count(*)::int as n from actions where enrollment_id=$1`, [enrOff])).rows[0].n;
  const sndEtat = (await q(`select status, stop_reason from enrollments where id=$1`, [enrOff])).rows[0];
  check('expéditeur désactivé → inscription en pause', sndEtat?.status === 'paused', `${sndEtat?.status}`);
  check('motif de pause lisible', String(sndEtat?.stop_reason ?? '').startsWith('sender_unavailable'), `${sndEtat?.stop_reason}`);
  check('aucune action émise sans expéditeur', sndApres === sndAvant, `${sndAvant} → ${sndApres}`);

  console.log(`\n[seq] ${failures === 0 ? '✅ TOUT VERT' : `❌ ${failures} échec(s)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[seq] ERREUR', e);
  process.exit(2);
});

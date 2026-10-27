// Lot « prêt pour Alex », tâche 9 (#169) : un message LinkedIn dont le destinataire n'est pas encore une
// relation ATTEND l'acceptation de l'invitation, au lieu d'arrêter la séquence.
//
// Exécution RÉELLE, sur Postgres, de la chaîne de production : inscription -> tick -> enfilage -> réclamation de
// la file -> `regler` (le règlement d'issue du handler d'envoi) -> départ réel. Le refus de LinkedIn
// (`cannot_message`) est la seule chose simulée : c'est l'issue qu'`executer` rendrait. Aucune requête de
// production n'est recopiée ici, seules les fixtures sont en SQL.
//
// Mutations qui font rougir (chacune seule, puis rétablie ; relevé du 27/10) :
//   1. envoi-linkedin.ts, `regler` : retirer l'appel `attendreAcceptation` : 1a, 1b, 1c, 1d, 2a, 2b, 3, 3a, 4a, 4b... (pause
//      `linkedin_refus:cannot_message`, ligne `failed`).
//   2. file.ts : ne pas rendre la tentative (`attempts - 1`) : 1d.
//   3. file.ts : ne pas replanifier `scheduled_for` : 1e.
//   4. file.ts : ne jamais sauter (`true ||` devant l'échéance) : 4a, 4b, 4d, 4e, 4f, 4g, 5a, 7a, 7c.
//   5. file.ts : compter depuis l'arrivée sur l'étape même quand une invitation est partie : 4a, 4b, 4d, 4e, 4f, 4g, 7a, 7c.
//   6. file.ts : ne pas poser l'échéance après le saut : 4d.
//   7. sequence.ts, garde du tick : (a) retirer `!sautee` : 4e, 4f ; (b) ignorer le motif `invitation_non_acceptee` : 6c.
//   8. file.ts, `chargerStatsRythme` : ne plus compter la vérification dans le dernier passage : 2a, 2b.
//   9. file.ts, `prochainesCandidates` : retirer la clé de tri des lignes en attente : 2b.
//  10. file.ts, lecture de `reglerMessagePasEncoreRelation` : (a) retirer `origine = 'sequence'` : 9a ; (b) retirer le statut
//      de l'action : 9b.
//  12. file.ts, `prochainesCandidates`, tri EXTÉRIEUR : retirer `en_attente asc` : 2c (invitation neuve devant message en attente).
//  11. file.ts : durée en dur (7) au lieu du réglage : 7a, 7b, 7c.
import pg from 'pg';
import {
  tickDueEnrollments,
  enrollContact,
  runLinkedInDispatch,
  regler,
  reclamerProchaineAction,
  enregistrerResultat,
  annulerEnvoisEnFile,
  lireFiche,
  reglerMessagePasEncoreRelation,
} from './_attente-acceptation-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

// Le shim auth du harnais n'a pas cette colonne de la plateforme ; `lireFiche` la lit (nom de l'auteur d'une note).
await q(`alter table auth.users add column if not exists raw_user_meta_data jsonb`);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
/** Une section qui lève ne doit pas en emporter dix : elle compte un échec et on continue. */
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      failures += 1;
      console.log(`  FAIL section ${section.name} a levé : ${e?.stack ?? e}`);
    }
  }
}

const JOUR_MS = 24 * 3_600_000;
const il_y_a = (jours) => new Date(Date.now() - jours * JOUR_MS);
const dans = (ms) => new Date(Date.now() + ms);
/** Une échéance posée à +96 h du départ, au jitter déterministe près (±20 %, `RATIO_JITTER_ECHEANCE`). */
const vers96h = (date) => {
  const ecart = new Date(date).getTime() - Date.now();
  return ecart >= 96 * 3_600_000 * 0.8 - 600_000 && ecart <= 96 * 3_600_000 * 1.2 + 600_000;
};
const deps = () => ({ pool, env: {}, pause: async () => undefined });

let seq = 0;
/**
 * Une organisation prête à envoyer À TOUTE HEURE, tous les jours (le harnais ne dépend pas de l'heure à
 * laquelle on le lance), une campagne active et un expéditeur email ouvert lui aussi à toute heure.
 */
async function monde({ jours, etapes = ['linkedin_invite', 'linkedin_message', 'email'] } = {}) {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [org]);
  await q(
    `insert into linkedin_settings (organization_id, send_days, send_from_hour, send_to_hour, timezone)
     values ($1, '{1,2,3,4,5,6,7}', 0, 24, 'Europe/Paris')`,
    [org],
  );
  await q(
    `insert into senders (organization_id, kind, identity, business_hours)
     values ($1, 'email', $2, '{"startHour":0,"endHour":24,"days":[1,2,3,4,5,6,7]}'::jsonb)`,
    [org, `exp-${n}@exemple.invalid`],
  );
  if (jours !== undefined) {
    await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_attente_acceptation_jours', $2::jsonb)`, [org, JSON.stringify(jours)]);
  }
  const campagne = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'C', 'active') returning id`, [org])).rows[0].id;
  // Délais : message +72 h, email +96 h (la séquence d'Alexandre, abrégée).
  const delais = { linkedin_invite: 0, linkedin_message: 72, email: 96 };
  for (const [position, canal] of etapes.entries()) {
    await q(`insert into sequence_steps (campaign_id, position, channel, delay_hours) values ($1, $2, $3::channel_kind, $4)`, [campagne, position, canal, position === 0 ? 0 : delais[canal]]);
  }
  return { org, campagne, ctx: { ex: pool, organisationId: org, utilisateurId: null, role: null } };
}

/** Le tick, à une heure que la marge de l'horloge de la base ne contredit pas. */
const tick = (quand = dans(60_000)) => tickDueEnrollments(pool, quand);
const rendreDue = (inscription) => q(`update enrollments set next_action_at = now() - interval '1 minute' where id = $1`, [inscription]);

/**
 * Une personne arrivée à l'étape « message » : son invitation est partie il y a `invitationIlYa` jours
 * (par le vrai `enregistrerResultat`, comme un départ réel), l'étape message est émise par le tick et
 * enfilée. `invitationIlYa: null` = campagne sans invitation (la première étape est le message).
 */
async function personne(m, { invitationIlYa, prenom = 'Marie' } = {}) {
  seq += 1;
  const url = `https://www.linkedin.com/in/fictif-${seq}-${Date.now().toString(36)}`;
  const contact = (
    await q(
      `insert into contacts (organization_id, first_name, last_name, linkedin_url, email, email_status)
       values ($1, $2, 'Test', $3, $4, 'valid') returning id`,
      [m.org, prenom, url, `p${seq}-${Date.now().toString(36)}@exemple.invalid`],
    )
  ).rows[0].id;
  const inscription = await enrollContact(pool, { organizationId: m.org, campaignId: m.campagne, contactId: contact, signalId: null });
  await rendreDue(inscription);
  let jobs = await tick();
  if (invitationIlYa !== null && invitationIlYa !== undefined) {
    const queueInvite = await runLinkedInDispatch(pool, jobs.find((j) => j.channel === 'linkedin_invite'));
    await q(`update linkedin_action_queue set status = 'processing', processing_started_at = now() where id = $1`, [queueInvite]);
    await enregistrerResultat(pool, { organizationId: m.org, queueId: queueInvite, status: 'sent', now: il_y_a(invitationIlYa) });
    await rendreDue(inscription);
    jobs = await tick();
  }
  const jobMessage = jobs.find((j) => j.channel === 'linkedin_message');
  const queue = await runLinkedInDispatch(pool, jobMessage);
  return { contact, inscription, queue, url };
}

/** Réclame la prochaine ligne de l'organisation puis la règle comme le handler le ferait sur un refus. */
async function essayerEtRefuser(m, quand = dans(120_000)) {
  const r = await reclamerProchaineAction(pool, m.org, quand);
  if (r.action === null) return { reclamee: null, motif: r.motif };
  await regler(deps(), m.ctx, r.action, { type: 'refus', code: 'cannot_message' });
  return { reclamee: r.action, motif: null };
}

const file = async (id) =>
  (await q(`select status, scheduled_for, attempts, error_code, error_message, processing_started_at, updated_at from linkedin_action_queue where id = $1`, [id])).rows[0];
const inscriptionDe = async (id) =>
  (await q(`select status::text as status, stop_reason, current_step, next_action_at, ended_at from enrollments where id = $1`, [id])).rows[0];
const actionsDe = async (id) =>
  (await q(`select s.position, a.status::text as status, a.error from actions a join sequence_steps s on s.id = a.step_id where a.enrollment_id = $1 order by s.position, a.created_at`, [id])).rows;
const action = async (id, rang) => (await actionsDe(id)).find((a) => a.position === rang);

// ---------------------------------------------------------------- 1. l'attente
async function attente() {
  console.log('\n1. un message refusé faute de relation ATTEND : ni échec, ni pause');
  const m = await monde();
  const p = await personne(m, { invitationIlYa: 2 });
  const avant = await inscriptionDe(p.inscription);
  check('0. précondition : à l\'étape suivant le message (current_step 2), sans échéance, action message scheduled',
    avant.status === 'active' && avant.current_step === 2 && avant.next_action_at === null && (await action(p.inscription, 1))?.status === 'scheduled', JSON.stringify(avant));

  const { reclamee, motif } = await essayerEtRefuser(m);
  check('1. la ligne de file est réclamée par la vraie file', reclamee?.id === p.queue, motif ?? '');

  const f = await file(p.queue);
  check('1a. la ligne est de nouveau `pending` avec son code d\'attente, ni `failed` ni `cancelled`',
    f.status === 'pending' && f.error_code === 'attente_acceptation' && !!f.error_message, JSON.stringify(f));
  const insc = await inscriptionDe(p.inscription);
  check('1b. l\'inscription est INTACTE : active, même étape, aucune pause, aucun motif',
    insc.status === 'active' && insc.stop_reason === null && insc.current_step === 2 && insc.next_action_at === null, JSON.stringify(insc));
  check('1c. l\'action reste `scheduled`, sans erreur', (await action(p.inscription, 1))?.status === 'scheduled' && (await action(p.inscription, 1))?.error === null);
  check('1d. la tentative est RENDUE (attempts 0) : une attente de plusieurs jours n\'épuise pas le budget des lectures', f.attempts === 0, String(f.attempts));
  const demain = new Date(f.scheduled_for).getTime();
  const minuit = (await q(`select ((date_trunc('day', now() at time zone 'Europe/Paris') + interval '1 day') at time zone 'Europe/Paris') as t`)).rows[0].t;
  check('1e. la vérification suivante est replanifiée au prochain minuit du fuseau d\'envoi (une par jour au plus)',
    Math.abs(demain - new Date(minuit).getTime()) < 60_000, `${new Date(demain).toISOString()} attendu ${new Date(minuit).toISOString()}`);

  // Au plus une vérification par jour : le même jour, la file ne rend rien.
  const memeJour = await reclamerProchaineAction(pool, m.org, new Date(demain - 3_600_000));
  check('2. le MÊME jour, la file ne rend rien : une vérification par jour au plus', memeJour.action === null && memeJour.motif === 'queue_empty', memeJour.motif ?? 'réclamée');
  check('2a. le tick ne la rejoue pas non plus (aucun job, aucune seconde action)',
    (await tick(new Date(demain - 3_600_000))).length === 0 && (await actionsDe(p.inscription)).length === 2);

  // Le lendemain, elle est de nouveau réclamée et, toujours refusée, attend encore.
  const lendemain = await essayerEtRefuser(m, new Date(demain + 3_600_000));
  check('3. le lendemain la ligne est réclamée à nouveau (une seconde vérification)', lendemain.reclamee?.id === p.queue, lendemain.motif ?? '');
  const f2 = await file(p.queue);
  check('3a. refusée encore : elle attend toujours, l\'inscription n\'est toujours pas en pause',
    f2.status === 'pending' && f2.error_code === 'attente_acceptation' && (await inscriptionDe(p.inscription)).status === 'active', JSON.stringify(f2));
}

// ---------------------------------------------------------------- 2. rythme et ordre
async function rythmeEtOrdre() {
  console.log('\n2. une vérification compte dans le rythme, et passe après les messages neufs');
  const m = await monde();
  const a = await personne(m, { invitationIlYa: 2, prenom: 'Anne' });
  await essayerEtRefuser(m); // a attend, vérifiée à l'instant
  const b = await personne(m, { invitationIlYa: 2, prenom: 'Bea' });

  const tropTot = await reclamerProchaineAction(pool, m.org, dans(30_000));
  check('2a. une autre ligne n\'est pas réclamée 30 s après une vérification : l\'intervalle de 1 à 20 minutes s\'applique',
    tropTot.action === null && tropTot.motif === 'too_soon', tropTot.motif ?? 'réclamée');

  // Ordre : on avance l'horloge de la file d'un jour ; `a` (en attente, échéance plus ancienne) et `b` (neuve).
  await q(`update linkedin_action_queue set scheduled_for = now() - interval '2 days' where id = $1`, [a.queue]);
  const plusTard = await reclamerProchaineAction(pool, m.org, dans(25 * 60_000));
  check('2b. la ligne NEUVE passe avant la ligne en attente, même quand celle-ci est plus ancienne',
    plusTard.action?.id === b.queue, `réclamée=${plusTard.action?.id === a.queue ? 'a (en attente)' : plusTard.action?.id === b.queue ? 'b (neuve)' : plusTard.motif}`);

  // Entre TYPES : une invitation neuve passe avant un message qui attend l'acceptation, même plus ancien.
  const inviteNeuve = (await q(`insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/invitation-neuve') returning id`, [m.org])).rows[0].id;
  const fileInvite = (await q(
    `insert into linkedin_action_queue (organization_id, contact_id, linkedin_url, kind, method, message_body)
     values ($1, $2, 'https://www.linkedin.com/in/invitation-neuve', 'invite', 'serveur', null) returning id`,
    [m.org, inviteNeuve],
  )).rows[0].id;
  await q(`update linkedin_action_queue set status = 'cancelled' where id = $1`, [b.queue]); // on isole : message en attente contre invitation
  await q(`update linkedin_action_queue set scheduled_for = now() - interval '3 days' where id = $1`, [a.queue]);
  const entreTypes = await reclamerProchaineAction(pool, m.org, dans(50 * 60_000));
  check('2c. une invitation NEUVE passe avant un message en attente d\'un AUTRE type, même plus ancien',
    entreTypes.action?.id === fileInvite, `réclamée=${entreTypes.action?.id === a.queue ? 'message en attente' : entreTypes.action?.id === fileInvite ? 'invitation neuve' : entreTypes.motif}`);
}

// ---------------------------------------------------------------- 3. l'acceptation
async function acceptation() {
  console.log('\n3. l\'invitation est acceptée : le message part UNE fois');
  const m = await monde();
  const p = await personne(m, { invitationIlYa: 2 });
  await essayerEtRefuser(m);
  const demain = new Date((await file(p.queue)).scheduled_for).getTime();

  // Le lendemain LinkedIn accepte le message : on règle l'issue `envoye`, comme `executer` la rendrait.
  const r = await reclamerProchaineAction(pool, m.org, new Date(demain + 3_600_000));
  check('3a. le lendemain la ligne est réclamée', r.action?.id === p.queue);
  await regler(deps(), m.ctx, r.action, { type: 'envoye' });
  const f = await file(p.queue);
  check('3b. la ligne est `sent`, sans reste du code d\'attente', f.status === 'sent' && f.error_code === null, JSON.stringify(f));
  const act = await action(p.inscription, 1);
  check('3c. l\'action message est `dispatched`', act?.status === 'dispatched', act?.status);
  const insc = await inscriptionDe(p.inscription);
  check('3d. l\'échéance de l\'email suivant est posée à +96 h du départ réel (jitter près), l\'inscription active à la même étape',
    insc.status === 'active' && insc.current_step === 2 && insc.next_action_at !== null && vers96h(insc.next_action_at), JSON.stringify(insc));
  const parties = (await q(`select count(*)::int n from linkedin_action_queue where contact_id = $1 and kind = 'message' and status = 'sent'`, [p.contact])).rows[0].n;
  check('3e. exactement UN message est parti pour cette personne', parties === 1, String(parties));
  const encore = await reclamerProchaineAction(pool, m.org, dans(5 * JOUR_MS));
  check('3f. et la file n\'a plus rien à lui envoyer', encore.action === null && encore.motif === 'queue_empty', encore.motif ?? 'réclamée');
}

// ---------------------------------------------------------------- 4. le saut
async function saut() {
  console.log('\n4. au-delà du délai, le message est SAUTÉ et l\'email suivant part');
  const m = await monde(); // 7 jours par défaut
  const p = await personne(m, { invitationIlYa: 8 });
  const { reclamee, motif } = await essayerEtRefuser(m);
  check('0. précondition : la ligne est réclamée', reclamee?.id === p.queue, motif ?? '');

  const f = await file(p.queue);
  check('4a. la ligne de file est annulée, motif `invitation_non_acceptee` (pas `failed`)',
    f.status === 'cancelled' && f.error_code === 'invitation_non_acceptee' && /8|7/.test(f.error_message ?? ''), JSON.stringify(f));
  const act = await action(p.inscription, 1);
  check('4b. l\'action est `skipped` avec son motif, lisible', act?.status === 'skipped' && act?.error === 'invitation_non_acceptee', JSON.stringify(act));
  const insc = await inscriptionDe(p.inscription);
  check('4c. l\'inscription reste ACTIVE, sans pause, même étape (jamais deux sauts, jamais un rejeu)',
    insc.status === 'active' && insc.stop_reason === null && insc.current_step === 2, JSON.stringify(insc));
  check('4d. l\'échéance de l\'email est posée à +96 h du saut (jitter près)',
    insc.next_action_at !== null && vers96h(insc.next_action_at), JSON.stringify(insc));

  await rendreDue(p.inscription);
  const jobs = await tick();
  const email = await action(p.inscription, 2);
  check('4e. l\'email suivant PART : action créée `scheduled` et job d\'envoi email émis',
    email?.status === 'scheduled' && jobs.some((j) => j.channel === 'email' && j.email?.contactId === p.contact), JSON.stringify({ email, jobs: jobs.map((j) => j.channel) }));
  const fin = await inscriptionDe(p.inscription);
  check('4f. dernière étape émise : l\'inscription est terminée normalement', fin.status === 'completed', JSON.stringify(fin));

  const fiche = await lireFiche({ ...m.ctx, role: 'admin' }, { contactId: p.contact });
  const trace = fiche.historique.find((e) => e.type === 'action_skipped');
  check('4g. la personne le lit dans son historique : message sauté, avec la durée',
    !!trace && /LinkedIn/.test(trace.libelle) && /7 jours/.test(trace.libelle), JSON.stringify(trace ?? fiche.historique));
}

// ---------------------------------------------------------------- 5. sans invitation
async function sansInvitation() {
  console.log('\n5. une personne jamais invitée : le délai compte depuis l\'arrivée sur l\'étape');
  const m = await monde({ etapes: ['linkedin_message', 'email'] });
  const recente = await personne(m, { invitationIlYa: null, prenom: 'Recente' });
  const ancienne = await personne(m, { invitationIlYa: null, prenom: 'Ancienne' });
  await q(`update linkedin_action_queue set created_at = now() - interval '8 days' where id = $1`, [ancienne.queue]);

  await essayerEtRefuser(m); // la plus ancienne d'abord (même échéance, départage par id) : on règle les deux
  await essayerEtRefuser(m, dans(25 * 60_000));
  const fR = await file(recente.queue);
  const fA = await file(ancienne.queue);
  check('5a. arrivée il y a 8 jours : SAUTÉE', fA.status === 'cancelled' && fA.error_code === 'invitation_non_acceptee', JSON.stringify(fA));
  check('5b. arrivée à l\'instant : elle ATTEND encore', fR.status === 'pending' && fR.error_code === 'attente_acceptation', JSON.stringify(fR));
}

// ---------------------------------------------------------------- 6. personne sortie
async function personneSortie() {
  console.log('\n6. une personne sortie entre-temps n\'est ni relancée, ni avancée, ni mise en pause');
  const m = await monde();
  const a = await personne(m, { invitationIlYa: 2, prenom: 'Sortie' });
  await essayerEtRefuser(m);
  // Elle répond entre deux vérifications : la sortie annule la ligne en attente (`pending`).
  await q(`update contacts set status = 'do_not_contact' where id = $1`, [a.contact]);
  await q(`update enrollments set status = 'stopped', next_action_at = null, ended_at = now(), stop_reason = 'replied' where id = $1`, [a.inscription]);
  const annulees = await annulerEnvoisEnFile(pool, m.org, a.contact, [a.url]);
  check('6a. la sortie annule la ligne en attente (elle est bien annulable) : plus rien à vérifier demain',
    annulees === 1 && (await file(a.queue)).status === 'cancelled' && (await file(a.queue)).error_code === 'contact_exclu', JSON.stringify(await file(a.queue)));
  const lendemain = await reclamerProchaineAction(pool, m.org, dans(2 * JOUR_MS));
  check('6a-bis. le lendemain la file ne rend rien', lendemain.action === null && lendemain.motif === 'queue_empty', lendemain.motif ?? 'réclamée');

  // Course : elle répond PENDANT la vérification (ligne `processing`, que la sortie ne rattrape pas).
  const b = await personne(m, { invitationIlYa: 2, prenom: 'Course' });
  const r = await reclamerProchaineAction(pool, m.org, dans(3 * JOUR_MS));
  check('0. précondition : la ligne de la course est réclamée', r.action?.id === b.queue, r.motif ?? '');
  await q(`update contacts set status = 'do_not_contact' where id = $1`, [b.contact]);
  await q(`update enrollments set status = 'stopped', next_action_at = null, ended_at = now(), stop_reason = 'replied' where id = $1`, [b.inscription]);
  await q(`update actions set status = 'skipped', error = 'enrollment_inactive' where enrollment_id = $1 and status = 'scheduled'`, [b.inscription]);
  await q(`update linkedin_action_queue set status = 'cancelled', error_code = 'contact_exclu' where id = $1`, [b.queue]);
  await regler(deps(), m.ctx, r.action, { type: 'refus', code: 'cannot_message' });
  const fb = await file(b.queue);
  const ib = await inscriptionDe(b.inscription);
  check('6b. une ligne devenue non `processing` n\'est NI replanifiée NI rouverte, l\'inscription sortie n\'est pas touchée (pas de pause)',
    fb.status === 'cancelled' && ib.status === 'stopped' && ib.stop_reason === 'replied' && (await action(b.inscription, 1))?.status === 'skipped', JSON.stringify({ fb, ib }));

  // Course 2 : la sortie arrive juste après la replanification (la ligne est `pending`, la garde de la file l'arrête).
  const c = await personne(m, { invitationIlYa: 2, prenom: 'Garde' });
  await essayerEtRefuser(m, dans(4 * JOUR_MS));
  await q(`update contacts set status = 'do_not_contact' where id = $1`, [c.contact]);
  const g = await reclamerProchaineAction(pool, m.org, dans(6 * JOUR_MS));
  check('6b-bis. la garde de la file arrête une ligne en attente dont le contact vient d\'être exclu',
    g.action === null && g.motif === 'contact_exclu' && (await file(c.queue)).status === 'cancelled', g.motif ?? 'réclamée');

  // 6c : un message `skipped` pour une AUTRE raison (inscription sortie) ne fait pas partir l'email suivant.
  const d = await personne(m, { invitationIlYa: 2, prenom: 'Autre' });
  await q(`update actions set status = 'skipped', error = 'enrollment_inactive' where enrollment_id = $1 and status = 'scheduled'`, [d.inscription]);
  await q(`update linkedin_action_queue set status = 'cancelled' where id = $1`, [d.queue]);
  await rendreDue(d.inscription);
  const jobs = await tick();
  check('6c. un message écarté pour une autre raison (`enrollment_inactive`) ne fait PAS partir l\'étape suivante',
    !jobs.some((j) => j.email?.contactId === d.contact) && (await action(d.inscription, 2)) === undefined, JSON.stringify(jobs.map((j) => j.channel)));
}

// ---------------------------------------------------------------- 7. le réglage
async function reglage() {
  console.log('\n7. le délai est un réglage de l\'organisation');
  const court = await monde({ jours: 3 });
  const a = await personne(court, { invitationIlYa: 4 });
  await essayerEtRefuser(court);
  check('7a. réglé à 3 jours, une invitation de 4 jours : sautée', (await file(a.queue)).status === 'cancelled' && (await action(a.inscription, 1))?.status === 'skipped');

  const long = await monde({ jours: 20 });
  const b = await personne(long, { invitationIlYa: 8 });
  await essayerEtRefuser(long);
  check('7b. réglé à 20 jours, une invitation de 8 jours attend encore', (await file(b.queue)).status === 'pending' && (await inscriptionDe(b.inscription)).status === 'active');

  const zero = await monde({ jours: 0 });
  const c = await personne(zero, { invitationIlYa: 0 });
  await essayerEtRefuser(zero, dans(25 * 60_000)); // l'invitation vient de partir : au-delà de l'intervalle de 20 min
  check('7c. réglé à 0, on ne vérifie qu\'une fois : sautée dès le premier refus (jamais sans avoir essayé)', (await file(c.queue)).status === 'cancelled' && (await file(c.queue)).attempts >= 1);
}

// ---------------------------------------------------------------- 8. ce qui n'attend pas
async function cePuiAttendPas() {
  console.log('\n8. la réponse d\'un opérateur et les lignes sans séquence gardent l\'échec ordinaire');
  const m = await monde();
  const p = await personne(m, { invitationIlYa: 2 });
  await q(`update linkedin_action_queue set origine = 'reponse' where id = $1`, [p.queue]);
  const r = await reclamerProchaineAction(pool, m.org, dans(120_000));
  await regler(deps(), m.ctx, r.action, { type: 'refus', code: 'cannot_message' });
  const f = await file(p.queue);
  check('8a. la réponse d\'un opérateur refusée : `failed / cannot_message`, comme avant', f.status === 'failed' && f.error_code === 'cannot_message', JSON.stringify(f));

  const s = await monde();
  const seul = (await q(`insert into contacts (organization_id, linkedin_url) values ($1, 'https://www.linkedin.com/in/sans-sequence') returning id`, [s.org])).rows[0].id;
  const l = (await q(
    `insert into linkedin_action_queue (organization_id, contact_id, linkedin_url, kind, method, message_body) values ($1, $2, 'https://www.linkedin.com/in/sans-sequence', 'message', 'serveur', 'Bonjour') returning id`,
    [s.org, seul],
  )).rows[0].id;
  const r2 = await reclamerProchaineAction(pool, s.org, dans(120_000));
  await regler(deps(), s.ctx, r2.action, { type: 'refus', code: 'cannot_message' });
  const f2 = await file(l);
  check('8b. une ligne sans action de séquence (extension) : `failed / cannot_message`, comme avant', f2.status === 'failed' && f2.error_code === 'cannot_message', JSON.stringify(f2));
}

// ---------------------------------------------------------------- 9. les gardes du coeur, appelées sans le handler
async function gardesDuCoeur() {
  console.log('\n9. la fonction du coeur refuse de toucher ce qui n\'est pas un message de séquence en cours');
  const m = await monde();
  const appeler = (queue) =>
    reglerMessagePasEncoreRelation(pool, { organizationId: m.org, queueId: queue, maintenant: new Date(), prochaineVerification: dans(JOUR_MS) });

  const a = await personne(m, { invitationIlYa: 8, prenom: 'Reponse' });
  await q(`update linkedin_action_queue set status = 'processing', origine = 'reponse' where id = $1`, [a.queue]);
  const sa = await appeler(a.queue);
  check('9a. une ligne d\'origine `reponse` : `sans_sequence`, rien n\'est écrit', sa.issue === 'sans_sequence' && (await file(a.queue)).status === 'processing' && (await action(a.inscription, 1))?.status === 'scheduled', JSON.stringify(sa));

  const b = await personne(m, { invitationIlYa: 8, prenom: 'Parti' });
  await q(`update linkedin_action_queue set status = 'processing' where id = $1`, [b.queue]);
  await q(`update actions set status = 'dispatched' where enrollment_id = $1 and status = 'scheduled'`, [b.inscription]);
  const sb = await appeler(b.queue);
  check('9b. une action déjà `dispatched` n\'est jamais rouverte ni sautée', sb.issue === 'sans_sequence' && (await file(b.queue)).status === 'processing' && (await action(b.inscription, 1))?.status === 'dispatched', JSON.stringify(sb));

  const c = await personne(m, { invitationIlYa: 8, prenom: 'Pending' });
  const sc = await appeler(c.queue); // ligne `pending`, jamais réclamée
  check('9c. une ligne qui n\'est pas `processing` n\'est pas touchée', sc.issue === 'sans_sequence' && (await file(c.queue)).status === 'pending', JSON.stringify(sc));
}

await jouer(attente, rythmeEtOrdre, acceptation, saut, sansInvitation, personneSortie, reglage, cePuiAttendPas, gardesDuCoeur);

await pool.end();
console.log(failures === 0 ? '\nTOUS LES CONTRÔLES PASSENT' : `\n${failures} CONTRÔLE(S) EN ÉCHEC`);
process.exit(failures === 0 ? 0 : 1);

// Lot « prêt pour Alex », tâche 3 : une campagne LinkedIn ne parle pas d'email. Exécution RÉELLE, sur
// Postgres, de ce que l'écran lit : les étapes numérotées par RANG (jamais position + 1), les
// contacts « allés au bout » comptés par personne (jamais par inscription), et les canaux des
// étapes que les écrans lisent pour n'afficher boîtes et libellés d'email que s'il y a un email.
// Aucune requête de production n'est recopiée ici : seules les fixtures sont en SQL.
//
// Mutations qui font rougir :
//   1. sequence.ts : remettre `count(*)` à la place de `count(distinct e.contact_id)` dans `sequence_fin`
//      — 1a rougit (3 inscriptions comptées pour 2 personnes).
//   2. sequence.ts : retirer `and not exists (... 'replied' ...)` de `sequence_fin` — 1b rougit.
//   3. sequence.ts : remettre `position: e.position + 1` — 2a et 2b rougissent.
//   4. etapes-sql.ts : remplacer `<` par `<=` dans `sqlRangEtape` — 3a, 3b, 3e et 3f rougissent ; retirer le
//      `case when ... is null` — 3i rougit.
//   5. campagnes.ts : retirer `sqlCanauxEtapes` de `lireCampagneEnTete` — 4a rougit ; de `listerCampagnes`
//      — 4b rougit ; d'`aujourdhui.ts` — 4c rougit.
import pg from 'pg';
import {
  lireSequence,
  lireVueDEnsemble,
  listerCampagnes,
  listerFileDuJour,
  listerActivite,
  manquesPourLancer,
  lireAujourdhui,
  apercuEnvoi,
  lireFiche,
} from './_sequence-canaux-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.stack ?? e));
    }
  }
}

// Le shim auth du harnais n'a pas cette colonne de la plateforme Supabase ; `lireFiche` la lit pour le nom
// de l'auteur d'une note. Posée ici, dans la base jetable, jamais dans le shim partagé.
await q(`alter table auth.users add column if not exists raw_user_meta_data jsonb`);

let seq = 0;
/** Une organisation, un administrateur, une campagne sans aucune étape. */
async function monde(nomCampagne = 'C') {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = (await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${n}@test.local`])).rows[0].id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, admin]);
  const campagne = (await q(`insert into campaigns (organization_id, name, status) values ($1, $2, 'active') returning id`, [org, nomCampagne])).rows[0].id;
  const ctx = { ex: pool, organisationId: org, utilisateurId: admin, role: 'admin' };
  return { org, campagne, ctx };
}
const etape = async (m, position, channel, delaiHeures = 0) =>
  (await q(`insert into sequence_steps (campaign_id, position, channel, delay_hours) values ($1, $2, $3::channel_kind, $4) returning id`, [m.campagne, position, channel, delaiHeures])).rows[0].id;
const contact = async (m, prenom) =>
  (await q(`insert into contacts (organization_id, first_name, last_name) values ($1, $2, 'Test') returning id`, [m.org, prenom])).rows[0].id;
const inscription = async (m, contactId, status, currentStep = 1) =>
  (await q(`insert into enrollments (organization_id, campaign_id, contact_id, status, current_step) values ($1, $2, $3, $4::enrollment_status, $5) returning id`, [m.org, m.campagne, contactId, status, currentStep])).rows[0].id;

// ------------------------------------------------------------ 1. « allés au bout »
async function alleAuBoutParPersonne() {
  console.log('[canaux] 1. « allés au bout » : des personnes, pas des inscriptions');
  const m = await monde('Recette LinkedIn');
  await etape(m, 1, 'linkedin_invite');
  const a = await contact(m, 'Alexandre');
  const b = await contact(m, 'Alexis');
  const c = await contact(m, 'Camille');
  await inscription(m, a, 'completed');
  await inscription(m, b, 'completed'); // même personne, réinscrite puis terminée une seconde fois
  await inscription(m, b, 'completed');
  await inscription(m, c, 'completed');
  await inscription(m, c, 'replied'); // elle a fini, puis répondu : elle n'est plus « sans répondre »
  const vue = await lireSequence(m.ctx, { campagneId: m.campagne });
  check('1a. 4 inscriptions terminées, 3 personnes : le compteur dit des personnes (2 sans réponse)', vue.finDeSequence.termines === 2, `termines=${vue.finDeSequence.termines}`);
  const sans = await monde('Sans inscription');
  await etape(sans, 0, 'email');
  const vide = await lireSequence(sans.ctx, { campagneId: sans.campagne });
  check('1b. aucune inscription : 0', vide.finDeSequence.termines === 0, `termines=${vide.finDeSequence.termines}`);
}

// ------------------------------------------------------------ 2. rang des étapes (Séquence)
async function rangDansLaSequence() {
  console.log('[canaux] 2. numérotation des étapes : le rang, jamais position + 1');
  const m = await monde('Une étape, position 1');
  await etape(m, 1, 'linkedin_invite'); // la position 0 a été supprimée, supprimerEtape ne renumérote pas
  const vue = await lireSequence(m.ctx, { campagneId: m.campagne });
  check('2a. la seule étape porte le numéro 1, pas 2', vue.etapes.length === 1 && vue.etapes[0].position === 1, JSON.stringify(vue.etapes.map((e) => e.position)));
  const n = await monde('Trou au milieu');
  await etape(n, 1, 'email');
  await etape(n, 4, 'linkedin_message', 48);
  const v2 = await lireSequence(n.ctx, { campagneId: n.campagne });
  check('2b. positions 1 et 4 : numéros 1 et 2', v2.etapes.map((e) => e.position).join() === '1,2', JSON.stringify(v2.etapes.map((e) => e.position)));
  check('2c. et le titre de la première étape suit le rang (Premier email)', v2.etapes[0].titre === 'Premier email', v2.etapes[0].titre);
}

// ------------------------------------------------------------ 3. rang des étapes (autres écrans)
async function rangDansLesAutresEcrans() {
  console.log('[canaux] 3. le même rang partout où l\'étape est nommée');
  const m = await monde('Étape unique');
  const s1 = await etape(m, 1, 'linkedin_invite');
  const ct = await contact(m, 'Ana');
  const insc = await inscription(m, ct, 'active', 0);
  const action = (
    await q(
      `insert into actions (organization_id, enrollment_id, step_id, channel, status, scheduled_for, idempotency_key)
       values ($1, $2, $3, 'linkedin_invite', 'scheduled', now(), $4) returning id`,
      [m.org, insc, s1, `rang-${insc}`],
    )
  ).rows[0].id;
  const file = await listerFileDuJour(m.ctx, { campagneId: m.campagne });
  const ligne = [...file.prevus, ...file.partis].find((e) => e.id === action);
  check('3a. File du jour : « étape 1 »', ligne?.etape === 1, `etape=${ligne?.etape}`);
  const apercu = await apercuEnvoi(m.ctx, { actionId: action });
  check('3b. tiroir de relecture : étape 1', apercu.etapePosition === 1, `etapePosition=${apercu.etapePosition}`);
  check('3c. et l\'étape LinkedIn ne s\'appelle pas « email » : « Invitation LinkedIn »', apercu.etapeNom === 'Invitation LinkedIn', apercu.etapeNom);
  check('3d. le tiroir dit le canal réel de l\'action', apercu.canal === 'linkedin_invite', String(apercu.canal));
  const aujourdhui = await lireAujourdhui(m.ctx);
  const tout = aujourdhui.fileDuJour.envois.find((e) => e.id === action);
  check('3e. Aujourd\'hui : « étape 1 »', tout?.etape === 1, `etape=${tout?.etape}`);
  // Une action déjà remise : le fil d'activité la groupe par (heure, étape).
  const s2 = await etape(m, 3, 'email', 24);
  await q(`update actions set status = 'dispatched', dispatched_at = now() where id = $1`, [action]);
  const activite = await listerActivite(m.ctx, { campagneId: m.campagne, filtre: 'tout', page: 1 });
  const groupe = activite.evenements.find((e) => e.donneesEnvois);
  check('3f. fil d\'activité : envois groupés à l\'étape 1', groupe?.donneesEnvois?.etape === 1, JSON.stringify(groupe?.donneesEnvois));
  check('3f2. et ce groupe est LinkedIn, sans boîte (jamais « emails remis · 0 boîte »)', groupe?.donneesEnvois?.canal === 'linkedin' && groupe.donneesEnvois.boites === 0, JSON.stringify(groupe?.donneesEnvois));
  const fiche = await lireFiche(m.ctx, { contactId: ct, campagneId: m.campagne });
  check('3g. fiche contact : étapes numérotées 1 et 2, la première en cours', fiche.sequence?.etapes.map((e) => `${e.position}:${e.etat}`).join() === '1:en_cours,2:a_venir', JSON.stringify(fiche.sequence?.etapes));
  // L'étape sans message relié est nommée par son rang, aussi dans le refus de lancement.
  const manques = await manquesPourLancer(m.ctx, { campagneId: m.campagne });
  check('3h. refus de lancement : « étapes 1, 2 », pas « 2, 4 »', manques.some((t) => t.includes('étapes 1, 2')), JSON.stringify(manques));
  // Une action dont l'étape a été supprimée n'a PAS de numéro d'étape : jamais « étape 1 » par défaut.
  await q(`update actions set step_id = null where id = $1`, [action]);
  const sansEtape = await listerFileDuJour(m.ctx, { campagneId: m.campagne });
  const orpheline = [...sansEtape.prevus, ...sansEtape.partis].find((e) => e.id === action);
  check('3i. étape supprimée : aucun numéro d\'étape (null), pas 1', orpheline !== undefined && orpheline.etape === null, `etape=${orpheline?.etape}`);
  void s2;
}

// ------------------------------------------------------------ 4. canaux des étapes
async function canauxDesEtapes() {
  console.log('[canaux] 4. les canaux des étapes, lus par chaque écran');
  const m = await monde('Mixte');
  await etape(m, 0, 'linkedin_invite');
  await etape(m, 1, 'email', 24);
  await etape(m, 2, 'linkedin_message', 48);
  const vue = await lireVueDEnsemble(m.ctx, { campagneId: m.campagne });
  check('4a. en-tête de campagne : canaux dans l\'ordre des étapes', vue.campagne.canauxEtapes?.join() === 'linkedin_invite,email,linkedin_message', JSON.stringify(vue.campagne.canauxEtapes));
  const liste = await listerCampagnes(m.ctx);
  check('4b. liste des campagnes : mêmes canaux', liste.find((c) => c.id === m.campagne)?.canauxEtapes?.join() === 'linkedin_invite,email,linkedin_message', JSON.stringify(liste.map((c) => c.canauxEtapes)));
  const aujourdhui = await lireAujourdhui(m.ctx);
  check('4c. Aujourd\'hui : mêmes canaux', aujourdhui.campagnes.find((c) => c.id === m.campagne)?.canauxEtapes?.join() === 'linkedin_invite,email,linkedin_message', JSON.stringify(aujourdhui.campagnes.map((c) => c.canauxEtapes)));
  const vide = await monde('Sans étape');
  const v0 = await lireVueDEnsemble(vide.ctx, { campagneId: vide.campagne });
  check('4d. campagne sans étape : liste vide, pas null', Array.isArray(v0.campagne.canauxEtapes) && v0.campagne.canauxEtapes.length === 0, JSON.stringify(v0.campagne.canauxEtapes));
}

await jouer(alleAuBoutParPersonne, rangDansLaSequence, rangDansLesAutresEcrans, canauxDesEtapes);
await pool.end();
console.log(failures === 0 ? '\n[canaux] OK' : `\n[canaux] ${failures} contrôle(s) en échec`);
process.exit(failures === 0 ? 0 : 1);

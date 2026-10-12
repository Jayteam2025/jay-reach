// Lot 2, revue de cohérence : la jauge d'envois du menu doit dire la même chose
// que le moteur. Exécution RÉELLE, sur Postgres, du SQL de production — aucune
// requête n'est recopiée ici.
//
// Trois défauts à prouver, chacun avec la mutation qui refait rougir :
//   1. `lirePlafondEnvois` fait `coalesce(sum(daily_quota), 0)` : une boîte active
//      SANS quota réglé (NULL) devient un plafond de 0, et 0 veut dire « en pause »
//      dans ce produit (`placesRestantes`, `plafonds-affichage.ts`). Le moteur, lui,
//      lit ce même NULL comme « aucune limite » (`quotaSenderRestant` rend Infinity).
//      La jauge annonce donc une pause pendant que le moteur envoie sans limite.
//   2. La jauge du menu compte TOUS les canaux au numérateur (`SQL_ACTION_DU_JOUR`,
//      sans filtre de canal) et l'email seul au dénominateur : une action LinkedIn
//      gonfle une barre qu'elle ne consomme pas.
//   3. Deux définitions du plafond vivent côte à côte — `lirePlafondEnvois`
//      (`plafonds.ts`) et `plafondEnvoisOrganisation` (`campagnes.ts`) — alors que le
//      commentaire de la première annonce « une seule définition ».
//   4. (section 5) Les alertes « le rythme ne sort rien » de `lireAujourdhui` : capacité par
//      jour (`senders.business_hours` jsonb) contre envois dus (`enrollments.next_action_at`),
//      et silence de trois jours ouvrés, exécutés sur Postgres.
import pg from 'pg';
import {
  lirePlafondEnvois,
  lireConsommationDuJour,
  lireAujourdhui,
  lireResumeCoquille,
  listerFileDuJour,
  chargerContraintesSender,
  quotaSenderRestant,
} from './_jauge-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

let seq = 0;
const uniq = () => `${Date.now().toString(36)}${(seq += 1)}`;
const ctxDe = (org) => ({ ex: { query: (...a) => pool.query(...a) }, organisationId: org, utilisateurId: null, role: 'viewer' });

async function orgNeuve(fuseau = 'UTC') {
  const id = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${uniq()}`, `org-${uniq()}`])).rows[0].id;
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'fuseau', $2::jsonb)`, [id, JSON.stringify(fuseau)]);
  return id;
}

async function senderNeuf(org, { daily = null, kind = 'email', actif = true, tz = 'UTC' } = {}) {
  return (
    await q(
      `insert into senders (organization_id, kind, identity, daily_quota, timezone, is_active, business_hours)
       values ($1, $2, $3, $4, $5, $6, '{"startHour":0,"endHour":24,"days":[1,2,3,4,5,6,7]}'::jsonb) returning id`,
      [org, kind, `s-${uniq()}@example.test`, daily, tz, actif],
    )
  ).rows[0].id;
}

/** Une action du jour, rattachée à une inscription : `dispatchedAt` null = planifiée, pas encore remise. */
async function actionDuJour(org, { sender = null, channel = 'email', status, dispatchedAt = null, scheduledFor = null }) {
  const ct = (await q(`insert into contacts (organization_id, email) values ($1, $2) returning id`, [org, `a-${uniq()}@example.test`])).rows[0].id;
  const camp =
    (await q(`select id from campaigns where organization_id = $1 limit 1`, [org])).rows[0]?.id ??
    (await q(`insert into campaigns (organization_id, name, status) values ($1, 'jauge', 'active') returning id`, [org])).rows[0].id;
  const enr = (
    await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1, $2, $3, 'active') returning id`, [org, camp, ct])
  ).rows[0].id;
  await q(
    `insert into actions (organization_id, enrollment_id, channel, sender_id, status, dispatched_at, delivered_at, scheduled_for, idempotency_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [org, enr, channel, sender, status, dispatchedAt, status === 'delivered' ? dispatchedAt : null, scheduledFor, `idem-${uniq()}`],
  );
}

const midiAujourdhui = async () => new Date((await q(`select date_trunc('day', now()) + interval '12 hours' as d`)).rows[0].d);

// ---------------------------------------------------------------------------
// (1) Le plafond distingue « aucune limite réglée » de « en pause »
// ---------------------------------------------------------------------------
async function plafondSansLimite() {
  console.log('\n[1] lirePlafondEnvois : NULL (aucune limite réglée) n’est pas 0 (en pause)');

  const regle = await orgNeuve();
  await senderNeuf(regle, { daily: 30 });
  await senderNeuf(regle, { daily: 50 });
  check('1.1 deux boîtes réglées : la somme', (await lirePlafondEnvois(ctxDe(regle))) === 80);

  const sansQuota = await orgNeuve();
  await senderNeuf(sansQuota, { daily: null });
  check(
    '1.2 une boîte active sans quota réglé : aucune limite',
    (await lirePlafondEnvois(ctxDe(sansQuota))) === null,
    'le moteur envoie sans limite dans ce cas',
  );

  const mixte = await orgNeuve();
  await senderNeuf(mixte, { daily: 30 });
  await senderNeuf(mixte, { daily: null });
  check(
    '1.3 une boîte réglée + une sans quota : aucune limite',
    (await lirePlafondEnvois(ctxDe(mixte))) === null,
    'la somme ignore le NULL et annoncerait 30',
  );

  const enPause = await orgNeuve();
  await senderNeuf(enPause, { daily: 0 });
  check('1.4 une boîte à 0 : en pause, pas « sans limite »', (await lirePlafondEnvois(ctxDe(enPause))) === 0);

  const aucune = await orgNeuve();
  await senderNeuf(aucune, { daily: null, actif: false });
  check('1.5 aucune boîte active : 0', (await lirePlafondEnvois(ctxDe(aucune))) === 0);

  const linkedinSeul = await orgNeuve();
  await senderNeuf(linkedinSeul, { daily: 25, kind: 'linkedin' });
  check('1.6 une boîte LinkedIn ne fait pas un plafond email', (await lirePlafondEnvois(ctxDe(linkedinSeul))) === 0);
}

// ---------------------------------------------------------------------------
// (2) La jauge et le moteur disent la même chose
// ---------------------------------------------------------------------------
async function accordAvecLeMoteur() {
  console.log('\n[2] Le plafond affiché et la décision du moteur, pour la MÊME boîte');

  const org = await orgNeuve();
  const sansQuota = await senderNeuf(org, { daily: null });
  const c = await chargerContraintesSender(pool, sansQuota);
  const restant = quotaSenderRestant(c);
  check('2.1 le moteur ne voit aucune limite', restant === Infinity, `restant=${restant}`);
  check(
    '2.2 la jauge ne dit pas « en pause » quand le moteur envoie sans limite',
    (await lirePlafondEnvois(ctxDe(org))) !== 0,
  );
}

// ---------------------------------------------------------------------------
// (3) Numérateur et dénominateur portent sur la même population
// ---------------------------------------------------------------------------
async function memePopulation() {
  console.log('\n[3] La jauge du menu : emails remis aujourd’hui, contre le plafond email');

  const org = await orgNeuve();
  const boite = await senderNeuf(org, { daily: 100 });
  const midi = await midiAujourdhui();
  // Trois emails remis aujourd'hui (dont un déjà parti), un LinkedIn remis, un email planifié.
  await actionDuJour(org, { sender: boite, status: 'delivered', dispatchedAt: midi });
  await actionDuJour(org, { sender: boite, status: 'dispatched', dispatchedAt: midi });
  await actionDuJour(org, { sender: boite, status: 'dispatched', dispatchedAt: midi });
  await actionDuJour(org, { channel: 'linkedin_message', status: 'dispatched', dispatchedAt: midi });
  await actionDuJour(org, { sender: boite, status: 'scheduled', scheduledFor: midi });

  const coquille = await lireResumeCoquille(ctxDe(org));
  const accueil = await lireAujourdhui(ctxDe(org));
  const conso = await lireConsommationDuJour(ctxDe(org));

  // `=== 3` et jamais `!== 4` : un champ absent satisferait la seconde forme.
  check('3.1 trois emails remis comptés', coquille.quotaEnvois?.utilise === 3, `utilise=${coquille.quotaEnvois?.utilise}`);
  check(
    '3.2 la jauge email (3) n’est pas la file tous canaux (5)',
    coquille.quotaEnvois?.utilise === 3 && accueil.fileDuJour.total === 5,
    `jauge=${coquille.quotaEnvois?.utilise} file=${accueil.fileDuJour.total}`,
  );
  check(
    '3.3 menu et accueil : un seul nombre',
    typeof coquille.quotaEnvois?.utilise === 'number' && coquille.quotaEnvois.utilise === accueil.plafonds.envois.utilise,
  );
  check('3.4 la jauge et la page Plafonds : un seul nombre', coquille.quotaEnvois?.utilise === conso.envois.utilise);
  check('3.5 la jauge et la page Plafonds : un seul plafond', coquille.quotaEnvois?.plafond === conso.envois.plafond);
  check('3.6 l’email planifié du jour est « en file », pas « remis »', coquille.quotaEnvois?.enFile === 1, `enFile=${coquille.quotaEnvois?.enFile}`);
  check('3.7 la file du jour de l’accueil reste tous canaux', accueil.fileDuJour.total === 5, `total=${accueil.fileDuJour.total}`);

  // La borne du jour vit dans le `where`, pas seulement dans les `filter` : sans elle la
  // requête du menu scanne toutes les actions de l'organisation, et elle compterait les
  // envois d'hier dans le quota d'aujourd'hui.
  const hier = new Date((await q(`select date_trunc('day', now()) - interval '12 hours' as d`)).rows[0].d);
  const demain = new Date((await q(`select date_trunc('day', now()) + interval '36 hours' as d`)).rows[0].d);
  await actionDuJour(org, { sender: boite, status: 'delivered', dispatchedAt: hier });
  // Planifié pour DEMAIN : c'est lui qui distingue une borne dans le `where` d'une borne
  // présente seulement dans le `filter` des remis. Sans la première, il gonflerait « en file »
  // et la requête scannerait au passage toutes les actions de l'organisation.
  await actionDuJour(org, { sender: boite, status: 'scheduled', scheduledFor: demain });
  const apres = await lireResumeCoquille(ctxDe(org));
  check('3.8 un envoi d’hier ne compte pas dans le quota du jour', apres.quotaEnvois.utilise === 3, `utilise=${apres.quotaEnvois.utilise}`);
  check('3.8b un envoi planifié demain n’est pas « en file » aujourd’hui', apres.quotaEnvois.enFile === 1, `enFile=${apres.quotaEnvois.enFile}`);

  // Chaque table métier porte `organization_id` et le worker lit avec la clé de service :
  // l'isolation est dans la requête, jamais seulement dans RLS.
  const voisine = await orgNeuve();
  const sonBoite = await senderNeuf(voisine, { daily: 100 });
  await actionDuJour(voisine, { sender: sonBoite, status: 'delivered', dispatchedAt: midi });
  const inchange = await lireResumeCoquille(ctxDe(org));
  check('3.9 les envois d’une autre organisation ne comptent pas', inchange.quotaEnvois.utilise === 3, `utilise=${inchange.quotaEnvois.utilise}`);
}

// ---------------------------------------------------------------------------
// (4) Une seule définition du plafond d'organisation
// ---------------------------------------------------------------------------
async function uneSeuleDefinition() {
  console.log('\n[4] La file du jour emploie la même définition du plafond que le menu');

  const org = await orgNeuve();
  await senderNeuf(org, { daily: null });
  const file = await listerFileDuJour(ctxDe(org), {});
  const duMenu = await lirePlafondEnvois(ctxDe(org));
  check(
    '4.1 sans campagne, le plafond de la file est celui du menu',
    file.plafondDuJour === duMenu && duMenu === null,
    `file=${file.plafondDuJour} menu=${duMenu}`,
  );
}

// ---------------------------------------------------------------------------
// (5) Les alertes « le rythme ne sort rien » : capacité par jour, envois dus, silence
// ---------------------------------------------------------------------------
/** Un sender email aux jours et au quota choisis (`days` : convention ISO, 1 = lundi). */
async function senderAuxJours(org, { daily, days }) {
  return (
    await q(
      `insert into senders (organization_id, kind, identity, daily_quota, timezone, is_active, business_hours)
       values ($1, 'email', $2, $3, 'UTC', true, $4::jsonb) returning id`,
      [org, `j-${uniq()}@example.test`, daily, JSON.stringify({ startHour: 0, endHour: 24, days })],
    )
  ).rows[0].id;
}

/**
 * Une campagne, `statut` au choix, créée il y a `ageJours` jours et activée il y a `activeDepuisJours`
 * (`null` : jamais renseigné, repli sur la création). `etapes` : positions ET canaux, qui peuvent ne pas
 * être contigus (une étape supprimée ne renumérote pas les suivantes).
 */
async function campagneEmail(org, { statut = 'active', ageJours = 10, activeDepuisJours = null, etapes = [{ position: 0, channel: 'email' }] } = {}) {
  const id = (
    await q(
      `insert into campaigns (organization_id, name, status, created_at, activated_at)
       values ($1, $2, $3, now() - ($4 || ' days')::interval, case when $5::text is null then null else now() - ($5 || ' days')::interval end) returning id`,
      [org, `c-${uniq()}`, statut, String(ageJours), activeDepuisJours === null ? null : String(activeDepuisJours)],
    )
  ).rows[0].id;
  for (const e of etapes) await q(`insert into sequence_steps (campaign_id, position, channel) values ($1, $2, $3)`, [id, e.position, e.channel]);
  return id;
}

/** `n` inscriptions actives au RANG `rang` (`current_step`) dont la prochaine action est due à midi UTC, `decalage` jours après aujourd'hui. */
async function envoisDus(org, campagne, decalage, n, rang = 0) {
  for (let i = 0; i < n; i += 1) {
    const ct = (await q(`insert into contacts (organization_id, email) values ($1, $2) returning id`, [org, `d-${uniq()}@example.test`])).rows[0].id;
    await q(
      `insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, next_action_at)
       values ($1, $2, $3, 'active', $5, date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' + ($4 || ' days')::interval + interval '12 hours')`,
      [org, campagne, ct, String(decalage), rang],
    );
  }
}

const isoJour = async (decalage) =>
  Number((await q(`select extract(isodow from (now() at time zone 'UTC')::date + $1::int)::int as j`, [decalage])).rows[0].j);
const alerteDe = async (org, type) => (await lireAujourdhui(ctxDe(org))).alertes.find((a) => a.type === type);

async function alertesRythme() {
  console.log('\n[5] Alertes « le rythme ne sort rien » : exécution réelle de leur SQL');

  // Deux boîtes aux jours différents : A ouverte le jour +1 (quota 10), B le jour +2 (quota 20).
  // Le jour +3 n'est ouvert pour aucune des deux (jour fermé), ISO jour +1 / +2 / +3 distincts.
  const jA = await isoJour(1);
  const jB = await isoJour(2);
  const monde = async () => {
    const org = await orgNeuve();
    await senderAuxJours(org, { daily: 10, days: [jA] });
    await senderAuxJours(org, { daily: 20, days: [jB] });
    return { org, camp: await campagneEmail(org) };
  };

  // 5.1 Jour +1 : 11 dus pour la seule boîte A (10). Une somme sans le filtre `days` annoncerait 30 et se tairait.
  const x = await monde();
  await envoisDus(x.org, x.camp, 1, 11);
  // Une voisine bien plus chargée, sans boîte : elle ne doit pas changer le texte de x.
  const voisine = await orgNeuve();
  await senderAuxJours(voisine, { daily: 500, days: [1, 2, 3, 4, 5, 6, 7] });
  await envoisDus(voisine, await campagneEmail(voisine), 1, 99);
  const a1 = await alerteDe(x.org, 'envois_entasses');
  check('5.1 11 envois dus un jour où seule la boîte à 10 est ouverte : alerte', a1 !== undefined, `texte=${a1?.texte}`);
  check('5.2 la capacité annoncée est 10, pas la somme 30 des deux boîtes', /11 envois sont dus pour une capacité de 10\b/.test(a1?.texte ?? ''), a1?.texte);
  check('5.3 les envois dus d’une autre organisation ne comptent pas', !/\b(99|110)\b/.test(a1?.texte ?? ''), a1?.texte);

  // 5.4 Jour +2 : 15 dus pour la boîte B (20) : rien à dire. Sa capacité n'est pas celle de A.
  const y = await monde();
  await envoisDus(y.org, y.camp, 2, 15);
  check('5.4 15 dus pour la boîte à 20 ouverte ce jour-là : pas d’alerte', (await alerteDe(y.org, 'envois_entasses')) === undefined);

  // 5.5 Jour +3 fermé : 40 dus, capacité nulle (et non 30). Les envois glissent au prochain jour ouvert.
  const z = await monde();
  await envoisDus(z.org, z.camp, 3, 40);
  check('5.5 un jour sans boîte ouverte a une capacité nulle : pas d’alerte à 40 dus', (await alerteDe(z.org, 'envois_entasses')) === undefined);

  // 5.6 Une boîte ouverte sans quota ne borne rien.
  const sansQuota = await orgNeuve();
  await senderAuxJours(sansQuota, { daily: null, days: [jA] });
  await senderAuxJours(sansQuota, { daily: 10, days: [jA] });
  await envoisDus(sansQuota, await campagneEmail(sansQuota), 1, 50);
  check('5.6 une boîte sans quota ouverte ce jour-là : pas d’alerte', (await alerteDe(sansQuota, 'envois_entasses')) === undefined);

  // 5.7 Les envois dus d'une campagne en pause ne comptent pas (une campagne active, elle, existe).
  const enPause = await orgNeuve();
  await senderAuxJours(enPause, { daily: 10, days: [jA] });
  await campagneEmail(enPause);
  await envoisDus(enPause, await campagneEmail(enPause, { statut: 'paused' }), 1, 50);
  check('5.7 50 dus dans une campagne en pause : pas d’alerte', (await alerteDe(enPause, 'envois_entasses')) === undefined);

  // 5.7b Les positions ne sont pas contiguës (étape du milieu supprimée) : `current_step` est un RANG.
  // Positions 0, 2, 3, toutes email ; inscriptions au rang 1 = position 2. Joindre `position = current_step`
  // chercherait la position 1, qui n'existe plus, et ferait disparaître ces 11 envois du compte.
  const trou = await orgNeuve();
  await senderAuxJours(trou, { daily: 10, days: [jA] });
  await envoisDus(trou, await campagneEmail(trou, { etapes: [{ position: 0, channel: 'email' }, { position: 2, channel: 'email' }, { position: 3, channel: 'email' }] }), 1, 11, 1);
  check('5.7b rang 1 sur des positions 0, 2, 3 : les 11 dus sont comptés', (await alerteDe(trou, 'envois_entasses')) !== undefined);
  // Et l'inverse : positions 1 (email) et 2 (LinkedIn), rang 1 = position 2 = LinkedIn. Lire `position = 1` y verrait
  // un email et gonflerait le compte de 11 envois qui ne sont pas des emails.
  const mauvaisCanal = await orgNeuve();
  await senderAuxJours(mauvaisCanal, { daily: 10, days: [jA] });
  await envoisDus(mauvaisCanal, await campagneEmail(mauvaisCanal, { etapes: [{ position: 1, channel: 'email' }, { position: 2, channel: 'linkedin_message' }] }), 1, 11, 1);
  check('5.7c rang 1 sur des positions 1 (email), 2 (LinkedIn) : étape LinkedIn, pas comptée', (await alerteDe(mauvaisCanal, 'envois_entasses')) === undefined);

  // 5.8 Sans campagne active, rien ne se déclenche, même avec des envois dus.
  const sansCampagne = await orgNeuve();
  await senderAuxJours(sansCampagne, { daily: 10, days: [jA] });
  await envoisDus(sansCampagne, await campagneEmail(sansCampagne, { statut: 'paused' }), 1, 50);
  const toutes = (await lireAujourdhui(ctxDe(sansCampagne))).alertes.map((a) => a.type);
  check(
    '5.8 aucune campagne active : aucun des trois contrôles',
    !['fenetre_trop_etroite', 'envois_entasses', 'rien_ne_part'].some((t) => toutes.includes(t)),
    toutes.join(','),
  );

  // 5.9 rien_ne_part : campagne active ancienne et aucune action depuis trois jours ouvrés.
  const silence = await orgNeuve();
  await campagneEmail(silence);
  check('5.9 campagne active ancienne, aucune action : alerte', (await alerteDe(silence, 'rien_ne_part')) !== undefined);
  // Les actions d'une AUTRE organisation ne la lèvent pas.
  const bavarde = await orgNeuve();
  const sb = await senderNeuf(bavarde, { daily: 100 });
  await actionDuJour(bavarde, { sender: sb, status: 'delivered', dispatchedAt: await midiAujourdhui() });
  check('5.10 les actions d’une autre organisation ne comptent pas', (await alerteDe(silence, 'rien_ne_part')) !== undefined);
  // Une action seulement BLOQUÉE (créée, jamais remise) ne la lève pas : c'est le chemin nominal d'un refus d'émettre.
  const bloquee = await orgNeuve();
  await campagneEmail(bloquee);
  await actionDuJour(bloquee, { status: 'blocked' });
  check('5.10b une action bloquée créée aujourd’hui n’est pas un départ : alerte', (await alerteDe(bloquee, 'rien_ne_part')) !== undefined);
  // Une action créée aujourd'hui dans l'organisation la lève.
  const parti = await orgNeuve();
  await campagneEmail(parti);
  const sp = await senderNeuf(parti, { daily: 100 });
  await actionDuJour(parti, { sender: sp, status: 'delivered', dispatchedAt: await midiAujourdhui() });
  check('5.11 une action créée aujourd’hui : pas d’alerte', (await alerteDe(parti, 'rien_ne_part')) === undefined);
  // Une campagne créée hier n'est pas accusée : trois jours ouvrés n'ont pas pu s'écouler.
  const neuve = await orgNeuve();
  await campagneEmail(neuve, { ageJours: 0 });
  check('5.12 campagne créée aujourd’hui : pas d’alerte', (await alerteDe(neuve, 'rien_ne_part')) === undefined);
  // Une vieille campagne RELANCÉE à l'instant (activated_at = maintenant) n'est pas accusée ; sans activated_at, repli sur la création.
  const relancee = await orgNeuve();
  await campagneEmail(relancee, { ageJours: 180, activeDepuisJours: 0 });
  check('5.13 campagne de six mois relancée à l’instant : pas d’alerte', (await alerteDe(relancee, 'rien_ne_part')) === undefined);
  const ancienneActivation = await orgNeuve();
  await campagneEmail(ancienneActivation, { ageJours: 180, activeDepuisJours: 20 });
  check('5.14 campagne activée il y a vingt jours, rien parti : alerte', (await alerteDe(ancienneActivation, 'rien_ne_part')) !== undefined);
  // En pause, le silence est voulu : pause_envoi le dit, rien_ne_part se tait.
  const enPauseOrg = await orgNeuve();
  await campagneEmail(enPauseOrg);
  await q(`update organizations set sending_paused_at = now() where id = $1`, [enPauseOrg]);
  const pauseTypes = (await lireAujourdhui(ctxDe(enPauseOrg))).alertes.map((a) => a.type);
  check('5.15 organisation en pause : pause_envoi seule, pas rien_ne_part', pauseTypes.includes('pause_envoi') && !pauseTypes.includes('rien_ne_part'), pauseTypes.join(','));
}

await plafondSansLimite();
await accordAvecLeMoteur();
await memePopulation();
await uneSeuleDefinition();
await alertesRythme();

await pool.end();
if (failures > 0) {
  console.log(`\n=== JAUGE ENVOIS FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== JAUGE ENVOIS OK ===');

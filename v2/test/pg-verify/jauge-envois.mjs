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

await plafondSansLimite();
await accordAvecLeMoteur();
await memePopulation();
await uneSeuleDefinition();

await pool.end();
if (failures > 0) {
  console.log(`\n=== JAUGE ENVOIS FAIL (${failures}) ===`);
  process.exit(1);
}
console.log('\n=== JAUGE ENVOIS OK ===');

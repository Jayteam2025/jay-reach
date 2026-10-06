// Lot 4a, tâche 7 : exécution RÉELLE, sur Postgres, du collecteur d'engageurs.
// Aucune requête de production n'est recopiée ici : seules les fixtures sont en
// SQL, et chacune nomme le chemin de production qui produit le même état.
// Le seul élément simulé est le NAVIGATEUR : un pilote factice rend des réponses
// Voyager écrites ci-dessous. Tout ce qui touche la base est du code de production.
//
// Mutations qui font rougir (voir le rapport de la tâche 7) :
//   1. producer.ts : retirer `and coalesce(s.config->>'sourceType','') not like 'linkedin%'`
//      de enqueueDiscoverForActiveSources — le contrôle 30 rougit.
//   2. producer.ts : retirer la branche `type.startsWith('linkedin')` de
//      enqueueRequestedRuns — les contrôles 31 à 33 rougissent.
//   3. collecte-linkedin.ts : retirer `sourceRunId` de `contexteEngageur` —
//      le contrôle 6 rougit (TypeScript le refuse aussi : la propriété est requise).
//   4. engageurs.ts : ne plus poser `urlProfil` depuis `publicIdentifier` —
//      le contrôle 7 rougit (adresse déduite de l'URN au lieu du nom public).
//   5. collecte-linkedin.ts : remplacer `Date.now() - UNE_HEURE_MS` par le début
//      de l'heure en cours — le contrôle 15 rougit.
//   6. collecte-linkedin.ts : retirer le `+ 1` de `postsRestants` — le contrôle 17 rougit.
//   7. collecte-linkedin.ts : appeler `enregistrerEngageur` sans `safeParse` —
//      le contrôle 9 rougit (le passage entier tombe sur un profil sans nom).
//   8. collecte-linkedin.ts : supprimer l'appel à `verifierDisjoncteur` — 26 rougit.
//   9. collecte-linkedin.ts : relire la session APRÈS avoir ouvert le navigateur —
//      le contrôle 21 rougit.
import pg from 'pg';
import {
  DUREE_VERROU_COLLECTE_MS,
  SOURCE_RUN_TIMEOUT_MIN,
  activerSessionLinkedIn,
  closeStaleSourceRuns,
  compterRequetesLinkedIn,
  confirmerIpAttendue,
  creerSource,
  enqueueDiscoverForActiveSources,
  enqueueRequestedRuns,
  extraireEngageurs,
  fusionner,
  MSG,
  lireSessionLinkedIn,
  prendreVerrouLinkedIn,
  QUEUES,
  startSourceRun,
  traiterCollecteLinkedIn,
} from './_linkedin-collecte-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit
// pas emporter les suivantes. Un harnais qui saute une preuve en silence est
// pire qu'un harnais rouge.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}

// --------------------------------------------------------------------- fixtures

let seq = 0;
const POST = 'https://www.linkedin.com/feed/update/urn:li:activity:7271000000000000001/';
const IP = '203.0.113.7';

async function userNeuf() {
  return (
    await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [
      `u${Date.now()}${(seq += 1)}@test.local`,
    ])
  ).rows[0].id;
}

/**
 * Une organisation prête à collecter. La SOURCE passe par `creerSource`, la
 * fonction de production que l'écran Sources appelle : c'est elle qui écrit le
 * marqueur `config.sourceType` et la ligne `campaign_sources` que le collecteur
 * relit. L'organisation, le persona et la campagne sont posés en SQL direct —
 * `creerCampagne` et l'inscription d'un membre sont les chemins de production
 * équivalents, ils n'apportent rien à ce qui est prouvé ici.
 */
async function monde({ personaDansSource = true, campagneActive = true, session = 'active', garder = ['reagi'] } = {}) {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = await userNeuf();
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, admin]);
  const persona = (
    await q(`insert into personas (organization_id, name, scoring_prompt) values ($1, 'Directeur commercial', 'x') returning id`, [org])
  ).rows[0].id;
  const campagne = (
    await q(`insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', $3, $2::jsonb) returning id`, [
      org,
      JSON.stringify({ personas: [persona] }),
      campagneActive ? 'active' : 'draft',
    ])
  ).rows[0].id;

  const ctx = { ex: pool, organisationId: org, utilisateurId: admin, role: 'admin' };
  const { id: source } = await creerSource(ctx, {
    campagneId: campagne,
    providerId: 'linkedin_post_engagers',
    nom: 'Engageurs du post',
    config: { urlPost: POST, garder, ...(personaDansSource ? { personaId: persona } : {}) },
  });

  if (session !== 'absente') {
    // Chemin de production : `jay-reach linkedin connecter`.
    await activerSessionLinkedIn(ctx, IP);
    if (session !== 'active') {
      await q(`update linkedin_server_sessions set status = 'bloquee', blocked_reason = 'defi', blocked_at = now() where organization_id = $1`, [org]);
    }
  }
  return { org, admin, persona, campagne, source, ctx };
}

/** Une source de post de plus sur la même campagne, par la fonction de production. */
async function sourceDePost(m, urlPost) {
  const { id } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_post_engagers',
    nom: `Engageurs ${urlPost.slice(-3)}`,
    config: { urlPost, garder: ['reagi'], personaId: m.persona },
  });
  return id;
}

const run = async (m) => startSourceRun(pool, m.source);
const job = (m, runId) => ({ organizationId: m.org, sourceId: m.source, sourceRunId: runId });

// ------------------------------------------------------------- pilote factice

/** Réponse Voyager normalisée : profils dans `included`, total dans `data.paging`. */
function voyager(profils, total = profils.length) {
  return JSON.stringify({
    data: {
      paging: { start: 0, count: 50, total },
      elements: profils.map((p) => ({ reactionType: 'LIKE', actorUrn: `urn:li:fsd_profile:${p.id}` })),
    },
    included: profils.map((p) => ({
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: `urn:li:fsd_profile:${p.id}`,
      ...(p.prenom === undefined ? {} : { firstName: p.prenom }),
      ...(p.nom === undefined ? {} : { lastName: p.nom }),
      headline: p.titre ?? '',
      ...(p.public ? { publicIdentifier: p.public } : {}),
    })),
  });
}

function pilote({ url = POST, reponse } = {}) {
  const requetes = [];
  const p = {
    aller: async () => undefined,
    url: async () => url,
    saisir: async () => undefined,
    cliquer: async () => undefined,
    attendre: async () => false,
    requete: async (u) => {
      requetes.push(u);
      return reponse(u, requetes.length);
    },
    fermer: async () => undefined,
  };
  return { p, requetes };
}

/**
 * Le vrai pool, qui lève sur UNE requête reconnue à son marqueur. Tout le reste du
 * SQL est réellement exécuté : c'est l'inverse d'un pool factice, qui ne prouverait
 * que la forme des requêtes.
 */
function poolQuiLache(marqueur, fabriquer = () => new Error('panne de base')) {
  return {
    query: async (sql, params) => {
      if (String(sql).includes(marqueur)) throw fabriquer();
      return pool.query(sql, params);
    },
    connect: () => pool.connect(),
  };
}

function deps(p, extra = {}) {
  return {
    pool,
    env: { JAY_REACH_LINKEDIN: '1' },
    ouvrirNavigateur: async () => p.p,
    releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
    pause: async () => undefined,
    ...extra,
  };
}

const ADA = { id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale chez Acme', public: 'ada-lovelace' };
const BOB = { id: 'ACoAAbob', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' };
const SANS_NOM = { id: 'ACoAAnul', titre: 'LinkedIn Member' };

/**
 * Le cas du second lot : l'élément de liste porte `objectUrn` et une décoration
 * d'affichage, SANS `publicIdentifier`, et il est rencontré AVANT le vrai profil de
 * `included` (la descente visite `data` en premier). Si le premier vu rafle l'URN,
 * `urlProfil` est perdue et l'adresse retombe sur la déduction par l'URN.
 */
function voyagerDecoreAvantComplet(p) {
  return JSON.stringify({
    data: {
      paging: { start: 0, count: 50, total: 1 },
      // La vignette porte ce que LinkedIn affiche d'un HORS-RÉSEAU : nom abrégé et
      // intitulé court. Lui donner le nom complet poserait comme acquis ce que le
      // contrôle doit vérifier.
      elements: [
        { objectUrn: `urn:li:fsd_profile:${p.id}`, headline: 'Directrice commerciale', name: `${p.prenom} ${p.nom[0]}.` },
      ],
    },
    included: [
      {
        $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
        entityUrn: `urn:li:fsd_profile:${p.id}`,
        firstName: p.prenom,
        lastName: p.nom,
        headline: p.titre,
        publicIdentifier: p.public,
      },
    ],
  });
}

/** Un profil enfoui sous `n` niveaux de décoration, comme la forme commentaires sait en empiler. */
function voyagerProfond(p, n) {
  let noeud = {
    $type: 'com.linkedin.voyager.identity.shared.MiniProfile',
    entityUrn: `urn:li:fsd_profile:${p.id}`,
    firstName: p.prenom,
    lastName: p.nom,
    occupation: p.titre,
    publicIdentifier: p.public,
  };
  for (let i = 0; i < n; i += 1) noeud = { [`niveau${i}`]: noeud };
  return JSON.stringify({ data: { paging: { start: 0, count: 50, total: 1 }, commentaires: noeud } });
}

const lirePassage = async (runId) =>
  (
    await q(
      `select status, error, items_found, items_new, requetes, vus, nouveaux, doublons, deja_en_campagne,
              ip_sortie, operateur_sortie, verdict_linkedin, finished_at
         from source_runs where id = $1`,
      [runId],
    )
  ).rows[0];

// ----------------------------------------------------------------- 1. nominal

async function nominal() {
  console.log('\n1. un passage nominal : signaux, contacts, compteurs, trace par requête');
  const m = await monde();
  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA, BOB]) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));

  const passage = await lirePassage(r);
  check('1. le passage est un succès', passage.status === 'success', `${passage.status} / ${passage.error}`);
  // Deux requêtes : le CHARGEMENT DE LA PAGE du post, puis l'appel Voyager. Le
  // chargement est du trafic LinkedIn comme le reste, et il se paie.
  check('2. les compteurs du passage disent ce qui s’est produit', passage.vus === 2 && passage.nouveaux === 2 && passage.requetes === 2, JSON.stringify(passage));
  check('3. items_found/items_new restent alimentés pour la carte « dernier passage »', passage.items_found === 2 && passage.items_new === 2);
  check('4. la sortie observée est consignée sur le passage', passage.ip_sortie === IP && passage.operateur_sortie?.includes('Exemple') === true, `${passage.ip_sortie}`);

  const sig = (await q(`select external_id, source_run_id, kind, url from signals where organization_id = $1 order by external_id`, [m.org])).rows;
  check('5. un signal post_engagement par personne', sig.length === 2 && sig.every((s) => s.kind === 'post_engagement'), String(sig.length));
  check('6. chaque signal porte le passage qui l’a collecté', sig.every((s) => s.source_run_id === r));

  const ct = (await q(`select first_name, linkedin_url, linkedin_provider_id, persona_id, enrichment from contacts where organization_id = $1 order by first_name`, [m.org])).rows;
  check('7. l’adresse de profil vient du publicIdentifier, pas de l’URN', ct[0]?.linkedin_url === 'https://www.linkedin.com/in/ada-lovelace', ct[0]?.linkedin_url);
  check('7b. sans publicIdentifier, l’adresse est déduite de l’URN', ct[1]?.linkedin_url === 'https://www.linkedin.com/in/ACoAAbob', ct[1]?.linkedin_url);
  check('8. l’entreprise lue dans l’intitulé est conservée en texte libre', ct[0]?.enrichment?.entreprise === 'Acme', JSON.stringify(ct[0]?.enrichment));
  check('8b. le contact porte le persona de la source', ct.every((c) => c.persona_id === m.persona));

  const traces = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1 and source_run_id = $2`, [m.org, r])).rows[0].n;
  check('10. une trace par requête émise, chargement de la page du post COMPRIS', traces === 2 && pil.requetes.length === 1,
    `${traces} tracées / ${pil.requetes.length} appel(s) Voyager`);
  check('10b. ce passage porte un verdict : il remet le disjoncteur à zéro', passage.verdict_linkedin === true);

  const s = await lireSessionLinkedIn(m.ctx);
  check('11. la dernière collecte est horodatée sur la session', s.derniereCollecte !== null);
  check('11b. la session reste active', s.etat === 'active', s.etat);
  const verrou = (await q(`select lock_until < now() as libre, lock_owner from linkedin_server_sessions where organization_id = $1`, [m.org])).rows[0];
  check('12. le verrou est rendu en fin de passage', verrou.libre === true, JSON.stringify(verrou));
  check('13. la durée du verrou reste sous le délai de péremption d’un passage', DUREE_VERROU_COLLECTE_MS < SOURCE_RUN_TIMEOUT_MIN * 60_000, `${DUREE_VERROU_COLLECTE_MS} vs ${SOURCE_RUN_TIMEOUT_MIN * 60_000}`);
  check('14. la file de collecte ne rejoue jamais', QUEUES.find((x) => x.name === 'linkedin.collecte')?.retry.retryLimit === 0);
}

async function profilIncomplet() {
  console.log('\n2. un profil que LinkedIn n’a pas nommé');
  const m = await monde();
  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA, SANS_NOM]) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));
  const passage = await lirePassage(r);
  const n = (await q(`select count(*)::int n from contacts where organization_id = $1`, [m.org])).rows[0].n;
  check('9. le profil sans nom n’emporte pas le passage, les autres sont enregistrés', passage.status === 'success' && n === 1, `${passage.status} / ${passage.error} / ${n}`);
  check('9b. il est compté dans les personnes vues, pas dans les nouvelles', passage.vus === 2 && passage.nouveaux === 1, JSON.stringify(passage));
  check('9c. l’extraction le rend bien (sinon le garde-fou ne serait jamais exercé)', extraireEngageurs(JSON.parse(voyager([SANS_NOM]))).personnes.length === 1);
}

// ------------------------------------------------------------- 3. les plafonds

async function plafondHoraire() {
  console.log('\n3. le plafond horaire, en fenêtre glissante');
  const m = await monde();
  // Chemin de production : écran Réglages > Plafonds (`ecrireReglage`), qui écrit
  // la même ligne. Le collecteur la relit par `lirePlafondLinkedIn`.
  // Trois : le chargement de la page en consomme une, il reste deux appels Voyager.
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_requetes_par_heure', '3')`, [m.org]);

  // Une requête d'il y a deux heures : hors fenêtre, elle ne doit rien consommer.
  const vieuxRun = await run(m);
  await q(`insert into linkedin_requetes (organization_id, source_run_id, requested_at) values ($1, $2, now() - interval '2 hours')`, [m.org, vieuxRun]);

  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA], 500) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));
  const passage = await lirePassage(r);
  check('15. une requête vieille de deux heures ne consomme pas le plafond de l’heure', pil.requetes.length === 2, `${pil.requetes.length} appel(s) Voyager`);
  check('16. le plafond atteint en cours de pagination termine le passage proprement', passage.status === 'success' && passage.requetes === 3, `${passage.status} / ${passage.requetes}`);
  check('16b. ce qui a été vu avant le plafond est enregistré', passage.nouveaux === 1, JSON.stringify(passage));
  const compte = await compterRequetesLinkedIn(m.ctx, new Date(Date.now() - 3_600_000));
  check('16c. la trace de l’heure compte exactement les requêtes émises', compte === 3, String(compte));
}

async function plafondPosts() {
  console.log('\n4. le plafond de posts du jour');
  const m = await monde();
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '1')`, [m.org]);

  const r1 = await run(m);
  const p1 = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(p1), job(m, r1));
  check('17. le premier passage du jour n’est pas compté contre lui-même', (await lirePassage(r1)).requetes === 2, JSON.stringify(await lirePassage(r1)));

  const r2 = await run(m);
  const p2 = pilote({ reponse: () => ({ statut: 200, corps: voyager([BOB]) }) });
  await traiterCollecteLinkedIn(deps(p2), job(m, r2));
  const passage = await lirePassage(r2);
  check('18. le second passage du même jour est refusé avant toute requête', p2.requetes.length === 0, `${p2.requetes.length}`);
  check('18b. il se termine en succès (le rejouer redépasserait le même plafond)', passage.status === 'success', `${passage.status} / ${passage.error}`);
}

// ---------------------------------------------------------------- 5. frictions

async function frictions() {
  console.log('\n5. les frictions');

  const m999 = await monde();
  const r999 = await run(m999);
  const p999 = pilote({ reponse: () => ({ statut: 999, corps: '' }) });
  await traiterCollecteLinkedIn(deps(p999), job(m999, r999));
  const s999 = await lireSessionLinkedIn(m999.ctx);
  check('19. un statut 999 bloque la session sur un défi', s999.etat === 'bloquee' && s999.motif === 'defi', `${s999.etat}/${s999.motif}`);
  check('19b. le passage est en erreur', (await lirePassage(r999)).status === 'error');
  const notif999 = (await q(`select count(*)::int n from notifications where organization_id = $1 and event = 'linkedin.session_blocked'`, [m999.org])).rows[0].n;
  check('19c. les membres sont prévenus du blocage', notif999 === 1, String(notif999));

  const m404 = await monde();
  const r404 = await run(m404);
  const p404 = pilote({ reponse: () => ({ statut: 404, corps: '' }) });
  await traiterCollecteLinkedIn(deps(p404), job(m404, r404));
  const s404 = await lireSessionLinkedIn(m404.ctx);
  check('20. un post introuvable arrête le passage SANS bloquer la session', s404.etat === 'active' && (await lirePassage(r404)).status === 'error', `${s404.etat}`);
  const notif404 = (await q(`select count(*)::int n from notifications where organization_id = $1 and event = 'linkedin.collecte_arretee'`, [m404.org])).rows[0].n;
  check('20b. l’opérateur est prévenu que sa collecte s’est arrêtée', notif404 === 1, String(notif404));

  const mVide = await monde();
  const rVide = await run(mVide);
  const pVide = pilote({ reponse: () => ({ statut: 200, corps: voyager([], 42) }) });
  await traiterCollecteLinkedIn(deps(pVide), job(mVide, rVide));
  const sVide = await lireSessionLinkedIn(mVide.ctx);
  check('21. une liste vide sur un post qui annonce 42 réactions arrête le passage sans bloquer la session', sVide.etat === 'active' && (await lirePassage(rVide)).status === 'error', `${sVide.etat}`);

  const mDefi = await monde();
  const rDefi = await run(mDefi);
  const pDefi = pilote({ url: 'https://www.linkedin.com/checkpoint/challenge/', reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pDefi), job(mDefi, rDefi));
  const sDefi = await lireSessionLinkedIn(mDefi.ctx);
  check('22. une arrivée sur un checkpoint bloque la session, et aucune requête ne part', pDefi.requetes.length === 0 && sDefi.motif === 'defi', `${pDefi.requetes.length}/${sDefi.motif}`);
}

// ------------------------------------------------------- 6. gardes préalables

async function gardes() {
  console.log('\n6. ce que le handler refuse de faire');

  const mBloquee = await monde({ session: 'bloquee' });
  const rBloquee = await run(mBloquee);
  let ouvert = 0;
  const pB = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(
    deps(pB, {
      ouvrirNavigateur: async () => {
        ouvert += 1;
        return pB.p;
      },
    }),
    job(mBloquee, rBloquee),
  );
  check('23. session bloquée : le navigateur n’est même pas ouvert', ouvert === 0 && pB.requetes.length === 0);
  check('23b. le passage est refermé en erreur, pas laissé ouvert', (await lirePassage(rBloquee)).status === 'error');

  const mFlag = await monde();
  const rFlag = await run(mFlag);
  const pF = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pF, { env: {} }), job(mFlag, rFlag));
  check('24. sans JAY_REACH_LINKEDIN, rien ne part', pF.requetes.length === 0 && (await lirePassage(rFlag)).status === 'error');

  const mDraft = await monde({ campagneActive: false });
  const rDraft = await run(mDraft);
  const pD = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pD), job(mDraft, rDraft));
  check('25. une campagne en brouillon ne collecte pas', pD.requetes.length === 0 && (await lirePassage(rDraft)).status === 'error');

  const mSortie = await monde();
  const rSortie = await run(mSortie);
  const pS = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pS, { releverSortie: async () => ({ ip: '198.51.100.9' }) }), job(mSortie, rSortie));
  const sSortie = await lireSessionLinkedIn(mSortie.ctx);
  check('26. une sortie inattendue bloque la session avant toute requête', pS.requetes.length === 0 && sSortie.motif === 'sortie_inattendue', `${pS.requetes.length}/${sSortie.motif}`);
  check('26b. l’IP vue est consignée pour que l’écran la montre', sSortie.ipVue === '198.51.100.9', sSortie.ipVue);

  const mVerrou = await monde();
  const rVerrou = await run(mVerrou);
  await prendreVerrouLinkedIn(mVerrou.ctx, 'cli-1234', 60_000);
  const pV = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pV), job(mVerrou, rVerrou));
  check('27. un verrou tenu par un autre processus arrête le passage', pV.requetes.length === 0 && (await lirePassage(rVerrou)).status === 'error');

  // Reprise après redémarrage : le verrou porte déjà le nom de CE passage.
  const mReprise = await monde();
  const rReprise = await run(mReprise);
  await prendreVerrouLinkedIn(mReprise.ctx, `collecte-${rReprise}`, 600_000);
  const pR = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(pR), job(mReprise, rReprise));
  check('28. le même passage reprend son propre verrou après un redémarrage', (await lirePassage(rReprise)).status === 'success', (await lirePassage(rReprise)).error);
}

// ------------------------------------------------------------ 7. disjoncteur

async function disjoncteur() {
  console.log('\n7. le disjoncteur');
  const m = await monde();
  const panne = pilote({
    reponse: () => {
      throw new Error('réseau');
    },
  });
  for (let i = 0; i < 2; i += 1) {
    const r = await run(m);
    await traiterCollecteLinkedIn(deps(panne), job(m, r)).catch(() => undefined);
    const s = await lireSessionLinkedIn(m.ctx);
    check(`29.${i + 1} après ${i + 1} échec(s), la session reste active`, s.etat === 'active', s.etat);
  }
  const r3 = await run(m);
  await traiterCollecteLinkedIn(deps(panne), job(m, r3)).catch(() => undefined);
  const s = await lireSessionLinkedIn(m.ctx);
  check('30. trois échecs consécutifs bloquent la session avec le motif disjoncteur', s.etat === 'bloquee' && s.motif === 'disjoncteur', `${s.etat}/${s.motif}`);
  const passage = await lirePassage(r3);
  check('30b. le message du passage ne porte que le type de l’erreur', /^Collecte interrompue \(/.test(passage.error ?? ''), passage.error);

  // Un passage laissé ouvert par un worker tué est refermé par le chemin de
  // production `closeStaleSourceRuns` — mais il n'entre PAS dans la fenêtre du
  // disjoncteur : cette fonction n'écrit pas `verdict_linkedin`, et un worker tué
  // est un incident d'hébergement qu'une reconnexion LinkedIn ne corrigerait pas.
  const m2 = await monde();
  const abandonne = await run(m2);
  await q(`update source_runs set started_at = now() - interval '45 minutes' where id = $1`, [abandonne]);
  const refermes = await closeStaleSourceRuns(pool);
  const refere = await lirePassage(abandonne);
  check('31. un passage abandonné est refermé en erreur par le producteur', refermes >= 1 && refere.status === 'error', String(refermes));
  check('31b. et il ne porte aucun verdict, donc il reste hors du disjoncteur', refere.verdict_linkedin === false, String(refere.verdict_linkedin));
}

/**
 * La borne de session. Sans elle : l'opérateur reconnecte son compte après un
 * blocage, le passage suivant rate UNE fois, et les deux anciens échecs le
 * rebloquent aussitôt avec un « Trop d'échecs d'affilée » qui est faux.
 */
async function disjoncteurBorneParLaReconnexion() {
  console.log('\n17. reconnecter, puis rater une fois');
  const m = await monde();
  // Cinq passages dans la journée : le plafond de posts ne doit pas court-circuiter
  // le scénario avant la fin.
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '10')`, [m.org]);
  const panne = () =>
    pilote({
      reponse: () => {
        throw new Error('réseau');
      },
    });
  for (let i = 0; i < 3; i += 1) {
    const r = await run(m);
    await traiterCollecteLinkedIn(deps(panne()), job(m, r)).catch(() => undefined);
  }
  check('51. trois échecs bloquent la session', (await lireSessionLinkedIn(m.ctx)).motif === 'disjoncteur');

  // Chemin de production : `jay-reach linkedin connecter`.
  await activerSessionLinkedIn(m.ctx, IP);
  check('51b. la reconnexion rend la session active', (await lireSessionLinkedIn(m.ctx)).etat === 'active');

  const r4 = await run(m);
  await traiterCollecteLinkedIn(deps(panne()), job(m, r4)).catch(() => undefined);
  const apres = await lireSessionLinkedIn(m.ctx);
  check('52. un seul échec après la reconnexion ne rebloque PAS la session', apres.etat === 'active', `${apres.etat}/${apres.motif}`);

  // Mais le compteur repart : trois échecs APRÈS la reconnexion bloquent toujours.
  for (let i = 0; i < 2; i += 1) {
    const r = await run(m);
    await traiterCollecteLinkedIn(deps(panne()), job(m, r)).catch(() => undefined);
  }
  const fin = await lireSessionLinkedIn(m.ctx);
  check('52b. et trois échecs APRÈS la reconnexion bloquent de nouveau', fin.etat === 'bloquee' && fin.motif === 'disjoncteur', `${fin.etat}/${fin.motif}`);
}

/**
 * Une panne de base survient APRÈS la dernière requête LinkedIn : la boucle
 * d'enregistrement ne fait que du Postgres. Le pool injecté lève sur la seule
 * requête `jr:linkedin_collecte_marquer`, tout le reste est réel.
 */
async function panneDeBaseApresLeTrafic() {
  console.log('\n18. une panne de base après tout le trafic LinkedIn');
  const m = await monde();
  const r = await run(m);
  const d = { ...deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) })), pool: poolQuiLache('jr:linkedin_collecte_marquer') };
  await traiterCollecteLinkedIn(d, job(m, r)).catch(() => undefined);
  const passage = await lirePassage(r);
  check('53. le passage échoue', passage.status === 'error', `${passage.status} / ${passage.error}`);
  check('53b. une panne de base survenue après le trafic ne porte AUCUN verdict sur le compte',
    passage.verdict_linkedin === false, String(passage.verdict_linkedin));
  check('53c. et les personnes vues avant la panne sont enregistrées',
    (await q(`select count(*)::int n from contacts where organization_id = $1`, [m.org])).rows[0].n === 1);

  // DANS la boucle d'enregistrement : `enregistrerEngageur` tape le pool
  // directement, plusieurs requêtes par personne. C'est ce scénario-là que le
  // ruling décrivait, et le contrôle 53 ne l'atteignait pas — son point
  // d'injection est postérieur à la boucle.
  const m2 = await monde();
  const r2 = await run(m2);
  const d2 = {
    ...deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) })),
    pool: poolQuiLache('from linkedin_engageurs_ecartes'),
  };
  await traiterCollecteLinkedIn(d2, job(m2, r2)).catch(() => undefined);
  const p2 = await lirePassage(r2);
  check('54. une panne PENDANT la boucle d’enregistrement ne porte aucun verdict non plus',
    p2.status === 'error' && p2.verdict_linkedin === false, `${p2.status} / ${p2.verdict_linkedin}`);

  // AVANT la fin du trafic : `tracerRequeteLinkedIn` part à chaque requête. Ici le
  // drapeau ne peut pas aider — c'est la reconnaissance de l'erreur Postgres qui
  // décide. Vraie `DatabaseError` de `pg`, dont le `name` vaut « error ».
  const m3 = await monde();
  const r3 = await run(m3);
  const d3 = {
    ...deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) })),
    pool: poolQuiLache('jr:linkedin_requete_tracer', () => new pg.DatabaseError('canceling statement due to statement timeout', 100, 'error')),
  };
  await traiterCollecteLinkedIn(d3, job(m3, r3)).catch(() => undefined);
  const p3 = await lirePassage(r3);
  check('55. une erreur Postgres levée AVANT la fin du trafic ne porte pas de verdict non plus',
    p3.status === 'error' && p3.verdict_linkedin === false, `${p3.status} / ${p3.verdict_linkedin}`);
  check('55b. et son nom réel, « error », arrive tel quel à l’écran', p3.error === 'Collecte interrompue (error).', p3.error);
}

/**
 * Une sortie inattendue bloque DÉJÀ la session elle-même. Si elle portait en plus
 * un verdict, `confirmerIpAttendue` lèverait le blocage sans toucher
 * `connected_at` : l'échec resterait dans la fenêtre, et trois changements d'IP
 * résolus par l'opérateur rebloqueraient la session pour un problème réglé.
 */
async function sortieInattendueNeDisjonctePas() {
  console.log('\n19. trois changements d’IP de proxy, chacun confirmé');
  const m = await monde();
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '10')`, [m.org]);
  for (let i = 0; i < 3; i += 1) {
    const r = await run(m);
    const d = deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) }), {
      releverSortie: async () => ({ ip: `198.51.100.${9 + i}` }),
    });
    await traiterCollecteLinkedIn(d, job(m, r));
    check(`56.${i + 1} la sortie inattendue bloque la session sans porter de verdict`,
      (await lireSessionLinkedIn(m.ctx)).motif === 'sortie_inattendue' && (await lirePassage(r)).verdict_linkedin === false);
    // Chemin de production : « jay-reach linkedin ip --confirmer ».
    await confirmerIpAttendue(m.ctx, `198.51.100.${9 + i}`);
  }
  check('56b. après confirmation, la session est active', (await lireSessionLinkedIn(m.ctx)).etat === 'active');

  // C'est le passage suivant, qui lève, qui fait lire la fenêtre.
  const r4 = await run(m);
  await traiterCollecteLinkedIn(
    deps(
      pilote({
        reponse: () => {
          throw new Error('réseau');
        },
      }),
      // La sortie est désormais CELLE QUI A ÉTÉ CONFIRMÉE : ce passage échoue sur
      // le réseau, pas sur un nouvel écart d'IP.
      { releverSortie: async () => ({ ip: '198.51.100.11' }) },
    ),
    job(m, r4),
  ).catch(() => undefined);
  const fin = await lireSessionLinkedIn(m.ctx);
  check('57. trois changements d’IP confirmés puis un incident ne bloquent PAS la session', fin.etat === 'active', `${fin.etat}/${fin.motif}`);
}

// -------------------------------------------------------------- 8. producteur

async function producteur() {
  console.log('\n8. le producteur, des deux côtés');
  const m = await monde();
  const envoyes = [];
  const boss = { send: async (name, data) => envoyes.push({ name, data }), insert: async (jobs) => envoyes.push(...jobs) };

  // État DÉLIBÉRÉMENT ARTIFICIEL, et il faut le dire : aucune fonction de
  // production n'écrit de ligne `source_providers` ni de `keywords` pour un type
  // linkedin_* (`creerSource` ne crée le rattachement que pour les autres types,
  // et `construireConfigStocke` ne met `keywords` en miroir que pour adzuna et
  // france_travail). On pose les deux ici parce que ce sont EXACTEMENT les deux
  // conditions qui écartent aujourd'hui ces sources du tour périodique : sans
  // elles, le contrôle resterait vert avec ou sans la clause d'exclusion, donc
  // ne prouverait rien. Il mesure donc une défense en profondeur, pas le
  // comportement courant.
  await q(`insert into source_providers (source_id, provider_id, is_active) values ($1, 'adzuna', true)`, [m.source]);
  await q(`update sources set config = config || '{"keywords":["directeur commercial"]}'::jsonb where id = $1`, [m.source]);
  const planifies = await enqueueDiscoverForActiveSources(boss, pool, { bucket: 'test' });
  check('32. le tour périodique n’enfile aucune source LinkedIn', planifies === 0 && envoyes.length === 0, `${planifies} / ${JSON.stringify(envoyes)}`);
  // La config est remise dans son état de production pour la suite de la section.
  await q(`update sources set config = config - 'keywords' where id = $1`, [m.source]);

  // Chemin de production : bouton « Lancer la collecte » de l'écran Sources.
  await q(`update sources set run_requested_at = now() where id = $1`, [m.source]);
  const demandes = await enqueueRequestedRuns(boss, pool);
  check('33. une collecte demandée à la main enfile un job linkedin.collecte', demandes === 1 && envoyes[0]?.name === 'linkedin.collecte', JSON.stringify(envoyes));
  const charge = envoyes[0]?.data ?? {};
  check('34. la charge utile porte l’organisation, la source et le passage', charge.organizationId === m.org && charge.sourceId === m.source && typeof charge.sourceRunId === 'string', JSON.stringify(charge));
  const ouvert = (await q(`select status from source_runs where id = $1`, [charge.sourceRunId])).rows[0];
  check('35. le passage est réellement ouvert en base avant le job', ouvert?.status === 'running', JSON.stringify(ouvert));
  const demande = (await q(`select run_requested_at from sources where id = $1`, [m.source])).rows[0];
  check('36. la demande est consommée', demande.run_requested_at === null);
}

// ------------------------------------- 9. plusieurs passages dans le meme tour

/**
 * Le cas que le round 2 a trouvé : `lancerCampagne` demande une collecte sur TOUTES
 * les sources de la campagne à chaque activation, et le producteur ouvre leurs
 * passages dans la même boucle. Si le plafond compte les lignes de passage, les
 * quatre lisent « quatre posts aujourd'hui » et se clôturent tous à vide.
 */
async function memeTour() {
  console.log('\n9. quatre posts demandés dans le même tour, plafond de trois');
  const m = await monde();
  for (let i = 2; i <= 4; i += 1) {
    await sourceDePost(m, `https://www.linkedin.com/feed/update/urn:li:activity:727100000000000000${i}/`);
  }
  // Chemin de production : `lancerCampagne` pose `run_requested_at` sur toutes les
  // sources de la campagne (`lancerTache({tache:'sources'})` fait de même).
  await q(`update sources set run_requested_at = now() where organization_id = $1`, [m.org]);
  const envoyes = [];
  const boss = { send: async (name, data) => envoyes.push({ name, data }), insert: async () => undefined };
  // Plafond ÉCRIT, pas hérité du défaut de `CLES_REGLAGES` : le contrôle ne doit
  // pas changer de sens le jour où ce défaut change.
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '3')`, [m.org]);
  const enfiles = await enqueueRequestedRuns(boss, pool);
  check('37. les quatre collectes sont enfilées dans le même tour', enfiles === 4 && envoyes.length === 4, String(enfiles));

  // Exécution séquentielle : c'est ce que fait pg-boss, `work()` sans options ne
  // prend qu'un job à la fois par file — et le verrou de session le garantirait sinon.
  let collectes = 0;
  const refuses = [];
  for (const e of envoyes) {
    const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
    await traiterCollecteLinkedIn(deps(pil), e.data);
    const passage = await lirePassage(e.data.sourceRunId);
    if (passage.requetes > 0) collectes += 1;
    else refuses.push(passage);
  }
  check('38. trois posts collectent vraiment, le quatrième seul est refusé', collectes === 3 && refuses.length === 1,
    `${collectes} collectés / ${refuses.length} refusés`);
  // Refusé par LE PLAFOND DE POSTS, pas par le verrou, la session ou le plafond
  // horaire — qui donneraient tous le même « zéro requête ».
  check('38b. et refusé par le plafond de posts, pas par autre chose',
    refuses[0]?.status === 'success' && refuses[0]?.error === MSG.plafond_posts, JSON.stringify(refuses[0]));
}

// --------------------------------- 10. ce que le disjoncteur ne doit PAS compter

async function disjoncteurRefusLocaux() {
  console.log('\n10. un refus local ne nourrit pas le disjoncteur');
  const m = await monde({ campagneActive: false });
  // Deux clics sur « Lancer la collecte » avec une campagne encore en brouillon.
  for (let i = 0; i < 2; i += 1) {
    const r = await run(m);
    await traiterCollecteLinkedIn(deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) })), job(m, r));
  }
  // Chemin de production : `lancerCampagne` passe la campagne en `active`.
  await q(`update campaigns set status = 'active' where organization_id = $1`, [m.org]);
  const r3 = await run(m);
  const panne = pilote({
    reponse: () => {
      throw new Error('réseau');
    },
  });
  await traiterCollecteLinkedIn(deps(panne), job(m, r3)).catch(() => undefined);
  const s = await lireSessionLinkedIn(m.ctx);
  check('39. deux refus locaux puis un vrai échec : la session reste active', s.etat === 'active', `${s.etat}/${s.motif}`);
}

async function disjoncteurReleveSortie() {
  console.log('\n11. trois relèves de sortie en échec font disjoncter (proxy mort)');
  const m = await monde();
  for (let i = 0; i < 3; i += 1) {
    const r = await run(m);
    const d = deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) }), {
      releverSortie: async () => {
        throw new Error('écho injoignable');
      },
    });
    await traiterCollecteLinkedIn(d, job(m, r)).catch(() => undefined);
  }
  const s = await lireSessionLinkedIn(m.ctx);
  check('40. un échec de relève compte parmi les erreurs consécutives, sans aucune requête émise', s.etat === 'bloquee' && s.motif === 'disjoncteur', `${s.etat}/${s.motif}`);
  const traces = (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1`, [m.org])).rows[0].n;
  check('40b. et rien n’a été émis vers LinkedIn', traces === 0, String(traces));
}

// --------------------------- 12. deux objets pour la meme personne, et la profondeur

async function fusionDesObjets() {
  console.log('\n12. le profil décoré arrive AVANT le profil complet');
  const m = await monde();
  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyagerDecoreAvantComplet(ADA) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));
  const ct = (await q(`select linkedin_url, job_title from contacts where organization_id = $1`, [m.org])).rows;
  check('41. le second objet, plus complet, n’est pas perdu : l’adresse vient du publicIdentifier',
    ct.length === 1 && ct[0]?.linkedin_url === 'https://www.linkedin.com/in/ada-lovelace', JSON.stringify(ct));
  check('41b. et une seule personne est créée pour cet URN', ct.length === 1, String(ct.length));
  // Le défaut du round 3 : la vignette arrive en premier avec « Ada L. », et c'est
  // sur ce nom tronqué que la tâche 8 achèterait une adresse.
  const fiche = (await q(`select first_name, last_name, job_title, enrichment from contacts where organization_id = $1`, [m.org])).rows[0];
  check('41d. le nom retenu est le nom structuré du profil, pas la vignette abrégée',
    fiche?.first_name === 'Ada' && fiche?.last_name === 'Lovelace', JSON.stringify(fiche));
  check('41e. l’intitulé retenu est celui de l’entité profil, et l’entreprise le suit',
    fiche?.job_title === 'Directrice commerciale chez Acme' && fiche?.enrichment?.entreprise === 'Acme', JSON.stringify(fiche));

  const direct = extraireEngageurs(JSON.parse(voyagerDecoreAvantComplet(ADA)));
  check('41c. l’extraction rend UNE personne, fusionnée', direct.personnes.length === 1 && direct.personnes[0]?.urlProfil !== undefined,
    JSON.stringify(direct.personnes));

  // La règle champ par champ, directement sur `fusionner`. Une entité mince ne doit
  // RIEN effacer : on échangerait une troncature contre une disparition.
  const vu = (e, rangNom, rangIntitule) => ({ ...e, provenance: { rangNom, rangIntitule } });
  const avecNom = vu({ urn: 'urn:li:fsd_profile:X', nom: 'Ada Lovelace', intitule: '' }, 3, 0);
  const avecTitre = vu({ urn: 'urn:li:fsd_profile:X', nom: '', intitule: 'Directrice commerciale chez Acme', entreprise: 'Acme' }, 0, 1);
  const f1 = fusionner(avecNom, avecTitre);
  check('45. un intitulé arrivé en second comble un intitulé vide, et son entreprise vient avec',
    f1.nom === 'Ada Lovelace' && f1.intitule === 'Directrice commerciale chez Acme' && f1.entreprise === 'Acme', JSON.stringify(f1));
  const f2 = fusionner(avecTitre, avecNom);
  check('46. l’entreprise SUIT l’intitulé retenu : un intitulé sans entreprise n’en invente pas une',
    f2.intitule === 'Directrice commerciale chez Acme' && f2.entreprise === 'Acme', JSON.stringify(f2));
  const sansEntreprise = vu({ urn: 'urn:li:fsd_profile:X', nom: '', intitule: 'Directrice commerciale' }, 0, 2);
  const f3 = fusionner(avecTitre, sansEntreprise);
  check('46b. et quand l’intitulé de meilleure source n’en porte pas, l’entreprise tombe avec lui',
    f3.intitule === 'Directrice commerciale' && f3.entreprise === undefined, JSON.stringify(f3));
  const mince = vu({ urn: 'urn:li:fsd_profile:X', nom: '', intitule: '', urlProfil: 'https://www.linkedin.com/in/ada-lovelace' }, 0, 0);
  const f4 = fusionner(fusionner(avecNom, avecTitre), mince);
  check('47. une entité mince ne fait qu’apporter l’adresse, elle n’efface rien',
    f4.nom === 'Ada Lovelace' && f4.intitule === 'Directrice commerciale chez Acme' && f4.urlProfil !== undefined, JSON.stringify(f4));
}

/**
 * Quelqu'un qui réagit ET commente apparaît dans les deux listes. Les réactions
 * sont demandées en premier, et rien ne dit qu'elles sont les mieux décorées.
 */
async function fusionEntreReponses() {
  console.log('\n14. la même personne dans la liste des réactions ET dans celle des commentaires');
  const m = await monde({ garder: ['reagi', 'commente'] });
  const r = await run(m);
  const pil = pilote({
    reponse: (url) =>
      url.includes('Reactions')
        ? { statut: 200, corps: voyager([{ id: ADA.id, prenom: 'Ada', nom: 'L.', titre: 'Directrice commerciale' }]) }
        : { statut: 200, corps: voyager([ADA]) },
  });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));
  const ct = (await q(`select first_name, last_name, linkedin_url, job_title from contacts where organization_id = $1`, [m.org])).rows;
  check('48. une seule personne, et la meilleure vue des deux réponses l’emporte',
    ct.length === 1 && ct[0]?.linkedin_url === 'https://www.linkedin.com/in/ada-lovelace' && ct[0]?.last_name === 'Lovelace',
    JSON.stringify(ct));
  check('48b. l’intitulé complet de la seconde réponse est retenu',
    ct[0]?.job_title === 'Directrice commerciale chez Acme', ct[0]?.job_title);
}

async function profondeur() {
  console.log('\n13. la profondeur de descente');
  // Mesuré : la forme commentaires met le profil à 7. Douze niveaux sont au-delà de
  // l’ancienne limite de 8 et bien en deçà de la nouvelle.
  const douze = extraireEngageurs(JSON.parse(voyagerProfond(ADA, 12)));
  check('42. un profil à douze niveaux est lu, et rien n’est tronqué',
    douze.personnes.length === 1 && douze.tronques === 0, JSON.stringify({ n: douze.personnes.length, t: douze.tronques }));

  const vingtCinq = extraireEngageurs(JSON.parse(voyagerProfond(ADA, 25)));
  check('43. au-delà, la troncature est COMPTÉE, elle n’est pas muette',
    vingtCinq.personnes.length === 0 && vingtCinq.tronques > 0, JSON.stringify({ n: vingtCinq.personnes.length, t: vingtCinq.tronques }));

  // Et le passage ne doit pas accuser LinkedIn de retenir la donnée.
  const m = await monde();
  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyagerProfond(ADA, 25) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r)).catch(() => undefined);
  const passage = await lirePassage(r);
  const s = await lireSessionLinkedIn(m.ctx);
  const notifs = (await q(`select count(*)::int n from notifications where organization_id = $1 and event = 'linkedin.collecte_arretee'`, [m.org])).rows[0].n;
  check('44. une liste vide PARCE QUE tronquée n’est pas annoncée comme une rétention de LinkedIn',
    passage.status === 'error' && notifs === 0, `${passage.status} / ${passage.error} / ${notifs} notif`);
  check('44b. l’échec de NOTRE parseur ne porte aucun verdict sur le compte',
    (await q(`select verdict_linkedin from source_runs where id = $1`, [r])).rows[0]?.verdict_linkedin === false);
  check('44c. le message qui atteint l’opérateur EXPLIQUE la panne, au lieu de nommer une classe',
    (passage.error ?? '').includes('imbriqués plus profond que 16 niveaux')
      && !(passage.error ?? '').startsWith('Collecte interrompue'), passage.error);
  check('44d. la session reste active', s.etat === 'active', s.etat);

  // Trois fois de suite : une décoration que LinkedIn change ne doit pas exiger
  // une reconnexion, qui ne corrigerait rien.
  for (let i = 0; i < 2; i += 1) {
    const r2 = await run(m);
    await traiterCollecteLinkedIn(deps(pilote({ reponse: () => ({ statut: 200, corps: voyagerProfond(ADA, 25) }) })), job(m, r2)).catch(() => undefined);
  }
  const apres = await lireSessionLinkedIn(m.ctx);
  check('44e. trois échecs de parseur d’affilée ne bloquent PAS la session', apres.etat === 'active', `${apres.etat}/${apres.motif}`);
}

async function navigateurInjoignable() {
  console.log('\n15. le navigateur ne répond pas');
  const m = await monde();
  const r = await run(m);
  const d = deps(pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) }), {
    ouvrirNavigateur: async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.3:9223');
    },
  });
  await traiterCollecteLinkedIn(d, job(m, r));
  const passage = await lirePassage(r);
  check('49. le passage est refermé TOUT DE SUITE, pas laissé running trente minutes',
    passage.status === 'error' && passage.finished_at !== null, `${passage.status}`);
  check('49b. le message dit que le navigateur est injoignable, et ne reprend pas l’adresse',
    (passage.error ?? '').startsWith(MSG.navigateur) && !/10\.0\.0\.3|9223/.test(passage.error ?? ''), passage.error);
  check('49c. un conteneur injoignable ne porte aucun verdict sur le compte LinkedIn',
    passage.verdict_linkedin === false, String(passage.verdict_linkedin));
}

async function postIntrouvableNeDisjonctePas() {
  console.log('\n16. trois adresses de post mal collées, puis un vrai incident');
  const m = await monde();
  // Quatre passages dans la journée : sans ce plafond relevé, le quatrième serait
  // refusé au plafond de posts et ne lèverait jamais — le contrôle 50b serait vide.
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '10')`, [m.org]);
  for (let i = 0; i < 3; i += 1) {
    const r = await run(m);
    await traiterCollecteLinkedIn(deps(pilote({ reponse: () => ({ statut: 404, corps: '' }) })), job(m, r));
  }
  const verdicts = (await q(
    `select count(*)::int n from source_runs sr join sources so on so.id = sr.source_id
      where so.organization_id = $1 and sr.verdict_linkedin`,
    [m.org],
  )).rows[0].n;
  check('50. un post introuvable ne porte aucun verdict : LinkedIn a répondu normalement', verdicts === 0, String(verdicts));

  // C'est le passage SUIVANT, qui lève, qui fait lire la fenêtre du disjoncteur.
  // Sans le filtre, les trois 404 la remplissaient et la session sautait ici.
  const r4 = await run(m);
  const panne = pilote({
    reponse: () => {
      throw new Error('réseau');
    },
  });
  await traiterCollecteLinkedIn(deps(panne), job(m, r4)).catch(() => undefined);
  const s = await lireSessionLinkedIn(m.ctx);
  check('50b. trois adresses mal collées puis un incident ne bloquent PAS la session', s.etat === 'active', `${s.etat}/${s.motif}`);
}

async function main() {
  await jouer(nominal, profilIncomplet, plafondHoraire, plafondPosts, frictions, gardes, disjoncteur, producteur,
    memeTour, disjoncteurRefusLocaux, disjoncteurReleveSortie, fusionDesObjets, profondeur,
    fusionEntreReponses, navigateurInjoignable, postIntrouvableNeDisjonctePas,
    disjoncteurBorneParLaReconnexion, panneDeBaseApresLeTrafic, sortieInattendueNeDisjonctePas);
  console.log(`\n[linkedin-collecte] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[linkedin-collecte] ERREUR', e);
  process.exit(2);
});

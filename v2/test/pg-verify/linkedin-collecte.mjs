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
  creerSource,
  enqueueDiscoverForActiveSources,
  enqueueRequestedRuns,
  extraireEngageurs,
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
async function monde({ personaDansSource = true, campagneActive = true, session = 'active' } = {}) {
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
    config: { urlPost: POST, garder: ['reagi'], ...(personaDansSource ? { personaId: persona } : {}) },
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
      elements: [{ objectUrn: `urn:li:fsd_profile:${p.id}`, headline: p.titre, name: `${p.prenom} ${p.nom}` }],
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
      `select status, error, items_found, items_new, requetes, vus, nouveaux, doublons, deja_en_campagne, ip_sortie, operateur_sortie
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
  check('2. les compteurs du passage disent ce qui s’est produit', passage.vus === 2 && passage.nouveaux === 2 && passage.requetes === 1, JSON.stringify(passage));
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
  check('10. une trace par requête émise', traces === 1, String(traces));

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
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_requetes_par_heure', '2')`, [m.org]);

  // Une requête d'il y a deux heures : hors fenêtre, elle ne doit rien consommer.
  const vieuxRun = await run(m);
  await q(`insert into linkedin_requetes (organization_id, source_run_id, requested_at) values ($1, $2, now() - interval '2 hours')`, [m.org, vieuxRun]);

  const r = await run(m);
  const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA], 500) }) });
  await traiterCollecteLinkedIn(deps(pil), job(m, r));
  const passage = await lirePassage(r);
  check('15. une requête vieille de deux heures ne consomme pas le plafond de l’heure', pil.requetes.length === 2, `${pil.requetes.length} requête(s)`);
  check('16. le plafond atteint en cours de pagination termine le passage proprement', passage.status === 'success' && passage.requetes === 2, `${passage.status} / ${passage.requetes}`);
  check('16b. ce qui a été vu avant le plafond est enregistré', passage.nouveaux === 1, JSON.stringify(passage));
  const compte = await compterRequetesLinkedIn(m.ctx, new Date(Date.now() - 3_600_000));
  check('16c. la trace de l’heure compte exactement les requêtes émises', compte === 2, String(compte));
}

async function plafondPosts() {
  console.log('\n4. le plafond de posts du jour');
  const m = await monde();
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'linkedin_posts_par_jour', '1')`, [m.org]);

  const r1 = await run(m);
  const p1 = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
  await traiterCollecteLinkedIn(deps(p1), job(m, r1));
  check('17. le premier passage du jour n’est pas compté contre lui-même', (await lirePassage(r1)).requetes === 1, JSON.stringify(await lirePassage(r1)));

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

  // Un passage laissé ouvert par un worker tué entre dans le compte, par le
  // chemin de production `closeStaleSourceRuns`.
  const m2 = await monde();
  const abandonne = await run(m2);
  await q(`update source_runs set started_at = now() - interval '45 minutes' where id = $1`, [abandonne]);
  const refermes = await closeStaleSourceRuns(pool);
  check('31. un passage abandonné est refermé en erreur par le producteur', refermes >= 1 && (await lirePassage(abandonne)).status === 'error', String(refermes));
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
  const enfiles = await enqueueRequestedRuns(boss, pool);
  check('37. les quatre collectes sont enfilées dans le même tour', enfiles === 4 && envoyes.length === 4, String(enfiles));

  // Exécution séquentielle : c'est ce que fait pg-boss, `work()` sans options ne
  // prend qu'un job à la fois par file — et le verrou de session le garantirait sinon.
  let collectes = 0;
  let refuses = 0;
  for (const e of envoyes) {
    const pil = pilote({ reponse: () => ({ statut: 200, corps: voyager([ADA]) }) });
    await traiterCollecteLinkedIn(deps(pil), e.data);
    const passage = await lirePassage(e.data.sourceRunId);
    if (passage.requetes > 0) collectes += 1;
    else refuses += 1;
  }
  check('38. trois posts collectent vraiment, le quatrième seul est refusé au plafond', collectes === 3 && refuses === 1, `${collectes} collectés / ${refuses} refusés`);
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
  // Le premier vu garde ce qu'il a renseigné : l'intitulé est bien celui de l'élément décoré.
  const direct = extraireEngageurs(JSON.parse(voyagerDecoreAvantComplet(ADA)));
  check('41c. l’extraction rend UNE personne, fusionnée', direct.personnes.length === 1 && direct.personnes[0]?.urlProfil !== undefined,
    JSON.stringify(direct.personnes));
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
  check('44b. et l’échec compte pour le disjoncteur (c’est notre panne, elle doit s’arrêter)',
    (await q(`select echec_navigateur from source_runs where id = $1`, [r])).rows[0]?.echec_navigateur === true);
  check('44c. la session n’est pas bloquée pour autant au premier échec', s.etat === 'active', s.etat);
}

async function main() {
  await jouer(nominal, profilIncomplet, plafondHoraire, plafondPosts, frictions, gardes, disjoncteur, producteur,
    memeTour, disjoncteurRefusLocaux, disjoncteurReleveSortie, fusionDesObjets, profondeur);
  console.log(`\n[linkedin-collecte] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[linkedin-collecte] ERREUR', e);
  process.exit(2);
});

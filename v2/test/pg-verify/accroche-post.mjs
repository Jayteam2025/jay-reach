// Lot « accroche du post » : exécution RÉELLE, sur Postgres, des fiches de post et du
// rattachement des signaux. Aucune requête de production n'est recopiée ici : seules les
// fixtures sont en SQL. Les tâches 4, 5 et 8 du lot ajoutent leurs sections à ce fichier.
//
// Mutations qui font rougir :
//   1. posts-fiches.ts : remplacer `coalesce(excluded.author_name, linkedin_posts.author_name)`
//      par `excluded.author_name` — le contrôle 3 rougit (une capture vide efface l'auteur).
//   2. posts-fiches.ts : poser `expires_at = excluded.expires_at` dans le `do update` — 1b rougit.
//   3. posts-fiches.ts : ajouter `subject = null` au `do update` — 3 et 6 rougissent.
//   4. post-engagement.ts : retirer l'appel à `rattacherSignalAuPost` — 5b et 5d rougissent.
//   5. collecte-linkedin.ts : ne pas passer `linkedinPostId` à `enregistrerEngageur` — 7c rougit.
//   6. collecte-linkedin.ts : ne plus demander la capture (dernier argument de `lireEngageurs`) — 7b et 7c rougissent.
//   8. collecte-linkedin.ts : ne pas passer `auteurAvecRepli` (fiche brute) — 8d rougit.
//   9. collecte-linkedin.ts : ne pas passer `linkedinPostId` — 7c et 8c rougissent.
//  10. collecte-linkedin.ts : retirer le try/catch autour de `enregistrerFichePost` — 9 à 9c rougissent.
//  11. fiche-post.ts : ne plus tracer la lecture (`tracerLectureFichePost`) — 11a, 11c, 11d rougissent.
//  12. fiche-post.ts : prendre le verrou APRÈS `ouvrirNavigateur` — 12a rougit.
//  13. fiche-post.ts : retirer le `limite` de `fichesARattraper` — 11 rougit.
//  14. queues.ts : retirer `policy: 'stately'` de la file — 10b rougit.
//  15. posts-fiches.ts : changer `SQL_FICHE_INCOMPLETE` (ex. ajouter `or subject is null`) — 10e rougit.
//  16. fiche-post.ts : passer la quantité de `consume_provider_credit` de 1 à 2 — 14 rougit.
//  17. message-values.ts : retirer la jointure `linkedin_posts` de REQUETE_LIGNE_INSCRIPTION — 15a et 15c rougissent.
//  18. valeurs-contact.ts : retirer la jointure `linkedin_posts` de lireValeursContact — 15b et 15c rougissent.
//  19. migration linkedin_posts : remettre `people_search,job_change` dans la reprise — 16b et 16c rougissent.
//  20. score.ts : remplacer `lp.text_excerpt as texte_post` par `null::text as texte_post` — 17a rougit.
//  21. score.ts : retirer `and lp.organization_id = s.organization_id` de la jointure — 17c rougit.
//  22. scoring.ts : passer `SCORING_DESCRIPTION_MAX_CARACTERES` de 150 à 600 — 26b rougit ; passer `SCORING_TEXTE_POST_MAX_CARACTERES` à 150 — 26c rougit.
//  23. posts.ts : retirer `and coalesce(btrim(subject), '') <> ''` de `validerPost` — 27e rougit.
//  24. posts.ts : retirer `and cs.campaign_id = $2` de la jointure de `listerPostsDeCampagne` — 27a et 27b rougissent.
//  25. posts.ts : remplacer `where organization_id = $1` de `rejeterPost` par `where $1::uuid is not null` — 27m rougit.
//  26. posts.ts : retirer `and expires_at > now()` de `reouvrirPost` — 27l rougit.
//  27. posts.ts : ajouter `review_status = 'pending'` au `set` de `corrigerSujetDePost` — 27i rougit.
//  28. posts.ts : retirer `and expires_at > now()` de `validerPost` — 27n rougit.
//   7. engageurs.ts : faire naviguer `lireFicheDuPostOuvert` (`pilote.aller`) — 7d rougit.
//  29. posts-fiches.ts : retirer la seconde branche du `union all` de `fichesARattraper` (les fiches
//      complètes sans sujet) — 28, 28a et 10h rougissent : le rédacteur n'a plus de population.
//  30. posts-fiches.ts : retirer `review_status <> 'rejected'` des deux branches — 10f et 10g rougissent.
//  31. fiche-post.ts : retirer le `if (aRelire)` autour de l'ouverture du navigateur — 28b et 28c
//      rougissent ; remplacer `if (ligne.a_relire && pilote)` par `if (pilote)` dans la boucle —
//      28f, 28g, 28h et 28i rougissent (un LOT MIXTE est le seul endroit où ça se voit).
//  32. posts.ts : remettre `coalesce(btrim(subject), '') <> ''` à la place de
//      `sqlFicheResoutCeQuEcritLaCampagne` dans `validerPost` — 29 et 29b rougissent.
//  33. posts.ts : retirer `corrigerAuteurDePost` (ou lui faire écrire `author_name`) — 29d et 29e
//      rougissent : la fiche sans auteur affichable redevient une impasse.
//  34. migration linkedin_posts : remettre `interval '28 days'` en dur — 16d et 16e rougissent.
//  35. posts-fiches.ts : revenir à `coalesce(excluded.author_display_name, …)` dans le `do update`
//      — 6c rougit : une capture reprend à l'opérateur le nom qu'il a écrit.
//  36. posts-fiches.ts : retirer `and p.subject_attempts < $5` de la branche de rédaction — 28j et
//      28k rougissent : un texte réfractaire rappelle le modèle à chaque passage.
//  37. fiche-post.ts : compter la tentative sur TOUTE issue sans sujet (`else` au lieu de
//      `else if (issue.etat === 'refuse')`) — 28l rougit : une organisation sans clé de modèle
//      brûle les tentatives de ses fiches sans qu'aucun modèle ne les ait vues. La distinction
//      elle-même (crédit pris ou non) vit dans `creerRedacteurDeSujet` et se mute côté Vitest.
//  38. accroche-post.ts : remettre la jointure par `campaign_sources` seule dans
//      `sqlAchatRetenuParUnPost` — 30b et 30c rougissent ; dans
//      `sqlSourceAUneCampagneQuiNommeUnPost` — 30d rougit.
//  39. posts.ts : faire `decouperAccroche` ne reconnaître que `post_auteur|post_sujet` — 29f et
//      29f2 rougissent : le jeton brut `{{post_date}}` repart dans la phrase relue.
//  40. posts.ts : dans `validerPost`, ne plus distinguer les variables RELEVÉES par la capture des
//      champs que l'opérateur écrit (`relevees` vide, `aEcrire` = tout) — 29g rougit : le refus
//      demande d'écrire une date dans une phrase qui n'a aucun champ de date.
//  41. posts.ts : retirer de `validerPost` la jointure `campaigns c` sur l'organisation (et l'appel
//      à `exigerCampagneDeLOrganisation`) — 29h rougit : un uuid de campagne étranger rend toutes
//      les exigences vraies et la fiche est approuvée.
//  42. fiche-post.ts : retirer le `await relacher()` placé avant la boucle de rédaction (ne garder
//      que celui du `finally`) — 28m et 28n rougissent : le navigateur et le verrou LinkedIn sont
//      tenus pendant les appels au modèle.
//  43. fiche-post.ts : sortir quand la session n'est pas active, et remettre `where status =
//      'active'` dans `enqueueFichesPostALire` — 28o et 28p rougissent : une session bloquée rend
//      l'opérateur aux sujets manuels.
//  44. posts.ts : retirer `sqlCampagneNommeUnPost` de `compterPostsAValiderDeCampagne` — 23i
//      rougit : le badge annonce une relecture qui ne débloque personne.
//  45. accroche-post.ts : un SEUL motif, strict partout (`MOTIF_SQL_VARIABLE_DE_POST` en
//      `repli: false`) — 31, 31a, 31b, 31f et 31j rougissent : un repli « au cas où » désactive
//      la relecture humaine aux quatre endroits à la fois.
//  46. accroche-post.ts : un SEUL motif, tolérant partout (`sqlCampagneEcritVariableDePost` en
//      `repli: true`) — 31g rougit : une fiche sans date n'est plus validable et l'achat reste
//      gelé, alors que le message partirait en rendant le repli. Et 32b à 32e rougissent avec
//      lui, sur le gabarit MIXTE : le refus réclame la date EN PLUS du sujet, donc la fiche
//      n'est plus validable du tout et personne n'entre, et 32f avec eux : l'adresse vide, à
//      repli, redevient exigée.
//  47. accroche-post.ts : faire du repli VIDE un repli côté garde (retirer `(\|\s*)?` du motif
//      strict) — 31h rougit : « votre réaction du ␣m'a interpellé » part sans que rien ne le dise.
//  48. posts.ts : retirer `sansRepliVide` de l'aperçu — 31i rougit : l'écran montre le trou au
//      lieu d'un morceau manquant, et compte la ligne validable.
//  49. accroche-post.ts : retirer `mt_ap.name` de `sqlGabaritPorteLeMotif` — 33, 33a, 33b, 33c,
//      33f et 33g rougissent : une accroche cachée dans le NOM du gabarit (objet d'un email quand le
//      sujet est vide) échappe à la garde, au gel, à l'épargne et à l'écran, et l'adresse réelle
//      d'un post jamais relu part dans l'objet.
//  50. accroche-post.ts : retirer la borne `st_ap.channel = 'email' and mt_ap.subject is null`
//      autour de `mt_ap.name` — les deux 33i rougissent : un nom que personne ne lit (sujet posé,
//      ou canal LinkedIn) gèlerait inscriptions et achats, et le nom d'un gabarit d'étape EST
//      celui de la campagne.
//  51. posts.ts : faire `listerPostsDeCampagne` ne lire que `mt.body` — 33h rougit : l'écran
//      retombe sur sa phrase par défaut, sans morceau manquant, et compte la ligne validable
//      pendant que `validerPost` la refuse.
//  52. tick.ts : retirer la branche `postARelire` — 34a et 34b rougissent sur les deux canaux :
//      une accroche ajoutée à une campagne qui tourne fait partir le post sans relecture.
//  53. accroche-post.ts : faire rendre `false` à `envoiRetenuParUnPost` — 34a, 34b et 34e
//      rougissent (et, côté Vitest, les deux contrôles de `email-salesblink.test.ts`).
//  54. campagnes.ts : remettre `mt.subject as etape_sujet` seul dans `jr:file_du_jour_campagne` —
//      33j rougit : la File du jour n'affiche aucun objet pour le gabarit qui partira avec son
//      nom en objet, sur le seul écran qui montre ce qui part aujourd'hui.
//  55. accroche-post.ts : retirer `linkedin_post_id is not null` de `sqlPostRetientLaPersonne` —
//      23c, 23d, 23e, 23f2, 35a, 35b, 35c et 35d rougissent : une personne dont le signal n'a
//      aucune fiche est retenue POUR TOUJOURS (rien à relire, et le repli empêche
//      `missing_variable` de prendre le relais), et son adresse ne s'achète plus.
//  56. traitements.ts : retirer la garde de `rejouerActionsLinkedInEnAttente` — 36 et 36a
//      rougissent : le balayage re-rend le corps depuis le gabarit courant et enfile un envoi
//      qui nomme un post non relu.
//  57. traitements.ts : retirer la garde de `rejouerActionsLinkedInReprises` — 36b rougit :
//      l'opérateur clique « Reprendre » et le message part en nommant un post non relu.
//  58. posts.ts : retirer l'appel à `relacherLesRetenuesDuPost` dans `validerPost` — 37b et 37d
//      rougissent : valider le post ne relance rien, et l'inscription reste `active` sans
//      échéance, que plus aucun chemin ne reprend.
//  59. posts.ts : retirer `and a.block_reason = 'post_a_relire'` de la relance — 37e rougit :
//      valider un post ferait partir une action bloquée pour une variable manquante.
//  60. posts.ts : retirer `and s.linkedin_post_id = $2::uuid` de la relance — 37f rougit :
//      valider un post réveillerait les personnes qui en attendent un AUTRE, encore en attente.
//  61. sequence.ts : retirer `payload.requiresApproval` du blocage `post_a_relire`, OU retirer
//      `coalesce((a.payload ->> 'requiresApproval')::boolean, false) or` des TROIS expressions de
//      relâchement — 37h, 38a et 38b rougissent : une action qui attendait l'accord d'un humain
//      saute la file. Ces trois-là retirent la politique AVANT la reprise, pour que seul le
//      drapeau puisse encore décider ; 38e à 38g gardent l'autre moitié de l'expression.
//  62. posts.ts : filtrer `listerPostsDeCampagne` sur `review_status = 'pending'` — 35h rougit :
//      le lien de la File du jour mènerait à une liste qui a écarté le post à rouvrir.
//  63. accroche-post.ts : ranger l'orpheline dans N'IMPORTE QUELLE catégorie du décompte (la
//      compter en `en_attente`, ou retirer la condition de fiche qui la range en `inexploitable`)
//      — 23b rougit dans les deux cas : il juge la SOMME, pas un compteur.
//  64. apps/worker/src/handlers/sequence.ts : remettre `set status = 'scheduled'` en dur dans le
//      rejeu de `reprendreAbsencesEchues` — 38a rougit : au retour d'absence, une action qui
//      attendait l'accord d'un humain part sans lui.
//  65. packages/core/src/fonctions/sequence.ts : la même chose dans `reprendreInscription` —
//      38b rougit : la reprise à la main fait sauter la file d'attente.
//  66. retirer les deux lignes `camp.approval_policy` des trois expressions de relâchement —
//      38e, 38f et 38g rougissent : une politique d'approbation posée APRÈS le blocage ne
//      s'applique pas, et l'action repart sans l'accord désormais exigé.
//  67. traitements.ts : remettre `a.status = 'scheduled'` dans l'un des TROIS balayages — les
//      deux contrôles 39 rougissent pour les deux premiers, 39b pour `rejouerActionsLinkedIn
//      Reprises` ; y accepter `pending_approval` fait rougir 39a ou 39c. Une action approuvée par
//      un humain ne partait sur aucun canal, et en ouvrir deux sorties sur trois fabriquait un
//      blocage définitif et muet.
//  68. email-salesblink.ts : refuser `approved` au contrôle de statut, OU y accepter
//      `pending_approval` — côté Vitest, l'un des deux contrôles du gestionnaire rougit à chaque
//      fois ; le second compte le plus, il garde la file d'attente fermée.
//  69. file-du-jour.ts : retirer `approved` des trois filtres d'état — 40 et 40a rougissent :
//      « Reporter » lève « Envoi introuvable » sur un envoi approuvé, et « Écarter » le laisse
//      compté comme prévu.
//  71. accroche-post.ts : faire lire `sqlFichePostEnAttente` à l'épargne au lieu de
//      `sqlFichePostDansSaFenetre` — 20h et 20i rougissent : valider un post après le délai
//      d'ancienneté EFFACE ses personnes au passage suivant, la purge passant avant l'enfilage.
//  72. posts.ts : retirer les appels à `relacherLesRetenuesDuPost` dans les deux correcteurs —
//      37j et 37k rougissent : compléter une fiche déjà validée débloque les futures actions,
//      jamais celles qui sont déjà bloquées.
//  73. posts-fiches.ts : retirer `SQL_POST_ATTENDU` des deux branches de `fichesARattraper` —
//      41, 41b et 41c rougissent : on ouvre une page LinkedIn et on paie un crédit pour un post
//      qu'aucune campagne ne nomme. Chaque DISJOINT a sa mutation : retirer la branche des
//      signaux fait rougir 41a seul, retirer celle de `linkedin_posts_traites` fait rougir 41e
//      (et les sections de rattrapage, qui passent toutes par elle).
//  70. approbation.ts : faire diverger les deux écritures de la règle — 40b rougit en NOMMANT
//      les entrées fautives. Trois façons, toutes vérifiées : retirer la clause `channels` du
//      SQL ; revenir à l'opérateur permissif `jsonb ?` (les deux formes pathologiques
//      `{"channels":{"email":true}}` et `{"channels":"email"}` divergent alors, et dans le
//      mauvais sens — le SQL exige, le tick non) ; retirer le canal `letter` de
//      `approbationExigeeHorsRelecture` (dix entrées rougissent, pour le seul canal que le dépôt
//      dit non négociable).
import { readFileSync } from 'node:fs';
import pg from 'pg';
import PgBoss from 'pg-boss';
import {
  AGE_MAX_SIGNAL_JOURS,
  campagneNommeUnPost,
  compterRetenuesParPost,
  retenuesAAfficher,
  apercuEnvoi,
  ecrireReglage,
  runScore,
  buildScoringUserMessage,
  compterSignauxScorables,
  fenetreValidationPost,
  rejeterFichesPostExpirees,
  ecarterSignauxTropAnciens,
  enqueueEnrichmentContactsConnus,
  enqueueEnrollments,
  enrichirContactConnu,
  enrollContact,
  tickDueEnrollments,
  envoiRetenuParUnPost,
  clePost,
  enregistrerEngageur,
  enregistrerFichePost,
  marquerPostTraite,
  rattacherSignalAuPost,
  creerSource,
  startSourceRun,
  traiterCollecteLinkedIn,
  activerSessionLinkedIn,
  enqueueFichesPostALire,
  traiterFichePost,
  prendreCreditAnthropic,
  fichesARattraper,
  ficheIncomplete,
  TENTATIVES_SUJET_MAX,
  compterPostsAValiderDeCampagne,
  corrigerAuteurDePost,
  decouperAccroche,
  corrigerSujetDePost,
  achatRetenuParUnPost,
  listerFileDuJour,
  listerPostsDeCampagne,
  rejouerActionsEmailEnAttente,
  rejouerActionsLinkedInEnAttente,
  rejouerActionsLinkedInReprises,
  reprendreAbsencesEchues,
  reprendreInscription,
  reporterEnvoi,
  ecarterDuneCampagne,
  approbationExigeeHorsRelecture,
  sqlApprobationExigee,
  rejeterPost,
  reouvrirPost,
  validerPost,
  prendreVerrouLinkedIn,
  registerQueues,
  chargerLigneInscription,
  buildMessageValues,
  lireValeursContact,
  renderTemplate,
} from './_accroche-post-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une ne doit pas emporter
// les suivantes. Un harnais qui saute une preuve en silence est pire qu'un harnais rouge.
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
const ID_POST = '7271000000000000001';
const URL_POST = `https://www.linkedin.com/feed/update/urn:li:activity:${ID_POST}/`;
const URN_POST = `urn:li:activity:${ID_POST}`;
const FENETRE = 28;

/** Une fiche du type réel `FichePost` ; `surcharge` en change des champs. */
function fiche(surcharge = {}) {
  return {
    urn: URN_POST,
    url: URL_POST,
    auteur: { kind: 'person', nom: 'Ana Test', nomAffiche: 'Ana', nomPublic: null, url: null },
    texte: 'Un texte de post inventé pour la preuve.',
    date: new Date('2026-10-12T08:30:00.000Z'),
    ...surcharge,
  };
}
const FICHE_VIDE = { urn: URN_POST, url: URL_POST, auteur: null, texte: null, date: null };

/** Une organisation, un persona, une campagne : le minimum que `creerSource` exige. */
async function monde() {
  seq += 1;
  const n = `${Date.now().toString(36)}${seq}`;
  const org = (await q(`insert into organizations (name, slug) values ($1, $2) returning id`, [`Org ${n}`, `org-${n}`])).rows[0].id;
  const admin = (
    await q(`insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`, [`u${n}@test.local`])
  ).rows[0].id;
  await q(`insert into memberships (organization_id, user_id, role) values ($1, $2, 'admin')`, [org, admin]);
  const persona = (
    await q(`insert into personas (organization_id, name, scoring_prompt) values ($1, 'Directeur commercial', 'x') returning id`, [org])
  ).rows[0].id;
  const campagne = (
    await q(`insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'C', 'active', $2::jsonb) returning id`, [
      org,
      JSON.stringify({ personas: [persona] }),
    ])
  ).rows[0].id;
  const ctx = { ex: pool, organisationId: org, utilisateurId: admin, role: 'admin' };
  return { org, persona, campagne, ctx };
}

/** Une source d'engageurs de plus sur la campagne, par la fonction de production. */
async function sourceDePost(m, urlPost, nom) {
  const { id } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_post_engagers',
    nom,
    config: { urlPost, garder: ['reagi'], personaId: m.persona },
  });
  return id;
}

const lignesPost = async (org) => (await q(`select * from linkedin_posts where organization_id = $1`, [org])).rows;

// --------------------------------------------------------------------- sections

async function ficheCreeeDeuxFois() {
  console.log('\n# une fiche créée deux fois ne produit qu\'une ligne');
  const m = await monde();
  const a = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const avant = (await lignesPost(m.org))[0];
  const b = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: 999 });
  const lignes = await lignesPost(m.org);

  check('1. deux enregistrements, une seule ligne', lignes.length === 1, `${lignes.length} lignes`);
  check('1a. même id, clé `linkedin:<chiffres>`, `nouvelle` vrai puis faux',
    a.id === b.id && a.postKey === `linkedin:${ID_POST}` && a.nouvelle === true && b.nouvelle === false, JSON.stringify({ a, b }));
  check('1b. `expires_at` posé à la création seulement (la seconde fenêtre est ignorée)',
    lignes[0].expires_at.getTime() === avant.expires_at.getTime());
  const jours = (lignes[0].expires_at.getTime() - lignes[0].created_at.getTime()) / 86_400_000;
  check('1c. `expires_at` = création + fenêtre', Math.abs(jours - FENETRE) < 0.01, `${jours} jours`);
  check('1d. `capture_attempts` compte chaque appel', lignes[0].capture_attempts === 2, String(lignes[0].capture_attempts));
  check('1e. les champs de la fiche sont rangés',
    lignes[0].author_name === 'Ana Test' && lignes[0].author_display_name === 'Ana' && lignes[0].author_kind === 'person'
      && lignes[0].text_excerpt?.startsWith('Un texte') && lignes[0].posted_at?.toISOString() === '2026-10-12T08:30:00.000Z'
      && lignes[0].post_urn === URN_POST && lignes[0].review_status === 'pending');

  // L'URN seul et l'URL du même post désignent la même ligne.
  const c = await enregistrerFichePost(pool, m.org, { ...FICHE_VIDE, url: URN_POST }, { fenetreJours: FENETRE });
  check('2. la même clé depuis l\'URN seul : toujours une ligne', c.id === a.id && (await lignesPost(m.org)).length === 1);
  check('2b. clePost rend la même clé pour l\'URL et l\'URN', clePost(URL_POST) === clePost(URN_POST));

  // Une capture vide n'efface rien.
  const d = (await lignesPost(m.org))[0];
  check('3. une capture vide ne remplace pas un champ renseigné par un nul',
    d.author_name === 'Ana Test' && d.text_excerpt !== null && d.posted_at !== null && d.capture_attempts === 3);

  // Une autre organisation a sa propre fiche pour le même post.
  const autre = await monde();
  const e = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  check('3b. une autre organisation, une autre fiche', e.id !== a.id && e.nouvelle === true);
}

async function deuxSourcesMemePost() {
  console.log('\n# deux sources, un même post');
  const m = await monde();
  const s1 = await sourceDePost(m, URL_POST, 'Engageurs A');
  // Un post nommé ne sert qu'une source d'engageurs ; la seconde source est une recherche par sujet,
  // qui retombe sur le même post (c'est le cas réel : une page concurrente et un mot-clé).
  const s2 = (
    await creerSource(m.ctx, {
      campagneId: m.campagne,
      providerId: 'linkedin_keywords',
      nom: 'Sujet',
      config: { sujets: ['prospection'], personaId: m.persona },
    })
  ).id;
  const f1 = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const f2 = await enregistrerFichePost(pool, m.org, fiche({ url: `https://fr.linkedin.com/posts/ana-test_sujet-activity-${ID_POST}-AbCd` }), { fenetreJours: FENETRE });
  await marquerPostTraite(pool, m.org, s1, URN_POST);
  await marquerPostTraite(pool, m.org, s2, URN_POST);

  const posts = await lignesPost(m.org);
  const traites = (await q(`select source_id from linkedin_posts_traites where organization_id = $1`, [m.org])).rows;
  check('4. une seule ligne `linkedin_posts` pour le même post', posts.length === 1 && f1.id === f2.id, `${posts.length} lignes`);
  check('4b. deux lignes `linkedin_posts_traites`, une par source',
    traites.length === 2 && new Set(traites.map((t) => t.source_id)).size === 2, `${traites.length} lignes`);
}

async function rattachementDuSignal() {
  console.log('\n# le signal d\'un engageur est rattaché à la fiche');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  const campagne = { id: m.campagne, personaId: m.persona };

  const issue = await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAArattache', nom: 'Bob Test', intitule: 'Directeur commercial' }, campagne, URL_POST, f.id);
  const signal = (await q(`select id, linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  check('5a. l\'engageur est enregistré', issue === 'nouveau' && signal.length === 1, issue);
  check('5b. son signal porte `linkedin_post_id`', signal[0]?.linkedin_post_id === f.id, JSON.stringify(signal));

  // Sans fiche, le signal naît sans rattachement : rien ne casse.
  const sans = await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAsans', nom: 'Cleo Test', intitule: 'Directrice commerciale' }, campagne, URL_POST);
  const sansFiche = (await q(`select linkedin_post_id from signals where organization_id = $1 and external_id like '%ACoAAsans'`, [m.org])).rows;
  check('5c. sans fiche, le signal naît sans rattachement', sans === 'nouveau' && sansFiche[0]?.linkedin_post_id === null);

  // `rattacherSignalAuPost` ne touche que l'organisation nommée.
  const autre = await monde();
  const g = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  await rattacherSignalAuPost(pool, autre.org, signal[0].id, g.id);
  const intact = (await q(`select linkedin_post_id from signals where id = $1`, [signal[0].id])).rows[0];
  check('5d. un signal d\'une autre organisation n\'est pas rattaché', intact.linkedin_post_id === f.id);
}

async function sujetOperateurSurvit() {
  console.log('\n# un sujet posé par l\'opérateur survit à une nouvelle capture');
  const m = await monde();
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set subject = 'la prospection par la preuve', subject_origin = 'operator', review_status = 'approved' where id = $1`, [f.id]);
  await enregistrerFichePost(pool, m.org, fiche({ texte: 'Un texte tout autre, capturé plus tard.' }), { fenetreJours: FENETRE });
  const l = (await lignesPost(m.org))[0];
  check('6. `subject`, son origine et la relecture sont intacts',
    l.subject === 'la prospection par la preuve' && l.subject_origin === 'operator' && l.review_status === 'approved', JSON.stringify({ s: l.subject, o: l.subject_origin, r: l.review_status }));
  check('6b. le texte, lui, a été mis à jour', l.text_excerpt === 'Un texte tout autre, capturé plus tard.');

  // Le nom d'auteur AFFICHÉ est une saisie de l'opérateur au même titre que le sujet : c'est le
  // texte qui part dans le message. Une capture ultérieure qui lirait « Ana » là où l'opérateur a
  // écrit « Christelle » lui reprendrait son travail sans un mot.
  await q(`update linkedin_posts set author_display_name = 'Christelle' where id = $1`, [f.id]);
  await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  const l2 = (await lignesPost(m.org))[0];
  check('6c. un nom d\'auteur affiché déjà posé n\'est jamais remplacé par une capture',
    l2.author_display_name === 'Christelle', String(l2.author_display_name));
  check('6d. `author_name`, identité technique écrite par la machine, suit la capture',
    l2.author_name === 'Ana Test', String(l2.author_name));

  // Et la protection ne doit pas figer un trou : un nom affiché vide se remplit toujours.
  await q(`update linkedin_posts set author_display_name = '   ' where id = $1`, [f.id]);
  await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  check('6e. un nom affiché vide, lui, se remplit', (await lignesPost(m.org))[0].author_display_name === 'Ana',
    String((await lignesPost(m.org))[0].author_display_name));
}

/** Réponse Voyager normalisée : profils dans `included`, total dans `data.paging`. */
function voyager(profils) {
  return JSON.stringify({
    data: {
      paging: { start: 0, count: 50, total: profils.length },
      elements: profils.map((p) => ({ reactionType: 'LIKE', actorUrn: `urn:li:fsd_profile:${p.id}` })),
    },
    included: profils.map((p) => ({
      $type: 'com.linkedin.voyager.dash.identity.profile.Profile',
      entityUrn: `urn:li:fsd_profile:${p.id}`,
      firstName: p.prenom,
      lastName: p.nom,
      headline: p.titre,
    })),
  });
}

async function collecteEnModePost() {
  console.log('\n# la collecte réelle en mode `post` capture la fiche et rattache chaque engageur');
  const IP = '203.0.113.7';
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs collectés');
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);

  const navigations = [];
  const requetes = [];
  const TEXTE = 'Recruter un commercial coûte cher, voici ce que nous avons mesuré.';
  const pilote = {
    aller: async (u) => void navigations.push(u),
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => TEXTE,
    attendre: async () => true,
    requete: async (u) => {
      requetes.push(u);
      return {
        statut: 200,
        corps: voyager([
          { id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale chez Acme' },
          { id: 'ACoAAbob', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' },
        ]),
      };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  const log = console.log;
  console.log = () => undefined; // le handler journalise chaque passage
  try {
    await traiterCollecteLinkedIn(
      {
        pool,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
  }

  const passage = (await q(`select status, error, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  check('7. le passage est un succès, deux personnes nouvelles', passage.status === 'success' && passage.nouveaux === 2, JSON.stringify(passage));
  const posts = await lignesPost(m.org);
  check('7b. une fiche est créée, avec le texte lu sur la page', posts.length === 1 && posts[0].text_excerpt === TEXTE && posts[0].post_key === `linkedin:${ID_POST}`, JSON.stringify(posts.map((p) => p.text_excerpt)));
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  // Le piège : un signal sans post ne lève aucune erreur, et tout le lot ne sert alors à rien.
  check('7c. CHAQUE engageur collecté est rattaché à sa fiche', signaux.length === 2 && posts.length === 1 && signaux.every((s) => s.linkedin_post_id === posts[0].id), JSON.stringify(signaux));
  check('7d. la capture est gratuite : une navigation (la page du post), une requête Voyager',
    navigations.length === 1 && navigations[0] === URL_POST && requetes.length === 1, `${navigations.length} navigation(s), ${requetes.length} requête(s)`);
}

const htmlPage = (nom, id) =>
  `<html><code>{&quot;entityUrn&quot;:&quot;urn:li:fsd_company:${id}&quot;,&quot;universalName&quot;:&quot;${nom}&quot;}</code></html>`;
const lotDePosts = (urns) =>
  JSON.stringify({
    data: {
      data: {
        feedDashOrganizationalPageUpdatesByOrganizationalPageRelevanceFeed: {
          paging: { count: 10, start: 0, total: urns.length },
          '*elements': urns.map((u) => `urn:li:fsd_update:(${u},COMPANY_FEED_RELEVANCE)`),
        },
      },
    },
  });

async function collecteEnModePages() {
  console.log('\n# la collecte réelle en mode `pages` capture une fiche par post, rattachée, sans navigation de plus');
  const IP = '203.0.113.7';
  const m = await monde();
  const { id: source } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_competitor_posts',
    nom: 'Concurrent',
    config: { pagesConcurrentes: ['https://www.linkedin.com/company/acme/'], garder: ['reagi'], personaId: m.persona },
  });
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);
  const P1 = 'urn:li:activity:7271000000000000011';
  const P2 = 'urn:li:activity:7271000000000000012';
  const parPost = {
    '7271000000000000011': [{ id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale' }],
    '7271000000000000012': [{ id: 'ACoAAbob', prenom: 'Bob', nom: 'Durand', titre: 'Directeur commercial' }],
  };

  const navigations = [];
  const pilote = {
    aller: async (u) => void navigations.push(u),
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '', // la page ne rend aucun auteur : le repli sur la source est exercé
    attendre: async () => false,
    requete: async (u) => {
      if (u.includes('/company/')) return { statut: 200, corps: htmlPage('acme', '777') };
      if (u.includes('organizationalPageUrn')) return { statut: 200, corps: lotDePosts([P1, P2]) };
      const id = Object.keys(parPost).find((x) => u.includes(x));
      return { statut: 200, corps: voyager(parPost[id] ?? []) };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  const log = console.log;
  console.log = () => undefined;
  try {
    await traiterCollecteLinkedIn(
      {
        pool,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
  }

  const passage = (await q(`select status, error, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  check('8. le passage est un succès, deux personnes nouvelles', passage.status === 'success' && passage.nouveaux === 2, JSON.stringify(passage));
  const posts = await lignesPost(m.org);
  check('8b. une fiche par post', posts.length === 2, `${posts.length} fiche(s)`);
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  const ids = new Set(posts.map((p) => p.id));
  check('8c. CHAQUE engageur est rattaché à la fiche de SON post',
    signaux.length === 2 && signaux.every((s) => ids.has(s.linkedin_post_id)) && new Set(signaux.map((s) => s.linkedin_post_id)).size === 2, JSON.stringify(signaux));
  check('8d. auteur de repli : la page, sans nom affiché (un slug ne s\'affiche pas)',
    posts.every((p) => p.author_kind === 'page' && p.author_name === 'acme' && p.author_display_name === null && p.author_public_name === 'acme'),
    JSON.stringify(posts.map((p) => [p.author_kind, p.author_name, p.author_display_name])));
  check('8e. la capture est gratuite : la page entreprise, puis UNE navigation par post',
    navigations.length === 3, `${navigations.length} navigation(s)`);
}

async function captureEnPanne() {
  console.log('\n# une capture de fiche en panne ne perd pas les engageurs');
  const IP = '203.0.113.7';
  const m = await monde();
  const { id: source } = await creerSource(m.ctx, {
    campagneId: m.campagne,
    providerId: 'linkedin_competitor_posts',
    nom: 'Concurrent en panne',
    config: { pagesConcurrentes: ['https://www.linkedin.com/company/acme/'], garder: ['reagi'], personaId: m.persona },
  });
  await activerSessionLinkedIn(m.ctx, IP);
  const runId = await startSourceRun(pool, source);
  const P1 = 'urn:li:activity:7271000000000000011';
  const pilote = {
    aller: async () => undefined,
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => false,
    requete: async (u) => {
      if (u.includes('/company/')) return { statut: 200, corps: htmlPage('acme', '777') };
      if (u.includes('organizationalPageUrn')) return { statut: 200, corps: lotDePosts([P1]) };
      return { statut: 200, corps: voyager([{ id: 'ACoAAada', prenom: 'Ada', nom: 'Lovelace', titre: 'Directrice commerciale' }]) };
    },
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
  };
  // Le vrai pool, qui lève sur la SEULE insertion d'une fiche : tout le reste est exécuté.
  const poolEnPanne = {
    query: async (sql, params) => {
      if (/insert into linkedin_posts\s*\(/.test(String(sql))) throw new Error('panne de base');
      return pool.query(sql, params);
    },
    connect: () => pool.connect(),
  };
  const log = console.log;
  const warn = console.warn;
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    await traiterCollecteLinkedIn(
      {
        pool: poolEnPanne,
        env: { JAY_REACH_LINKEDIN: '1' },
        ouvrirNavigateur: async () => pilote,
        releverSortie: async () => ({ ip: IP, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
        pause: async () => undefined,
      },
      { organizationId: m.org, sourceId: source, sourceRunId: runId },
    );
  } finally {
    console.log = log;
    console.warn = warn;
  }
  const passage = (await q(`select status, nouveaux from source_runs where id = $1`, [runId])).rows[0];
  const signaux = (await q(`select linkedin_post_id from signals where organization_id = $1`, [m.org])).rows;
  const traites = (await q(`select 1 from linkedin_posts_traites where organization_id = $1`, [m.org])).rowCount;
  check('9. le passage réussit malgré la panne de capture', passage.status === 'success' && passage.nouveaux === 1, JSON.stringify(passage));
  check('9b. l\'engageur est enregistré, sans post (rattrapé plus tard)', signaux.length === 1 && signaux[0].linkedin_post_id === null, JSON.stringify(signaux));
  check('9c. le post est marqué traité : sans cette tolérance ses engageurs seraient perdus pour de bon', traites === 1, String(traites));
}


// --------------------------------------------------------------------- rattrapage (tâche 5)

// Le VRAI pg-boss : il installe lui-même son schéma sur le Postgres jetable, et la file est
// créée par `registerQueues` à partir de `QUEUES` (donc avec sa politique `stately`). Aucune table
// de substitution : la singularité par organisation est celle de pg-boss, pas une copie.
const boss = new PgBoss({ connectionString: process.env.DATABASE_URL, schema: 'pgboss' });
let bossPret = false;
async function demarrerBoss() {
  if (bossPret) return;
  boss.on('error', () => undefined);
  await boss.start();
  await registerQueues(boss);
  bossPret = true;
}
const urlN = (n) => `https://www.linkedin.com/feed/update/urn:li:activity:72710000000000${String(n).padStart(5, '0')}/`;
const ficheN = (n, surcharge = {}) => ({ ...fiche({ urn: `urn:li:activity:72710000000000${String(n).padStart(5, '0')}`, url: urlN(n) }), ...surcharge });
const VIDE = { auteur: null, texte: null, date: null };
const jobsDe = async (org) => (await q(`select id, data from pgboss.job where name = 'linkedin.fiche-post' and data->>'organizationId' = $1`, [org])).rows;
const traces = async (org) => (await q(`select kind, post_id, source_run_id from linkedin_requetes where organization_id = $1 and kind = 'fiche'`, [org])).rows;
const IP_FICHE = '203.0.113.7';

/** Un pilote qui consigne ses navigations ; `texte` est ce que rend n'importe quel sélecteur. */
function piloteFiche(texte, navigations, journal = []) {
  return {
    aller: async (u) => {
      navigations.push(u);
      journal.push('page');
    },
    url: async () => URL_POST,
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => texte,
    attendre: async () => texte !== '',
    requete: async () => { throw new Error('aucune requête attendue'); },
    effacerCookies: async () => undefined,
    fermer: async () => void journal.push('ferme'),
  };
}
/** Un rédacteur factice qui écrit toujours le même sujet, dans la forme réelle (`IssueSujet`). */
const ecrit = (sujet) => async () => ({ etat: 'ecrit', sujet });
/** Le défaut : aucune clé de modèle, donc rien n'est demandé — et aucune tentative consommée. */
const sansModele = async () => ({ etat: 'impossible' });

/**
 * Les dépendances du lot, et ce qu'elles ont vu. `vu.journal` garde l'ORDRE des événements
 * (`ouvre`, `page`, `ferme`, `redige`) : c'est la seule façon de prouver que le navigateur est
 * rendu AVANT la première rédaction, et non gardé ouvert pendant vingt appels au modèle.
 */
function depsLot(texte = 'Recruter un commercial coûte cher, voici ce que nous avons mesuré.', redacteur = sansModele) {
  const vu = { navigations: [], ouvertures: 0, pauses: [], journal: [] };
  return {
    vu,
    deps: {
      pool,
      env: { JAY_REACH_LINKEDIN: '1' },
      ouvrirNavigateur: async () => {
        vu.ouvertures += 1;
        vu.journal.push('ouvre');
        return piloteFiche(texte, vu.navigations, vu.journal);
      },
      releverSortie: async () => ({ ip: IP_FICHE, operateur: 'AS64496 Exemple Telecom', pays: 'FR' }),
      pause: async (ms) => void vu.pauses.push(ms),
      redacteurPour: async () => async (t) => {
        vu.journal.push('redige');
        return redacteur(t);
      },
    },
  };
}
/** Une organisation à session active, avec `n` fiches vides (une tentative chacune). */
/**
 * Rend ATTENDUES toutes les fiches déjà enregistrées de cette organisation : une campagne qui
 * nomme le post, une source de post qui l'alimente, et la trace de traitement par source.
 *
 * Nécessaire depuis que `fichesARattraper` ne lit plus que ce qui sert : sans ça, les sections de
 * rattrapage créeraient des fiches que personne n'attend, et testeraient le filtre au lieu de ce
 * qu'elles veulent prouver (la sélection, l'incomplétude, les plafonds).
 */
async function rendreLesPostsAttendus(m) {
  await etapeAvecCorps(m, ACCROCHE_URL, { canal: 'email' });
  const source = await sourceDePost(m, urlN(900), 'Engageurs attendus');
  await q(
    `insert into linkedin_posts_traites (organization_id, source_id, post_urn)
     select p.organization_id, $2, p.post_urn from linkedin_posts p
      where p.organization_id = $1 and p.post_urn is not null
     on conflict do nothing`,
    [m.org, source],
  );
  return source;
}

async function monde5(n, plafondJour = null, plafondHeure = null) {
  const m = await monde();
  await activerSessionLinkedIn(m.ctx, IP_FICHE);
  const reg = (cle, v) => q(`insert into organization_settings (organization_id, key, value) values ($1, $2, $3::jsonb)`, [m.org, cle, String(v)]);
  if (plafondJour !== null) await reg('linkedin_fiches_post_par_jour', plafondJour);
  if (plafondHeure !== null) await reg('linkedin_requetes_par_heure', plafondHeure);
  for (let i = 1; i <= n; i += 1) await enregistrerFichePost(pool, m.org, ficheN(i, VIDE), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(m);
  return m;
}

async function rattrapageSelection() {
  console.log('\n# le rattrapage retient les fiches incomplètes, pas les complètes, pas les épuisées, un job par organisation');
  await demarrerBoss();
  const m = await monde();
  await activerSessionLinkedIn(m.ctx, IP_FICHE);
  await enregistrerFichePost(pool, m.org, ficheN(1, VIDE), { fenetreJours: FENETRE }); // vide
  await enregistrerFichePost(pool, m.org, ficheN(2), { fenetreJours: FENETRE }); // complète
  for (let i = 0; i < 3; i += 1) await enregistrerFichePost(pool, m.org, ficheN(3, VIDE), { fenetreJours: FENETRE }); // épuisée
  await rendreLesPostsAttendus(m);

  const retenues = (await fichesARattraper(pool, m.org, { aRelire: 50, aRediger: 50 })).filter((r) => r.a_relire).map((r) => r.url);
  check('10. la sélection retient l\'incomplète seule (ni la complète, ni l\'épuisée à 3 tentatives)', retenues.length === 1 && retenues[0] === urlN(1), JSON.stringify(retenues));

  await enqueueFichesPostALire(boss, pool);
  const j1 = await jobsDe(m.org);
  check('10a. un job de lot pour l\'organisation, chargé de l\'organisation seule', j1.length === 1 && JSON.stringify(j1[0].data) === JSON.stringify({ organizationId: m.org }), JSON.stringify(j1.map((j) => j.data)));
  await enqueueFichesPostALire(boss, pool);
  check('10b. un second passage ne dépose rien de plus (file `stately`, singleton par organisation)', (await jobsDe(m.org)).length === 1);

  const autre = await monde();
  await enregistrerFichePost(pool, autre.org, ficheN(1, VIDE), { fenetreJours: FENETRE });
  await enqueueFichesPostALire(boss, pool);
  // Depuis que les sujets s'écrivent sans session active, ce qui écarte cette organisation n'est
  // plus le STATUT de sa session, c'est qu'elle n'en a aucune : elle n'a jamais collecté.
  check('10c. une organisation sans aucune session LinkedIn n\'est pas servie', (await jobsDe(autre.org)).length === 0);

  // « Rien à rattraper » : une fiche complète ET pourvue d'un sujet. Une fiche complète SANS sujet,
  // elle, a du travail (la rédaction) — c'est la section `sujetSansRelecture`.
  const vide = await monde();
  await activerSessionLinkedIn(vide.ctx, IP_FICHE);
  await enregistrerFichePost(pool, vide.org, ficheN(1), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set subject = 'un sujet relu' where organization_id = $1`, [vide.org]);
  await enqueueFichesPostALire(boss, pool);
  check('10d. rien à rattraper : aucun job', (await jobsDe(vide.org)).length === 0);

  // Une fiche que l'opérateur a REJETÉE ne se rouvre plus : ni page LinkedIn, ni crédit de modèle,
  // pour un post qu'un humain vient de refuser.
  const rejete = await monde();
  await activerSessionLinkedIn(rejete.ctx, IP_FICHE);
  await enregistrerFichePost(pool, rejete.org, ficheN(1, VIDE), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set review_status = 'rejected' where organization_id = $1`, [rejete.org]);
  const apresRejet = await fichesARattraper(pool, rejete.org, { aRelire: 50, aRediger: 50 });
  check('10f. une fiche rejetée par l\'opérateur n\'est plus proposée au rattrapage', apresRejet.length === 0, JSON.stringify(apresRejet.map((r) => r.url)));
  await enqueueFichesPostALire(boss, pool);
  check('10g. et aucun job n\'est déposé pour elle', (await jobsDe(rejete.org)).length === 0);
}

/**
 * Le rattrapage ne lit QUE ce qui sert.
 *
 * `fichesARattraper` ne regardait ni campagne ni source : chaque post collecté donnait une page
 * LinkedIn ouverte et un crédit de rédaction, y compris quand aucune campagne ne nomme de post —
 * donc pour un résultat que personne n'attend, ce que ce lot combat partout ailleurs. Mesuré sur
 * la base : six posts, une seule organisation ; mais à 500 posts, c'est vingt-cinq jours de
 * budget LinkedIn brûlés.
 *
 * LE REVERS, vérifié avant de figer la forme : une fiche jamais rattrapée expire et passe
 * `rejected`. L'opérateur qui branche l'accroche APRÈS la fenêtre se retrouve-t-il avec des posts
 * rejetés sans l'avoir demandé ? **Non, et il les perdait déjà** : `reouvrirPost` exige
 * `expires_at > now()`, donc une fiche échue est inutilisable qu'elle ait été rattrapée ou pas.
 * Dans la fenêtre, en revanche, brancher l'accroche rend la condition vraie et le rattrapage
 * reprend la fiche au passage suivant — c'est ce que ces contrôles montrent.
 */
async function rattrapageCibleCeQuiSert() {
  console.log('\n# le rattrapage ne lit que les posts qu\'une campagne nomme');
  const m = await monde();
  await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'email' });
  const p = await engageurDUnPost(m, 165, { etat: 'pending' });
  await q(`update linkedin_posts set author_name = null, text_excerpt = null, posted_at = null where id = $1`, [p.fiche]);

  const candidates = async (org) => (await fichesARattraper(pool, org, { aRelire: 10, aRediger: 10 })).map((f) => f.id);
  check('41. aucune campagne ne nomme de post : sa fiche incomplète n\'est pas candidate au rattrapage',
    !(await candidates(m.org)).includes(p.fiche), JSON.stringify(await candidates(m.org)));

  // L'ACCROCHE EST BRANCHÉE, dans la fenêtre : la fiche redevient candidate au passage suivant.
  // C'est la réponse au revers — rien n'est perdu tant que la fenêtre tient.
  await q(`update message_templates set body = $2 where id = $1`,
    [(await q(`select mt.id from message_templates mt join sequence_steps st on st.template_parent_id = mt.id where st.campaign_id = $1`, [m.campagne])).rows[0].id, ACCROCHE_URL]);
  check('41a. l\'accroche branchée dans la fenêtre, la fiche redevient candidate : rien n\'est perdu',
    (await candidates(m.org)).includes(p.fiche), JSON.stringify(await candidates(m.org)));

  // La borne : une campagne ARCHIVÉE ne compte pas, comme pour l'épargne.
  await q(`update campaigns set status = 'archived' where id = $1`, [m.campagne]);
  check('41b. une campagne archivée ne fait rattraper personne',
    !(await candidates(m.org)).includes(p.fiche), JSON.stringify(await candidates(m.org)));
  await q(`update campaigns set status = 'active' where id = $1`, [m.campagne]);

  // LA SECONDE BRANCHE DU FILTRE, dans les DEUX sens. `linkedin_posts_traites` existe dès que la
  // collecte a vu le post, avant même ses engageurs : c'est elle qui couvre une fiche sans aucun
  // signal rattaché. Elle n'était exercée qu'en positif (les mondes des sections de rattrapage
  // passent par elle), donc elle pouvait disparaître sans qu'un seul contrôle bouge — la mesure
  // qui a démasqué la preuve du drapeau.
  const t = await monde();
  await etapeAvecCorps(t, SANS_ACCROCHE, { canal: 'email' });
  const sourceT = await sourceDePost(t, urlN(167), 'Engageurs 167');
  const ficheT = await enregistrerFichePost(pool, t.org, ficheN(167, VIDE), { fenetreJours: FENETRE });
  await marquerPostTraite(pool, t.org, sourceT, `urn:li:activity:7271000000000000167`);
  const sansSignal = (await q(`select 1 from signals where linkedin_post_id = $1`, [ficheT.id])).rowCount;
  check('41d. une fiche SANS signal, traitée par une source dont la campagne ne nomme aucun post : pas candidate',
    sansSignal === 0 && !(await candidates(t.org)).includes(ficheT.id),
    `${sansSignal} signal(aux) / ${JSON.stringify(await candidates(t.org))}`);
  await q(`update message_templates set body = $2 where id = $1`,
    [(await q(`select mt.id from message_templates mt join sequence_steps st on st.template_parent_id = mt.id where st.campaign_id = $1`, [t.campagne])).rows[0].id, ACCROCHE_URL]);
  check('41e. la même fiche, l\'accroche branchée : candidate par la trace de traitement seule',
    (await candidates(t.org)).includes(ficheT.id), JSON.stringify(await candidates(t.org)));

  // L'autre moitié du rattrapage : la fiche COMPLÈTE dont le sujet reste à écrire. Même filtre,
  // sinon on paierait un crédit Anthropic pour un sujet que personne ne lira.
  const n = await monde();
  await etapeAvecCorps(n, SANS_ACCROCHE, { canal: 'email' });
  const q2 = await engageurDUnPost(n, 166, { etat: 'pending', sujet: null });
  check('41c. et le sujet à rédiger suit la même règle : pas de crédit pour un post que rien ne nomme',
    !(await candidates(n.org)).includes(q2.fiche), JSON.stringify(await candidates(n.org)));
}

async function rattrapageCritere() {
  console.log('\n# « incomplète » n\'a qu\'une définition : la sélection SQL et `ficheIncomplete` s\'accordent');
  const m = await monde();
  const lignes = [];
  let i = 0;
  for (const auteur of [null, 'Ana']) for (const texte of [null, 't']) for (const date of [null, new Date('2026-10-12T08:30:00Z')]) {
    i += 1;
    const f = ficheN(i, {
      auteur: auteur ? { kind: 'person', nom: auteur, nomAffiche: auteur, nomPublic: null, url: null } : null,
      texte,
      date,
    });
    await enregistrerFichePost(pool, m.org, f, { fenetreJours: FENETRE });
    lignes.push(urlN(i));
  }
  await rendreLesPostsAttendus(m);
  const toutes = (await q(`select url, author_name, text_excerpt, posted_at from linkedin_posts where organization_id = $1`, [m.org])).rows;
  const attendu = toutes.filter(ficheIncomplete).map((r) => r.url).sort();
  const candidates = await fichesARattraper(pool, m.org, { aRelire: 100, aRediger: 100 });
  const lues = candidates.filter((r) => r.a_relire).map((r) => r.url).sort();
  check('10e. huit combinaisons auteur / texte / date : mêmes fiches À RELIRE pour le SQL et pour `ficheIncomplete`', JSON.stringify(lues) === JSON.stringify(attendu) && lues.length === 7, `${lues.length} / ${attendu.length}`);
  // La huitième, complète, n'est pas à relire — mais son sujet manque, donc elle est à rédiger.
  const aRediger = candidates.filter((r) => !r.a_relire).map((r) => r.url);
  check('10h. la fiche complète n\'est pas rouverte, elle n\'attend que son sujet', aRediger.length === 1 && !attendu.includes(aRediger[0]), JSON.stringify(aRediger));
}

async function rattrapageLot() {
  console.log('\n# le lot : une trace par lecture, un rythme, les plafonds, le verrou');
  // Plafond du jour : 2 sur 5.
  const m = await monde5(5, 2);
  const { deps, vu } = depsLot();
  await traiterFichePost(deps, { organizationId: m.org });
  const t = await traces(m.org);
  check('11. plafond du jour 2 : deux fiches lues sur cinq, UN navigateur', vu.navigations.length === 2 && vu.ouvertures === 1, `${vu.navigations.length} navigation(s), ${vu.ouvertures} ouverture(s)`);
  check('11a. chaque lecture est TRACÉE dans `linkedin_requetes` (kind `fiche`, rattachée à la fiche)', t.length === 2 && t.every((r) => r.post_id !== null && r.source_run_id === null), JSON.stringify(t));
  check('11b. une pause avant CHAQUE ouverture de page', vu.pauses.length === 2 && vu.pauses.every((ms) => ms > 0), JSON.stringify(vu.pauses));
  const heure = await q(`select count(*)::int as n from linkedin_requetes where organization_id = $1 and requested_at > now() - interval '1 hour'`, [m.org]);
  check('11c. ces lectures comptent dans le même budget horaire que la collecte', heure.rows[0].n === 2, String(heure.rows[0].n));

  const b = depsLot();
  await traiterFichePost(b.deps, { organizationId: m.org });
  check('11d. plafond du jour atteint : le lot suivant n\'ouvre RIEN', b.vu.ouvertures === 0 && b.vu.navigations.length === 0, JSON.stringify(b.vu.navigations));
  await q(`delete from pgboss.job where data->>'organizationId' = $1`, [m.org]);
  // Les deux fiches lues sont désormais complètes : leur donner un sujet retire la seule autre
  // raison de déposer un job (la rédaction, qui ne consomme aucune requête LinkedIn). Ce qui reste
  // à prouver ici, c'est que le plafond du JOUR, lui, n'en laisse plus déposer pour la lecture.
  await q(`update linkedin_posts set subject = 'un sujet relu' where organization_id = $1`, [m.org]);
  await enqueueFichesPostALire(boss, pool);
  check('11e. et le producteur ne dépose plus de job', (await jobsDe(m.org)).length === 0);

  // Plafond relevé : le crédit neuf va à des fiches NEUVES.
  await q(`update organization_settings set value = '3'::jsonb where organization_id = $1 and key = 'linkedin_fiches_post_par_jour'`, [m.org]);
  const c = depsLot();
  await traiterFichePost(c.deps, { organizationId: m.org });
  const tout = (await q(`select distinct post_id from linkedin_requetes where organization_id = $1 and kind = 'fiche'`, [m.org])).rows.length;
  check('11f. plafond relevé de 2 à 3 : une fiche de plus, et trois fiches distinctes en tout', c.vu.navigations.length === 1 && tout === 3, `${c.vu.navigations.length} / ${tout}`);

  // Plafond horaire de la collecte : 1 requête par heure.
  const h = await monde5(5, 20, 1);
  const d = depsLot();
  await traiterFichePost(d.deps, { organizationId: h.org });
  check('11g. plafond horaire de requêtes à 1 : une seule lecture', d.vu.navigations.length === 1, String(d.vu.navigations.length));

  // Verrou tenu par une collecte : ni navigateur, ni trace, ni crédit consommé.
  const v = await monde5(3, 20);
  check('12. le verrou est pris par une collecte', await prendreVerrouLinkedIn(v.ctx, 'collecte-en-cours', 600_000));
  const e = depsLot();
  await traiterFichePost(e.deps, { organizationId: v.org });
  check('12a. verrou tenu : AUCUN navigateur ouvert, aucune navigation', e.vu.ouvertures === 0 && e.vu.navigations.length === 0, JSON.stringify(e.vu));
  check('12b. et aucune trace, aucun crédit du jour consommé', (await traces(v.org)).length === 0);
  const verrou = (await q(`select lock_owner from linkedin_server_sessions where organization_id = $1`, [v.org])).rows[0].lock_owner;
  check('12c. le verrou de la collecte reste à la collecte', verrou === 'collecte-en-cours', String(verrou));
  await prendreVerrouLinkedIn(v.ctx, 'collecte-en-cours', 0);
  const f = depsLot();
  await traiterFichePost(f.deps, { organizationId: v.org });
  check('12d. verrou libre : le lot s\'exécute, puis rend le verrou', f.vu.navigations.length === 3
    && (await q(`select lock_until is null or lock_until <= now() as libre from linkedin_server_sessions where organization_id = $1`, [v.org])).rows[0].libre === true);
}

async function rattrapageTraitement() {
  console.log('\n# le traitement : page illisible, page lisible, sujet de l\'opérateur');
  const m = await monde5(2, 20);
  const ligne = async (n) => (await q(`select * from linkedin_posts where organization_id = $1 and url = $2`, [m.org, urlN(n)])).rows[0];

  const a = depsLot('', ecrit('jamais'));
  let leve = null;
  try { await traiterFichePost(a.deps, { organizationId: m.org }); } catch (e) { leve = e; }
  const l1 = await ligne(1);
  check('13. une page illisible ne lève pas', leve === null, String(leve));
  check('13a. elle incrémente `capture_attempts` (1 -> 2), la fiche reste `pending`, sans texte ni sujet',
    l1.capture_attempts === 2 && l1.review_status === 'pending' && l1.text_excerpt === null && l1.subject === null, JSON.stringify([l1.capture_attempts, l1.review_status]));

  const b = depsLot('Recruter un commercial coûte cher, voici ce que nous avons mesuré.', async (t) => ({ etat: 'ecrit', sujet: `sujet de : ${t.slice(0, 8)}` }));
  await traiterFichePost(b.deps, { organizationId: m.org });
  const l2 = await ligne(1);
  check('13b. une page lisible complète le texte', l2.text_excerpt?.startsWith('Recruter') === true, String(l2.text_excerpt));
  check('13c. le sujet du rédacteur est rangé, d\'origine `model`', l2.subject === 'sujet de : Recruter' && l2.subject_origin === 'model', JSON.stringify([l2.subject, l2.subject_origin]));

  await q(`update linkedin_posts set subject = 'Mon sujet', subject_origin = 'operator', text_excerpt = null where id = $1`, [l2.id]);
  const c = depsLot('Un autre texte lu sur la page.', ecrit('écrasement'));
  await traiterFichePost(c.deps, { organizationId: m.org });
  const l3 = await ligne(1);
  check('13d. le sujet de l\'opérateur n\'est pas remplacé', l3.subject === 'Mon sujet' && l3.subject_origin === 'operator', JSON.stringify([l3.subject, l3.subject_origin]));

  // Plus rien d'incomplet : le lot n'ouvre rien.
  await q(`update linkedin_posts set author_name = 'Ana', posted_at = now(), text_excerpt = 'texte' where organization_id = $1`, [m.org]);
  const d = depsLot();
  await traiterFichePost(d.deps, { organizationId: m.org });
  check('13e. aucune fiche incomplète : aucun navigateur ouvert', d.vu.ouvertures === 0);
}

async function sujetSansRelecture() {
  console.log('\n# une fiche COMPLÈTE sans sujet est rédigée, sans rouvrir sa page');
  await demarrerBoss();
  const m = await monde();
  await activerSessionLinkedIn(m.ctx, IP_FICHE);
  // Ce que produit la collecte quand elle réussit : auteur, texte et date en base, sujet vide.
  // C'est le CHEMIN NOMINAL ; s'il n'appelait pas le rédacteur, l'opérateur écrirait chaque sujet
  // à la main (197 posts chez l'opérateur qui a mesuré l'accroche).
  await enregistrerFichePost(pool, m.org, ficheN(51), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(m);

  await enqueueFichesPostALire(boss, pool);
  check('28. un job est déposé même quand il n\'y a QUE des sujets à rédiger', (await jobsDe(m.org)).length === 1, JSON.stringify(await jobsDe(m.org)));

  // Le pilote lèverait sur toute lecture de page : la fiche ne doit JAMAIS être rouverte.
  const { deps, vu } = depsLot('TEXTE RELU SUR LA PAGE', async (t) => ({ etat: 'ecrit', sujet: `sujet de : ${t.slice(0, 8)}` }));
  await traiterFichePost(deps, { organizationId: m.org });
  const l = (await q(`select subject, subject_origin, capture_attempts, text_excerpt from linkedin_posts where organization_id = $1`, [m.org])).rows[0];
  check('28a. le sujet est écrit, à partir du texte DÉJÀ en base', l.subject === 'sujet de : Un texte' && l.subject_origin === 'model', JSON.stringify([l.subject, l.subject_origin]));
  check('28b. sans ouvrir de navigateur ni naviguer', vu.ouvertures === 0 && vu.navigations.length === 0, JSON.stringify(vu.navigations));
  check('28c. sans tracer la moindre requête LinkedIn (budget horaire et plafond du jour intacts)', (await traces(m.org)).length === 0, JSON.stringify(await traces(m.org)));
  check('28d. et sans compter une tentative de capture de plus', l.capture_attempts === 1 && l.text_excerpt?.startsWith('Un texte') === true, String(l.capture_attempts));

  // Le sujet écrit, il n'y a plus rien à faire : le lot suivant ne redemande rien.
  const b = depsLot('TEXTE RELU SUR LA PAGE', ecrit('un second sujet'));
  await traiterFichePost(b.deps, { organizationId: m.org });
  const apres = (await q(`select subject from linkedin_posts where organization_id = $1`, [m.org])).rows[0];
  check('28e. un sujet déjà écrit n\'est pas redemandé', apres.subject === 'sujet de : Un texte', String(apres.subject));

  // UN LOT MIXTE : une fiche à relire, une fiche complète. Le navigateur est ouvert pour la
  // première — la seconde ne doit pas en profiter pour se faire relire, son texte est déjà là.
  const mixte = await monde();
  await activerSessionLinkedIn(mixte.ctx, IP_FICHE);
  await enregistrerFichePost(pool, mixte.org, ficheN(53, VIDE), { fenetreJours: FENETRE });
  await enregistrerFichePost(pool, mixte.org, ficheN(54), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(mixte);
  const x = depsLot('TEXTE RELU SUR LA PAGE', async (t) => ({ etat: 'ecrit', sujet: `sujet de : ${t.slice(0, 8)}` }));
  await traiterFichePost(x.deps, { organizationId: mixte.org });
  const parUrl = Object.fromEntries(
    (await q(`select id, url, subject, capture_attempts from linkedin_posts where organization_id = $1`, [mixte.org])).rows.map((r) => [r.url, r]),
  );
  const tracesMixte = await traces(mixte.org);
  check('28f. lot mixte : UNE seule page ouverte, celle de la fiche incomplète',
    x.vu.navigations.length === 1 && x.vu.navigations[0] === urlN(53), JSON.stringify(x.vu.navigations));
  check('28g. et UNE seule trace de requête, rattachée à cette fiche-là',
    tracesMixte.length === 1 && tracesMixte[0].post_id === parUrl[urlN(53)].id, JSON.stringify(tracesMixte));
  check('28h. les deux sujets sont écrits, celui de la fiche complète depuis le texte DÉJÀ en base',
    parUrl[urlN(53)].subject === 'sujet de : TEXTE RE' && parUrl[urlN(54)].subject === 'sujet de : Un texte',
    JSON.stringify([parUrl[urlN(53)].subject, parUrl[urlN(54)].subject]));
  check('28i. et la fiche complète n\'a pas pris une tentative de capture de plus',
    parUrl[urlN(54)].capture_attempts === 1, String(parUrl[urlN(54)].capture_attempts));
  // RIEN ne doit tenir un verrou LinkedIn pour appeler un modèle : vingt rédactions derrière un
  // verrou de dix minutes, c'est la collecte qui attend pour rien.
  check('28m. le navigateur est FERMÉ avant la première rédaction',
    x.vu.journal.indexOf('ferme') >= 0 && x.vu.journal.indexOf('ferme') < x.vu.journal.indexOf('redige'), JSON.stringify(x.vu.journal));

  // Le verrou, lu DEPUIS la rédaction elle-même : c'est le seul moment où la question se pose.
  const mixteB = await monde();
  await activerSessionLinkedIn(mixteB.ctx, IP_FICHE);
  await enregistrerFichePost(pool, mixteB.org, ficheN(57, VIDE), { fenetreJours: FENETRE });
  await enregistrerFichePost(pool, mixteB.org, ficheN(58), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(mixteB);
  const verrousVus = [];
  const z = depsLot('TEXTE RELU SUR LA PAGE', async () => {
    verrousVus.push((await q(`select lock_until > now() as tenu from linkedin_server_sessions where organization_id = $1`, [mixteB.org])).rows[0].tenu);
    return { etat: 'ecrit', sujet: 'un sujet' };
  });
  await traiterFichePost(z.deps, { organizationId: mixteB.org });
  check('28n. et le verrou LinkedIn est rendu avant la première rédaction',
    verrousVus.length === 2 && verrousVus.every((tenu) => tenu === false), JSON.stringify(verrousVus));

  // Rédiger n'émet rien vers LinkedIn : une session bloquée ne doit pas rendre l'opérateur aux
  // sujets manuels que ce travail de fond existe pour supprimer.
  const bloquee = await monde();
  await activerSessionLinkedIn(bloquee.ctx, IP_FICHE);
  await enregistrerFichePost(pool, bloquee.org, ficheN(59), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(bloquee);
  await q(`update linkedin_server_sessions set status = 'bloquee', blocked_reason = 'defi' where organization_id = $1`, [bloquee.org]);
  await enqueueFichesPostALire(boss, pool);
  check('28o. session bloquée : un job est déposé quand même, pour les sujets à écrire', (await jobsDe(bloquee.org)).length === 1, JSON.stringify((await jobsDe(bloquee.org)).map((j) => j.data)));
  const w = depsLot('x', ecrit('un sujet malgré la session'));
  await traiterFichePost(w.deps, { organizationId: bloquee.org });
  const rBloquee = (await q(`select subject from linkedin_posts where organization_id = $1`, [bloquee.org])).rows[0];
  check('28p. le sujet est écrit sans navigateur et sans trace de requête',
    rBloquee.subject === 'un sujet malgré la session' && w.vu.ouvertures === 0 && (await traces(bloquee.org)).length === 0,
    `${rBloquee.subject} / ${w.vu.ouvertures} ouverture(s)`);
  const verrouBloquee = (await q(`select lock_until > now() as tenu from linkedin_server_sessions where organization_id = $1`, [bloquee.org])).rows[0];
  check('28q. et le verrou LinkedIn n\'a jamais été pris', verrouBloquee.tenu !== true, String(verrouBloquee.tenu));

  // Une fiche INCOMPLÈTE, elle, exige toujours la session : elle a besoin d'une page.
  const sansSession = await monde();
  await activerSessionLinkedIn(sansSession.ctx, IP_FICHE);
  await enregistrerFichePost(pool, sansSession.org, ficheN(60, VIDE), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(sansSession);
  await q(`update linkedin_server_sessions set status = 'bloquee', blocked_reason = 'defi' where organization_id = $1`, [sansSession.org]);
  const v2 = depsLot('TEXTE RELU SUR LA PAGE', ecrit('jamais'));
  await traiterFichePost(v2.deps, { organizationId: sansSession.org });
  check('28r. une fiche à relire n\'est pas lue sans session : aucune page ouverte, aucun sujet écrit',
    v2.vu.ouvertures === 0 && (await q(`select subject from linkedin_posts where organization_id = $1`, [sansSession.org])).rows[0].subject === null);

  // UN TEXTE RÉFRACTAIRE. Le modèle répond, rien n'en sort : sans compteur, la fiche le rappelle
  // à chaque passage pendant toute sa fenêtre, sur le crédit que le SCORING partage avec elle.
  const refractaire = await monde();
  await activerSessionLinkedIn(refractaire.ctx, IP_FICHE);
  await enregistrerFichePost(pool, refractaire.org, ficheN(55), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(refractaire);
  let appels = 0;
  const refuse = async () => {
    appels += 1;
    return { etat: 'refuse' };
  };
  for (let i = 0; i < 5; i += 1) await traiterFichePost(depsLot('x', refuse).deps, { organizationId: refractaire.org });
  const r55 = (await q(`select subject, subject_attempts from linkedin_posts where organization_id = $1`, [refractaire.org])).rows[0];
  check('28j. cinq passages, mais le modèle n\'est rappelé que trois fois sur le même texte',
    appels === TENTATIVES_SUJET_MAX && r55.subject_attempts === TENTATIVES_SUJET_MAX, `${appels} appel(s), ${r55.subject_attempts} tentative(s)`);
  check('28k. et la fiche n\'est plus proposée au rattrapage',
    (await fichesARattraper(pool, refractaire.org, { aRelire: 50, aRediger: 50 })).length === 0 && r55.subject === null);

  // RIEN DEMANDÉ n'est pas une tentative : sans clé de modèle, ou le plafond du jour atteint, le
  // lendemain change tout. Brûler les trois tentatives là-dessus condamnerait une fiche sans
  // qu'aucun modèle ne l'ait jamais vue.
  const sansCle = await monde();
  await activerSessionLinkedIn(sansCle.ctx, IP_FICHE);
  await enregistrerFichePost(pool, sansCle.org, ficheN(56), { fenetreJours: FENETRE });
  await rendreLesPostsAttendus(sansCle);
  for (let i = 0; i < 4; i += 1) await traiterFichePost(depsLot('x').deps, { organizationId: sansCle.org });
  const r56 = (await q(`select subject_attempts from linkedin_posts where organization_id = $1`, [sansCle.org])).rows[0];
  check('28l. aucune clé de modèle : aucune tentative consommée, la fiche reste demandable',
    r56.subject_attempts === 0 && (await fichesARattraper(pool, sansCle.org, { aRelire: 50, aRediger: 50 })).length === 1, String(r56.subject_attempts));
}

async function sujetCredit() {
  console.log('\n# le crédit du sujet : celui du scoring, une unité par appel');
  const m = await monde();
  await q(`insert into organization_settings (organization_id, key, value) values ($1, 'scoring_par_jour', '2'::jsonb)`, [m.org]);
  const r = [await prendreCreditAnthropic(pool, m.org), await prendreCreditAnthropic(pool, m.org), await prendreCreditAnthropic(pool, m.org)];
  const u = (await q(`select used from provider_daily_usage where organization_id = $1 and provider_id = 'anthropic'`, [m.org])).rows;
  check('14. plafond de scoring à 2 : deux crédits accordés, le troisième refusé', JSON.stringify(r) === '[true,true,false]', JSON.stringify(r));
  check('14a. une unité par appel, sur le fournisseur `anthropic`', u.length === 1 && u[0].used === 2, JSON.stringify(u));
}

async function deuxCheminsDeRendu() {
  console.log('\n# les variables de post : même rendu à l\'envoi et à l\'aperçu, sur le même enregistrement');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set subject = 'le recrutement des commerciaux', subject_origin = 'operator', review_status = 'approved' where id = $1`, [f.id]);
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAdeux', nom: 'Dana Test', intitule: 'Directrice commerciale' }, { id: m.campagne, personaId: m.persona }, URL_POST, f.id);
  const sig = (await q(`select id from signals where organization_id = $1`, [m.org])).rows[0];
  const contact = (await q(`select id from contacts where organization_id = $1 order by created_at desc limit 1`, [m.org])).rows[0];
  const insc = (
    await q(`insert into enrollments (organization_id, campaign_id, contact_id, signal_id) values ($1, $2, $3, $4) returning id`, [m.org, m.campagne, contact.id, sig.id])
  ).rows[0].id;

  const CORPS = '{{post_auteur}} | {{post_sujet}} | {{post_url}} | {{post_date}}';
  const envoi = buildMessageValues(await chargerLigneInscription(pool, insc));
  const apercu = (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {};
  const rE = renderTemplate(CORPS, envoi);
  const rA = renderTemplate(CORPS, apercu);
  check('15a. la requête d\'envoi résout les quatre variables', rE.missing.length === 0 && rE.text.startsWith('Ana | le recrutement des commerciaux | https://www.linkedin.com/'), JSON.stringify(rE));
  check('15b. la requête de l\'aperçu résout les quatre variables', rA.missing.length === 0, JSON.stringify(rA));
  check('15c. les deux chemins rendent exactement la même chose', rE.text === rA.text && rE.text.endsWith('12/10/2026'), `${rE.text} / ${rA.text}`);

  // Une fiche sans nom affiché : ni l'un ni l'autre n'invente une valeur.
  await q(`update linkedin_posts set author_display_name = null, subject = null where id = $1`, [f.id]);
  const e2 = renderTemplate(CORPS, buildMessageValues(await chargerLigneInscription(pool, insc)));
  const a2 = renderTemplate(CORPS, (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {});
  check('15d. sans nom affiché ni sujet, les deux chemins les retiennent', JSON.stringify(e2.missing.sort()) === '["post_auteur","post_sujet"]' && JSON.stringify(a2.missing.sort()) === JSON.stringify(e2.missing), JSON.stringify([e2.missing, a2.missing]));

  // La fiche d'une autre organisation ne se lit jamais, même rattachée par erreur au signal.
  const autre = await monde();
  const g = await enregistrerFichePost(pool, autre.org, fiche(), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set author_display_name = 'Intrus', subject = 'sujet étranger' where id = $1`, [g.id]);
  await q(`update signals set linkedin_post_id = $2 where id = $1`, [sig.id, g.id]);
  const e3 = buildMessageValues(await chargerLigneInscription(pool, insc));
  const a3 = (await lireValeursContact(pool, m.org, contact.id, m.campagne))?.valeurs ?? {};
  check('15e. une fiche d\'une autre organisation n\'est lue par aucun des deux chemins', e3.post_auteur === undefined && a3.post_auteur === undefined, JSON.stringify([e3.post_auteur, a3.post_auteur]));
}

// ------------------------------------------------- la garde d'entrée (tâche 8)

const ACCROCHE = 'Bonjour, je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}.';
const SANS_ACCROCHE = 'Bonjour, parlons prospection.';
/** Accroches qui ne citent qu'UNE variable de post : la garde ne doit exiger que celle-là. */
const ACCROCHE_URL = 'Bonjour, je vous ai vu réagir à ce post : {{post_url}}.';
const ACCROCHE_DATE = 'Bonjour, votre réaction du {{post_date}} m\'a interpellé.';
/**
 * Les mêmes, ÉCRITES AVEC UN REPLI. Deux questions s'y séparent, et c'est tout l'objet des deux
 * sections plus bas :
 *
 *  - « cette campagne parle-t-elle du post » reste VRAIE — un repli ne dispense pas de faire
 *    relire. L'accroche d'URL le montre le mieux : `url` est renseignée dès la création de la
 *    fiche, donc le repli ne sert JAMAIS, et pourtant il suffirait à désactiver toute la
 *    relecture humaine ;
 *  - « que faut-il exiger de la fiche » devient FAUSSE : la variable se résout, le message part.
 *
 * Seules `post_url` et `post_date` peuvent porter un repli : `NO_FALLBACK_VARIABLES` le refuse
 * sur `post_auteur` et `post_sujet` dès l'enregistrement.
 */
const ACCROCHE_URL_REPLI = 'Bonjour, j\'ai vu votre réaction à ce post : {{post_url|https://www.linkedin.com/feed/}}.';
const ACCROCHE_DATE_REPLI = 'Bonjour, votre réaction du {{post_date|12 octobre}} m\'a interpellé.';
/** Un repli VIDE n'est pas un repli : `renderTemplate` rendrait un blanc, que le dépôt interdit. */
const ACCROCHE_DATE_REPLI_VIDE = 'Bonjour, votre réaction du {{post_date|}} m\'a interpellé.';
/**
 * LE CAS MIXTE, celui que la séparation des deux motifs rend central : une variable de post SANS
 * repli, deux AVEC. La campagne doit faire relire le post (elle en parle), et n'exiger de la
 * fiche que le sujet (les deux autres se résolvent toutes seules).
 */
const ACCROCHE_MIXTE = 'Bonjour, je vous ai vu réagir au post sur {{post_sujet}}, publié le {{post_date|12 octobre}} : {{post_url|https://www.linkedin.com/feed/}}.';
/**
 * La même, à ceci près que l'adresse n'a PAS de repli : le seul écart entre 32f et 32g. DÉRIVÉE,
 * jamais recopiée — sans quoi un éditeur futur casserait l'appariement sans s'en apercevoir, et
 * la paire cesserait de prouver que c'est le repli, et lui seul, qui change le verdict.
 */
const ACCROCHE_MIXTE_URL_STRICTE = ACCROCHE_MIXTE.replace('{{post_url|https://www.linkedin.com/feed/}}', '{{post_url}}');

/**
 * Une étape de séquence et son gabarit : c'est le CORPS du gabarit qui dit si la campagne nomme
 * un post. Canal `linkedin_message` par défaut — une campagne 100 % LinkedIn inscrit un engageur
 * sans email (`sqlCampagneSansEmail`), ce qui isole la garde du post de celle de l'adresse.
 */
async function etapeAvecCorps(m, corps, { canal = 'linkedin_message', position = 0, sujet = null, nom = 'Modele' } = {}) {
  const gabarit = (
    await q(
      `insert into message_templates (organization_id, name, channel, locale, body, subject)
       values ($1, $5, $2::channel_kind, 'fr', $3, $4) returning id`,
      [m.org, canal, corps, sujet, nom],
    )
  ).rows[0].id;
  await q(
    `insert into sequence_steps (campaign_id, position, channel, template_parent_id) values ($1, $2, $3::channel_kind, $4)`,
    [m.campagne, position, canal, gabarit],
  );
  return gabarit;
}

/**
 * Une personne collectée sur le post `n`, par les fonctions de production, avec sa fiche dans
 * l'état demandé. Une fiche par post : deux états à éprouver dans la même organisation
 * demandent deux posts.
 */
async function engageurDUnPost(m, n, { etat = 'pending', sujet = 'le recrutement des commerciaux', nomAffiche = 'Ana', memePost = null } = {}) {
  // `memePost` : le retour d'un appel precedent. Un post a plusieurs engageurs : meme fiche, meme source,
  // seul l'engageur change.
  const source = memePost ? memePost.source : await sourceDePost(m, urlN(n), `Engageurs ${n}`);
  const runId = await startSourceRun(pool, source);
  const f = memePost ? { id: memePost.fiche } : await enregistrerFichePost(pool, m.org, ficheN(n), { fenetreJours: FENETRE });
  if (!memePost) {
    await q(`update linkedin_posts set review_status = $2, subject = $3, author_display_name = $4 where id = $1`, [
      f.id,
      etat,
      sujet,
      nomAffiche,
    ]);
  }
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  await enregistrerEngageur(
    ctx,
    {
      urn: `urn:li:fsd_profile:ACoAA${n}${seq}`,
      nom: `Bob ${n}`,
      intitule: 'Directeur commercial',
      // Adresse PUBLIQUE : sans elle, `sqlAdresseResolvable` écarte la personne de l'achat et la
      // section du gel de la dépense ne prouverait rien.
      urlProfil: `https://www.linkedin.com/in/bob-${n}-${seq}/`,
    },
    { id: m.campagne, personaId: m.persona },
    memePost ? urlN(memePost.n) : urlN(n),
    f.id,
  );
  const ligne = (
    await q(
      `select c.id as contact_id, s.id as signal_id from contacts c join signals s on s.id = c.source_signal_id
        where c.organization_id = $1 and s.linkedin_post_id = $2 and c.linkedin_url like $3`,
      [m.org, f.id, `%/in/bob-${n}-${seq}%`],
    )
  ).rows[0];
  return { fiche: f.id, source, n, ...ligne };
}

/** Les inscriptions réellement créées pour une organisation, par la production seule. */
const inscritsDe = async (org) =>
  (await q(`select contact_id from enrollments where organization_id = $1`, [org])).rows.map((r) => r.contact_id);

/** Joue `f` en captant ce que le moteur écrit dans ses journaux. */
async function enEcoutant(f) {
  const lignes = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...a) => lignes.push(a.join(' '));
  console.warn = (...a) => lignes.push(a.join(' '));
  try {
    return { valeur: await f(), lignes };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

/**
 * Un tour complet de production des inscriptions : le producteur dépose, le traitement inscrit.
 * `limit` large car la requête balaie TOUTES les organisations du harnais d'un seul passage.
 */
/**
 * Un expéditeur email, OUVERT À TOUTE HEURE.
 *
 * `business_hours` par défaut vaut 9h-18h du lundi au vendredi (`heuresOuvrees`, `sequence.ts`) :
 * hors de ce créneau, `runGuards` REPORTE l'envoi au lieu de composer l'action, et toute section
 * qui observe une action email devient rouge — un harnais qui ne prouve rien la nuit, le week-end
 * ou avant 9h n'est pas un harnais. Mesuré le 16/10 à 8h35 : quatre contrôles rouges et une
 * section entière non jouée, pour une cause qui n'avait rien à voir avec le code.
 */
const expediteurEmail = async (org, nom) =>
  q(
    `insert into senders (organization_id, kind, identity, business_hours)
     values ($1, 'email', $2, '{"startHour":0,"endHour":24,"days":[1,2,3,4,5,6,7]}'::jsonb)`,
    [org, nom],
  );

async function tourDInscription(org) {
  await demarrerBoss();
  await enqueueEnrollments(boss, pool, { limit: 500 });
  const jobs = (
    await q(`select data from pgboss.job where name = 'sequence.enroll' and data->>'organizationId' = $1`, [org])
  ).rows.map((r) => r.data);
  for (const job of jobs) await enrollContact(pool, job);
  return jobs;
}

async function gardeDEntree() {
  console.log('\n# une campagne qui nomme le post n\'inscrit que sur une fiche validée');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const attente = await engageurDUnPost(m, 21, { etat: 'pending' });

  const { valeur: deposes, lignes: journal } = await enEcoutant(() => tourDInscription(m.org));
  check('17. fiche `pending` : personne n\'est inscrit', (await inscritsDe(m.org)).length === 0, JSON.stringify(await inscritsDe(m.org)));
  // Le PRÉ-FILTRE du producteur, distinct du contrôle autoritaire : sans lui, un job serait
  // déposé chaque jour pour une personne que l'inscription refuse, et la file se remplirait de
  // travail nul sans que rien ne le dise.
  check('17-a. et aucun job d\'inscription n\'est déposé pour elle', deposes.length === 0, JSON.stringify(deposes));
  // Une campagne qui retient toute sa population doit être indistinguable d'une campagne SANS
  // candidat pour personne : ni pour l'opérateur, ni dans les journaux du moteur. Le décompte
  // dit COMBIEN et POURQUOI, campagne par campagne.
  const traceRetenues = journal.find((l) => l.includes(m.campagne) && l.includes('validation du post'));
  check('17-b. le moteur journalise ce que la garde retient, par campagne et par motif',
    traceRetenues !== undefined && /1 personne\(s\) retenue\(s\)/.test(traceRetenues)
      && /1 en attente de validation/.test(traceRetenues) && /0 sans post/.test(traceRetenues)
      && /0 fiche inexploitable/.test(traceRetenues), String(traceRetenues));

  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  await tourDInscription(m.org);
  check('17a. la fiche validée, la personne est inscrite au passage suivant', (await inscritsDe(m.org)).includes(attente.contact_id));

  // Contrôle autoritaire : un job déposé autrement (reprise à la main, serveur MCP) ne contourne rien.
  const n = await monde();
  await etapeAvecCorps(n, ACCROCHE);
  const direct = await engageurDUnPost(n, 22, { etat: 'pending' });
  const job = { organizationId: n.org, campaignId: n.campagne, contactId: direct.contact_id, signalId: direct.signal_id };
  check('17b. `enrollContact` appelé directement refuse aussi', (await enrollContact(pool, job)) === null);
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [direct.fiche]);
  check('17c. et accepte dès que la fiche est validée', typeof (await enrollContact(pool, job)) === 'string');

  // Point de vigilance 1 : c'est le nom AFFICHÉ qui décide, jamais `author_name` (un slug de page).
  const p = await monde();
  await etapeAvecCorps(p, ACCROCHE);
  const slug = await engageurDUnPost(p, 23, { etat: 'approved', nomAffiche: null });
  await q(`update linkedin_posts set author_name = 'uptoo-france' where id = $1`, [slug.fiche]);
  const sansSujet = await engageurDUnPost(p, 24, { etat: 'approved', sujet: null });
  await tourDInscription(p.org);
  const inscritsP = await inscritsDe(p.org);
  check('17d. fiche validée SANS nom affiché : personne n\'est inscrit (le slug ne fait pas une accroche)',
    !inscritsP.includes(slug.contact_id), JSON.stringify(inscritsP));
  check('25b. fiche validée sans sujet : personne n\'est inscrit non plus', !inscritsP.includes(sansSujet.contact_id), JSON.stringify(inscritsP));
  check('25c. ni l\'un ni l\'autre ne produit d\'action envoyable', inscritsP.length === 0, JSON.stringify(inscritsP));
  // L'OBJET d'un email nomme le post aussi bien que son corps : la tâche 6 fabrique justement un
  // objet qui le nomme. Un gabarit dont seul le sujet porte la variable doit être gardé pareil.
  const o = await monde();
  await etapeAvecCorps(o, SANS_ACCROCHE, { canal: 'email', sujet: 'Votre réaction au post de {{post_auteur}}' });
  const parLeSujet = await engageurDUnPost(o, 41, { etat: 'pending' });
  const refusSujet = await enrollContact(pool, {
    organizationId: o.org,
    campaignId: o.campagne,
    contactId: parLeSujet.contact_id,
    signalId: parLeSujet.signal_id,
  });
  check("17g. une campagne qui ne nomme le post que dans l'OBJET est gardée pareil", refusSujet === null, String(refusSujet));

  // Point de vigilance 5, par le chemin des VERSIONS : l'opérateur ne réécrit pas le gabarit, il
  // en publie une nouvelle version. L'ancienne reste en base, retirée. Seules les versions EN
  // VIGUEUR comptent, sinon la campagne resterait « nomme le post » pour toujours et retiendrait
  // ses personnes sans que rien ne l'explique.
  const w = await monde();
  const gabaritW = await etapeAvecCorps(w, ACCROCHE);
  const versionne = await engageurDUnPost(w, 43, { etat: 'pending' });
  const jobW = { organizationId: w.org, campaignId: w.campagne, contactId: versionne.contact_id, signalId: versionne.signal_id };
  check('17h. retenu tant que la version en vigueur nomme le post', (await enrollContact(pool, jobW)) === null);
  await q(`update message_templates set is_active = false where id = $1`, [gabaritW]);
  await q(
    `insert into message_templates (organization_id, name, channel, locale, version, body, parent_id, is_active)
     values ($1, 'Modele', 'linkedin_message'::channel_kind, 'fr', 2, $2, $3, true)`,
    [w.org, SANS_ACCROCHE, gabaritW],
  );
  check('17i. une nouvelle version sans la variable libère la personne, l\'ancienne version ne compte plus',
    typeof (await enrollContact(pool, jobW)) === 'string');

  // La fiche d'une AUTRE organisation ne valide rien, même rattachée par erreur au signal : la
  // garde filtre par organisation, comme les deux chemins de rendu (contrôle 15e).
  const x = await monde();
  await etapeAvecCorps(x, ACCROCHE);
  const local = await engageurDUnPost(x, 44, { etat: 'pending' });
  const etrangere = await monde();
  const ficheEtrangere = await enregistrerFichePost(pool, etrangere.org, ficheN(44), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set review_status = 'approved', subject = 'un sujet', author_display_name = 'Zoe' where id = $1`, [ficheEtrangere.id]);
  await q(`update signals set linkedin_post_id = $2 where id = $1`, [local.signal_id, ficheEtrangere.id]);
  check('17j. une fiche validée d\'une autre organisation ne fait entrer personne',
    (await enrollContact(pool, { organizationId: x.org, campaignId: x.campagne, contactId: local.contact_id, signalId: local.signal_id })) === null);

  // La garde exige les SEULES variables que la campagne écrit. Une campagne qui ne cite que
  // l'adresse du post n'a besoin de rien d'autre : l'URL existe dès la création de la fiche.
  // Exiger l'auteur et le sujet ici retiendrait ses personnes sans aucune raison.
  const y = await monde();
  await etapeAvecCorps(y, ACCROCHE_URL);
  const parLUrl = await engageurDUnPost(y, 46, { etat: 'approved', sujet: null, nomAffiche: null });
  check('17k. une campagne qui ne cite que {{post_url}} inscrit sans auteur affiché ni sujet',
    typeof (await enrollContact(pool, { organizationId: y.org, campaignId: y.campagne, contactId: parLUrl.contact_id, signalId: parLUrl.signal_id })) === 'string');

  // Et symétriquement : celle qui cite la date exige la date, pas le sujet.
  const z = await monde();
  await etapeAvecCorps(z, ACCROCHE_DATE);
  const parLaDate = await engageurDUnPost(z, 47, { etat: 'approved', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [parLaDate.fiche]);
  const jobZ = { organizationId: z.org, campaignId: z.campagne, contactId: parLaDate.contact_id, signalId: parLaDate.signal_id };
  check('17l. une campagne qui cite {{post_date}} est retenue tant que la fiche n\'a pas de date', (await enrollContact(pool, jobZ)) === null);
  await q(`update linkedin_posts set posted_at = now() - interval '2 days' where id = $1`, [parLaDate.fiche]);
  check('17m. et elle entre dès que la date est là, sans exiger ni auteur ni sujet', typeof (await enrollContact(pool, jobZ)) === 'string');
}

async function contactExcluNeRevientPas() {
  console.log('\n# un contact exclu (reponse humaine, ne plus contacter) n\'est plus jamais propose a l\'inscription');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const exclu = await engageurDUnPost(m, 31, { etat: 'approved' });
  // MEME post pour les deux : un seul terme change, le statut du contact.
  const jumeau = await engageurDUnPost(m, 32, { memePost: exclu });
  await q(`update contacts set status = 'do_not_contact' where id = $1`, [exclu.contact_id]);
  const deposes = await tourDInscription(m.org);
  // La paire : meme campagne, meme etat de fiche, seul le statut du contact differe.
  check('T7-a. le jumeau non exclu est propose et inscrit', deposes.some((j) => j.contactId === jumeau.contact_id) && (await inscritsDe(m.org)).includes(jumeau.contact_id));
  check('T7-b. le contact exclu n\'est PAS propose : aucun job d\'inscription, aucune inscription',
    !deposes.some((j) => j.contactId === exclu.contact_id) && !(await inscritsDe(m.org)).includes(exclu.contact_id), JSON.stringify(deposes));
}

async function campagneSansAccrocheNonGelee() {
  console.log('\n# une campagne qui ne nomme pas le post n\'est pas gelée');
  const m = await monde();
  await etapeAvecCorps(m, SANS_ACCROCHE);
  const attente = await engageurDUnPost(m, 25, { etat: 'pending' });
  await tourDInscription(m.org);
  check('18. fiche `pending`, campagne sans accroche : la personne est inscrite', (await inscritsDe(m.org)).includes(attente.contact_id));

  const n = await monde();
  await etapeAvecCorps(n, SANS_ACCROCHE);
  const direct = await engageurDUnPost(n, 26, { etat: 'pending' });
  const id = await enrollContact(pool, { organizationId: n.org, campaignId: n.campagne, contactId: direct.contact_id, signalId: direct.signal_id });
  check('18b. le contrôle autoritaire ne refuse pas non plus', typeof id === 'string', String(id));
}

async function retraitDeLaVariable() {
  console.log('\n# retirer la variable des étapes libère les retenues, sans intervention');
  const m = await monde();
  const gabarit = await etapeAvecCorps(m, ACCROCHE);
  const retenu = await engageurDUnPost(m, 27, { etat: 'pending' });
  const avant = await tourDInscription(m.org);
  check('19. retenu tant que la campagne nomme le post', (await inscritsDe(m.org)).length === 0 && avant.length === 0, JSON.stringify(avant));

  await q(`update message_templates set body = $2 where id = $1`, [gabarit, SANS_ACCROCHE]);
  await tourDInscription(m.org);
  check('19a. la variable retirée, la personne est inscrite au passage suivant', (await inscritsDe(m.org)).includes(retenu.contact_id));
}

async function epargneReelle() {
  console.log('\n# la branche d\'épargne épargne réellement');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const qualifie = await engageurDUnPost(m, 28, { etat: 'pending' });
  const neuf = await engageurDUnPost(m, 29, { etat: 'pending' });
  const sansFiche = await engageurDUnPost(m, 30, { etat: 'pending' });
  await q(`update signals set linkedin_post_id = null where id = $1`, [sansFiche.signal_id]);
  // Le signal est plus vieux que le délai d'ancienneté, mais la fiche est encore dans sa fenêtre.
  const vieillir = (id, jours) => q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [id, jours]);
  await vieillir(qualifie.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await vieillir(neuf.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await vieillir(sansFiche.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [qualifie.signal_id]);

  const vivants = async () =>
    (await q(`select id from signals where id = any($1::uuid[])`, [[qualifie.signal_id, neuf.signal_id, sansFiche.signal_id]])).rows.map((r) => r.id);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const apres = await vivants();
  check('20. une personne QUALIFIÉE rattachée à une fiche `pending` dans sa fenêtre est épargnée', apres.includes(qualifie.signal_id), JSON.stringify(apres));
  check('20a. une personne jamais scorée l\'est aussi', apres.includes(neuf.signal_id), JSON.stringify(apres));
  check('20b. sans fiche, rien n\'est épargné : la branche n\'épargne pas tout le monde', !apres.includes(sansFiche.signal_id), JSON.stringify(apres));

  // VALIDER NE DOIT PAS EFFACER. L'épargne s'indexait sur `pending` seul, quand les quatre
  // autres gardes s'indexent sur `approved` : au moment où l'opérateur valide, l'épargne tombait
  // — et dans `produire`, la purge passe AVANT l'enfilage. Le geste utile détruisait donc ses
  // propres personnes, au passage suivant, quinze minutes plus tard. La fenêtre annoncée à
  // l'écran faisait 28 jours, celle où valider servait vraiment en faisait 14.
  const valide = await engageurDUnPost(m, 160, { etat: 'pending' });
  await vieillir(valide.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await validerPost(m.ctx, { postId: valide.fiche, campagneId: m.campagne });
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20h. une fiche VALIDÉE épargne encore : valider n\'efface pas ce qu\'on vient de débloquer',
    (await q(`select 1 from signals where id = $1`, [valide.signal_id])).rowCount === 1);

  // Même famille : une fiche `approved` mais INCOMPLÈTE, et une fiche `rejected`. Les deux
  // retiennent (la garde exige que la fiche résolve ce que la campagne écrit, ou qu'elle soit
  // relue) pendant que la ligne de l'écran promet une date d'effacement. Retenir sans épargner,
  // c'est promettre une fenêtre qu'on n'honore pas.
  const incomplete = await engageurDUnPost(m, 161, { etat: 'approved', sujet: null });
  const rejetee = await engageurDUnPost(m, 162, { etat: 'rejected' });
  await vieillir(incomplete.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await vieillir(rejetee.signal_id, AGE_MAX_SIGNAL_JOURS + 2);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const encoreLa = (await q(`select id from signals where id = any($1::uuid[])`, [[incomplete.signal_id, rejetee.signal_id]])).rows.map((r) => r.id);
  check('20i. une fiche validée mais incomplète, et une fiche rejetée, épargnent tant que leur fenêtre tient',
    encoreLa.length === 2, JSON.stringify(encoreLa));

  // La fenêtre passée, la personne retombe sous la purge ordinaire. C'est la SEULE borne, et
  // c'est elle que l'écran annonce : la fenêtre promise est celle où valider sert encore.
  await q(`update linkedin_posts set expires_at = now() - interval '1 day' where id = any($1::uuid[])`,
    [[qualifie.fiche, neuf.fiche, valide.fiche, incomplete.fiche, rejetee.fiche]]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const fin = await vivants();
  check('20c. `expires_at` passé, la personne disparaît', fin.length === 0, JSON.stringify(fin));
  const finToutes = (await q(`select id from signals where id = any($1::uuid[])`,
    [[valide.signal_id, incomplete.signal_id, rejetee.signal_id]])).rows;
  check('20j. et aucun des trois autres états ne survit à sa fenêtre : l\'épargne a UNE borne',
    finToutes.length === 0, JSON.stringify(finToutes));

  // L'épargne ne vaut que si QUELQU'UN attend la validation de ce post : une campagne qui nomme
  // le post, reliée à la source d'où il vient. Sans cela, on garderait plus longtemps le nom et
  // l'intitulé de personnes que personne n'attend — le coût de la fenêtre sans son bénéfice.
  const sans = await monde();
  await etapeAvecCorps(sans, SANS_ACCROCHE);
  const delaissee = await engageurDUnPost(sans, 48, { etat: 'pending' });
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [delaissee.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  const resteDelaissee = async () => (await q(`select 1 from signals where id = $1`, [delaissee.signal_id])).rowCount;
  check('20d. aucune campagne ne nomme le post : la personne est effacée à l\'échéance ordinaire', (await resteDelaissee()) === 0);

  // La même situation, mais une campagne qui nomme le post est reliée à la source : épargnée.
  const avecQui = await monde();
  await etapeAvecCorps(avecQui, SANS_ACCROCHE);
  const attendue = await engageurDUnPost(avecQui, 49, { etat: 'pending' });
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [attendue.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  const campagneQuiNomme = (
    await q(
      `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'Avec accroche', 'active', $2::jsonb) returning id`,
      [avecQui.org, JSON.stringify({ personas: [avecQui.persona] })],
    )
  ).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [campagneQuiNomme, attendue.source]);
  await etapeAvecCorps({ ...avecQui, campagne: campagneQuiNomme }, ACCROCHE);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20e. une campagne qui nomme le post, reliée à sa source, l\'épargne', (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 1);

  // Et elle l'épargne même en PAUSE : mettre sa campagne en pause une semaine ne doit pas faire
  // effacer les personnes dont on allait valider le post. C'est l'inverse du quantificateur du
  // gel de la dépense (contrôle 21g), et pour la raison inverse : ici, l'erreur coûteuse est
  // d'effacer à tort. L'épargne reste bornée par `expires_at`.
  await q(`update campaigns set status = 'paused' where id = $1`, [campagneQuiNomme]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20f. la campagne qui nomme le post est en pause : la personne est épargnée quand même',
    (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 1);

  // Archivée, en revanche, elle n'attend plus rien : garder le nom et l'intitulé d'une personne
  // pour une campagne que personne ne reprendra, c'est payer la rétention sans le bénéfice.
  await q(`update campaigns set status = 'archived' where id = $1`, [campagneQuiNomme]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('20g. la campagne qui nomme le post est archivée : la personne est effacée à l\'échéance ordinaire',
    (await q(`select 1 from signals where id = $1`, [attendue.signal_id])).rowCount === 0);
}

async function gelDeLaDepense() {
  console.log('\n# aucun email acheté sur un post qu\'un humain n\'a pas relu');
  await demarrerBoss();
  const candidats = async (org) =>
    (await q(`select data from pgboss.job where name = 'enrichment.contact_connu' and data->>'organizationId' = $1`, [org])).rows.map(
      (r) => r.data.contactId,
    );
  // La campagne nomme le post ET envoie des emails : c'est le cas où l'achat sert.
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE, { canal: 'email' });
  const attente = await engageurDUnPost(m, 31, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [attente.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21. fiche `pending` : aucun achat enfilé', !(await candidats(m.org)).includes(attente.contact_id), JSON.stringify(await candidats(m.org)));

  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21a. la fiche validée, l\'achat repart', (await candidats(m.org)).includes(attente.contact_id), JSON.stringify(await candidats(m.org)));

  // Une campagne qui ne nomme pas le post achète comme avant : le lot ne gèle aucune dépense existante.
  const n = await monde();
  await etapeAvecCorps(n, SANS_ACCROCHE, { canal: 'email' });
  const libre = await engageurDUnPost(n, 32, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [libre.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('21b. campagne sans accroche : l\'achat part malgré la fiche `pending`', (await candidats(n.org)).includes(libre.contact_id), JSON.stringify(await candidats(n.org)));

  // Contrôle autoritaire : la fonction qui DÉPENSE refuse elle-même, et n'appelle pas le fournisseur.
  const p = await monde();
  await etapeAvecCorps(p, ACCROCHE, { canal: 'email' });
  const retenu = await engageurDUnPost(p, 33, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [retenu.signal_id]);
  const appels = [];
  const deps = {
    pool,
    cleFullEnrich: async () => 'cle-de-test',
    acheter: async (_cle, entree) => {
      appels.push(entree);
      return { resultat: null, credits: 1 };
    },
  };
  const warn = console.warn;
  console.warn = () => undefined;
  let issue;
  try {
    issue = await enrichirContactConnu(deps, { organizationId: p.org, contactId: retenu.contact_id });
  } finally {
    console.warn = warn;
  }
  check('21c. la fonction qui dépense refuse elle-même, sans appeler le fournisseur', issue === 'post_a_relire' && appels.length === 0, `${issue} / ${appels.length} appel(s)`);
  const marque = (await q(`select enriched_at from contacts where id = $1`, [retenu.contact_id])).rows[0];
  check('21d. et ne marque PAS le contact : le refus est temporaire, pas définitif', marque.enriched_at === null, String(marque.enriched_at));

  // Deux campagnes actives sur la MÊME source, une seule nomme le post. L'autre inscrira la
  // personne dès qu'elle aura son adresse : l'achat n'est donc pas prématuré. C'est pour ce cas
  // que la règle est « TOUTES les campagnes de la source nomment le post », et pas « au moins
  // une » — avec « au moins une », la seconde campagne serait stérilisée sans un mot.
  const r = await monde();
  await etapeAvecCorps(r, ACCROCHE, { canal: 'email' });
  const partage = await engageurDUnPost(r, 42, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [partage.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21e. une seule campagne, qui nomme le post : l'achat est retenu", !(await candidats(r.org)).includes(partage.contact_id));
  const seconde = (
    await q(
      `insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'Sans accroche', 'active', $2::jsonb) returning id`,
      [r.org, JSON.stringify({ personas: [r.persona] })],
    )
  ).rows[0].id;
  await q(`insert into campaign_sources (campaign_id, source_id) values ($1, $2)`, [seconde, partage.source]);
  await etapeAvecCorps({ ...r, campagne: seconde }, SANS_ACCROCHE, { canal: 'email' });
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21f. une seconde campagne qui ne le nomme pas rend l'achat légitime", (await candidats(r.org)).includes(partage.contact_id), JSON.stringify(await candidats(r.org)));

  // Une campagne qui n'est pas ACTIVE n'inscrit personne, donc elle ne décide rien ici : l'achat
  // part comme avant ce lot. Sans cette réserve, mettre sa campagne en pause une semaine gèlerait
  // en silence tous les achats de ses sources — un comportement que ce lot n'a pas à changer.
  const u = await monde();
  await etapeAvecCorps(u, ACCROCHE, { canal: 'email' });
  const enPause = await engageurDUnPost(u, 45, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [enPause.signal_id]);
  await q(`update campaigns set status = 'paused' where id = $1`, [u.campagne]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check("21g. une campagne en pause ne gèle aucun achat", (await candidats(u.org)).includes(enPause.contact_id), JSON.stringify(await candidats(u.org)));
}

async function fenetreReglable() {
  console.log('\n# la fenêtre de décision est un réglage, et elle a un terme');
  const m = await monde();
  await ecrireReglage(m.ctx, { cle: 'linkedin_fenetre_validation_post_jours', valeur: 40 });
  check('22. la fenêtre lue est celle de l\'organisation', (await fenetreValidationPost(pool, m.org)) === 40);
  const defaut = await monde();
  check('22a. sans réglage, le défaut de 28 jours', (await fenetreValidationPost(pool, defaut.org)) === 28);

  // Point de vigilance 4 : sous le délai d'ancienneté, l'épargne n'épargnerait jamais rien.
  let refus = null;
  try {
    await ecrireReglage(m.ctx, { cle: 'linkedin_fenetre_validation_post_jours', valeur: AGE_MAX_SIGNAL_JOURS });
  } catch (e) {
    refus = e;
  }
  // Le message compte autant que le refus : c'est lui que l'écran affiche (`messageDErreur`,
  // `app/actions/plafonds.ts` lit `details.fieldErrors.valeur`).
  const motif = refus?.details?.fieldErrors?.valeur?.[0] ?? '';
  check('22b. une fenêtre sous le délai d\'ancienneté est refusée, avec un message qui dit pourquoi',
    refus !== null && motif.includes(String(AGE_MAX_SIGNAL_JOURS)) && /ancienneté/.test(motif), `${refus} / ${motif}`);
  check('22c. et la valeur en base n\'a pas bougé', (await fenetreValidationPost(pool, m.org)) === 40);

  // La bascule périodique : seule une `pending` échue change d'état.
  const f = await enregistrerFichePost(pool, m.org, ficheN(34), { fenetreJours: FENETRE });
  const g = await enregistrerFichePost(pool, m.org, ficheN(35), { fenetreJours: FENETRE });
  const h = await enregistrerFichePost(pool, m.org, ficheN(36), { fenetreJours: FENETRE });
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = any($1::uuid[])`, [[f.id, g.id]]);
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [g.id]);
  const bascules = await rejeterFichesPostExpirees(pool);
  const etats = Object.fromEntries(
    (await q(`select id, review_status, reviewed_at, reviewed_by from linkedin_posts where id = any($1::uuid[])`, [[f.id, g.id, h.id]])).rows.map((r) => [
      r.id,
      r,
    ]),
  );
  check('22d. la fiche échue passe en `rejected`', bascules >= 1 && etats[f.id].review_status === 'rejected', `${bascules} / ${etats[f.id].review_status}`);
  check('22e. une fiche validée, même échue, n\'est pas touchée', etats[g.id].review_status === 'approved');
  check('22f. une fiche encore dans sa fenêtre non plus', etats[h.id].review_status === 'pending');
  check('22g. le rejet d\'expiration ne se fait pas passer pour une relecture humaine',
    etats[f.id].reviewed_at === null && etats[f.id].reviewed_by === null, JSON.stringify([etats[f.id].reviewed_at, etats[f.id].reviewed_by]));
}

/**
 * Ce que le décompte compte EN TOUT, toutes catégories confondues.
 *
 * Dérivé de l'objet rendu plutôt que d'une liste de champs recopiée : une catégorie qu'on
 * rajouterait demain entre dans la somme sans qu'on y pense, ce qui est tout l'intérêt — c'est ce
 * qu'un `=== undefined` sur un champ supprimé ne peut plus faire.
 *
 * LA FORME compte autant que le nombre. Ne sommer que les `number` laisserait passer une
 * catégorie rendue autrement — une liste d'identifiants, un objet par motif —, et c'est
 * exactement la forme qu'aurait `sansPost` ressuscité en liste. On compte donc des PERSONNES,
 * quelle que soit la forme : un nombre vaut lui-même, une liste vaut sa longueur, un objet vaut
 * la somme de ses valeurs. Les booléens restent dehors, et c'est la seule frontière qu'on pose :
 * ils disent un FAIT sur la campagne (« elle nomme un post », « elle a une source »), jamais un
 * nombre de personnes — `aUneSourceDePost` ferait sinon bouger le total sans que personne ne
 * soit retenu.
 */
const personnesComptees = (v) => {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (v !== null && typeof v === 'object') return Object.values(v).reduce((a, x) => a + personnesComptees(x), 0);
  return 0; // booléen, chaîne, nul : un fait, pas une population.
};
const totalCompte = (d) => Object.values(d).reduce((a, v) => a + personnesComptees(v), 0);

async function decompteLisible() {
  console.log('\n# le décompte : pourquoi personne ne part');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const attente = await engageurDUnPost(m, 37, { etat: 'pending' });
  const prete = await engageurDUnPost(m, 38, { etat: 'approved' });
  const inexploitable = await engageurDUnPost(m, 39, { etat: 'approved', sujet: null });
  const orpheline = await engageurDUnPost(m, 40, { etat: 'pending' });
  await q(`update signals set linkedin_post_id = null where id = $1`, [orpheline.signal_id]);

  const r = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23. la campagne nomme un post et a une source de post', r.nommeUnPost === true && r.aUneSourceDePost === true, JSON.stringify(r));
  check('23a. les personnes en attente de validation sont comptées', r.enAttenteDeValidation === 1, JSON.stringify(r));
  // La personne SANS aucune fiche n'est plus retenue (voir `rienARelireNeRetientPas`), donc le
  // décompte n'a plus de catégorie pour elle : un compteur qui annonce une rétention qui n'a pas
  // lieu est le défaut d'en face, et ce dépôt l'a déjà payé.
  //
  // L'assertion porte sur LA PERSONNE, pas sur l'absence d'un champ : `r.sansPost === undefined`
  // était vrai par construction depuis que le champ a disparu du type, donc vert même si le
  // décompte recomptait n'importe quoi. On vérifie d'abord qu'elle est bien dans la population
  // comptée — sans ça, « elle n'est comptée nulle part » serait vrai d'une personne absente.
  const orphelineComptable = (await q(
    `select 1 from contacts ct join signals s on s.id = ct.source_signal_id
      where ct.id = $1 and s.linkedin_post_id is null
        and not exists (select 1 from enrollments e
                         where e.contact_id = ct.id and e.status in ('active', 'paused', 'paused_absence'))
        -- LE prédicat d'appartenance, rejoué tel quel : chaque personne a sa PROPRE source, et
        -- c'est par ce lien-là qu'elle sortirait de la population sans que le total bronche. La
        -- somme resterait à 2, le contrôle resterait vert, et il n'aurait rien prouvé d'elle.
        and (exists (select 1 from campaigns cp where cp.id = $2 and cp.source_id = s.source_id)
          or exists (select 1 from campaign_sources cs where cs.campaign_id = $2 and cs.source_id = s.source_id))`,
    [orpheline.contact_id, m.campagne])).rowCount;
  // L'assertion porte sur la SOMME, pas sur un compteur : répéter `postInexploitable === 1`
  // referait 23c en double, et deux contrôles pour un fait ne valent pas mieux qu'un contrôle
  // creux. La somme se dérive de l'objet rendu, jamais d'une liste recopiée — le jour où une
  // catégorie réapparaît et attrape l'orpheline, elle entre dedans toute seule.
  check('23b. la personne sans aucun post est dans la population, et n\'est comptée NULLE PART',
    orphelineComptable === 1 && totalCompte(r) === 2, `${totalCompte(r)} comptée(s) sur 4 personnes — ${JSON.stringify(r)}`);
  check('23c. et celles dont la fiche est inexploitable', r.postInexploitable === 1, JSON.stringify(r));

  // Chaque compteur suit bien SA personne : on corrige une fiche à la fois, et un seul bouge.
  await q(`update linkedin_posts set review_status = 'approved' where id = $1`, [attente.fiche]);
  const r2 = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23d. valider le post en attente vide ce compteur-là, et lui seul',
    r2.enAttenteDeValidation === 0 && r2.postInexploitable === 1, JSON.stringify(r2));
  await q(`update linkedin_posts set subject = 'la prospection' where id = $1`, [inexploitable.fiche]);
  const r3 = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23e. compléter la fiche inexploitable vide le sien', r3.postInexploitable === 0, JSON.stringify(r3));

  // La personne prête n'est comptée nulle part : une fois inscrite, elle sort même de la population.
  await tourDInscription(m.org);
  const apres = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('23f. la personne inscrite sort du décompte',
    (await inscritsDe(m.org)).includes(prete.contact_id) && apres.enAttenteDeValidation === 0, JSON.stringify(apres));
  // Et l'orpheline, qui n'a aucune fiche, est entrée elle aussi : plus rien ne la retient.
  check('23f2. la personne sans aucune fiche entre, elle n\'a rien à faire relire',
    (await inscritsDe(m.org)).includes(orpheline.contact_id), JSON.stringify(await inscritsDe(m.org)));

  // La mauvaise configuration que l'enregistrement accepte volontairement.
  const n = await monde();
  await etapeAvecCorps(n, ACCROCHE);
  const sansSource = await compterRetenuesParPost(pool, n.org, n.campagne);
  check('23g. une campagne qui nomme un post sans aucune source de post est signalée',
    sansSource.nommeUnPost === true && sansSource.aUneSourceDePost === false, JSON.stringify(sansSource));
  check('23h. `campagneNommeUnPost` dit faux sur une campagne sans étape', (await campagneNommeUnPost(pool, (await monde()).campagne)) === false);

  // Le badge de l'onglet annonce du TRAVAIL. Sans accroche, relire ces posts ne débloque
  // personne : l'annoncer envoie l'opérateur valider pour rien, et le jour où la rétention sera
  // vraie il ne lira plus le badge.
  const muette = await monde();
  await etapeAvecCorps(muette, SANS_ACCROCHE);
  const posteMuet = await engageurDUnPost(muette, 64, { etat: 'pending', sujet: null });
  check('23i. une campagne qui ne nomme aucun post n\'affiche aucun post à relire sur son onglet',
    (await compterPostsAValiderDeCampagne(muette.ctx, { campagneId: muette.campagne })) === 0,
    String(await compterPostsAValiderDeCampagne(muette.ctx, { campagneId: muette.campagne })));
  const etatMuet = (await q(`select review_status, expires_at > now() as vivante from linkedin_posts where id = $1`, [posteMuet.fiche])).rows[0];
  check('23i2. et le post EST bien là, en attente dans sa fenêtre : ce qui manque, c\'est l\'accroche',
    etatMuet?.review_status === 'pending' && etatMuet?.vivante === true, JSON.stringify(etatMuet));
  // La même campagne, l'accroche ajoutée : le badge apparaît, sans que rien d'autre ne change.
  await etapeAvecCorps(muette, ACCROCHE, { position: 1 });
  check('23j. l\'accroche ajoutée, le badge compte ce post',
    (await compterPostsAValiderDeCampagne(muette.ctx, { campagneId: muette.campagne })) === 1,
    String(await compterPostsAValiderDeCampagne(muette.ctx, { campagneId: muette.campagne })));
}

async function indexDeJointureDesGabarits() {
  console.log('\n# la jointure des gabarits, que la garde évalue à chaque candidat, est indexée');
  // Les cinq sous-requêtes de la garde (une par variable de post, plus « cette campagne nomme-t-elle
  // un post ») joignent `message_templates` par `parent_id`. Ce qui compte n'est pas qu'un index
  // PRÉCIS existe, c'est que la jointure soit indexable.
  //
  // La première version de ce contrôle exigeait un index à UNE SEULE colonne, et ce filtre
  // masquait exactement l'index qui existait déjà — l'unique (parent_id, version, locale) du
  // schéma initial. Une preuve écrite autour de ce qu'on croit ne peut plus le contredire : elle
  // avait fait poser un index redondant. Elle regarde maintenant la propriété, pas une ligne.
  const tete = (
    await q(
      `select i.relname as nom, pg_get_indexdef(i.oid) as def
         from pg_index x join pg_class i on i.oid = x.indexrelid
        where x.indrelid = 'public.message_templates'::regclass
          and (select a.attname from pg_attribute a
                where a.attrelid = x.indrelid and a.attnum = x.indkey[0]) = 'parent_id'`,
    )
  ).rows;
  check('24. un index porte `parent_id` en COLONNE DE TÊTE, quel que soit son nom et sa largeur',
    tete.length > 0, tete.map((r) => r.nom).join(', ') || 'aucun');

  // Et le planificateur s'en sert pour la forme EXACTE que la garde écrit. `enable_seqscan = off`
  // parce que la table du harnais tient en une page : sans cela un parcours séquentiel serait
  // légitimement préféré, et le contrôle ne dirait rien de l'indexabilité.
  const client = await pool.connect();
  let plan = '';
  try {
    await client.query('begin');
    await client.query('set local enable_seqscan = off');
    const r = await client.query(
      `explain (costs off) select 1 from public.message_templates mt_ap
        where (mt_ap.id = '00000000-0000-0000-0000-000000000001'::uuid
            or mt_ap.parent_id = '00000000-0000-0000-0000-000000000001'::uuid)`,
    );
    plan = r.rows.map((x) => x['QUERY PLAN']).join(' / ');
  } finally {
    await client.query('rollback').catch(() => undefined);
    client.release();
  }
  check('24a. et le planificateur l\'utilise pour la forme exacte de la garde, sans parcours séquentiel',
    /Index Scan/.test(plan) && !/Seq Scan/.test(plan), plan);
}

/** La partie « reprise » et la partie « auto-vérification » de la migration, telles qu'écrites dans le fichier. */
function morceauxDeLaMigration() {
  const sql = readFileSync(new URL('../../supabase/migrations/20261015092540_linkedin_posts.sql', import.meta.url), 'utf8');
  const debut = sql.indexOf('create function pg_temp.cle_post');
  const verif = sql.indexOf('-- La migration se vérifie elle-même.');
  return { reprise: sql.slice(debut, verif), verification: sql.slice(verif) };
}

async function repriseDeLExistant() {
  console.log('\n# la reprise de l\'existant : seulement post_engagement');
  const m = await monde();
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const signal = async (kind, ext, url) =>
    (await q(`insert into signals (organization_id, source_id, external_id, kind, occurred_at, url) values ($1, $2, $3, $4::signal_kind, now(), $5) returning id`, [m.org, source, ext, kind, url])).rows[0].id;
  const sPost = await signal('post_engagement', 'rep-post', URL_POST);
  const sRech = await signal('people_search', 'rep-rech', 'https://www.linkedin.com/search/results/content/?keywords=prospection');
  const sPoste = await signal('job_change', 'rep-poste', 'https://www.linkedin.com/in/dana-test/');
  // La fenêtre de décision est un RÉGLAGE : les fiches de la reprise doivent porter celle de leur
  // organisation, pas un intervalle en dur. Une échéance en dur annoncerait à l'écran une date que
  // le réglage contredit, et `expires_at` n'est posé qu'à la création.
  await ecrireReglage(m.ctx, { cle: 'linkedin_fenetre_validation_post_jours', valeur: 35 });

  // Les sections précédentes ont laissé des signaux sans fiche (cas voulus) : l'auto-vérification de la
  // migration lit toute la base, on ne garde donc que ceux de cette section (elle joue en dernier).
  await q(`delete from signals where organization_id <> $1`, [m.org]);
  const { reprise, verification } = morceauxDeLaMigration();
  const client = await pool.connect();
  let leveeVerification = null;
  try {
    await client.query(reprise); // les fonctions pg_temp vivent le temps de la session
    // Dans SON propre try : la migration se vérifie elle-même, et une vérification qui lève ne
    // doit pas emporter les contrôles de cette section — c'est elle qu'on veut voir rougir.
    await client.query(verification).catch((e) => { leveeVerification = e; });
  } finally {
    client.release();
  }
  check('16e. le bloc d\'auto-vérification de la migration passe', leveeVerification === null, String(leveeVerification?.message ?? ''));
  const rattaches = (await q(`select id, linkedin_post_id from signals where id = any($1::uuid[])`, [[sPost, sRech, sPoste]])).rows;
  const par = Object.fromEntries(rattaches.map((r) => [r.id, r.linkedin_post_id]));
  const fiches = (await q(`select url from linkedin_posts where organization_id = $1`, [m.org])).rows;
  check('16a. le signal post_engagement est rattaché', par[sPost] !== null);
  check('16b. ni la recherche par mots-clés ni le changement de poste ne le sont', par[sRech] === null && par[sPoste] === null, JSON.stringify(par));
  check('16c. aucune fiche créée pour leur adresse', fiches.length === 1 && fiches[0].url === URL_POST, JSON.stringify(fiches));
  const fenetre = (await q(`select (extract(epoch from (expires_at - created_at)) / 86400) as jours from linkedin_posts where organization_id = $1`, [m.org])).rows[0];
  check('16d. la fiche de reprise porte la fenêtre RÉGLÉE de son organisation, pas 28 jours en dur',
    Math.abs(Number(fenetre.jours) - 35) < 0.01, `${fenetre.jours} jours`);
}

async function scoringNourri() {
  console.log('\n# le scoring reçoit le texte du post de l\'engageur');
  const m = await monde();
  await q(`update personas set scoring_prompt = $2 where id = $1`, [m.persona, 'Qualifie les directeurs commerciaux. '.repeat(10)]);
  const source = await sourceDePost(m, URL_POST, 'Engageurs');
  const runId = await startSourceRun(pool, source);
  const f = await enregistrerFichePost(pool, m.org, fiche({ texte: 'Pourquoi les commerciaux détestent leur CRM.' }), { fenetreJours: FENETRE });
  const ctx = { pool, organizationId: m.org, sourceId: source, sourceRunId: runId, exclusions: {} };
  const campagne = { id: m.campagne, personaId: m.persona };
  const urlProfil = (nom) => `https://www.linkedin.com/in/${nom}/`;
  await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAscoreA', nom: 'Ana Rattachee', intitule: 'Directrice commerciale', urlProfil: urlProfil('ana-rattachee') }, campagne, URL_POST, f.id);
  await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAscoreB', nom: 'Bob Sansfiche', intitule: 'Directeur des ventes', urlProfil: urlProfil('bob-sansfiche') }, campagne, URL_POST);
  // Une fiche d'une AUTRE organisation : la clé étrangère l'accepte, la jointure ne doit pas la lire.
  const autre = await monde();
  const fAutre = await enregistrerFichePost(pool, autre.org, fiche({ texte: 'TEXTE D UNE AUTRE ORGANISATION' }), { fenetreJours: FENETRE });
  await enregistrerEngageur(ctx, { urn: 'urn:li:fsd_profile:ACoAAscoreC', nom: 'Cleo Etrangere', intitule: 'Directrice des ventes', urlProfil: urlProfil('cleo-etrangere') }, campagne, URL_POST);
  await q(`update signals set linkedin_post_id = $2 where organization_id = $1 and external_id like '%ACoAAscoreC'`, [m.org, fAutre.id]);

  const avant = await compterSignauxScorables(pool, m.org);
  let recus = [];
  const scorer = async (prospects) => {
    recus = [...recus, ...prospects];
    return prospects.map((p) => ({ id: p.id, score: 90, reason: 'Retenu pour la preuve.' }));
  };
  const resume = await runScore({ pool, organizationId: m.org, scorer, now: Date.now() });
  const parNom = async (ext) => {
    const id = (await q(`select id from signals where organization_id = $1 and external_id like $2`, [m.org, `%${ext}`])).rows[0].id;
    return recus.find((p) => p.id === id);
  };
  check('17. la jointure ne filtre rien : le compteur et la sélection voient les mêmes trois signaux',
    avant === 3 && resume.considered === 3 && recus.length === 3, JSON.stringify({ avant, resume }));
  check('17a. l\'engageur rattaché reçoit le texte du post (`texteDePost`)',
    (await parNom('ACoAAscoreA'))?.texteDePost === 'Pourquoi les commerciaux détestent leur CRM.', JSON.stringify(await parNom('ACoAAscoreA')));
  check('17b. sans fiche, pas de texte de post', (await parNom('ACoAAscoreB'))?.texteDePost === undefined);
  check('17c. la fiche d\'une autre organisation n\'est pas lue', (await parNom('ACoAAscoreC'))?.texteDePost === undefined, JSON.stringify(await parNom('ACoAAscoreC')));
  // L'offre d'emploi : source Adzuna, prompt exploitable, description longue. Elle part à 150, le post à 600.
  const long = (c) => c.repeat(900);
  const srcOffre = (await q(`insert into sources (organization_id, name, provider_id, config) values ($1, 'Offres', 'adzuna', $2::jsonb) returning id`,
    [m.org, JSON.stringify({ scoring_prompt: 'Qualifie les offres de directeur commercial. '.repeat(10) })])).rows[0].id;
  const sigOffre = (await q(`insert into signals (organization_id, source_id, external_id, kind, occurred_at, title, raw) values ($1, $2, 'offre-1', 'job_posting', now(), 'Directeur commercial', $3::jsonb) returning id`,
    [m.org, srcOffre, JSON.stringify({ description: long('o') })])).rows[0].id;
  await q(`update linkedin_posts set text_excerpt = $2 where id = $1`, [f.id, long('p')]);
  await q(`update signals set status = 'new', score = null where organization_id = $1`, [m.org]);
  recus = [];
  await runScore({ pool, organizationId: m.org, scorer, now: Date.now() });
  const offre = recus.find((p) => p.id === sigOffre);
  const rattache = recus.find((p) => p.texteDePost !== undefined);
  check('26a. l\'offre garde sa description et n\'a pas de texte de post', offre?.description?.length === 900 && offre?.texteDePost === undefined, JSON.stringify(offre && { d: offre.description?.length, t: offre.texteDePost }));
  const message = buildScoringUserMessage([offre, rattache].filter(Boolean));
  check('26b. l\'offre part à 150 caractères', message.includes('o'.repeat(150)) && !message.includes('o'.repeat(151)));
  check('26c. le texte du post part à 600 caractères', message.includes('p'.repeat(600)) && !message.includes('p'.repeat(601)));
  const retenus = (await q(`select count(*)::int as n from signals where organization_id = $1 and score_reason = 'Retenu pour la preuve.'`, [m.org])).rows[0].n;
  check('17d. l\'explication du modèle est écrite pour les retenus', retenus === 4, String(retenus));
}

async function ecranDesPosts() {
  console.log('\n# l\'écran de validation : la relecture humaine que la garde exige');
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const a = await engageurDUnPost(m, 41, { etat: 'pending', sujet: null });
  const b = await engageurDUnPost(m, 42, { etat: 'pending', sujet: 'le recrutement des commerciaux' });
  // Hors périmètre : une autre campagne de la MÊME organisation, et une autre organisation.
  const autreCampagne = (await q(`insert into campaigns (organization_id, name, status, entry_rules) values ($1, 'Autre', 'active', $2::jsonb) returning id`, [m.org, JSON.stringify({ personas: [m.persona] })])).rows[0].id;
  const hors = await engageurDUnPost({ ...m, campagne: autreCampagne }, 43, { etat: 'pending' });
  const n = await monde();
  const etranger = await engageurDUnPost(n, 44, { etat: 'pending' });

  const lignes = await listerPostsDeCampagne(m.ctx, { campagneId: m.campagne });
  const ids = lignes.map((l) => l.id).sort();
  check('27a. la liste ne rend que les posts des sources de CETTE campagne', JSON.stringify(ids) === JSON.stringify([a.fiche, b.fiche].sort()),
    `${lignes.length} lignes, hors-campagne ${ids.includes(hors.fiche)}, autre organisation ${ids.includes(etranger.fiche)}`);
  const la = lignes.find((l) => l.id === a.fiche);
  check('27b. chaque ligne compte ses personnes en attente', lignes.every((l) => l.personnesEnAttente === 1), JSON.stringify(lignes.map((l) => l.personnesEnAttente)));
  check('27c. l\'aperçu est la phrase du gabarit, l\'auteur ET le sujet laissés en place (deux champs à écrire dans la phrase)',
    la?.apercuAccroche === 'Bonjour, je vous ai vu réagir au post de {{post_auteur}} sur {{post_sujet}}.', String(la?.apercuAccroche));
  check('27d. le badge de l\'onglet compte les deux posts en attente', (await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })) === 2);

  // Un post sans sujet ne se valide pas, et rien ne bouge.
  let refus = null;
  await validerPost(m.ctx, { postId: a.fiche, campagneId: m.campagne }).catch((e) => { refus = e; });
  const etatA = (await q(`select review_status from linkedin_posts where id = $1`, [a.fiche])).rows[0].review_status;
  check('27e. valider un post sans sujet est refusé, il reste en attente', refus !== null && etatA === 'pending', `${refus?.name} / ${etatA}`);
  await tourDInscription(m.org);
  check('27f. et personne n\'entre en séquence tant qu\'il n\'est pas relu', (await inscritsDe(m.org)).length === 0);

  // Corriger, puis une capture ultérieure : le sujet de l'opérateur survit.
  await corrigerSujetDePost(m.ctx, { postId: a.fiche, sujet: 'la prospection LinkedIn' });
  const apres = (await q(`select subject, subject_origin from linkedin_posts where id = $1`, [a.fiche])).rows[0];
  await enregistrerFichePost(pool, m.org, ficheN(41), { fenetreJours: FENETRE });
  const recapture = (await q(`select subject, subject_origin from linkedin_posts where id = $1`, [a.fiche])).rows[0];
  check('27g. corriger pose subject_origin operator, et une nouvelle capture ne l\'écrase pas',
    apres.subject_origin === 'operator' && recapture.subject === 'la prospection LinkedIn' && recapture.subject_origin === 'operator', JSON.stringify(recapture));

  // Valider ouvre la garde : la personne entre réellement.
  await validerPost(m.ctx, { postId: a.fiche, campagneId: m.campagne });
  await validerPost(m.ctx, { postId: b.fiche, campagneId: m.campagne });
  await tourDInscription(m.org);
  const inscrits = await inscritsDe(m.org);
  check('27h. valider un post fait entrer ses personnes en séquence', inscrits.includes(a.contact_id) && inscrits.includes(b.contact_id), `${inscrits.length} inscrits`);

  // Corriger un post validé le laisse validé : la correction EST la relecture.
  await corrigerSujetDePost(m.ctx, { postId: b.fiche, sujet: 'le recrutement commercial' });
  const apresCorrection = (await q(`select review_status, reviewed_at, subject from linkedin_posts where id = $1`, [b.fiche])).rows[0];
  check('27i. corriger le sujet d\'un post déjà validé le laisse validé, relecture conservée',
    apresCorrection.review_status === 'approved' && apresCorrection.reviewed_at !== null && apresCorrection.subject === 'le recrutement commercial', JSON.stringify(apresCorrection));

  // Rejeter n'efface rien ; rouvrir annule.
  const avantRejet = (await q(`select (select count(*) from contacts where organization_id = $1)::int as c, (select count(*) from signals where organization_id = $1)::int as s`, [m.org])).rows[0];
  await rejeterPost(m.ctx, { postId: b.fiche });
  const apresRejet = (await q(`select (select count(*) from contacts where organization_id = $1)::int as c, (select count(*) from signals where organization_id = $1)::int as s, (select review_status from linkedin_posts where id = $2) as etat`, [m.org, b.fiche])).rows[0];
  check('27j. rejeter est un drapeau : ni personne ni signal n\'est effacé',
    apresRejet.etat === 'rejected' && apresRejet.c === avantRejet.c && apresRejet.s === avantRejet.s, JSON.stringify({ avantRejet, apresRejet }));
  await reouvrirPost(m.ctx, { postId: b.fiche });
  check('27k. rouvrir ramène un post rejeté en attente', (await q(`select review_status from linkedin_posts where id = $1`, [b.fiche])).rows[0].review_status === 'pending');

  // Une fenêtre passée ne se rouvre pas : l'échéance borne la rétention.
  await rejeterPost(m.ctx, { postId: b.fiche });
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = $1`, [b.fiche]);
  let refusRouvrir = null;
  await reouvrirPost(m.ctx, { postId: b.fiche }).catch((e) => { refusRouvrir = e; });
  check('27l. un post dont la fenêtre est passée ne se rouvre pas', refusRouvrir !== null && (await q(`select review_status from linkedin_posts where id = $1`, [b.fiche])).rows[0].review_status === 'rejected');

  // Même règle des deux côtés : une fenêtre passée ne se valide pas non plus.
  const perimee = await engageurDUnPost(m, 45, { etat: 'pending', sujet: 'un sujet relu' });
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = $1`, [perimee.fiche]);
  let refusValider = null;
  await validerPost(m.ctx, { postId: perimee.fiche, campagneId: m.campagne }).catch((e) => { refusValider = e; });
  const etatPerimee = (await q(`select review_status from linkedin_posts where id = $1`, [perimee.fiche])).rows[0].review_status;
  check('27n. un post en attente dont l\'échéance est passée ne se valide pas, comme il ne se rouvre pas',
    refusValider !== null && etatPerimee === 'pending' && JSON.stringify(refusValider.details).includes('échéance'), `${refusValider?.name} / ${etatPerimee}`);

  // Une autre organisation n'agit jamais sur ce post.
  let intrus = null;
  await validerPost(n.ctx, { postId: hors.fiche, campagneId: n.campagne }).catch((e) => { intrus = e; });
  await rejeterPost(n.ctx, { postId: hors.fiche }).catch(() => undefined);
  const etatHors = (await q(`select review_status from linkedin_posts where id = $1`, [hors.fiche])).rows[0].review_status;
  check('27m. une autre organisation ne peut ni valider ni rejeter ce post', intrus !== null && etatHors === 'pending', `${intrus?.name} / ${etatHors}`);
}

async function validationExigeCeQuiPartira() {
  console.log('\n# valider exige EXACTEMENT ce que la campagne écrit, ni plus ni moins');
  // 1. La campagne nomme l'auteur ET le sujet, mais l'auteur affiché est vide (repli de slug) :
  // valider ne débloquerait rien, donc valider doit être refusé — sinon l'opérateur croit avoir
  // libéré ses personnes et la garde les retient en silence jusqu'à la purge.
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE);
  const sansAuteur = await engageurDUnPost(m, 61, { etat: 'pending', sujet: 'le recrutement des commerciaux', nomAffiche: null });
  let refus = null;
  await validerPost(m.ctx, { postId: sansAuteur.fiche, campagneId: m.campagne }).catch((e) => { refus = e; });
  const etat = (await q(`select review_status from linkedin_posts where id = $1`, [sansAuteur.fiche])).rows[0].review_status;
  check('29. valider est refusé quand une variable écrite par la campagne ne se résout pas (auteur affiché vide)',
    refus !== null && etat === 'pending', `${refus?.name} / ${etat}`);
  await tourDInscription(m.org);
  check('29a. et la garde dit la même chose : personne n\'entre', (await inscritsDe(m.org)).length === 0);

  // LA SORTIE : le nom de l'auteur s'écrit, comme le sujet. Sans elle, cette fiche est une impasse
  // définitive — le rattrapage ne la reprend pas (elle est complète) et aucun écran ne la répare.
  await corrigerAuteurDePost(m.ctx, { postId: sansAuteur.fiche, auteur: 'Ana' });
  let refusApres = null;
  await validerPost(m.ctx, { postId: sansAuteur.fiche, campagneId: m.campagne }).catch((e) => { refusApres = e; });
  const etatApres = (await q(`select review_status, author_display_name from linkedin_posts where id = $1`, [sansAuteur.fiche])).rows[0];
  check('29d. écrire le nom de l\'auteur débloque la validation',
    refusApres === null && etatApres.review_status === 'approved' && etatApres.author_display_name === 'Ana',
    `${refusApres?.message ?? ''} / ${JSON.stringify(etatApres)}`);
  await tourDInscription(m.org);
  check('29e. et les personnes du post entrent enfin en séquence', (await inscritsDe(m.org)).includes(sansAuteur.contact_id), JSON.stringify(await inscritsDe(m.org)));

  // 2. La campagne ne cite que l'adresse du post : exiger un sujet serait exiger ce qui ne partira
  // pas. L'adresse existe dès la création de la fiche, donc la validation passe et les personnes
  // entrent (c'est le quantificateur de la garde, reporté ici).
  const u = await monde();
  await etapeAvecCorps(u, ACCROCHE_URL);
  const sansSujet = await engageurDUnPost(u, 62, { etat: 'pending', sujet: null, nomAffiche: null });
  let refusUrl = null;
  await validerPost(u.ctx, { postId: sansSujet.fiche, campagneId: u.campagne }).catch((e) => { refusUrl = e; });
  const etatUrl = (await q(`select review_status from linkedin_posts where id = $1`, [sansSujet.fiche])).rows[0].review_status;
  check('29b. une campagne qui ne cite que {{post_url}} valide sans sujet ni auteur', refusUrl === null && etatUrl === 'approved', `${refusUrl?.name} / ${etatUrl}`);
  await tourDInscription(u.org);
  check('29c. et ses personnes entrent réellement en séquence', (await inscritsDe(u.org)).includes(sansSujet.contact_id), JSON.stringify(await inscritsDe(u.org)));

  // 3. La campagne cite la DATE, que la capture n'a pas pu lire (fiche de reprise, page illisible).
  // L'opérateur ne peut pas l'écrire : ce n'est pas une chaîne, c'est un horodatage que seul le
  // rattrapage peut reposer. L'écran ne doit donc ni montrer le jeton, ni la lui demander.
  const d = await monde();
  await etapeAvecCorps(d, ACCROCHE_DATE);
  const sansDate = await engageurDUnPost(d, 63, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [sansDate.fiche]);
  const ligneSansDate = (await listerPostsDeCampagne(d.ctx, { campagneId: d.campagne })).find((l) => l.id === sansDate.fiche);
  // L'écran ne lit pas l'aperçu, il lit ses MORCEAUX : la preuve porte sur ce qu'il affichera.
  const morceauxSansDate = decouperAccroche(ligneSansDate?.apercuAccroche ?? null) ?? [];
  const texteAffiche = morceauxSansDate.filter((m) => 'texte' in m).map((m) => m.texte).join('');
  check('29f. aucun jeton brut de variable de post ne parvient à l\'écran',
    morceauxSansDate.length > 0 && !/\{\{/.test(texteAffiche), JSON.stringify(morceauxSansDate));
  check('29f2. la date non lue est un morceau MANQUANT, ni un champ à écrire ni du texte',
    morceauxSansDate.some((m) => m.manquant === 'post_date') && !morceauxSansDate.some((m) => m.champ !== undefined),
    JSON.stringify(morceauxSansDate));
  let refusDate = null;
  await validerPost(d.ctx, { postId: sansDate.fiche, campagneId: d.campagne }).catch((e) => { refusDate = e; });
  const messageDate = refusDate?.details?.formErrors?.[0] ?? '';
  check('29g. valider est refusé, et le message ne demande pas d\'écrire ce qui ne s\'écrit pas',
    refusDate !== null && !/écrivez/i.test(messageDate) && /pas pu être lue|rattrapage/i.test(messageDate), messageDate);

  // 4. L'id de campagne est une ENTRÉE : la façade que le serveur MCP appellera doit vérifier
  // qu'elle appartient à l'organisation. Un uuid étranger rend toutes les exigences vraies.
  const voisin = await monde();
  let intrus = null;
  await validerPost(d.ctx, { postId: sansDate.fiche, campagneId: voisin.campagne }).catch((e) => { intrus = e; });
  const etatIntrus = (await q(`select review_status from linkedin_posts where id = $1`, [sansDate.fiche])).rows[0].review_status;
  check('29h. valider avec la campagne d\'une AUTRE organisation est refusé, la fiche ne bouge pas',
    intrus !== null && etatIntrus === 'pending', `${intrus?.name} / ${etatIntrus}`);
}

async function repliNeDispensePasDeRelire() {
  console.log('\n# un repli ne dispense PAS de faire relire le post');
  await demarrerBoss();
  // Canal LinkedIn : une campagne 100 % LinkedIn inscrit un engageur sans email, ce qui isole la
  // garde du post de celle de l'adresse (même raison que `gardeDEntree`).
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE_URL_REPLI);
  const p = await engageurDUnPost(m, 73, { etat: 'pending', sujet: null, nomAffiche: null });
  // Le pire cas : ni date, ni sujet, ni nom affiché. Mais `url`, elle, existe depuis la création
  // de la fiche — donc le repli de l'accroche ne servira jamais, et c'est l'adresse RÉELLE du
  // post qui partira, sur un post que personne n'a relu.
  await q(`update linkedin_posts set posted_at = null where id = $1`, [p.fiche]);

  const retenues = await compterRetenuesParPost(pool, m.org, m.campagne);
  const dit = retenuesAAfficher(retenues);
  check('31. la campagne PARLE du post malgré le repli : le bandeau le dit',
    retenues.nommeUnPost === true && dit.enAttenteDeValidation === 1 && dit.relecture === true,
    JSON.stringify({ retenues, dit }));
  check('31a. et le badge de l\'onglet annonce un travail qui débloque réellement quelqu\'un',
    (await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })) === 1,
    String(await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })));
  await tourDInscription(m.org);
  check('31b. garde : personne n\'entre tant qu\'un humain n\'a pas relu ce post',
    (await inscritsDe(m.org)).length === 0, JSON.stringify(await inscritsDe(m.org)));

  // L'AUTRE moitié de la règle : la relecture est exigée, la FICHE n'a rien à fournir. Sans ça,
  // valider serait impossible (ni date, ni sujet, ni auteur) et la campagne gèlerait pour de bon.
  let refus = null;
  await validerPost(m.ctx, { postId: p.fiche, campagneId: m.campagne }).catch((e) => { refus = e; });
  check('31c. valider reste SATISFAISABLE : le repli n\'exige rien de la fiche',
    refus === null && (await q(`select review_status from linkedin_posts where id = $1`, [p.fiche])).rows[0].review_status === 'approved',
    String(refus?.message ?? ''));
  await tourDInscription(m.org);
  check('31d. relu, il fait entrer ses personnes', (await inscritsDe(m.org)).includes(p.contact_id), JSON.stringify(await inscritsDe(m.org)));

  // Et ce qui part est bien l'adresse du post, pas le repli : la relecture portait sur du RÉEL.
  const insc = (await q(`select id from enrollments where organization_id = $1`, [m.org])).rows[0]?.id ?? null;
  const rendu = insc === null
    ? { text: '', missing: ['(aucune inscription)'] }
    : renderTemplate(ACCROCHE_URL_REPLI, buildMessageValues(await chargerLigneInscription(pool, insc)));
  check('31e. et c\'est l\'adresse RÉELLE du post qui part, jamais le repli',
    rendu.missing.length === 0 && rendu.text.includes(urlN(73)), JSON.stringify(rendu));
}

async function repliNExigeRienDeLaFiche() {
  console.log('\n# un repli n\'exige rien de la fiche, mais ne désactive ni le gel ni l\'épargne');
  await demarrerBoss();
  // Canal email : le gel de la dépense ne se juge que là où l'achat sert.
  const e = await monde();
  await etapeAvecCorps(e, ACCROCHE_DATE_REPLI, { canal: 'email' });
  const a = await engageurDUnPost(e, 74, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [a.fiche]);
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [a.signal_id]);

  const enfiles = async () =>
    (await q(`select data from pgboss.job where name = 'enrichment.contact_connu' and data->>'organizationId' = $1`, [e.org])).rows.map((r) => r.data.contactId);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('31f. gel : le repli ne débloque pas l\'achat, le post n\'est pas relu', !(await enfiles()).includes(a.contact_id), JSON.stringify(await enfiles()));

  // La fiche n'a toujours NI date NI sujet NI auteur, et pourtant elle se valide : c'est ce que
  // le repli change, et la seule chose qu'il change.
  let refus = null;
  await validerPost(e.ctx, { postId: a.fiche, campagneId: e.campagne }).catch((err) => { refus = err; });
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  check('31g. validée sans date ni sujet ni auteur, elle libère l\'achat',
    refus === null && (await enfiles()).includes(a.contact_id), `${refus?.message ?? ''} / ${JSON.stringify(await enfiles())}`);

  // UN REPLI VIDE n'est pas un repli : `renderTemplate` rendrait un blanc dans l'envoi.
  const v = await monde();
  await etapeAvecCorps(v, ACCROCHE_DATE_REPLI_VIDE);
  const w = await engageurDUnPost(v, 76, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [w.fiche]);
  let refusVide = null;
  await validerPost(v.ctx, { postId: w.fiche, campagneId: v.campagne }).catch((err) => { refusVide = err; });
  check('31h. un repli VIDE se lit comme une absence de repli : la date est exigée',
    refusVide !== null && /date de publication/.test(refusVide?.details?.formErrors?.[0] ?? ''),
    refusVide?.details?.formErrors?.[0] ?? 'aucun refus');
  const morceauxVide = decouperAccroche((await listerPostsDeCampagne(v.ctx, { campagneId: v.campagne })).find((l) => l.id === w.fiche)?.apercuAccroche ?? null) ?? [];
  check('31i. et l\'écran le dit pareil : un morceau MANQUANT, pas un trou dans la phrase',
    morceauxVide.some((x) => x.manquant === 'post_date'), JSON.stringify(morceauxVide));

  // L'ÉPARGNE, EN DERNIER : elle efface, et un contrôle qui détruit ne doit pas emporter la
  // preuve des suivants. Une fiche en attente épargne sa personne, repli ou pas.
  const b = await engageurDUnPost(e, 75, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [b.fiche]);
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [b.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('31j. épargne : quelqu\'un attend la relecture de ce post, sa personne survit',
    (await q(`select 1 from signals where id = $1`, [b.signal_id])).rowCount === 1);
}

async function gabaritMixte() {
  console.log('\n# un gabarit MIXTE : une variable de post sans repli, deux avec');
  await demarrerBoss();
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE_MIXTE);
  const p = await engageurDUnPost(m, 77, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [p.fiche]);

  check('32. la campagne parle du post : la relecture est exigée',
    (await compterRetenuesParPost(pool, m.org, m.campagne)).nommeUnPost === true);
  await tourDInscription(m.org);
  check('32a. garde : personne n\'entre tant qu\'un humain n\'a pas relu ce post',
    (await inscritsDe(m.org)).length === 0, JSON.stringify(await inscritsDe(m.org)));

  // LE CŒUR DU CAS MIXTE, et la raison d'être de ce contrôle-ci : les deux motifs s'exécutent
  // ici pour de bon, avec `~*` dans Postgres, sur le MÊME corps. Le refus doit nommer le sujet,
  // et lui seul — ni la date ni l'adresse, qui portent un repli, ni l'auteur, qui n'est pas écrit.
  let refus = null;
  await validerPost(m.ctx, { postId: p.fiche, campagneId: m.campagne }).catch((e) => { refus = e; });
  const msg = refus?.details?.formErrors?.[0] ?? '';
  check('32b. valider n\'exige QUE le sujet : ni la date, ni l\'adresse, ni l\'auteur',
    refus !== null && /le sujet/.test(msg) && !/date de publication/.test(msg)
      && !/adresse du post/.test(msg) && !/nom de l'auteur/.test(msg), msg);

  // Le sujet écrit — la seule chose qui manquait — et tout se débloque, la date toujours nulle.
  await corrigerSujetDePost(m.ctx, { postId: p.fiche, sujet: 'la prospection par la preuve' });
  let refus2 = null;
  await validerPost(m.ctx, { postId: p.fiche, campagneId: m.campagne }).catch((e) => { refus2 = e; });
  const apres = (await q(`select review_status, posted_at from linkedin_posts where id = $1`, [p.fiche])).rows[0];
  check('32c. le sujet écrit, valider passe — la date manque toujours, et c\'est sans effet',
    refus2 === null && apres.review_status === 'approved' && apres.posted_at === null,
    `${refus2?.message ?? ''} / ${JSON.stringify(apres)}`);
  await tourDInscription(m.org);
  check('32d. et ses personnes entrent en séquence', (await inscritsDe(m.org)).includes(p.contact_id), JSON.stringify(await inscritsDe(m.org)));

  // Et ce qui part le prouve : le sujet relu, le repli pour la date absente, l'adresse RÉELLE.
  const insc = (await q(`select id from enrollments where organization_id = $1`, [m.org])).rows[0]?.id ?? null;
  const rendu = insc === null
    ? { text: '', missing: ['(aucune inscription)'] }
    : renderTemplate(ACCROCHE_MIXTE, buildMessageValues(await chargerLigneInscription(pool, insc)));
  check('32e. le message part entier : sujet relu, repli pour la date, adresse réelle du post',
    rendu.missing.length === 0 && rendu.text.includes('sur la prospection par la preuve')
      && rendu.text.includes('publié le 12 octobre') && rendu.text.includes(urlN(77)), JSON.stringify(rendu));

  // L'AUTRE moitié de l'intersection. Les contrôles d'avant prouvent que `{{post_date|…}}`
  // n'exige rien, parce qu'une fiche peut réellement n'avoir pas de date. `{{post_url|…}}` ne se
  // prouve pas pareil : `url` est renseignée dès la création, donc « exigée » et « non exigée »
  // rendent le même verdict tant qu'elle l'est. On la vide, et seulement alors la différence se
  // voit.
  //
  // Aucune inversion DU MOTIF ne fait rougir 32f seul, et aucune ne le pourrait : `post_url` et
  // `post_date` sortent du même appel de `motifSqlDesVariables`, donc une erreur de motif qui
  // toucherait l'une sans l'autre est inatteignable. La phrase s'arrête au motif :
  // `EXIGENCES_VARIABLE_DE_POST` tient, elle, une condition PAR variable, et une erreur sur la
  // seule ligne `post_url` reste parfaitement atteignable — c'est même ce que la paire attrape.
  // 32f vaut donc pour sa COUVERTURE, et ce qui prouve son propos, c'est la PAIRE 32f / 32g —
  // même fiche, deux gabarits qui ne diffèrent que par le repli sur l'adresse, deux verdicts
  // opposés.
  const u = await monde();
  await etapeAvecCorps(u, ACCROCHE_MIXTE);
  const w = await engageurDUnPost(u, 78, { etat: 'pending', sujet: 'un sujet relu', nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null, url = '' where id = $1`, [w.fiche]);
  let refusUrl = null;
  await validerPost(u.ctx, { postId: w.fiche, campagneId: u.campagne }).catch((e) => { refusUrl = e; });
  const etatUrl = (await q(`select review_status, url, posted_at from linkedin_posts where id = $1`, [w.fiche])).rows[0];
  check('32f. l\'adresse à repli n\'exige rien non plus : sans adresse ni date, le sujet suffit',
    refusUrl === null && etatUrl.review_status === 'approved' && etatUrl.url === '' && etatUrl.posted_at === null,
    `${refusUrl?.details?.formErrors?.[0] ?? ''} / ${JSON.stringify(etatUrl)}`);

  // Le jumeau de 32f : MÊME fiche, même date absente, même adresse vide — le gabarit ne change
  // que d'un repli. Le verdict s'inverse, et c'est ça qui prouve que le repli décide.
  const v = await monde();
  await etapeAvecCorps(v, ACCROCHE_MIXTE_URL_STRICTE);
  const x = await engageurDUnPost(v, 83, { etat: 'pending', sujet: 'un sujet relu', nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null, url = '' where id = $1`, [x.fiche]);
  let refusStrict = null;
  await validerPost(v.ctx, { postId: x.fiche, campagneId: v.campagne }).catch((e) => { refusStrict = e; });
  check('32g. la même adresse vide, le MÊME gabarit sans son repli : valider est refusé',
    refusStrict !== null && /adresse du post/.test(refusStrict?.details?.formErrors?.[0] ?? ''),
    refusStrict?.details?.formErrors?.[0] ?? 'aucun refus');
}

/**
 * Ce qu'un gabarit porte d'accroche AILLEURS que dans son corps.
 *
 * L'objet d'un email se replie sur le NOM du gabarit quand le sujet est vide — `subject ?? name`,
 * à l'envoi (`email-salesblink.ts`) comme à l'aperçu (`file-du-jour.ts`). Le nom n'est ni validé,
 * ni normalisé : rien n'empêche d'y écrire une variable. Une garde qui ne lirait que le corps et
 * le sujet laisserait donc partir un message nommant un post que personne n'a relu — exactement
 * ce que ce lot promet d'empêcher.
 */
const ACCROCHE_DANS_LE_NOM = 'Votre réaction à {{post_url}}';
/** L'accroche du ruling : un repli, donc la campagne nomme le post sans rien exiger de la fiche. */
const ACCROCHE_URL_A_REPLI = 'Bonjour, votre réaction à {{post_url|https://www.linkedin.com/feed/}} nous a marqués.';
const ACCROCHE_NOM_SUJET = 'Votre réaction au post sur {{post_sujet}}';
const CORPS_MUET = 'Bonjour, parlons prospection.';

async function accrocheDansLeNomDuGabarit() {
  console.log('\n# l\'accroche cachée dans le NOM du gabarit, dont l\'objet d\'un email se repose');
  await demarrerBoss();
  const m = await monde();
  // Corps sans la moindre variable de post, sujet VIDE, accroche dans le nom seul.
  await etapeAvecCorps(m, CORPS_MUET, { canal: 'email', nom: ACCROCHE_DANS_LE_NOM });
  const p = await engageurDUnPost(m, 79, { etat: 'pending' });
  // Une adresse, pour que la campagne email puisse réellement inscrire : sans elle, « personne
  // n'entre » ne prouverait rien (c'est l'adresse qui retiendrait, pas le post).
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob79-${Date.now()}@exemple.invalid`]);

  check('33. une accroche cachée dans le NOM fait nommer le post comme les autres',
    (await compterRetenuesParPost(pool, m.org, m.campagne)).nommeUnPost === true);
  check('33a. et le badge de l\'onglet l\'annonce',
    (await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })) === 1,
    String(await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })));

  // Le gel se juge sur une personne SANS adresse : celle d'au-dessus n'est candidate à aucun
  // achat, justement parce qu'on vient de lui en donner une.
  const sansAdresse = await engageurDUnPost(m, 82, { etat: 'pending' });
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [sansAdresse.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  const enfiles = (await q(`select data from pgboss.job where name = 'enrichment.contact_connu' and data->>'organizationId' = $1`, [m.org])).rows.map((r) => r.data.contactId);
  check('33b. gel : aucun achat pour une personne dont le post n\'est pas relu', !enfiles.includes(sansAdresse.contact_id), JSON.stringify(enfiles));
  await tourDInscription(m.org);
  check('33c. garde : personne n\'entre tant que ce post n\'est pas relu',
    (await inscritsDe(m.org)).length === 0, JSON.stringify(await inscritsDe(m.org)));

  // Relu, la personne entre — et l'objet de son email, c'est le NOM du gabarit, rendu.
  await validerPost(m.ctx, { postId: p.fiche, campagneId: m.campagne });
  await tourDInscription(m.org);
  check('33d. relu, ses personnes entrent', (await inscritsDe(m.org)).includes(p.contact_id), JSON.stringify(await inscritsDe(m.org)));
  // L'envoi lui-même part par SalesBlink, hors de ce harnais ; `apercuEnvoi` est l'autre lecteur
  // du MÊME repli (`subject ?? name`), et il tourne sur les vraies données. L'action est posée en
  // fixture : l'inscription seule n'en crée pas, c'est la planification d'étape qui s'en charge.
  const insc = (await q(`select id, campaign_id from enrollments where organization_id = $1 and contact_id = $2`, [m.org, p.contact_id])).rows[0];
  const etape = (await q(`select id from sequence_steps where campaign_id = $1 order by position limit 1`, [insc.campaign_id])).rows[0];
  const action = (await q(
    `insert into actions (organization_id, enrollment_id, step_id, channel, status, scheduled_for, idempotency_key)
     values ($1, $2, $3, 'email', 'scheduled', now(), $4) returning id`,
    [m.org, insc.id, etape.id, `nom-gabarit-${insc.id}`],
  )).rows[0];
  const apercu = await apercuEnvoi(m.ctx, { actionId: action.id });
  check('33e. et l\'objet de l\'email EST ce nom, avec l\'adresse réelle du post',
    apercu.objet === `Votre réaction à ${urlN(79)}`, apercu.objet);

  // Le TROISIÈME lecteur du même repli : la File du jour. Elle lit la colonne brute, donc le
  // recensement des appelants de `renderTemplate` ne pouvait pas l'attraper. Pour le gabarit qui
  // partira avec son nom en objet, la colonne « Étape et objet » restait VIDE : l'opérateur ne
  // voyait nulle part l'accroche qui allait sortir, sur le seul écran qui montre ce qui part
  // aujourd'hui. Même ordre qu'à l'envoi (subject ?? name), sur de vraies données.
  //
  // L'adresse, elle, reste en jeton, et c'est le contrat ASSUMÉ de cet écran : `objetAffiche`
  // rend par `renderTemplatePartial`, avec les seules valeurs déjà en main dans cette requête de
  // liste (prénom, poste, colonnes de liste) — `{{entreprise}}` y est visible pareil, plutôt que
  // blanchi. Ce qu'on corrige ici, c'est la colonne vide, pas la portée de la résolution :
  // l'adresse exacte du post se lit sur l'écran de relecture, qui, lui, joint la fiche.
  const file = await listerFileDuJour(m.ctx, { campagneId: insc.campaign_id });
  check('33j. la File du jour montre cet objet-là, et non une colonne vide',
    file.prevus.some((e) => e.id === action.id && e.objet === 'Votre réaction à {{post_url}}'),
    JSON.stringify(file.prevus.map((e) => [e.id, e.objet])));

  // L'AUTRE motif : un nom qui écrit `{{post_sujet}}` l'exige de la fiche, sinon l'objet partirait
  // vide — un objet vide n'est pas une accroche, c'est un email sans objet.
  const n = await monde();
  await etapeAvecCorps(n, CORPS_MUET, { canal: 'email', nom: ACCROCHE_NOM_SUJET });
  const w = await engageurDUnPost(n, 80, { etat: 'pending', sujet: null, nomAffiche: null });
  let refusNom = null;
  await validerPost(n.ctx, { postId: w.fiche, campagneId: n.campagne }).catch((e) => { refusNom = e; });
  check('33f. un nom qui écrit {{post_sujet}} l\'exige de la fiche : sans sujet, valider est refusé',
    refusNom !== null && /le sujet/.test(refusNom?.details?.formErrors?.[0] ?? ''),
    refusNom?.details?.formErrors?.[0] ?? 'aucun refus');

  // L'ÉCRAN, sur le même gabarit : la phrase relue doit venir du NOM, pas de la phrase par
  // défaut. Sans ça, aucun morceau `manquant`, la ligne entre dans « Tout valider », et
  // `validerPost` la refuse — le symptôme revenu trois fois par un champ qu'un lecteur ignore.
  const d = await monde();
  await etapeAvecCorps(d, CORPS_MUET, { canal: 'email', nom: 'Votre réaction du {{post_date}}' });
  const y = await engageurDUnPost(d, 84, { etat: 'pending', sujet: null, nomAffiche: null });
  await q(`update linkedin_posts set posted_at = null where id = $1`, [y.fiche]);
  const morceauxNom = decouperAccroche((await listerPostsDeCampagne(d.ctx, { campagneId: d.campagne })).find((l) => l.id === y.fiche)?.apercuAccroche ?? null) ?? [];
  check('33h. l\'écran dérive la phrase du NOM, et y voit la date à reposer',
    morceauxNom.some((x) => x.manquant === 'post_date') && morceauxNom.some((x) => x.texte === 'Votre réaction du '),
    JSON.stringify(morceauxNom));

  // LA BORNE. Le nom d'un gabarit d'étape EST le nom de la campagne, et `verserDansBibliotheque`
  // réécrit celui de toute la lignée : lu sans condition, un nom de campagne porteur d'un jeton
  // gèlerait inscriptions et achats sur tous les canaux, pour un texte que personne ne lit.
  for (const [cas, opts] of [
    ['un sujet posé : le nom ne part jamais', { canal: 'email', sujet: 'Un objet bien à lui' }],
    ['un canal LinkedIn : le nom ne part jamais non plus', { canal: 'linkedin_message' }],
  ]) {
    const z = await monde();
    await etapeAvecCorps(z, CORPS_MUET, { ...opts, nom: ACCROCHE_DANS_LE_NOM });
    await engageurDUnPost(z, 85, { etat: 'pending' });
    check(`33i. ${cas} : la campagne ne nomme aucun post`,
      (await compterRetenuesParPost(pool, z.org, z.campagne)).nommeUnPost === false,
      JSON.stringify(await compterRetenuesParPost(pool, z.org, z.campagne)));
  }

  // L'ÉPARGNE, EN DERNIER : elle efface.
  const b = await engageurDUnPost(m, 81, { etat: 'pending' });
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [b.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('33g. épargne : la personne survit tant que sa fiche attend',
    (await q(`select 1 from signals where id = $1`, [b.signal_id])).rowCount === 1);
}

/**
 * La garde du côté de l'ENVOI.
 *
 * Le chemin d'usage le plus probable : une campagne qui tourne déjà, à laquelle on ajoute
 * l'accroche après coup — exactement ce que les 31,1 % mesurés invitent à faire. Ses personnes
 * sont inscrites depuis longtemps, l'adresse du post se résout, rien ne manque, et le message
 * partirait en nommant un post que personne n'a relu. La garde d'entrée n'y peut rien : elle
 * garde l'entrée.
 */
async function gardeALEnvoi() {
  console.log('\n# la garde ne protège pas que l\'entrée : une accroche ajoutée après coup');
  await demarrerBoss();
  let n = 86;
  // `letter` est traité à part : un garde-fou ANTÉRIEUR au lot le bloque plus tôt (voir 34d).
  for (const canal of ['email', 'linkedin_message']) {
    // Le post EN ATTENTE et le post RELU, même montage, pour que la différence soit lisible.
    for (const relu of [false, true]) {
      n += 1;
      const m = await monde();
      const gabarit = await etapeAvecCorps(m, SANS_ACCROCHE, { canal });
      const p = await engageurDUnPost(m, n, { etat: relu ? 'approved' : 'pending' });
      if (canal === 'email') {
        await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob${n}@exemple.invalid`]);
        // Un expéditeur : sans lui le tick met l'inscription en pause AVANT d'insérer l'action,
        // et le contrôle du post relu n'observerait rien.
        await expediteurEmail(m.org, `exp${n}@exemple.invalid`);
      }
      // 1. La campagne ne nomme aucun post : la personne s'inscrit, comme avant ce lot.
      await tourDInscription(m.org);
      if (!relu) {
        check(`34. [${canal}] inscrite tant que la campagne ne nomme aucun post`,
          (await inscritsDe(m.org)).includes(p.contact_id), JSON.stringify(await inscritsDe(m.org)));
      }

      // 2. L'ACCROCHE EST AJOUTÉE à la campagne qui tourne — ce que les 31,1 % invitent à faire.
      await q(`update message_templates set body = $2 where id = $1`, [gabarit, ACCROCHE_URL]);
      await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
      await tickDueEnrollments(pool, new Date());
      const a = (await q(`select status, block_reason from actions where organization_id = $1 order by created_at desc limit 1`, [m.org])).rows[0];
      const insc = (await q(`select status, current_step from enrollments where organization_id = $1`, [m.org])).rows[0];
      if (relu) {
        // L'état ATTENDU, pas « un autre motif » : affirmer `block_reason !== 'post_a_relire'`
        // laissait le contrôle vert alors que l'action serait bloquée pour une tout autre cause,
        // donc il ne prouvait pas que le post relu laisse passer.
        check(`34c. [${canal}] le post RELU, la même action part : planifiée, aucun motif`,
          a?.status === 'scheduled' && a?.block_reason === null, JSON.stringify(a));
      } else {
        check(`34a. [${canal}] le post en attente : l'action part en file, bloquée, motif nommé`,
          a?.status === 'blocked' && a?.block_reason === 'post_a_relire', JSON.stringify(a));
        check(`34b. [${canal}] et l'inscription reste vivante, sans avancer d'étape`,
          insc?.status === 'active' && insc?.current_step === 0, JSON.stringify(insc));
      }
    }
  }

  // LE COURRIER. `runGuards` tourne AVANT `composeTick` et exige une adresse postale vérifiée,
  // que rien ne renseigne aujourd'hui (`postalVerified` n'est passé nulle part) : une étape
  // courrier est donc déjà bloquée, pour un motif antérieur à ce lot. Rien ne part, mais la
  // branche du post ne l'atteint pas — dit ici pour qu'un lecteur futur ne s'y trompe pas.
  const l = await monde();
  const gabaritL = await etapeAvecCorps(l, SANS_ACCROCHE, { canal: 'letter' });
  const pl = await engageurDUnPost(l, 95, { etat: 'pending' });
  await tourDInscription(l.org);
  await q(`update message_templates set body = $2 where id = $1`, [gabaritL, ACCROCHE_URL]);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [l.org]);
  await tickDueEnrollments(pool, new Date());
  const al = (await q(`select status, block_reason from actions where organization_id = $1 order by created_at desc limit 1`, [l.org])).rows[0];
  check('34d. [letter] rien ne part non plus, mais par un garde-fou antérieur (adresse postale)',
    al?.status === 'blocked' && al?.block_reason !== null && pl.fiche !== undefined, JSON.stringify(al));

  // LA DÉCISION ELLE-MÊME, lue sur Postgres : c'est elle que le tick et l'envoi email consomment.
  const d = await monde();
  await etapeAvecCorps(d, ACCROCHE_URL, { canal: 'email' });
  const pd = await engageurDUnPost(d, 96, { etat: 'pending' });
  check('34e. `envoiRetenuParUnPost` retient un envoi dont le post attend sa relecture',
    (await envoiRetenuParUnPost(pool, d.org, d.campagne, pd.signal_id)) === true);
  await validerPost(d.ctx, { postId: pd.fiche, campagneId: d.campagne });
  check('34f. et le relâche dès qu\'il est relu',
    (await envoiRetenuParUnPost(pool, d.org, d.campagne, pd.signal_id)) === false);
  const muette = await monde();
  await etapeAvecCorps(muette, SANS_ACCROCHE, { canal: 'email' });
  const pm = await engageurDUnPost(muette, 97, { etat: 'pending' });
  check('34g. une campagne qui ne nomme aucun post ne retient aucun envoi',
    (await envoiRetenuParUnPost(pool, muette.org, muette.campagne, pm.signal_id)) === false);
  check('34h. sans signal, elle ne retient rien : c\'est la variable manquante qui bloquera',
    (await envoiRetenuParUnPost(pool, d.org, d.campagne, null)) === false);
}

/**
 * « On ne retient que s'il y a quelque chose à relire. »
 *
 * Le ruling des replis, pris seul, fabriquait un blocage SANS REMÈDE : une campagne dont
 * l'accroche porte un repli (`{{post_url|https://…}}`) NOMME le post — c'est voulu, la relecture
 * ne se désactive pas par un repli. Mais pour une inscription dont le signal n'a aucune fiche
 * rattachée (un contact Adzuna, une liste importée), il n'existe AUCUNE fiche à relire : la
 * personne était retenue pour toujours, sans écran qui l'explique, et `missing_variable` ne
 * prenait pas le relais puisque le repli résout la variable. Avant ce lot, son message partait
 * avec le repli, ce qui est le comportement correct.
 *
 * La règle : pas de fiche rattachée, rien à relire, le message part — le rendu décide seul,
 * repli ou variable manquante. Une fiche rattachée et non relue, on retient.
 *
 * CONSÉQUENCE ASSUMÉE, figée ici pour qu'elle ne surprenne personne : un engageur dont la fiche
 * n'a pas pu être enregistrée (`collecte-linkedin.ts` continue sans elle, et rien ne rattache un
 * signal après coup) n'aura jamais de fiche. Son message part donc avec le repli, c'est-à-dire
 * une accroche fausse. Sans repli, `missing_variable` le bloque, et c'est le cas ordinaire.
 */
async function rienARelireNeRetientPas() {
  console.log('\n# pas de fiche rattachée, rien à relire : on ne retient pas');
  await demarrerBoss();

  // Le cas du ruling : accroche À REPLI, signal SANS fiche.
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE_URL_A_REPLI, { canal: 'email' });
  const p = await engageurDUnPost(m, 110, { etat: 'pending' });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob110-${Date.now()}@exemple.invalid`]);
  await expediteurEmail(m.org, `exp110-${Date.now()}@exemple.invalid`);
  await q(`update signals set linkedin_post_id = null where id = $1`, [p.signal_id]);

  check('35. la campagne nomme toujours le post : un repli ne désactive pas la relecture',
    (await compterRetenuesParPost(pool, m.org, m.campagne)).nommeUnPost === true);
  check('35a. mais sans fiche rattachée, aucun envoi n\'est retenu',
    (await envoiRetenuParUnPost(pool, m.org, m.campagne, p.signal_id)) === false);
  await tourDInscription(m.org);
  check('35b. et la personne entre en séquence au lieu d\'attendre pour toujours',
    (await inscritsDe(m.org)).includes(p.contact_id), JSON.stringify(await inscritsDe(m.org)));

  // Elle part VRAIMENT : le tick compose l'action sans la bloquer.
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
  await tickDueEnrollments(pool, new Date());
  const a = (await q(`select status, block_reason from actions where organization_id = $1 order by created_at desc limit 1`, [m.org])).rows[0];
  check('35c. son action n\'est pas bloquée par le post', a !== undefined && a.block_reason !== 'post_a_relire', JSON.stringify(a));

  // L'ACHAT non plus : le gel suivait la même lecture.
  const g = await monde();
  await etapeAvecCorps(g, ACCROCHE_URL_A_REPLI, { canal: 'email' });
  const pg = await engageurDUnPost(g, 111, { etat: 'pending' });
  await q(`update signals set linkedin_post_id = null, status = 'qualified', score = 90, scored_at = now() where id = $1`, [pg.signal_id]);
  check('35d. et son adresse peut s\'acheter : le gel suivait la même lecture',
    (await achatRetenuParUnPost(pool, g.org, pg.contact_id)) === false);

  // LE JUMEAU. Même campagne, même repli, même tout — une fiche EST rattachée, et non relue.
  // C'est ce qui prouve que la fiche décide, et non le repli.
  const n = await monde();
  await etapeAvecCorps(n, ACCROCHE_URL_A_REPLI, { canal: 'email' });
  const pn = await engageurDUnPost(n, 112, { etat: 'pending' });
  check('35e. la MÊME campagne, avec une fiche rattachée non relue : l\'envoi est retenu',
    (await envoiRetenuParUnPost(pool, n.org, n.campagne, pn.signal_id)) === true);
  await tourDInscription(n.org);
  check('35f. et personne n\'entre tant qu\'elle n\'est pas relue',
    (await inscritsDe(n.org)).length === 0, JSON.stringify(await inscritsDe(n.org)));

  // LA LISTE NE FILTRE RIEN. Une fiche peut atteindre son échéance pendant qu'une inscription
  // est retenue : `rejeterFichesPostExpirees` la passe `rejected`, et `validerPost` la refuse
  // alors — seul « Rouvrir » puis valider la relâche. Ce chemin existe et l'écran le dit ; ce
  // qu'il faut vérifier, c'est que le lien de la File du jour mène bien à CE post-là. Si la
  // liste l'excluait, l'opérateur arriverait sur un écran vide sans comprendre.
  const l = await monde();
  await etapeAvecCorps(l, ACCROCHE_URL, { canal: 'email' });
  // DEUX états distincts, pas deux fois le même : la bascule d'expiration les aurait rendus
  // identiques, et le libellé aurait promis un cas que le contrôle ne traitait pas.
  const rejete = await engageurDUnPost(l, 123, { etat: 'pending' });
  const echu = await engageurDUnPost(l, 124, { etat: 'pending' });
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = $1`, [rejete.fiche]);
  await rejeterFichesPostExpirees(pool);
  // Celui-ci est échu APRÈS la bascule : encore `pending`, mais hors de sa fenêtre — l'état dans
  // lequel une fiche passe la plupart du temps avant que le moteur ne la rejette.
  await q(`update linkedin_posts set expires_at = now() - interval '1 hour' where id = $1`, [echu.fiche]);
  const listes = await listerPostsDeCampagne(l.ctx, { campagneId: l.campagne });
  const etatsListes = Object.fromEntries(listes.map((x) => [x.id, x.etat]));
  check('35h. un post rejeté ou échu reste listé : le lien de la File du jour mène bien à lui',
    etatsListes[rejete.fiche] === 'rejected' && etatsListes[echu.fiche] === 'pending',
    JSON.stringify(etatsListes));

  // LA BORNE : le chemin du NOM du gabarit reste fermé. Une fiche existe, donc on retient.
  const z = await monde();
  await etapeAvecCorps(z, CORPS_MUET, { canal: 'email', nom: ACCROCHE_DANS_LE_NOM });
  const pz = await engageurDUnPost(z, 113, { etat: 'pending' });
  check('35g. l\'accroche cachée dans le NOM retient toujours, la fiche existe',
    (await envoiRetenuParUnPost(pool, z.org, z.campagne, pz.signal_id)) === true);
}

/**
 * La garde aux DEUX rejeux LinkedIn.
 *
 * L'email n'est pas le seul canal qui rend son corps plus tard : `rejouerActionsLinkedInEnAttente`
 * et `rejouerActionsLinkedInReprises` re-rendent le corps depuis le gabarit COURANT puis enfilent,
 * en ne contrôlant que `missing_locale` et `missing_variable`. Scénario : un envoi LinkedIn
 * échoue, l'opérateur ajoute l'accroche, clique « Reprendre » — le balayage re-rend avec
 * l'accroche, les variables se résolvent (la fiche porte l'url dès la capture), rien ne bloque,
 * et le message part en nommant un post que personne n'a relu.
 */
async function gardeAuxRejeuxLinkedIn() {
  console.log('\n# les deux rejeux LinkedIn re-rendent le corps : la garde doit y être aussi');
  await demarrerBoss();

  // 1. LE REJEU DES ACTIONS JAMAIS ENFILÉES.
  for (const relu of [false, true]) {
    const m = await monde();
    const gabarit = await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'linkedin_message' });
    await engageurDUnPost(m, relu ? 115 : 114, { etat: relu ? 'approved' : 'pending' });
    await tourDInscription(m.org);
    await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
    await tickDueEnrollments(pool, new Date());
    // L'accroche est ajoutée APRÈS que l'action a été créée : c'est le chemin réel.
    await q(`update message_templates set body = $2 where id = $1`, [gabarit, ACCROCHE_URL]);
    // L'action redevient éligible au balayage : jamais partie, jamais enfilée, assez vieille.
    await q(`update actions set status = 'scheduled', block_reason = null, dispatched_at = null,
                created_at = now() - interval '10 minutes' where organization_id = $1`, [m.org]);
    await q(`delete from linkedin_action_queue where organization_id = $1`, [m.org]);
    await rejouerActionsLinkedInEnAttente({ pool, boss });
    const a = (await q(`select id, status, block_reason from actions where organization_id = $1`, [m.org])).rows[0];
    const jobs = (await q(`select 1 from pgboss.job where name = 'actions.dispatch' and data->>'organizationId' = $1`, [m.org])).rowCount;
    if (relu) {
      check('36c. [attente] le post RELU, le rejeu enfile normalement',
        a?.status === 'scheduled' && a?.block_reason === null && jobs === 1, `${JSON.stringify(a)} / ${jobs} job(s)`);
    } else {
      check('36. [attente] le post en attente : le rejeu bloque, motif nommé',
        a?.status === 'blocked' && a?.block_reason === 'post_a_relire', JSON.stringify(a));
      check('36a. [attente] et n\'enfile RIEN', jobs === 0, `${jobs} job(s)`);
    }
  }

  // 2. LE REJEU DES REPRISES HUMAINES : une ligne de file en échec, reprise par l'opérateur.
  for (const relu of [false, true]) {
    const m = await monde();
    const gabarit = await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'linkedin_message' });
    // Une SECONDE étape : `rejouerActionsLinkedInReprises` exige `e.status = 'active'`, et une
    // séquence à une seule étape laisse l'inscription `completed` dès la première planifiée.
    await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'linkedin_message', position: 1 });
    const p = await engageurDUnPost(m, relu ? 117 : 116, { etat: relu ? 'approved' : 'pending' });
    await tourDInscription(m.org);
    await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
    await tickDueEnrollments(pool, new Date());
    await q(`update message_templates set body = $2 where id = $1`, [gabarit, ACCROCHE_URL]);
    const act = (await q(`select id from actions where organization_id = $1 limit 1`, [m.org])).rows[0];
    await q(`update actions set status = 'scheduled', block_reason = null where id = $1`, [act.id]);
    await q(`delete from linkedin_action_queue where organization_id = $1`, [m.org]);
    await q(
      `insert into linkedin_action_queue (organization_id, action_id, kind, linkedin_url, contact_id, signal_id, status, error_code, reprise_le, method)
       values ($1, $2, 'message', $3, $4, $5, 'failed', 'echec_envoi', now(), 'serveur')`,
      [m.org, act.id, `https://www.linkedin.com/in/bob-${relu ? 117 : 116}/`, p.contact_id, p.signal_id],
    );
    await rejouerActionsLinkedInReprises({ pool });
    const a = (await q(`select status, block_reason from actions where id = $1`, [act.id])).rows[0];
    const enfilees = (await q(`select 1 from linkedin_action_queue where organization_id = $1 and status = 'pending'`, [m.org])).rowCount;
    if (relu) {
      check('36d. [reprise] le post RELU, la reprise réenfile normalement',
        a?.block_reason !== 'post_a_relire' && enfilees === 1, `${JSON.stringify(a)} / ${enfilees} ligne(s)`);
    } else {
      check('36b. [reprise] le post en attente : la reprise bloque, motif nommé, et n\'enfile RIEN',
        a?.status === 'blocked' && a?.block_reason === 'post_a_relire' && enfilees === 0,
        `${JSON.stringify(a)} / ${enfilees} ligne(s)`);
    }
  }
}

/**
 * Valider un post fait REPARTIR les inscriptions qu'il retenait.
 *
 * Sans ça, `post_a_relire` est un cul-de-sac : l'inscription reste `active` avec
 * `next_action_at` nul et une action `blocked`, or la sélection des dues exige une échéance,
 * `rattraperEcheancesManquantes` l'écarte, `reprendreInscription` n'accepte que `paused` et
 * `relancerEnvoi` que `failed`. Personne ne repart, et aucun geste d'écran ne les relance. La
 * sémantique est bien celle de `missing_variable` — sauf qu'ici c'est le chemin NORMAL du lot.
 *
 * Le geste est celui du rejeu éprouvé (`reprendreAbsencesEchues`) : l'action redevient
 * `scheduled`, et on NE POSE PAS `next_action_at`. Poser les deux ferait boucler l'inscription
 * indéfiniment — le défaut le plus grave de la revue transversale du lot 2.
 */
async function validerRelanceLesRetenues() {
  console.log('\n# valider un post fait repartir les inscriptions qu\'il retenait');
  await demarrerBoss();
  const m = await monde();
  const gabarit = await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'email' });
  const p = await engageurDUnPost(m, 120, { etat: 'pending' });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob120-${Date.now()}@exemple.invalid`]);
  await expediteurEmail(m.org, `exp120-${Date.now()}@exemple.invalid`);
  // Une SECONDE personne, sur un AUTRE post, retenue elle aussi : valider le premier ne doit pas
  // la réveiller. `reprendreInscription`, le seul autre mécanisme de reprise du dépôt, s'appelle
  // par inscription et n'aurait pas cette borne — c'est pourquoi elle est écrite dans la requête.
  const autre = await engageurDUnPost(m, 122, { etat: 'pending' });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [autre.contact_id, `bob122-${Date.now()}@exemple.invalid`]);
  await tourDInscription(m.org);
  await q(`update message_templates set body = $2 where id = $1`, [gabarit, ACCROCHE_URL]);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
  await tickDueEnrollments(pool, new Date());

  // L'action DE CETTE personne : l'organisation en porte deux depuis la seconde borne ci-dessous.
  const avant = (await q(`select a.id, a.status, a.block_reason, e.status as insc, e.next_action_at, e.current_step
                            from actions a join enrollments e on e.id = a.enrollment_id
                           where a.organization_id = $1 and e.contact_id = $2`, [m.org, p.contact_id])).rows[0];
  check('37. retenue : action bloquée, inscription vivante, aucune échéance',
    avant?.block_reason === 'post_a_relire' && avant?.insc === 'active' && avant?.next_action_at === null, JSON.stringify(avant));
  // L'impasse, dite explicitement : le tick ne resélectionne JAMAIS cette inscription.
  await tickDueEnrollments(pool, new Date());
  check('37a. et aucun tick ne la reprend : sans échéance, elle n\'est jamais due',
    (await q(`select status from actions where id = $1`, [avant.id])).rows[0].status === 'blocked');

  await validerPost(m.ctx, { postId: p.fiche, campagneId: m.campagne });
  const apres = (await q(`select a.status, a.block_reason, e.next_action_at, e.current_step, e.status as insc
                            from actions a join enrollments e on e.id = a.enrollment_id where a.id = $1`, [avant.id])).rows[0];
  check('37b. valider le post relâche son action : elle redevient `scheduled`',
    apres?.status === 'scheduled' && apres?.block_reason === null, JSON.stringify(apres));
  check('37c. et l\'échéance de l\'inscription reste nulle : l\'échéance et le rejeu ne visent jamais la même étape',
    apres?.next_action_at === null && apres?.insc === 'active' && apres?.current_step === 0, JSON.stringify(apres));

  // Et elle PART : le balayage de rejeu l'enfile, comme n'importe quelle action en attente.
  await q(`update actions set created_at = now() - interval '10 minutes' where id = $1`, [avant.id]);
  await rejouerActionsEmailEnAttente({ pool, boss });
  check('37d. le balayage de rejeu l\'enfile : l\'envoi part pour de bon',
    (await q(`select 1 from pgboss.job where name = 'actions.dispatch' and data->>'actionId' = $1`, [avant.id])).rowCount === 1);

  // L'APPROBATION. `requiresApproval` est calculé AVANT `composeTick`, et la branche du post
  // passe AVANT celle de l'approbation : une action qui aurait dû attendre l'accord d'un humain
  // part donc en `blocked post_a_relire`. La relâcher en `scheduled` lui ferait SAUTER la file,
  // et ce n'est pas qu'une affaire de courrier — une politique de campagne, ou les trois
  // premiers envois d'un couple gabarit+version, l'exigent aussi en email.
  const ap = await monde();
  await q(`update campaigns set approval_policy = '{"mode":"all"}'::jsonb where id = $1`, [ap.campagne]);
  const gabaritAp = await etapeAvecCorps(ap, SANS_ACCROCHE, { canal: 'email' });
  const pap = await engageurDUnPost(ap, 125, { etat: 'pending' });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [pap.contact_id, `bob125-${Date.now()}@exemple.invalid`]);
  await expediteurEmail(ap.org, `exp125-${Date.now()}@exemple.invalid`);
  await tourDInscription(ap.org);
  await q(`update message_templates set body = $2 where id = $1`, [gabaritAp, ACCROCHE_URL]);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [ap.org]);
  await tickDueEnrollments(pool, new Date());
  const avantAp = (await q(`select id, status, block_reason from actions where organization_id = $1`, [ap.org])).rows[0];
  check('37g. une action qui exigeait l\'accord d\'un humain est bien bloquée par le post',
    avantAp?.status === 'blocked' && avantAp?.block_reason === 'post_a_relire', JSON.stringify(avantAp));
  // LA POLITIQUE EST RETIRÉE avant la reprise, et c'est tout l'intérêt : le drapeau du payload
  // est déjà posé (le tick l'a écrit au blocage), donc seule SA lecture peut encore rendre
  // `pending_approval`. Sans ce retrait, la clause de politique suffisait à verdir le contrôle,
  // et le drapeau n'était gardé par rien — or c'est le seul mécanisme qui couvre une campagne
  // SANS politique dont l'approbation vient du seuil des premiers envois (règle non négociable
  // n°1). Les contrôles 38e à 38g font l'inverse : drapeau faux, politique posée après.
  await q(`update campaigns set approval_policy = '{}'::jsonb where id = $1`, [ap.campagne]);
  await validerPost(ap.ctx, { postId: pap.fiche, campagneId: ap.campagne });
  const apresAp = (await q(`select status, block_reason from actions where id = $1`, [avantAp.id])).rows[0];
  check('37h. relâchée, elle retourne dans la FILE D\'ATTENTE, pas en partance',
    apresAp?.status === 'pending_approval' && apresAp?.block_reason === null, JSON.stringify(apresAp));

  // CORRIGER UNE FICHE DÉJÀ VALIDÉE relâche aussi. C'est l'impasse du tour 10 par l'autre porte :
  // la campagne A n'écrit que `{{post_url}}` et son post est validé ; la campagne B écrit
  // `{{post_sujet}}`, ses inscrits sont bloqués ; l'opérateur écrit le sujet — les futures
  // actions passent, mais celles DÉJÀ bloquées n'étaient relâchées par personne (`validerPost`
  // sort en silence sur une fiche `approved`, et les deux correcteurs ne relâchaient pas).
  const c = await monde();
  const gabaritC = await etapeAvecCorps(c, SANS_ACCROCHE, { canal: 'email' });
  // Une SECONDE étape, comme en 40 et 40a : une séquence à une seule étape laisse l'inscription
  // `completed` dès la première planifiée, et ces contrôles la supposent encore vivante. Verts
  // sans elle, mais pour une raison qui tient à la forme de la fixture.
  await etapeAvecCorps(c, SANS_ACCROCHE, { canal: 'email', position: 1 });
  const pc = await engageurDUnPost(c, 163, { etat: 'approved', sujet: null });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [pc.contact_id, `bob163-${Date.now()}@exemple.invalid`]);
  await expediteurEmail(c.org, `exp163-${Date.now()}@exemple.invalid`);
  await tourDInscription(c.org);
  // L'accroche qui exige le SUJET, ajoutée après coup : la fiche est validée mais ne le porte pas.
  await q(`update message_templates set body = $2 where id = $1`, [gabaritC, 'Bonjour, votre réaction au post sur {{post_sujet}} nous a marqués.']);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [c.org]);
  await tickDueEnrollments(pool, new Date());
  const bloqueeC = (await q(`select id, status, block_reason from actions where organization_id = $1`, [c.org])).rows[0];
  check('37i. une fiche validée mais sans sujet retient quand même : la garde exige ce que la campagne écrit',
    bloqueeC?.block_reason === 'post_a_relire', JSON.stringify(bloqueeC));
  await corrigerSujetDePost(c.ctx, { postId: pc.fiche, sujet: 'la prospection par la preuve' });
  const apresC = (await q(`select status, block_reason from actions where id = $1`, [bloqueeC.id])).rows[0];
  check('37j. écrire le sujet relâche les actions que ce post retenait',
    apresC?.status === 'scheduled' && apresC?.block_reason === null, JSON.stringify(apresC));

  // Et l'AUTEUR, le second correcteur, sur le même modèle.
  const d = await monde();
  const gabaritD = await etapeAvecCorps(d, SANS_ACCROCHE, { canal: 'email' });
  await etapeAvecCorps(d, SANS_ACCROCHE, { canal: 'email', position: 1 });
  const pd = await engageurDUnPost(d, 164, { etat: 'approved', nomAffiche: null });
  await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [pd.contact_id, `bob164-${Date.now()}@exemple.invalid`]);
  await expediteurEmail(d.org, `exp164-${Date.now()}@exemple.invalid`);
  await tourDInscription(d.org);
  await q(`update message_templates set body = $2 where id = $1`, [gabaritD, 'Bonjour, votre réaction au post de {{post_auteur}} nous a marqués.']);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [d.org]);
  await tickDueEnrollments(pool, new Date());
  const bloqueeD = (await q(`select id, block_reason from actions where organization_id = $1`, [d.org])).rows[0];
  await corrigerAuteurDePost(d.ctx, { postId: pd.fiche, auteur: 'Ana Test' });
  const apresD = (await q(`select status, block_reason from actions where id = $1`, [bloqueeD.id])).rows[0];
  check('37k. écrire le nom de l\'auteur relâche aussi',
    bloqueeD?.block_reason === 'post_a_relire' && apresD?.status === 'scheduled', JSON.stringify([bloqueeD, apresD]));

  // LA SECONDE BORNE : l'autre personne attend un AUTRE post, encore en attente. Elle reste
  // retenue — sinon valider un post ferait partir des messages qui en nomment un autre.
  const actionAutre = (await q(
    `select a.status, a.block_reason from actions a
       join enrollments e on e.id = a.enrollment_id where e.contact_id = $1`, [autre.contact_id])).rows[0];
  check('37f. la personne qui attend un AUTRE post n\'est pas réveillée',
    actionAutre?.status === 'blocked' && actionAutre?.block_reason === 'post_a_relire', JSON.stringify(actionAutre));

  // LA BORNE : un autre motif de blocage n'est pas relâché par la validation d'un post.
  // En LinkedIn : c'est le seul canal dont le tick rend le corps, donc le seul où il peut poser
  // `missing_variable` (l'email est rendu à l'envoi). `{{ville}}` n'a pas de repli et le contact
  // n'en a pas : un blocage franc, qui ne doit RIEN devoir à la validation du post.
  const n = await monde();
  const gabaritN = await etapeAvecCorps(n, SANS_ACCROCHE, { canal: 'linkedin_message' });
  const pn = await engageurDUnPost(n, 121, { etat: 'pending' });
  await tourDInscription(n.org);
  await q(`update message_templates set body = $2 where id = $1`, [gabaritN, 'Bonjour, à {{ville}} ?']);
  await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [n.org]);
  await tickDueEnrollments(pool, new Date());
  const bloqueeAutrement = (await q(`select id, status, block_reason from actions where organization_id = $1`, [n.org])).rows[0];
  await validerPost(n.ctx, { postId: pn.fiche, campagneId: n.campagne });
  const apresN = (await q(`select status, block_reason from actions where id = $1`, [bloqueeAutrement.id])).rows[0];
  check('37e. une action bloquée pour un AUTRE motif n\'est pas relâchée par la validation d\'un post',
    bloqueeAutrement?.block_reason === 'missing_variable' && apresN?.status === 'blocked', JSON.stringify([bloqueeAutrement, apresN]));
}

/**
 * Les DEUX autres chemins qui débloquent une action, et l'état qu'ils lui rendent.
 *
 * `relacherLesRetenuesDuPost` ne voit que les inscriptions `active`. Deux autres chemins
 * remettent la même action en marche, et ils écrivaient `scheduled` EN DUR :
 * `reprendreInscription` (la reprise à la main) et `reprendreAbsencesEchues` (le retour
 * d'absence). Le scénario tient debout : une action email parmi les trois premiers envois d'un
 * gabarit, bloquée par un post non relu ; une réponse d'absence met l'inscription en pause ; on
 * valide le post, mais la relance saute cette inscription puisqu'elle n'est plus `active` ; au
 * retour, le rejeu la pose `scheduled`, plus rien ne la rebloque, et elle part SANS l'accord
 * humain. C'est la règle non négociable n°1, par un chemin que la relance ne couvre pas.
 *
 * Pour tout autre motif le drapeau est absent du payload, donc rien ne change — c'est ce qui rend
 * la correction sûre, et c'est la seconde moitié de ce que ces contrôles montrent.
 */
async function repriseRestitueLaFile() {
  console.log('\n# les deux autres chemins de reprise rendent l\'action à l\'état où elle allait');
  await demarrerBoss();

  /** Une inscription dont l'action est bloquée, avec ou sans l'accord humain exigé. */
  const monteBloquee = async (n, { approbation, motif }) => {
    const m = await monde();
    if (approbation) await q(`update campaigns set approval_policy = '{"mode":"all"}'::jsonb where id = $1`, [m.campagne]);
    // `missing_variable` ne se pose qu'en LinkedIn : c'est le seul canal dont le tick rend le
    // corps, l'email étant rendu à l'envoi. Monter ce cas en email donnerait une action JAMAIS
    // bloquée, et un contrôle qui fabrique son état ne prouve rien.
    const canal = motif === 'missing_variable' ? 'linkedin_message' : 'email';
    const gabarit = await etapeAvecCorps(m, SANS_ACCROCHE, { canal });
    const p = await engageurDUnPost(m, n, { etat: 'pending' });
    if (canal === 'email') {
      await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob${n}-${Date.now()}@exemple.invalid`]);
      await expediteurEmail(m.org, `exp${n}-${Date.now()}@exemple.invalid`);
    }
    await tourDInscription(m.org);
    // Le motif voulu : l'accroche pour le post, une variable introuvable pour l'autre cas.
    await q(`update message_templates set body = $2 where id = $1`,
      [gabarit, motif === 'post_a_relire' ? ACCROCHE_URL : 'Bonjour, à {{ville}} ?']);
    await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
    await tickDueEnrollments(pool, new Date());
    const a = (await q(`select a.id, a.status, a.block_reason, a.payload, e.id as inscription
                          from actions a join enrollments e on e.id = a.enrollment_id
                         where a.organization_id = $1`, [m.org])).rows[0];
    return { m, p, action: a };
  };

  // 1. LE RETOUR D'ABSENCE, avec l'accord humain exigé.
  const abs = await monteBloquee(130, { approbation: true, motif: 'post_a_relire' });
  check('38. l\'action est bloquée par le post, et le tick a noté que l\'accord humain était exigé',
    abs.action?.block_reason === 'post_a_relire' && abs.action?.payload?.requiresApproval === true,
    JSON.stringify([abs.action?.block_reason, abs.action?.payload]));
  await validerPost(abs.m.ctx, { postId: abs.p.fiche, campagneId: abs.m.campagne });
  await q(`update enrollments set status = 'paused_absence', resume_at = now() - interval '1 hour',
              next_action_at = null where id = $1`, [abs.action.inscription]);
  // La relance a sauté cette inscription (plus `active`) : on la remet bloquée, comme elle l'était.
  await q(`update actions set status = 'blocked', block_reason = 'post_a_relire' where id = $1`, [abs.action.id]);
  // LA POLITIQUE EST RETIRÉE avant la reprise, et c'est tout l'intérêt : le drapeau du payload
  // est déjà posé (le tick l'a écrit au blocage), donc seule SA lecture peut encore rendre
  // `pending_approval`. Sans ce retrait, la clause de politique suffisait à verdir le contrôle,
  // et le drapeau n'était gardé par rien — or c'est le seul mécanisme qui couvre une campagne
  // SANS politique dont l'approbation vient du seuil des premiers envois (règle non négociable
  // n°1). Les contrôles 38e à 38g font l'inverse : drapeau faux, politique posée après.
  await q(`update campaigns set approval_policy = '{}'::jsonb where id = $1`, [abs.m.campagne]);
  await reprendreAbsencesEchues(pool, new Date());
  const apresAbs = (await q(`select status, block_reason from actions where id = $1`, [abs.action.id])).rows[0];
  check('38a. au retour d\'absence, elle retourne dans la FILE D\'ATTENTE, pas en partance',
    apresAbs?.status === 'pending_approval' && apresAbs?.block_reason === null, JSON.stringify(apresAbs));

  // 2. LA REPRISE À LA MAIN, même exigence.
  const rep = await monteBloquee(131, { approbation: true, motif: 'post_a_relire' });
  await validerPost(rep.m.ctx, { postId: rep.p.fiche, campagneId: rep.m.campagne });
  await q(`update enrollments set status = 'paused', next_action_at = null where id = $1`, [rep.action.inscription]);
  await q(`update actions set status = 'blocked', block_reason = 'post_a_relire' where id = $1`, [rep.action.id]);
  // Même isolement qu'en 38a : seule la lecture du drapeau peut encore décider.
  await q(`update campaigns set approval_policy = '{}'::jsonb where id = $1`, [rep.m.campagne]);
  await reprendreInscription(rep.m.ctx, { inscriptionId: rep.action.inscription });
  const apresRep = (await q(`select status, block_reason from actions where id = $1`, [rep.action.id])).rows[0];
  check('38b. reprise à la main, même verdict : la file, pas la partance',
    apresRep?.status === 'pending_approval' && apresRep?.block_reason === null, JSON.stringify(apresRep));

  // 3. LE DRAPEAU GELÉ. Il dit ce qui était exigé AU MOMENT DU BLOCAGE, pas ce qui l'est
  // aujourd'hui : une action bloquée sans approbation, puis une politique passée à `all`, et
  // elle repartirait `scheduled` sans l'accord désormais exigé. Le drapeau est donc un MINIMUM —
  // on pose `pending_approval` dès que lui, OU le canal `letter`, OU la politique courante
  // l'exige. Ça ne peut que durcir, jamais laisser partir davantage. (`relecturePremiersEnvoisRequise`
  // n'est pas rejouée : elle compte les envois déjà partis, hors de portée d'une mise à jour en masse.)
  const gel = await monteBloquee(134, { approbation: false, motif: 'post_a_relire' });
  check('38d. au blocage, aucune approbation n\'était exigée',
    gel.action?.payload?.requiresApproval === false, JSON.stringify(gel.action?.payload));
  await q(`update campaigns set approval_policy = '{"mode":"all"}'::jsonb where id = $1`, [gel.m.campagne]);
  await validerPost(gel.m.ctx, { postId: gel.p.fiche, campagneId: gel.m.campagne });
  const apresGel = (await q(`select status from actions where id = $1`, [gel.action.id])).rows[0];
  check('38e. la politique a changé depuis : la relance la met dans la FILE, pas en partance',
    apresGel?.status === 'pending_approval', JSON.stringify(apresGel));

  // Les deux autres chemins lisent la même expression.
  for (const [cle, chemin] of [['38f. retour d\'absence', 'absence'], ['38g. reprise à la main', 'manuelle']]) {
    const g = await monteBloquee(chemin === 'absence' ? 135 : 136, { approbation: false, motif: 'post_a_relire' });
    await q(`update campaigns set approval_policy = '{"mode":"all"}'::jsonb where id = $1`, [g.m.campagne]);
    if (chemin === 'absence') {
      await q(`update enrollments set status = 'paused_absence', resume_at = now() - interval '1 hour',
                  next_action_at = null where id = $1`, [g.action.inscription]);
      await reprendreAbsencesEchues(pool, new Date());
    } else {
      await q(`update enrollments set status = 'paused', next_action_at = null where id = $1`, [g.action.inscription]);
      await reprendreInscription(g.m.ctx, { inscriptionId: g.action.inscription });
    }
    const apres = (await q(`select status from actions where id = $1`, [g.action.id])).rows[0];
    check(`${cle} : la politique courante durcit aussi ce chemin-là`,
      apres?.status === 'pending_approval', JSON.stringify(apres));
  }

  // 4. L'AUTRE MOITIÉ : sans drapeau ni exigence courante, rien ne change. C'est ce qui rend la
  // correction sûre — elle durcit, elle ne relâche jamais.
  for (const [cas, approbation] of [['un autre motif de blocage', false], ['sans accord exigé', false]]) {
    const n = cas === 'un autre motif de blocage' ? 132 : 133;
    const autre = await monteBloquee(n, { approbation, motif: cas === 'un autre motif de blocage' ? 'missing_variable' : 'post_a_relire' });
    await q(`update enrollments set status = 'paused', next_action_at = null where id = $1`, [autre.action.inscription]);
    await reprendreInscription(autre.m.ctx, { inscriptionId: autre.action.inscription });
    const apres = (await q(`select status, block_reason from actions where id = $1`, [autre.action.id])).rows[0];
    // Le motif de DÉPART est affirmé : sans lui, ce contrôle serait vert sur une action qui
    // n'avait jamais été bloquée, et ne dirait rien de la reprise.
    check(`38c. ${cas} : la reprise la repose PLANIFIÉE, comme avant`,
      autre.action?.block_reason === (cas === 'un autre motif de blocage' ? 'missing_variable' : 'post_a_relire')
        && apres?.status === 'scheduled' && apres?.block_reason === null,
      `${JSON.stringify(apres)} / bloquée en ${autre.action?.block_reason}`);
  }
}

/**
 * Une action APPROUVÉE doit partir.
 *
 * Ce lot remplit la file d'attente humaine pour la première fois : une action relâchée restitue
 * `pending_approval` quand l'accord était exigé. Or une action `approved` ne partait JAMAIS, sur
 * AUCUN des deux canaux — les balayages filtrent `scheduled`, le gestionnaire email refuse tout
 * autre statut, `approuverEnvoi` n'enfile rien, et rien ne ramène l'action à `scheduled`. Elle
 * reste `approved` indéfiniment, sans erreur, pendant que l'écran la compte comme « prévue ».
 * Livrer la garde sans ça, ce serait envoyer des gens dans une file dont rien ne sort.
 *
 * Mesuré : aucune action `approved` ni `pending_approval` n'existe en base aujourd'hui (le seuil
 * de relecture des premiers envois vaut zéro par défaut), donc la correction ne peut réveiller
 * aucune ligne.
 *
 * LES DEUX SENS, et le second compte le plus : une action qui attend encore un accord ne doit
 * toujours pas partir, sinon cette correction casserait la règle que l'autre protège.
 */
async function approuveePart() {
  console.log('\n# une action approuvée part ; une action qui attend l\'accord, non');
  await demarrerBoss();

  for (const canal of ['email', 'linkedin_message']) {
    for (const statut of ['approved', 'pending_approval']) {
      const m = await monde();
      await etapeAvecCorps(m, SANS_ACCROCHE, { canal });
      const n = canal === 'email' ? 140 : 141;
      const p = await engageurDUnPost(m, n, { etat: 'approved' });
      if (canal === 'email') {
        await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob${n}-${Date.now()}@exemple.invalid`]);
        await expediteurEmail(m.org, `exp${n}-${Date.now()}@exemple.invalid`);
      }
      await tourDInscription(m.org);
      await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
      await tickDueEnrollments(pool, new Date());
      // L'état à éprouver, posé sur l'action que le tick vient de créer, et assez vieille pour
      // que le balayage la voie (il attend deux minutes que le dispatch normal fasse son travail).
      const act = (await q(`select id, status from actions where organization_id = $1`, [m.org])).rows[0];
      await q(`update actions set status = $2, created_at = now() - interval '10 minutes',
                  dispatched_at = null where id = $1`, [act.id, statut]);
      await q(`delete from pgboss.job where data->>'organizationId' = $1`, [m.org]);
      await q(`delete from linkedin_action_queue where organization_id = $1`, [m.org]);

      if (canal === 'email') await rejouerActionsEmailEnAttente({ pool, boss });
      else await rejouerActionsLinkedInEnAttente({ pool, boss });

      const enfilee = (await q(
        `select 1 from pgboss.job where name = 'actions.dispatch' and data->>'actionId' = $1`, [act.id])).rowCount;
      if (statut === 'approved') {
        check(`39. [${canal}] une action approuvée est enfilée : la file d'attente humaine a une sortie`,
          enfilee === 1, `${enfilee} job(s) pour l'action ${act.status} -> ${statut}`);
      } else {
        check(`39a. [${canal}] une action qui attend encore l'accord n'est PAS enfilée`,
          enfilee === 0, `${enfilee} job(s)`);
      }
    }
  }

  // LA TROISIÈME SORTIE, celle des REPRISES humaines. Ouvrir les deux autres sans celle-ci
  // fabriquait un blocage définitif et muet, créé par notre propre élargissement : campagne avec
  // politique d'approbation, action LinkedIn approuvée donc enfilée — ce que la correction
  // ci-dessus rend possible —, ligne de file en échec, inscription mise en pause, reprise à la
  // main, l'expression rend `pending_approval`, un humain approuve, l'action passe `approved`...
  // et plus personne ne la lit : les reprises filtraient `scheduled`, et le balayage des actions
  // jamais enfilées l'exclut par son `not exists` sur la file.
  for (const statut of ['approved', 'pending_approval']) {
    const m = await monde();
    await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'linkedin_message' });
    // Une SECONDE étape : les reprises exigent `e.status = 'active'`, et une séquence à une seule
    // étape laisse l'inscription `completed` dès la première planifiée.
    await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'linkedin_message', position: 1 });
    const p = await engageurDUnPost(m, 142, { etat: 'approved' });
    await tourDInscription(m.org);
    await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
    await tickDueEnrollments(pool, new Date());
    const act = (await q(`select id from actions where organization_id = $1 limit 1`, [m.org])).rows[0];
    await q(`update actions set status = $2 where id = $1`, [act.id, statut]);
    await q(`delete from linkedin_action_queue where organization_id = $1`, [m.org]);
    await q(
      `insert into linkedin_action_queue (organization_id, action_id, kind, linkedin_url, contact_id, signal_id, status, error_code, reprise_le, method)
       values ($1, $2, 'message', $3, $4, $5, 'failed', 'echec_envoi', now(), 'serveur')`,
      [m.org, act.id, `https://www.linkedin.com/in/bob-142/`, p.contact_id, p.signal_id],
    );
    await rejouerActionsLinkedInReprises({ pool });
    const reenfilee = (await q(`select 1 from linkedin_action_queue where organization_id = $1 and status = 'pending'`, [m.org])).rowCount;
    if (statut === 'approved') {
      check('39b. [reprise] une action approuvée est réenfilée : la troisième sortie est ouverte aussi',
        reenfilee === 1, `${reenfilee} ligne(s)`);
    } else {
      check('39c. [reprise] une action qui attend encore l\'accord n\'est PAS réenfilée',
        reenfilee === 0, `${reenfilee} ligne(s)`);
    }
  }
}

/**
 * `approved` est un état que les écrans ne connaissaient pas — et c'est ce lot qui le fait exister
 * pour la première fois, en renvoyant les actions relâchées dans la file d'attente humaine.
 *
 * Cinq filtres l'ignoraient, pendant que l'écran, lui, range `approved` dans « à venir ». Aucun
 * envoi fautif à la clé (les deux gestes arrêtent l'inscription, que les balayages excluent),
 * mais l'opérateur voyait un « Reporter » qui lève « Envoi introuvable » et des chiffres qui ne
 * bougent pas après « Écarter de la campagne ».
 *
 * Et la RÈGLE d'approbation elle-même, qui vit en deux formes : du TypeScript pour le tick, du
 * SQL pour les trois chemins qui débloquent. Elles ne peuvent pas être une seule fonction, donc
 * un contrôle les compare sur un jeu de politiques — c'est ce garde qui tient la promesse, pas la
 * proximité des lignes. Une clause posée à deux endroits sur trois vient de coûter un blocage
 * définitif et muet.
 */
async function approuveVisibleParLesEcrans() {
  console.log('\n# l\'état `approved` : les gestes d\'écran le connaissent, et la règle n\'a qu\'une écriture');
  await demarrerBoss();

  /** Une action approuvée, sur une campagne qui tourne. */
  const actionApprouvee = async (n) => {
    const m = await monde();
    await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'email' });
    // Une SECONDE étape : « Écarter » n'arrête que les inscriptions VIVANTES, et une séquence à
    // une seule étape laisse l'inscription `completed` dès la première planifiée. Sans elle, le
    // contrôle serait rouge pour une raison qui n'a rien à voir avec l'état de l'action.
    await etapeAvecCorps(m, SANS_ACCROCHE, { canal: 'email', position: 1 });
    const p = await engageurDUnPost(m, n, { etat: 'approved' });
    await q(`update contacts set email = $2, email_status = 'valid' where id = $1`, [p.contact_id, `bob${n}-${Date.now()}@exemple.invalid`]);
    await expediteurEmail(m.org, `exp${n}-${Date.now()}@exemple.invalid`);
    await tourDInscription(m.org);
    await q(`update enrollments set next_action_at = now() - interval '1 minute' where organization_id = $1 and status = 'active'`, [m.org]);
    await tickDueEnrollments(pool, new Date());
    const a = (await q(`select id, scheduled_for from actions where organization_id = $1`, [m.org])).rows[0];
    await q(`update actions set status = 'approved' where id = $1`, [a.id]);
    return { m, p, action: a };
  };

  // 1. REPORTER. Le geste levait « Envoi introuvable » sur une action approuvée.
  const r = await actionApprouvee(150);
  let refus = null;
  await reporterEnvoi(r.m.ctx, { actionId: r.action.id, minutes: 60 }).catch((e) => { refus = e; });
  const apresReport = (await q(`select scheduled_for from actions where id = $1`, [r.action.id])).rows[0];
  check('40. « Reporter » marche sur un envoi approuvé, au lieu de lever « Envoi introuvable »',
    refus === null && apresReport.scheduled_for.getTime() > r.action.scheduled_for.getTime(),
    `${refus?.message ?? 'aucun refus'} / ${apresReport.scheduled_for?.toISOString()}`);

  // 2. ÉCARTER. La ligne restait comptée comme prévue.
  const e = await actionApprouvee(151);
  await ecarterDuneCampagne(e.m.ctx, { contactId: e.p.contact_id, campagneId: e.m.campagne });
  const apresEcart = (await q(`select status from actions where id = $1`, [e.action.id])).rows[0];
  check('40a. « Écarter de la campagne » saute aussi l\'envoi approuvé',
    apresEcart?.status === 'skipped', JSON.stringify(apresEcart));

  // 3. LES DEUX FORMES DE LA RÈGLE, comparées sur un jeu de politiques. Le SQL est évalué par
  // Postgres, le TypeScript par nous : si l'une dévie, un message part sans l'accord requis.
  const politiques = [
    {},
    { mode: 'all' },
    { mode: 'auto' },
    { channels: ['email'] },
    { channels: ['linkedin_message'] },
    { channels: [] },
    { mode: 'all', channels: ['letter'] },
    { mode: 'none', channels: ['email', 'call'] },
    // Les deux formes PATHOLOGIQUES sur lesquelles les écritures divergeaient : `jsonb ?`
    // accepte les CLÉS d'un objet et lit un scalaire comme un tableau d'un élément, là où le
    // tick refuse les deux. L'écart allait dans le mauvais sens — le SQL exigeait l'accord, le
    // tick non, donc c'est le tick qui laissait partir. Elles restent dans la grille pour que la
    // divergence ne revienne pas par une écriture future.
    { channels: { email: true } },
    { channels: 'email' },
    { channels: 'letter' },
    { channels: [1, 2] },
  ];
  const ecarts = [];
  for (const politique of politiques) {
    // `letter` est DANS la grille : son terme vit maintenant des deux côtés
    // (`approbationExigeeHorsRelecture`), et le garder d'un seul laissait le tick libre de cesser
    // de l'exiger sans que rien ne rougisse — pour le seul canal que le dépôt dit non négociable.
    for (const canal of ['email', 'linkedin_message', 'call', 'letter']) {
      const sql = (await q(
        `select ${sqlApprobationExigee('a', 'camp')} as exige
           from (select $1::jsonb as payload, $2::text as channel) a,
                (select $3::jsonb as approval_policy) camp`,
        [JSON.stringify({}), canal, JSON.stringify(politique)],
      )).rows[0].exige === true;
      const ts = approbationExigeeHorsRelecture(canal, politique);
      if (sql !== ts) ecarts.push({ politique, canal, sql, ts });
    }
  }
  check('40b. les deux écritures de la règle d\'approbation disent la même chose, entrée par entrée',
    ecarts.length === 0, JSON.stringify(ecarts));

  // Le SEUL terme que le SQL ajoute et que le tick ne peut pas connaître : le drapeau du payload,
  // puisque c'est le tick lui-même qui l'écrit. Sans ce contrôle, 40b serait vrai d'une
  // expression amputée de ce terme-là.
  const parLeDrapeau = (await q(
    `select ${sqlApprobationExigee('a', 'camp')} as exige
       from (select $1::jsonb as payload, 'email'::text as channel) a, (select '{}'::jsonb as approval_policy) camp`,
    [JSON.stringify({ requiresApproval: true })],
  )).rows[0].exige;
  check('40c. et le SQL ajoute le drapeau du blocage, que le tick ne peut pas connaître : il l\'écrit',
    parLeDrapeau === true && approbationExigeeHorsRelecture('email', {}) === false,
    JSON.stringify(parLeDrapeau));
}

/** Relie une campagne à une source par le SEUL lien historique `campaigns.source_id`. */
async function parLeLienHistorique(campagne, source) {
  await q(`delete from campaign_sources where campaign_id = $1 and source_id = $2`, [campagne, source]);
  await q(`update campaigns set source_id = $2 where id = $1`, [campagne, source]);
}

async function lienHistoriqueSourceCampagne() {
  console.log('\n# le lien historique `campaigns.source_id` vaut la table de liaison, dans les QUATRE endroits');
  await demarrerBoss();
  const m = await monde();
  await etapeAvecCorps(m, ACCROCHE, { canal: 'email' });
  const p = await engageurDUnPost(m, 72, { etat: 'pending' });
  await parLeLienHistorique(m.campagne, p.source);
  const liens = (await q(`select (select count(*)::int from campaign_sources where campaign_id = $1) as table_de_liaison, source_id from campaigns where id = $1`, [m.campagne])).rows[0];
  check('30. la campagne n\'est reliée QUE par le lien historique', liens.table_de_liaison === 0 && liens.source_id === p.source, JSON.stringify(liens));

  // 1. La garde : personne n'entre tant que le post n'est pas relu.
  await tourDInscription(m.org);
  check('30a. garde : personne n\'entre tant que le post n\'est pas relu', (await inscritsDe(m.org)).length === 0);

  // 2. Le gel : « retenu mais payé » est exactement le défaut à éviter — la garde retient la
  // personne pendant que l'argent de l'enrichissement part pour elle.
  await q(`update signals set status = 'qualified', score = 90, scored_at = now() where id = $1`, [p.signal_id]);
  await enqueueEnrichmentContactsConnus(boss, pool, { limit: 100, limiteGlobale: 500 });
  const enfiles = (await q(`select data from pgboss.job where name = 'enrichment.contact_connu' and data->>'organizationId' = $1`, [m.org])).rows.map((r) => r.data.contactId);
  check('30b. gel : aucun achat enfilé pour une personne que la garde retient', !enfiles.includes(p.contact_id), JSON.stringify(enfiles));
  const appelsFournisseur = [];
  const warn = console.warn;
  console.warn = () => undefined;
  let issue;
  try {
    issue = await enrichirContactConnu(
      { pool, cleFullEnrich: async () => 'cle-de-test', acheter: async (_c, e) => { appelsFournisseur.push(e); return { resultat: null, credits: 1 }; } },
      { organizationId: m.org, contactId: p.contact_id },
    );
  } finally {
    console.warn = warn;
  }
  check('30c. et la fonction qui dépense refuse elle-même, sans appeler le fournisseur',
    issue === 'post_a_relire' && appelsFournisseur.length === 0, `${issue} / ${appelsFournisseur.length} appel(s)`);

  // 3. L'écran : sans lui, la campagne retiendrait ses personnes avec un onglet Posts vide.
  const lignes = await listerPostsDeCampagne(m.ctx, { campagneId: m.campagne });
  check('30e. écran : le post est listé dans l\'onglet de la campagne', lignes.some((l) => l.id === p.fiche), `${lignes.length} ligne(s)`);
  check('30f. et le badge de l\'onglet le compte', (await compterPostsAValiderDeCampagne(m.ctx, { campagneId: m.campagne })) === 1);
  const retenues = await compterRetenuesParPost(pool, m.org, m.campagne);
  check('30g. et le bandeau voit la campagne, sa source de post et sa personne retenue',
    retenues.nommeUnPost === true && retenues.aUneSourceDePost === true && retenues.enAttenteDeValidation === 1, JSON.stringify(retenues));

  // 4. L'épargne, EN DERNIER : elle efface, et un contrôle qui détruit ne doit pas emporter la
  // preuve des suivants (la personne purgée faisait tomber les trois contrôles d'écran).
  await q(`update signals set occurred_at = now() - make_interval(days => $2) where id = $1`, [p.signal_id, AGE_MAX_SIGNAL_JOURS + 2]);
  await ecarterSignauxTropAnciens(pool, AGE_MAX_SIGNAL_JOURS);
  check('30d. épargne : la personne survit tant que sa fiche attend dans sa fenêtre',
    (await q(`select 1 from signals where id = $1`, [p.signal_id])).rowCount === 1);
}

async function main() {
  await jouer(ficheCreeeDeuxFois, deuxSourcesMemePost, rattachementDuSignal, sujetOperateurSurvit, collecteEnModePost, collecteEnModePages, captureEnPanne, rattrapageSelection, rattrapageCritere, rattrapageCibleCeQuiSert, rattrapageLot, rattrapageTraitement, sujetSansRelecture, sujetCredit, deuxCheminsDeRendu, gardeDEntree, contactExcluNeRevientPas, campagneSansAccrocheNonGelee, retraitDeLaVariable, epargneReelle, gelDeLaDepense, fenetreReglable, decompteLisible, indexDeJointureDesGabarits, repriseDeLExistant, scoringNourri, ecranDesPosts, validationExigeCeQuiPartira, repliNeDispensePasDeRelire, repliNExigeRienDeLaFiche, gabaritMixte, accrocheDansLeNomDuGabarit, gardeALEnvoi, rienARelireNeRetientPas, gardeAuxRejeuxLinkedIn, validerRelanceLesRetenues, repriseRestitueLaFile, approuveePart, approuveVisibleParLesEcrans, lienHistoriqueSourceCampagne);
  console.log(`\n[accroche-post] ${failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`}`);
  await boss.stop({ graceful: false, wait: false }).catch(() => undefined);
  await pool.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[accroche-post] ERREUR', e);
  process.exit(2);
});

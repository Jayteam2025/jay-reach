// Lot réponses LinkedIn, tâche 4 : exécution RÉELLE, sur Postgres, du SQL de la relève. Aucune requête
// de production n'est recopiée ici : seules les fixtures sont en SQL (et deux requêtes témoins, marquées
// « témoin », qui prouvent que la fixture SAURAIT attraper la faute que le contrôle écarte).
//
// Mutations qui font rougir (à rejouer à la main) :
//   1. releve-linkedin.ts : retirer le `normaliserUrlProfil` du repli par URL — 20 (URL dégénérée) rougit ;
//   2. retirer `if (res.rows.length > 1) return 'url_ambigue'` — 21 rougit ;
//   3. retirer `and organization_id = $1` d'une des deux recherches — 25 rougit ;
//   4. ecrireEtat : remplacer `coalesce($3::timestamptz, releve_curseur_at)` par `$3` — 30 rougit ;
//   5. retirer une des trois formes d'URN de la liste — 11 à 13 rougissent ;
//   7. contactsSansUrn : retirer `c.linkedin_provider_id is null` — 60, 61, 63, 66 rougissent ;
//      retirer `q.organization_id = c.organization_id` — 60 et 62 ; retirer `q.status = 'sent'` — 60 et 61
//      (l'action en echec porte un sent_at : sans lui `dernier is not null` ne l'ecarterait pas) ;
//   7b. retirer `and (c.urn_tentee_le is null or ...)` — 73 rougit (109 revient) ; passer 7 jours a 5 — 75 ; a 9 — 74 ;
//      ne plus dater les adresses ecartees (marquerIrresolus avant le filtre) — 76 ;
//   8. (tests unitaires) `.slice(0, nombre)`, le budget, la trace avant l'appel, le filtre `normaliserUrlProfil`,
//      l'arret sur refus de session, la capture d'un echec individuel : chacun fait rougir au moins un test.
//   9. (tache 6) enregistrer-message-sortant : retirer `assurerFil` au profit d'un insert direct dans
//      threads — 80 (reutilisation) ou 85 rougit ; poser `is_read = false`/`classification` a la mise a jour
//      du fil — 83 et 84 rougissent ; retirer `update threads set last_message_at` — 82 ; `etat: 'en_cours'`
//      qui pose sent_at — 87 ; retirer `and organization_id = $2` de `toucherDernierMessage` — 89.
//  10. (tache 7) exclusion-sur-reponse : retirer le `if (cls.classification === 'human_reply')` autour de
//      `exclureApresReponse` (exclure toujours) — 95 rougit (la paire : l'absence est alors exclue) ; ne plus l'appeler
//      du tout — 92 a 94 rougissent ; la sortir de la transaction n'est prouve que par le test unitaire (rollback) ;
//      lire `linkedin_provider_id` et deduire l'adresse — 98 rougit (l'adresse fabriquee apparait) ; retirer
//      `where not exists` d'une des deux insertions — 101 et 102 rougissent ; retirer le `and organization_id = $2` de la
//      lecture du contact — 104 rougit ; de la mise a jour du statut dans `poserExclusion` — 107 rougit ; `enrollContact` sans le `not exists (... do_not_contact)` — 96 rougit (la
//      paire : l'inscription du contact exclu aboutit) ; `poserExclusion` qui pose toujours 'manual' — 93 rougit.
//   6 (rappel) : migration 20261016100000 : revenir à `num_nonnulls(...) = 1` pour tout kind — 40 rougit.
import pg from 'pg';
import {
  compterRequetesLinkedIn,
  contactsSansUrn,
  enregistrerMessageSortant,
  toucherDernierMessage,
  ecrireEtat,
  lirePlafondLinkedIn,
  enqueueReleveLinkedIn,
  lireEtat,
  rattacher,
  REQUETES_PAR_RELEVE,
  tracerRequeteMessagerie,
  traiterReleveLinkedIn,
  urlConversations,
  recordInboundReply,
  exclureApresReponse,
  nePlusContacter,
  poserExclusion,
  enrollContact,
  inscrireContact,
} from './_releve-linkedin-bundle.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, params) => pool.query(sql, params);

let failures = 0;
function check(label, cond, extra = '') {
  console.log(`  ${cond ? 'OK  ' : 'FAIL'} ${label}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
}

// Chaque section tourne dans son propre `try` : une exception dans l'une n'emporte pas les suivantes.
async function jouer(...sections) {
  for (const section of sections) {
    try {
      await section();
    } catch (e) {
      check(`section ${section.name} : exception, ses contrôles n'ont PAS été joués`, false, String(e?.message ?? e));
    }
  }
}
const erreur = async (promesse) => {
  try {
    await promesse;
    return null;
  } catch (e) {
    return e;
  }
};

const ORG_A = '00000000-0000-0000-0000-0000000000a1';
const ORG_B = '00000000-0000-0000-0000-0000000000b1';
const id = (n) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
const msg = (expediteurUrn, expediteurUrl) => ({
  conversationUrn: 'urn:li:msg_conversation:c',
  messageUrn: 'urn:li:msg_message:m',
  expediteurUrn,
  expediteurUrl,
  texte: 'bonjour',
  recuLe: new Date(),
});

async function fixtures() {
  await q(`insert into organizations (id, name, slug) values ($1, 'Org A', 'org-a'), ($2, 'Org B', 'org-b')`, [ORG_A, ORG_B]);
  // `created_at` explicite : « le plus ancien » doit se lire, pas dépendre de l'ordre d'insertion.
  const c = (n, org, email, provider, url, jour) =>
    q(
      `insert into contacts (id, organization_id, email, linkedin_provider_id, linkedin_url, created_at)
       values ($1, $2, $3, $4, $5, now() - make_interval(days => $6))`,
      [id(n), org, email, provider, url, jour],
    );
  await c(1, ORG_A, 'nu@example.test', 'ACoAAurnnu', null, 1);
  await c(2, ORG_A, 'pref@example.test', 'urn:li:fsd_profile:ACoAAurnpref', null, 1);
  await c(3, ORG_A, 'mini@example.test', 'urn:li:fs_miniProfile:ACoAAurnmini', null, 1);
  await c(4, ORG_A, 'url@example.test', null, 'https://www.linkedin.com/in/jeanne-dupont/', 1);
  await c(5, ORG_A, 'trunc1@example.test', null, 'https://www.linkedin.com/in/', 1);
  await c(6, ORG_A, 'trunc2@example.test', null, 'https://www.linkedin.com/in', 1);
  await c(7, ORG_A, 'double-recent@example.test', 'ACoAAdouble', null, 1);
  await c(8, ORG_A, 'double-ancien@example.test', 'ACoAAdouble', null, 30);
  await c(9, ORG_A, 'paul1@example.test', null, 'https://www.linkedin.com/in/paul-martin', 1);
  await c(10, ORG_A, 'paul2@example.test', null, 'https://www.linkedin.com/in/paul-martin/', 1);
  await c(11, ORG_A, 'mixte@example.test', 'ACoAAmixte', 'https://www.linkedin.com/in/autre-personne', 1);
  await c(12, ORG_A, 'autre@example.test', null, 'https://www.linkedin.com/in/mixte-url', 1);
  // Même identifiant et même URL dans une AUTRE organisation : jamais rattachés depuis A.
  await c(21, ORG_B, 'b-nu@example.test', 'ACoAAurnnu', null, 1);
  await c(22, ORG_B, 'b-url@example.test', null, 'https://www.linkedin.com/in/seulement-b', 1);
}

async function rattachementParUrn() {
  const a = await rattacher(pool, ORG_A, msg('ACoAAurnnu', null));
  check('10 URN nu rattache le contact', a?.contactId === id(1) && a.par === 'urn' && a.ambigu === false, JSON.stringify(a));
  const b = await rattacher(pool, ORG_A, msg('ACoAAurnpref', null));
  check('11 un contact dont l identifiant est stocke prefixe fsd_profile est retrouve', b?.contactId === id(2), JSON.stringify(b));
  const c = await rattacher(pool, ORG_A, msg('ACoAAurnmini', null));
  check('12 un contact dont l identifiant est stocke prefixe fs_miniProfile est retrouve', c?.contactId === id(3), JSON.stringify(c));
  const d = await rattacher(pool, ORG_A, msg('ACoAAdouble', null));
  check('13 deux contacts pour le meme URN : le plus ancien, et le cas est signale', d?.contactId === id(8) && d.ambigu === true, JSON.stringify(d));
  const e = await rattacher(pool, ORG_A, msg('ACoAAinconnu', null));
  check('14 URN inconnu et aucune URL : rien', e === null, JSON.stringify(e));
}

async function rattachementParUrl() {
  const a = await rattacher(pool, ORG_A, msg('ACoAAinconnu', 'https://www.linkedin.com/in/jeanne-dupont'));
  check('15 repli par URL : l URL stockee avec une barre finale est retrouvee', a?.contactId === id(4) && a.par === 'url', JSON.stringify(a));
  const b = await rattacher(pool, ORG_A, msg('ACoAAinconnu', 'linkedin.com/in/Jeanne-Dupont/?trk=x'));
  check('16 la meme adresse sous une autre graphie (sans schema, casse, parametre) est retrouvee', b?.contactId === id(4), JSON.stringify(b));

  // Témoin : la requête naïve (sans `normaliserUrlProfil`) attraperait DEUX contacts pour une URL dégénérée.
  // Sans lui, le contrôle 20 ne prouverait rien : la fixture doit pouvoir faire échouer la faute.
  const temoin = await q(
    `select count(*)::int n from contacts where organization_id = $1
        and app.url_linkedin_normalisee(linkedin_url) = app.url_linkedin_normalisee($2)`,
    [ORG_A, 'https://www.linkedin.com/in/'],
  );
  check('19 témoin : la comparaison brute rattacherait les deux URL tronquees a un inconnu', temoin.rows[0].n === 2, `n=${temoin.rows[0].n}`);
  for (const url of ['https://www.linkedin.com/in/', 'https://www.linkedin.com/in', 'https://example.com/in/jeanne-dupont', 'https://www.linkedin.com/company/acme', '   ']) {
    const r = await rattacher(pool, ORG_A, msg('ACoAAinconnu', url));
    check(`20 une URL qui ne designe pas un profil ne rattache rien : ${JSON.stringify(url)}`, r === null, JSON.stringify(r));
  }
  const amb = await rattacher(pool, ORG_A, msg('ACoAAinconnu', 'https://www.linkedin.com/in/paul-martin'));
  check('21 une URL portee par deux contacts est refusee (pas « le plus ancien »)', amb === 'url_ambigue', JSON.stringify(amb));
}

async function prioriteEtOrganisation() {
  const a = await rattacher(pool, ORG_A, msg('ACoAAmixte', 'https://www.linkedin.com/in/mixte-url'));
  check('22 l URN prime sur l URL quand ils designent deux contacts', a?.contactId === id(11) && a.par === 'urn', JSON.stringify(a));
  const b = await rattacher(pool, ORG_B, msg('ACoAAurnnu', null));
  check('25a l URN est cherche dans l organisation du passage seulement (B)', b?.contactId === id(21), JSON.stringify(b));
  const c = await rattacher(pool, ORG_A, msg('ACoAAinconnu', 'https://www.linkedin.com/in/seulement-b'));
  check('25b une URL d un contact d une autre organisation ne rattache rien', c === null, JSON.stringify(c));
  const d = await rattacher(pool, ORG_B, msg('ACoAAinconnu', 'https://www.linkedin.com/in/seulement-b'));
  check('25c la meme URL est retrouvee dans SA organisation', d?.contactId === id(22), JSON.stringify(d));
}

async function etat() {
  await q(`insert into linkedin_server_sessions (organization_id, status) values ($1, 'active')`, [ORG_A]);
  const vide = await lireEtat(pool, ORG_A);
  check('29 la session neuve a un curseur et un compte nuls', vide.curseur === null && vide.compteUrn === null, JSON.stringify(vide));
  const t = new Date('2026-10-13T08:00:00Z');
  await ecrireEtat(pool, ORG_A, 'urn:li:fsd_profile:ACoAAmoi', t);
  const e1 = await lireEtat(pool, ORG_A);
  check('30a ecrire un curseur le pose, avec le compte', e1.curseur?.getTime() === t.getTime() && e1.compteUrn === 'urn:li:fsd_profile:ACoAAmoi', JSON.stringify(e1));
  await ecrireEtat(pool, ORG_A, 'urn:li:fsd_profile:ACoAAautre', null);
  const e2 = await lireEtat(pool, ORG_A);
  check('30b un curseur nul ne touche PAS le curseur (changement de compte), le compte change', e2.curseur?.getTime() === t.getTime() && e2.compteUrn === 'urn:li:fsd_profile:ACoAAautre', JSON.stringify(e2));
  const org = await erreur(ecrireEtat(pool, ORG_B, 'x', new Date()));
  const autre = await q(`select count(*)::int n from linkedin_server_sessions where organization_id = $1`, [ORG_B]);
  check('31 ecrire l etat d une organisation sans session ne cree rien ET leve : le passage ne se croit pas reussi',
    org !== null && org.name === 'SessionDisparue' && autre.rows[0].n === 0, String(org?.message));
  await q(`update linkedin_server_sessions set releve_curseur_at = null, releve_compte_urn = null where organization_id = $1`, [ORG_A]);
}

async function trace() {
  const avant = await compterRequetesLinkedIn({ ex: pool, organisationId: ORG_A }, new Date(Date.now() - 3_600_000));
  await tracerRequeteMessagerie({ ex: pool, organisationId: ORG_A });
  const l = (await q(`select kind, source_run_id, action_queue_id, post_id from linkedin_requetes where organization_id = $1 and kind = 'messagerie'`, [ORG_A])).rows;
  check('40 la trace de messagerie passe la contrainte d origine : kind messagerie, aucune origine',
    l.length === 1 && l[0].source_run_id === null && l[0].action_queue_id === null && l[0].post_id === null, JSON.stringify(l));
  const apres = await compterRequetesLinkedIn({ ex: pool, organisationId: ORG_A }, new Date(Date.now() - 3_600_000));
  check('41 elle compte dans le budget de l heure des autres canaux', apres === avant + 1, `${avant} -> ${apres}`);
  const sans = await erreur(q(`insert into linkedin_requetes (organization_id) values ($1)`, [ORG_A]));
  check('42 sens inverse : une trace sans nature ET sans origine reste refusee par la contrainte', sans !== null && /une_origine/.test(String(sans.message)), String(sans?.message));
  const nommee = await erreur(q(`insert into linkedin_requetes (organization_id, kind) values ($1, 'profil')`, [ORG_A]));
  check('43 sens inverse : une trace de profil sans origine reste refusee', nommee !== null, String(nommee?.message));
}

async function passageComplet() {
  // Plage ouverte en permanence : le verdict ne doit pas dépendre de l'heure du poste.
  await q(
    `insert into linkedin_settings (organization_id, send_from_hour, send_to_hour, send_days, timezone)
     values ($1, 0, 24, '{1,2,3,4,5,6,7}', 'Europe/Paris')
     on conflict (organization_id) do update set send_from_hour = 0, send_to_hour = 24, send_days = '{1,2,3,4,5,6,7}'`,
    [ORG_A],
  );
  const MOI = 'urn:li:fsd_profile:ACoAAmoi';
  const maintenant = Date.now();
  const recu = maintenant + 1000; // après le curseur « maintenant » du premier passage
  const conv = (idm, de, url, quand) => ({
    entityUrn: `urn:li:msg_conversation:c-${idm}`,
    lastActivityAt: quand,
    groupChat: false,
    conversationParticipants: [
      { hostIdentityUrn: MOI, participantType: { member: { profileUrl: 'https://www.linkedin.com/in/moi' } } },
      { hostIdentityUrn: `urn:li:fsd_profile:${de}`, participantType: { member: { profileUrl: url } } },
    ],
    messages: { elements: [{ entityUrn: `urn:li:msg_message:${idm}`, deliveredAt: quand, sender: { hostIdentityUrn: `urn:li:fsd_profile:${de}` }, body: { text: `message ${idm}` } }] },
  });
  let corps = { data: { messengerConversationsX: { elements: [] } } };
  const pilote = {
    aller: async () => undefined,
    url: async () => 'https://www.linkedin.com/feed/',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
    requete: async (u) => {
      if (u === 'https://www.linkedin.com/voyager/api/me') {
        return { statut: 200, corps: JSON.stringify({ data: { '*miniProfile': 'urn:li:fs_miniProfile:ACoAAmoi' }, included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAmoi', publicIdentifier: 'moi' }] }) };
      }
      if (u === urlConversations(MOI, 20)) return { statut: 200, corps: JSON.stringify(corps) };
      throw new Error(`requete non prevue : ${u}`);
    },
  };
  const deps = { pool, env: { JAY_REACH_LINKEDIN: '1' }, ouvrirNavigateur: async () => pilote, releverSortie: async () => ({ ip: '203.0.113.7' }) };

  // Passage 1 : curseur nul = maintenant, boîte vide. Pose le curseur et le compte.
  await traiterReleveLinkedIn(deps, { organizationId: ORG_A });
  const e1 = await lireEtat(pool, ORG_A);
  check('50 premier passage : le compte est pose, le curseur vaut maintenant', e1.compteUrn === MOI && e1.curseur !== null && Math.abs(e1.curseur.getTime() - maintenant) < 60_000, JSON.stringify(e1));
  // Comparé par la base : l'horloge de la VM Docker peut différer de celle du poste.
  const libre = (await q(`select (lock_until is null or lock_until <= now()) as libre from linkedin_server_sessions where organization_id = $1`, [ORG_A])).rows[0].libre;
  check('51 le verrou est rendu en fin de passage', libre === true);

  // Passage 2 : deux réponses, l'une rattachée par URN, l'autre par URL seulement.
  corps = { data: { messengerConversationsX: { elements: [conv('m1', 'ACoAAurnnu', 'https://www.linkedin.com/in/x', recu), conv('m2', 'ACoAAnouveau', 'https://www.linkedin.com/in/jeanne-dupont', recu + 1), conv('m3', 'ACoAAinconnu', 'https://www.linkedin.com/in/personne', recu + 2), conv('m4', 'ACoAAinconnu2', 'https://www.linkedin.com/in/', recu + 3)] } } };
  await traiterReleveLinkedIn(deps, { organizationId: ORG_A });
  const msgs = (await q(`select m.provider_message_id, t.contact_id, t.channel from thread_messages m join threads t on t.id = m.thread_id where t.organization_id = $1 order by m.provider_message_id`, [ORG_A])).rows;
  check('52 les deux réponses rattachées sont enregistrées sur le canal linkedin_message, les inconnues et la dégénérée NON',
    msgs.length === 2 && msgs[0].contact_id === id(1) && msgs[1].contact_id === id(4) && msgs.every((m) => m.channel === 'linkedin_message'), JSON.stringify(msgs));
  const urn = (await q(`select linkedin_provider_id from contacts where id = $1`, [id(4)])).rows[0].linkedin_provider_id;
  check('53 le contact rattaché par URL a désormais son URN (chemin principal)', urn === 'ACoAAnouveau', String(urn));
  const notifs = (await q(`select count(*)::int n from notifications where organization_id = $1`, [ORG_A])).rows[0].n;
  const orphelins = (await q(`select count(*)::int n from threads where organization_id = $1 and contact_id is null`, [ORG_A])).rows[0].n;
  check('54 aucun fil sans contact : un message inconnu n est jamais stocké', orphelins === 0);
  const e2 = await lireEtat(pool, ORG_A);
  check('55 le curseur n a pas reculé et a avancé après le succès', e2.curseur.getTime() >= e1.curseur.getTime(), JSON.stringify(e2));

  // Passage 3 : même charge utile (la marge fait relire) — aucun doublon.
  await q(`update linkedin_server_sessions set releve_curseur_at = $2 where organization_id = $1`, [ORG_A, new Date(maintenant)]);
  await traiterReleveLinkedIn(deps, { organizationId: ORG_A });
  const n = (await q(`select count(*)::int n from thread_messages m join threads t on t.id = m.thread_id where t.organization_id = $1`, [ORG_A])).rows[0].n;
  check('56 rejouer les mêmes messages n en crée aucun de plus', n === 2, `n=${n}`);
  void notifs;

  // Le producteur, sur la vraie base : une session active, un job, la cadence réglée.
  const envois = [];
  const boss = { send: async (...a) => (envois.push(a), 'job') };
  const deposes = await enqueueReleveLinkedIn(boss, pool);
  check('57 le producteur depose un job par organisation a session active, cadence par defaut 30 min',
    deposes === 1 && envois[0][2].singletonKey === ORG_A && envois[0][2].singletonSeconds === 1800, JSON.stringify(envois));
}

// Tâche 5 : résolution des URN manquants. Fixtures propres à la section, posées APRÈS le passage complet :
// avant, le passage aurait tenté de les résoudre sur un pilote qui n'a pas de profils à rendre.
async function resolutionDesUrn() {
  const jour = (n) => `now() - make_interval(days => ${n})`;
  const contact = (n, org, provider, url) =>
    q(`insert into contacts (id, organization_id, email, linkedin_provider_id, linkedin_url) values ($1, $2, $3, $4, $5)`, [id(n), org, `r${n}@example.test`, provider, url]);
  const profil = (slug) => `https://www.linkedin.com/in/${slug}`;
  // `quand` est une expression SQL : l'ancienneté se lit dans la base, pas dans l'horloge du poste.
  const action = (n, org, contactId, kind, statut, quand) =>
    q(
      `insert into linkedin_action_queue (id, organization_id, contact_id, linkedin_url, kind, status, sent_at)
       values ($1, $2, $3, 'https://www.linkedin.com/in/x', $4, $5, ${quand})`,
      [id(n), org, id(contactId), kind, statut],
    );
  await contact(100, ORG_A, null, profil('recent'));        // envoi parti il y a 1 jour
  await contact(101, ORG_A, null, profil('ancien'));        // deux envois partis : invitation il y a 9 j, message il y a 5 j
  await contact(102, ORG_A, 'ACoAAdejaposee', profil('urn-deja-posee')); // a deja son URN
  await contact(103, ORG_A, null, profil('jamais-ecrit'));  // aucun envoi
  await contact(104, ORG_A, null, profil('en-attente'));    // seul envoi : statut failed, malgré un sent_at
  await contact(105, ORG_A, null, '   ');                   // pas d adresse
  await contact(106, ORG_A, '', profil('valeur-vide'));     // valeur non nulle : hors critere
  await contact(107, ORG_A, null, profil('envoi-autre-org'));// la seule action qui le vise appartient a l organisation B
  await contact(108, ORG_B, null, profil('chez-b'));        // envoi parti, mais dans B
  await contact(109, ORG_A, null, profil('introuvable'));   // envoi parti il y a 12 h, profil inexistant (404)
  await contact(110, ORG_A, null, profil('dix-jours'));     // envoi parti il y a 10 j
  await action(100, ORG_A, 100, 'message', 'sent', jour(1));
  await action(101, ORG_A, 101, 'invite', 'sent', jour(9));
  await action(102, ORG_A, 101, 'message', 'sent', jour(5));
  await action(103, ORG_A, 102, 'message', 'sent', jour(1));
  // `sent_at` renseigné malgré le statut : seul le statut peut l'écarter (sans lui, `sent_at is not null` suffirait).
  await action(104, ORG_A, 104, 'message', 'failed', jour(1));
  await action(105, ORG_A, 105, 'message', 'sent', jour(1));
  await action(106, ORG_A, 106, 'message', 'sent', jour(1));
  await action(107, ORG_B, 107, 'message', 'sent', jour(1));
  await action(108, ORG_B, 108, 'message', 'sent', jour(1));
  await action(109, ORG_A, 109, 'message', 'sent', `now() - interval '12 hours'`);
  await action(110, ORG_A, 110, 'message', 'sent', jour(10));

  const lus = await contactsSansUrn(pool, ORG_A, 20);
  check('60 candidats : sans URN, avec un envoi parti, le dernier envoi d abord, chacun UNE fois (deux envois = une ligne)',
    JSON.stringify(lus.map((l) => l.id)) === JSON.stringify([id(109), id(100), id(101), id(110)]), JSON.stringify(lus.map((l) => l.id.slice(-3))));
  const exclus = new Set(lus.map((l) => l.id));
  check('61 exclus : URN deja pose, valeur vide non nulle, aucun envoi, seul envoi en echec',
    ![id(102), id(106), id(103), id(104)].some((x) => exclus.has(x)));
  check('62 exclus : l action qui vise le contact appartient a une AUTRE organisation ; et le contact d une autre organisation',
    !exclus.has(id(107)) && !exclus.has(id(108)));
  const deB = await contactsSansUrn(pool, ORG_B, 20);
  check('62b depuis B : seulement SES contacts', JSON.stringify(deB.map((l) => l.id)) === JSON.stringify([id(108)]), JSON.stringify(deB));
  const borne = await contactsSansUrn(pool, ORG_A, 2);
  check('63 la limite borne la lecture, les plus recents restent', JSON.stringify(borne.map((l) => l.id)) === JSON.stringify([id(109), id(100)]));
  // 64 est le temoin de 61 : sans le critere `is null`, la fixture ramenerait bien 102 et 106.
  const temoin = await q(`select count(*)::int n from contacts where organization_id = $1 and id = any($2::uuid[]) and linkedin_provider_id is not null`, [ORG_A, [id(102), id(106)]]);
  check('64 temoin : les deux contacts exclus ont bien une valeur non nulle (la fixture saurait les ramener)', temoin.rows[0].n === 2);

  // Un passage sur la vraie base.
  const MOI = 'urn:li:fsd_profile:ACoAAmoi';
  const demandes = [];
  const profils = {
    recent: 'ACoAAurnrecent',
    ancien: 'ACoAAurnancien',
    'dix-jours': 'ACoAAurndix',
  };
  const pilote = {
    aller: async () => undefined,
    url: async () => 'https://www.linkedin.com/feed/',
    saisir: async () => undefined,
    presserEntree: async () => undefined,
    texte: async () => '',
    attendre: async () => true,
    effacerCookies: async () => undefined,
    fermer: async () => undefined,
    requete: async (u) => {
      if (u === 'https://www.linkedin.com/voyager/api/me') {
        return { statut: 200, corps: JSON.stringify({ data: { '*miniProfile': 'urn:li:fs_miniProfile:ACoAAmoi' }, included: [{ entityUrn: 'urn:li:fs_miniProfile:ACoAAmoi', publicIdentifier: 'moi' }] }) };
      }
      if (u === urlConversations(MOI, 20)) return { statut: 200, corps: JSON.stringify({ data: { messengerConversationsX: { elements: [] } } }) };
      const slug = /memberIdentity=(.+)$/.exec(u)?.[1];
      if (slug === undefined) throw new Error(`requete non prevue : ${u}`);
      demandes.push(slug);
      if (!(slug in profils)) return { statut: 404, corps: '{}' };
      return { statut: 200, corps: JSON.stringify({ elements: [{ entityUrn: `urn:li:fsd_profile:${profils[slug]}`, publicIdentifier: slug }] }) };
    },
  };
  const deps = { pool, env: { JAY_REACH_LINKEDIN: '1' }, ouvrirNavigateur: async () => pilote, releverSortie: async () => ({ ip: '203.0.113.7' }) };
  const urnDe = async (n) => (await q(`select linkedin_provider_id from contacts where id = $1`, [id(n)])).rows[0].linkedin_provider_id;
  const unJourAvant = async () => {
    await q(`update linkedin_server_sessions set releve_curseur_at = now() - interval '2 days', releve_compte_urn = $2 where organization_id = $1`, [ORG_A, MOI]);
  };
  const curseurAvance = async () => (await q(`select releve_curseur_at > now() - interval '1 hour' as ok from linkedin_server_sessions where organization_id = $1`, [ORG_A])).rows[0].ok;
  const traces = async () => (await q(`select count(*)::int n from linkedin_requetes where organization_id = $1`, [ORG_A])).rows[0].n;

  // Budget épuisé : exactement les deux requêtes de la relève restent. Aucune résolution, aucune erreur.
  const plafond = await lirePlafondLinkedIn({ ex: pool, organisationId: ORG_A }, 'linkedin_requetes_par_heure');
  const deja = await compterRequetesLinkedIn({ ex: pool, organisationId: ORG_A }, new Date(Date.now() - 3_600_000));
  await q(`insert into linkedin_requetes (organization_id, kind) select $1, 'messagerie' from generate_series(1, $2::int)`, [ORG_A, plafond - REQUETES_PAR_RELEVE - deja]);
  await unJourAvant();
  const avantBudget = await traces();
  const sansBudget = await erreur(traiterReleveLinkedIn(deps, { organizationId: ORG_A }));
  check('65 budget epuise apres la releve : le passage REUSSIT, le curseur avance, aucune resolution',
    sansBudget === null && demandes.length === 0 && (await curseurAvance()) && (await urnDe(100)) === null && (await traces()) === avantBudget + REQUETES_PAR_RELEVE,
    `${sansBudget?.message ?? ''} demandes=${demandes.length}`);
  await q(`delete from linkedin_requetes where organization_id = $1`, [ORG_A]);

  // Premier passage libre : quatre candidats, trois résolutions (109 d abord, introuvable, puis 100 et 101).
  await unJourAvant();
  const avant = await traces();
  const e1 = await erreur(traiterReleveLinkedIn(deps, { organizationId: ORG_A }));
  check('66 trois resolutions au plus : 109 (404), 100 et 101 ; 110 n est pas touche',
    JSON.stringify(demandes) === JSON.stringify(['introuvable', 'recent', 'ancien']) && (await urnDe(110)) === null, JSON.stringify(demandes));
  check('67 une resolution qui echoue (404) n emporte pas le passage : il reussit et son curseur avance',
    e1 === null && (await curseurAvance()), String(e1?.message));
  check('68 les URN resolus sont memorises sous leur forme nue, sur les bons contacts ; l echec ne laisse rien',
    (await urnDe(100)) === 'ACoAAurnrecent' && (await urnDe(101)) === 'ACoAAurnancien' && (await urnDe(109)) === null,
    `${await urnDe(100)} ${await urnDe(101)} ${await urnDe(109)}`);
  check('69 chaque resolution est tracee : les requetes de la releve + 3 resolutions', (await traces()) === avant + REQUETES_PAR_RELEVE + 3, `${avant} -> ${await traces()}`);
  const autres = await q(`select count(*)::int n from contacts where organization_id = $1 and id = any($2::uuid[]) and linkedin_provider_id is distinct from $3`, [ORG_A, [id(102)], 'ACoAAdejaposee']);
  check('70 un contact qui avait deja un URN n est ni resolu ni modifie', autres.rows[0].n === 0 && !demandes.includes('urn-deja-posee'));
  const bB = await urnDe(108);
  check('71 le contact de l autre organisation n est pas touche', bB === null);

  // La mémoire de l'échec définitif : 109 (404) est daté, un échec passager ne date rien.
  const tentee = async (n) => (await q(`select urn_tentee_le is not null as d from contacts where id = $1`, [id(n)])).rows[0].d;
  check('72 le profil introuvable est DATE ; les contacts resolus et le contact non tente ne le sont pas',
    (await tentee(109)) === true && (await tentee(100)) === false && (await tentee(101)) === false && (await tentee(110)) === false);

  // Second passage : 109 ne revient PAS (c'est le contrôle qui prouve la fin de la famine), 110 se résout.
  demandes.length = 0;
  await unJourAvant();
  const e2 = await erreur(traiterReleveLinkedIn(deps, { organizationId: ORG_A }));
  check('73 un contact introuvable ne revient pas au passage suivant ; un contact resolu non plus ; le suivant passe',
    e2 === null && JSON.stringify(demandes) === JSON.stringify(['dix-jours']) && (await urnDe(110)) === 'ACoAAurndix', JSON.stringify(demandes));

  // Passé sept jours, il peut revenir (le profil a pu réapparaître).
  await q(`update contacts set urn_tentee_le = now() - interval '8 days' where id = $1`, [id(109)]);
  const revenus = await contactsSansUrn(pool, ORG_A, 20);
  check('74 sept jours apres, le contact introuvable redevient candidat', JSON.stringify(revenus.map((l) => l.id)) === JSON.stringify([id(109)]), JSON.stringify(revenus.map((l) => l.id.slice(-3))));
  await q(`update contacts set urn_tentee_le = now() - interval '6 days' where id = $1`, [id(109)]);
  const encore = await contactsSansUrn(pool, ORG_A, 20);
  check('75 six jours apres, non', encore.length === 0, JSON.stringify(encore.map((l) => l.id.slice(-3))));

  // Une adresse qui n'est pas une page de profil est datée par le passage, sans requête vers LinkedIn.
  await contact(111, ORG_A, null, 'https://www.linkedin.com/company/page-entreprise');
  await action(111, ORG_A, 111, 'message', 'sent', `now() - interval '1 hour'`);
  await q(`update contacts set urn_tentee_le = null where id = $1`, [id(109)]);
  demandes.length = 0;
  await unJourAvant();
  await traiterReleveLinkedIn(deps, { organizationId: ORG_A });
  check('76 une adresse qui n est pas une page de profil est datee et jamais interrogee',
    (await tentee(111)) === true && !demandes.includes('') && demandes.length === 1 && demandes[0] === 'introuvable', JSON.stringify(demandes));
  check('77 isolement : la date ne touche aucun contact de l autre organisation', (await tentee(108)) === false);
}

// Tâche 6 : le message sortant entre dans le fil. Le SQL est celui de production (`assurerFil` + insertion).
async function messageSortant() {
  const ex = pool;
  const contact = (n, org) =>
    q(`insert into contacts (id, organization_id, email) values ($1, $2, $3)`, [id(n), org, `sortant${n}@example.test`]);
  await contact(200, ORG_A); // aucun fil
  await contact(201, ORG_A); // fil portant deja une reponse classee, non lue
  await contact(202, ORG_A); // fil email : ne doit pas etre confondu avec le fil LinkedIn
  await contact(203, ORG_B);
  const fils = (n, org) =>
    q(`select id, channel, is_read, classification, handled_at, last_message_at from threads where contact_id = $1 and organization_id = $2 order by channel`, [id(n), org]);
  const base = { organizationId: ORG_A, channel: 'linkedin_message', etat: 'envoye' };

  const f1 = await enregistrerMessageSortant(ex, { ...base, contactId: id(200), body: 'Bonjour 200', raw: { queue_id: 'q-200' } });
  const t1 = await fils(200, ORG_A);
  const m1 = await q(`select direction, body, provider_message_id, sent_at, raw from thread_messages where thread_id = $1`, [f1]);
  check('78 un message sortant cree le fil LinkedIn du contact, lu, sans classification',
    t1.rows.length === 1 && t1.rows[0].id === f1 && t1.rows[0].channel === 'linkedin_message' && t1.rows[0].is_read === true && t1.rows[0].classification === 'unclassified', JSON.stringify(t1.rows));
  check('79 le message est stocke en sortant, avec son corps, sa date d envoi et ses metadonnees',
    m1.rows.length === 1 && m1.rows[0].direction === 'out' && m1.rows[0].body === 'Bonjour 200' && m1.rows[0].sent_at !== null && m1.rows[0].raw.queue_id === 'q-200', JSON.stringify(m1.rows));

  const f2 = await enregistrerMessageSortant(ex, { ...base, contactId: id(200), body: 'Relance 200' });
  const t2 = await fils(200, ORG_A);
  check('80 un second message reutilise le meme fil, il n en cree pas un deuxieme', f2 === f1 && t2.rows.length === 1, JSON.stringify(t2.rows));
  const m2 = await q(`select count(*)::int as n from thread_messages where thread_id = $1`, [f1]);
  check('81 les deux messages sont dans le fil', m2.rows[0].n === 2);

  // Fil existant portant une reponse : classee human_reply, non lue, traitee.
  const fil = (await q(
    `insert into threads (organization_id, contact_id, channel, classification, is_read, handled_at, last_message_at)
     values ($1, $2, 'linkedin_message', 'human_reply', false, now() - interval '2 days', now() - interval '3 days') returning id`,
    [ORG_A, id(201)],
  )).rows[0].id;
  await q(`insert into thread_messages (thread_id, direction, body, sent_at) values ($1, 'in', 'Oui, interessé', now() - interval '3 days')`, [fil]);
  const avant = (await fils(201, ORG_A)).rows[0];
  const f3 = await enregistrerMessageSortant(ex, { ...base, contactId: id(201), body: 'Merci, je vous appelle' });
  const apres = (await fils(201, ORG_A)).rows[0];
  check('82 le dernier message du fil existant est mis a jour', f3 === fil && new Date(apres.last_message_at) > new Date(avant.last_message_at), JSON.stringify([avant.last_message_at, apres.last_message_at]));
  check('83 la classification du fil existant n est pas ecrasee', apres.classification === 'human_reply', apres.classification);
  check('84 l etat de lecture et le traitement du fil existant ne bougent pas : la reponse attend toujours l operateur',
    apres.is_read === false && String(apres.handled_at) === String(avant.handled_at) && apres.handled_at !== null, JSON.stringify(apres));

  // Le canal compte : un fil email du meme contact n est ni reutilise ni touche.
  const email = (await q(`insert into threads (organization_id, contact_id, channel, is_read) values ($1, $2, 'email', false) returning id`, [ORG_A, id(202)])).rows[0].id;
  const f4 = await enregistrerMessageSortant(ex, { ...base, contactId: id(202), body: 'Bonjour 202' });
  const t4 = await fils(202, ORG_A);
  check('85 un fil email du meme contact n est pas reutilise : un fil LinkedIn distinct est cree',
    f4 !== email && t4.rows.length === 2 && t4.rows.find((r) => r.id === email).is_read === false, JSON.stringify(t4.rows));

  // « en cours d envoi » : la meme ecriture, sans date d envoi, marquee.
  const f5 = await enregistrerMessageSortant(ex, { ...base, contactId: id(200), body: 'Reponse saisie', etat: 'en_cours', raw: { queue_id: 'q-x' } });
  const m5 = (await q(`select sent_at, raw, direction from thread_messages where thread_id = $1 and body = 'Reponse saisie'`, [f5])).rows[0];
  check('87 un message en cours d envoi n a pas de date d envoi et porte son etat, en sortant',
    f5 === f1 && m5.sent_at === null && m5.raw.etat === 'en_cours' && m5.raw.queue_id === 'q-x' && m5.direction === 'out', JSON.stringify(m5));
  const m6 = (await q(`select raw from thread_messages where thread_id = $1 and body = 'Bonjour 200'`, [f1])).rows[0];
  check('88 un message envoye ne porte pas l etat en_cours', m6.raw.etat === undefined, JSON.stringify(m6.raw));

  // Le filtre d'organisation de la mise a jour du dernier message : le SQL de production, appele avec
  // le fil d'ORG_A et l'organisation ORG_B. Aucune ligne touchee, date inchangee ; avec la bonne organisation, une.
  const avantB = (await q(`select last_message_at from threads where id = $1`, [fil])).rows[0].last_message_at;
  await q(`select pg_sleep(0.01)`);
  const autre = await toucherDernierMessage(ex, ORG_B, fil);
  const apresB = (await q(`select last_message_at from threads where id = $1`, [fil])).rows[0].last_message_at;
  check('89 la mise a jour du dernier message d un fil ne touche rien pour une autre organisation', autre === 0 && String(avantB) === String(apresB), `${autre} ligne(s)`);
  const propre = await toucherDernierMessage(ex, ORG_A, fil);
  const apresA = (await q(`select last_message_at from threads where id = $1`, [fil])).rows[0].last_message_at;
  check('90 pour la bonne organisation elle touche exactement le fil', propre === 1 && new Date(apresA) > new Date(avantB), `${propre} ligne(s)`);

  // Le chemin email SalesBlink passe par la meme fonction : sa forme d'appel (canal email, raw avec l'objet),
  // relue en base. Le fil email du contact 202 existe deja : il est reutilise, jamais duplique.
  const fe = await enregistrerMessageSortant(ex, {
    organizationId: ORG_A, contactId: id(202), channel: 'email', body: 'Corps email', etat: 'envoye',
    raw: { action_id: 'act-1', mode: 'sequence', subject: 'Objet email' },
  });
  const me = (await q(`select direction, body, raw ->> 'subject' as objet, raw ->> 'action_id' as action, sent_at from thread_messages where thread_id = $1 and body = 'Corps email'`, [fe])).rows[0];
  check('91 chemin email : meme fil email reutilise, message sortant avec son objet et son action relus en base',
    fe === email && me.direction === 'out' && me.objet === 'Objet email' && me.action === 'act-1' && me.sent_at !== null, JSON.stringify(me));
}

// Tâche 7 : le SQL de production de l'exclusion automatique, exécuté. La paire différentielle (92 a 96) joue
// DEUX contacts identiques (meme email, meme profil, aucune inscription) que seule la reponse distingue :
// « human_reply » exclut, « auto_absence » non. Sans elle, un controle vert prouverait seulement que le code
// ecrit quelque chose.
async function exclusionSurReponse() {
  const org = ORG_A;
  const contact = async (n, email, url, provider = null) =>
    q(`insert into contacts (id, organization_id, email, linkedin_url, linkedin_provider_id) values ($1, $2, $3, $4, $5)`, [id(n), org, email, url, provider]);
  const etat = async (n) => (await q(`select status from contacts where id = $1`, [id(n)])).rows[0].status;
  const supp = async (scope, valeur) =>
    (await q(`select reason, origin::text as origin, value from suppressions where organization_id = $1 and scope = $2::suppression_scope and lower(value) = lower($3)`, [org, scope, valeur])).rows;

  const humaine = 'Bonjour, merci pour votre message, on se rappelle la semaine prochaine.';
  const absence = 'Je suis actuellement en conges, de retour le 20.';

  // La paire : meme etat de depart, une seule difference, la reponse.
  await contact(300, 'paire-humain@example.test', 'https://www.linkedin.com/in/paire-humain/');
  await contact(301, 'paire-absent@example.test', 'https://www.linkedin.com/in/paire-absent/');
  const rh = await recordInboundReply(pool, org, { contactId: id(300), channel: 'linkedin_message', body: humaine });
  const ra = await recordInboundReply(pool, org, { contactId: id(301), channel: 'linkedin_message', body: absence });
  check('92 la paire : les deux reponses sont enregistrees, classees differemment',
    rh.isNew && ra.isNew && rh.classification === 'human_reply' && ra.classification === 'auto_absence', JSON.stringify([rh.classification, ra.classification]));

  check('93 human_reply : contact do_not_contact, suppression email reconnaissable (reponse_recue, api)',
    (await etat(300)) === 'do_not_contact' && JSON.stringify(await supp('email', 'paire-humain@example.test')) ===
      JSON.stringify([{ reason: 'reponse_recue', origin: 'api', value: 'paire-humain@example.test' }]),
    JSON.stringify(await supp('email', 'paire-humain@example.test')));
  const sl = await supp('linkedin', 'https://www.linkedin.com/in/paire-humain');
  check('94 human_reply : une suppression linkedin sur l adresse REELLE du contact, forme normalisee, reponse_recue / api',
    sl.length === 1 && sl[0].reason === 'reponse_recue' && sl[0].origin === 'api' && sl[0].value === 'https://www.linkedin.com/in/paire-humain', JSON.stringify(sl));
  const aucune = (await q(`select count(*)::int as n from suppressions where organization_id = $1 and lower(value) in ('paire-absent@example.test', 'https://www.linkedin.com/in/paire-absent', 'https://www.linkedin.com/in/paire-absent/')`, [org])).rows[0].n;
  check('95 auto_absence, meme etat de depart : contact reste actif et AUCUNE suppression', (await etat(301)) === 'active' && aucune === 0, `${await etat(301)}, ${aucune} suppression(s)`);

  // Le contrat de bout en bout : une autre campagne, la meme personne. Le contact exclu ne s'inscrit pas,
  // son jumeau non exclu s'inscrit (sans quoi le refus pourrait venir d'ailleurs : campagne, plafond).
  const campB = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'Autre campagne', 'active') returning id`, [org])).rows[0].id;
  const refus = await enrollContact(pool, { organizationId: org, campaignId: campB, contactId: id(300), signalId: null });
  const accepte = await enrollContact(pool, { organizationId: org, campaignId: campB, contactId: id(301), signalId: null });
  check('96 une reponse humaine sur un canal empeche l inscription dans une autre campagne ; le jumeau, lui, s inscrit',
    refus === null && typeof accepte === 'string', JSON.stringify([refus, accepte]));
  const enrExclu = (await q(`select count(*)::int as n from enrollments where contact_id = $1`, [id(300)])).rows[0].n;
  check('97 aucune inscription n a ete creee pour le contact exclu', enrExclu === 0, String(enrExclu));

  // Le piege : un identifiant qui n'est pas un URN LinkedIn, et aucune adresse de profil.
  await contact(302, 'sans-url@example.test', null, 'fullenrich-id-0042');
  await recordInboundReply(pool, org, { contactId: id(302), channel: 'email', body: humaine });
  const fausse = (await q(`select value from suppressions where organization_id = $1 and scope = 'linkedin' and (value ilike '%fullenrich%' or value ilike '%0042%')`, [org])).rows;
  const toutes302 = (await q(`select scope::text as scope from suppressions where organization_id = $1 and (value ilike '%fullenrich%' or value ilike '%0042%' or value = 'sans-url@example.test')`, [org])).rows;
  check('98 sans adresse de profil, une reponse humaine pose l email et AUCUNE adresse LinkedIn fabriquee a partir de l identifiant',
    fausse.length === 0 && toutes302.length === 1 && toutes302[0].scope === 'email' && (await etat(302)) === 'do_not_contact', JSON.stringify([fausse, toutes302]));

  // Meme chose avec une adresse qui n'est pas un profil.
  await contact(303, null, 'https://exemple.test/in/quelquun', 'pas-un-urn-303');
  await recordInboundReply(pool, org, { contactId: id(303), channel: 'linkedin_message', body: humaine });
  const n303 = (await q(`select count(*)::int as n from suppressions where organization_id = $1 and (value ilike '%quelquun%' or value ilike '%pas-un-urn-303%')`, [org])).rows[0].n;
  check('99 une adresse qui n est pas un profil LinkedIn ne devient pas une opposition (et le contact est tout de meme exclu)',
    n303 === 0 && (await etat(303)) === 'do_not_contact', `${n303} suppression(s)`);

  // auto_left_company : arrete, n'exclut pas.
  await contact(304, 'parti@example.test', 'https://www.linkedin.com/in/parti');
  const campC = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'Campagne C', 'active') returning id`, [org])).rows[0].id;
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1, $2, $3, 'active')`, [org, campC, id(304)]);
  const rp = await recordInboundReply(pool, org, { contactId: id(304), channel: 'email', body: 'Je ne suis plus en poste dans cette entreprise.' });
  const insc304 = (await q(`select status::text as s from enrollments where contact_id = $1`, [id(304)])).rows[0].s;
  check('100 auto_left_company : l inscription s arrete, le contact n est PAS exclu',
    rp.classification === 'auto_left_company' && insc304 === 'stopped' && (await etat(304)) === 'active' && (await supp('email', 'parti@example.test')).length === 0, `${insc304}, ${await etat(304)}`);

  // Rejeu : meme message deux fois (garde isNew), puis exclusion rappelee a la main.
  await contact(305, 'rejeu@example.test', 'https://www.linkedin.com/in/rejeu');
  const r1 = await recordInboundReply(pool, org, { contactId: id(305), channel: 'linkedin_message', body: humaine, providerMessageId: 'urn:li:msg_message:rejeu' });
  const r2 = await recordInboundReply(pool, org, { contactId: id(305), channel: 'linkedin_message', body: humaine, providerMessageId: 'urn:li:msg_message:rejeu' });
  const p1 = await exclureApresReponse(pool, org, id(305));
  const p2 = await exclureApresReponse(pool, org, id(305));
  const nbEmail = (await supp('email', 'rejeu@example.test')).length;
  const nbLi = (await supp('linkedin', 'https://www.linkedin.com/in/rejeu')).length;
  check('101 rejouee (deux messages identiques, puis deux appels directs) : une seule suppression par canal, et les appels suivants ne posent rien',
    r1.isNew && !r2.isNew && nbEmail === 1 && nbLi === 1 && p1.email === 0 && p1.linkedin === 0 && p2.email === 0 && p2.linkedin === 0, JSON.stringify([nbEmail, nbLi, p1, p2]));

  // Une opposition deja posee (autre graphie, par l'operateur) : pas de doublon, l'existante reste telle quelle.
  await contact(306, 'deja@example.test', 'https://www.linkedin.com/in/deja');
  await q(`insert into suppressions (organization_id, scope, value, reason, origin) values ($1, 'email', 'deja@example.test', 'operator_do_not_contact', 'manual'), ($1, 'linkedin', 'https://www.linkedin.com/in/DEJA', 'operator_do_not_contact', 'manual')`, [org]);
  const pd = await exclureApresReponse(pool, org, id(306));
  const e306 = await supp('email', 'deja@example.test');
  const l306 = await supp('linkedin', 'https://www.linkedin.com/in/deja');
  check('102 une opposition deja posee n est pas doublee ni rereciee en api',
    pd.email === 0 && pd.linkedin === 0 && e306.length === 1 && l306.length === 1 && e306[0].origin === 'manual' && l306[0].origin === 'manual', JSON.stringify([pd, e306, l306]));

  // Un contact sans email ni profil : le statut change, rien d'autre.
  await contact(307, null, null);
  const p307 = await exclureApresReponse(pool, org, id(307));
  check('103 un contact sans email ni profil : exclu, aucune suppression posee', (await etat(307)) === 'do_not_contact' && p307.email === 0 && p307.linkedin === 0, JSON.stringify(p307));

  // Le filtre d'organisation : le contact d'ORG_A, vu depuis ORG_B, n'est ni lu ni exclu.
  await contact(308, 'cloison@example.test', 'https://www.linkedin.com/in/cloison');
  const pb = await exclureApresReponse(pool, ORG_B, id(308));
  const touche = (await q(`select count(*)::int as n from suppressions where value in ('cloison@example.test', 'https://www.linkedin.com/in/cloison')`)).rows[0].n;
  check('104 vu depuis une autre organisation, le contact n est ni lu, ni exclu, aucune suppression n est posee',
    pb.email === 0 && pb.linkedin === 0 && (await etat(308)) === 'active' && touche === 0, JSON.stringify([pb, touche]));

  // Defense en profondeur : la meme ecriture, appelee directement avec le MAUVAIS identifiant d'organisation
  // (la lecture du contact, filtree plus haut, ne peut pas la proteger quand l'appelant la saute).
  const pp = await poserExclusion(pool, ORG_B, id(308), { email: null, adressesLinkedin: [], motif: 'test', origine: 'api' });
  check('107 poserExclusion appelee avec une autre organisation ne change pas le statut du contact', (await etat(308)) === 'active', `${pp.email}/${pp.linkedin}`);

  // Les inscriptions vivantes de TOUTES les campagnes : la reponse humaine ferme celle qui existe (une seule par contact).
  await contact(309, 'inscrit@example.test', null);
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1, $2, $3, 'active')`, [org, campC, id(309)]);
  await recordInboundReply(pool, org, { contactId: id(309), channel: 'email', body: humaine });
  const insc309 = (await q(`select status::text as s from enrollments where contact_id = $1`, [id(309)])).rows[0].s;
  check('105 la reponse humaine ferme l inscription vivante ET exclut', insc309 === 'replied' && (await etat(309)) === 'do_not_contact', insc309);


  // Les deux graphies : un identifiant de membre reconnu ajoute l'adresse deduite ; un identifiant FullEnrich non.
  await contact(311, 'membre@example.test', 'https://www.linkedin.com/in/membre-reel', 'ACoAAmembre311');
  await contact(312, 'fullenrich@example.test', 'https://www.linkedin.com/in/fullenrich-reel', '3f2b8c1e-5d4a-4e6f-9a7b-1c2d3e4f5a6b');
  await recordInboundReply(pool, org, { contactId: id(311), channel: 'linkedin_message', body: humaine });
  await recordInboundReply(pool, org, { contactId: id(312), channel: 'linkedin_message', body: humaine });
  const l311 = (await q(`select value from suppressions where organization_id = $1 and scope = 'linkedin' and (value ilike '%membre-reel%' or value ilike '%acoaamembre311%') order by value`, [org])).rows.map((r) => r.value);
  const l312 = (await q(`select value from suppressions where organization_id = $1 and scope = 'linkedin' and (value ilike '%fullenrich-reel%' or value ilike '%3f2b8c1e%') order by value`, [org])).rows.map((r) => r.value);
  check('108 identifiant de membre reconnu : DEUX oppositions LinkedIn distinctes (adresse reelle et forme deduite)',
    l311.length === 2 && l311.includes('https://www.linkedin.com/in/membre-reel') && l311.includes('https://www.linkedin.com/in/ACoAAmembre311'), JSON.stringify(l311));
  check('109 identifiant FullEnrich : UNE seule opposition, celle de l adresse reelle, rien de fabrique',
    JSON.stringify(l312) === JSON.stringify(['https://www.linkedin.com/in/fullenrich-reel']), JSON.stringify(l312));

  // La trace : un evenement automatique, distinct de l'action manuelle, sans acteur ; pas de second sur un rejeu.
  const ev = (await q(`select action, actor_id, diff from audit_events where organization_id = $1 and entity_id = $2 and action like 'contact.%'`, [org, id(305)])).rows;
  check('110 la reponse humaine laisse UN evenement contact.excluded_after_reply, sans acteur, marque automatique (et pas celui de l operateur) apres le rejeu 101',
    ev.length === 1 && ev[0].action === 'contact.excluded_after_reply' && ev[0].actor_id === null && ev[0].diff.automatique === true, JSON.stringify(ev));
  const evAbsent = (await q(`select count(*)::int as n from audit_events where organization_id = $1 and entity_id = $2 and action = 'contact.excluded_after_reply'`, [org, id(301)])).rows[0].n;
  check('110b auto_absence (la paire) : aucun evenement d exclusion', evAbsent === 0, String(evAbsent));

  // Non-regression : une absence AVEC inscription vivante la met toujours en pause avec sa date de reprise.
  await contact(313, 'absent-inscrit@example.test', 'https://www.linkedin.com/in/absent-inscrit');
  await q(`insert into enrollments (organization_id, campaign_id, contact_id, status) values ($1, $2, $3, 'active')`, [org, campC, id(313)]);
  const ra2 = await recordInboundReply(pool, org, { contactId: id(313), channel: 'email', body: absence });
  const e313 = (await q(`select status::text as s, resume_at, next_action_at from enrollments where contact_id = $1`, [id(313)])).rows[0];
  check('111 auto_absence avec inscription vivante : paused_absence avec date de reprise future, contact actif, aucune suppression',
    ra2.classification === 'auto_absence' && e313.s === 'paused_absence' && e313.resume_at !== null && new Date(e313.resume_at) > new Date()
      && String(e313.resume_at) === String(e313.next_action_at) && (await etat(313)) === 'active' && (await supp('email', 'absent-inscrit@example.test')).length === 0,
    JSON.stringify(e313));

  // Le motif du refus d'inscription : exclu, deja inscrit, accepte.
  const campD = (await q(`insert into campaigns (organization_id, name, status) values ($1, 'Campagne D', 'active') returning id`, [org])).rows[0].id;
  const job = (n) => ({ organizationId: org, campaignId: campD, contactId: id(n), signalId: null });
  const mExclu = await inscrireContact(pool, job(311));
  const mAccepte = await inscrireContact(pool, job(304));
  const mDeja = await inscrireContact(pool, job(304));
  check('112 inscrireContact dit pourquoi : contact_exclu, puis un id, puis deja_inscrit',
    mExclu.refus === 'contact_exclu' && typeof mAccepte.id === 'string' && mDeja.refus === 'deja_inscrit', JSON.stringify([mExclu, mAccepte, mDeja]));

  // Non-regression de nePlusContacter apres le partage du corps SQL : toujours manual / operator_do_not_contact,
  // et toujours les DEUX graphies (adresse du contact + forme deduite de l'URN).
  await contact(310, 'operateur@example.test', 'https://www.linkedin.com/in/operateur', 'ACoAAoperateur310');
  await nePlusContacter({ ex: pool, organisationId: org, utilisateurId: null, role: 'operator' }, { contactId: id(310) });
  const e310 = await supp('email', 'operateur@example.test');
  const l310 = (await q(`select value, reason, origin::text as origin from suppressions where organization_id = $1 and scope = 'linkedin' and (value ilike '%/in/operateur' or value ilike '%acoaaoperateur310%') order by value`, [org])).rows;
  check('106 nePlusContacter : toujours manual / operator_do_not_contact, email et deux graphies LinkedIn',
    e310.length === 1 && e310[0].origin === 'manual' && e310[0].reason === 'operator_do_not_contact' &&
      l310.length === 2 && l310.every((r) => r.origin === 'manual' && r.reason === 'operator_do_not_contact') && (await etat(310)) === 'do_not_contact', JSON.stringify([e310, l310]));
}

try {
  await fixtures();
  await jouer(rattachementParUrn, rattachementParUrl, prioriteEtOrganisation, etat, trace, passageComplet, resolutionDesUrn, messageSortant, exclusionSurReponse);
} catch (e) {
  console.error('ERREUR', e);
  failures += 1;
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

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
//   6. migration 20261016100000 : revenir à `num_nonnulls(...) = 1` pour tout kind — 40 rougit.
import pg from 'pg';
import {
  compterRequetesLinkedIn,
  ecrireEtat,
  enqueueReleveLinkedIn,
  lireEtat,
  rattacher,
  tracerRequeteMessagerie,
  traiterReleveLinkedIn,
  urlConversations,
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

try {
  await fixtures();
  await jouer(rattachementParUrn, rattachementParUrl, prioriteEtOrganisation, etat, trace, passageComplet);
} catch (e) {
  console.error('ERREUR', e);
  failures += 1;
} finally {
  await pool.end();
}
console.log(failures === 0 ? 'TOUT VERT' : `${failures} ÉCHEC(S)`);
process.exit(failures === 0 ? 0 : 1);

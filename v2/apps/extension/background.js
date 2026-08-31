// Service worker Jay Reach — LinkedIn. Poll la file d'actions LinkedIn de
// l'app (invitations + messages) et les exécute via l'API interne Voyager, avec
// la propre session de l'utilisateur. Le pacing est appliqué CÔTÉ SERVEUR
// (fenêtre, plafonds, intervalle) : ici on ne fait que demander la prochaine
// action prête et remonter le résultat.

importScripts('linkedin-invite.js', 'linkedin-message.js', 'linkedin-inbox.js');

// Repli quand l'extension n'a pas encore vu d'application : c'est le cas d'une
// installation fraiche, avant la premiere connexion. La production est le cas
// courant ; un developpeur qui travaille en local recoit l'origine reelle au
// moment ou il connecte l'extension, et elle est alors memorisee.
const DEFAULT_BASE_URL = 'https://jay-reach.vercel.app';
const POLL_MINUTES = 2;
// La relève des réponses est plus espacée que l'envoi : elle lit la messagerie,
// et rien ne justifie de le faire toutes les deux minutes. Un quart d'heure
// borne le risque — le temps maximal pendant lequel une relance peut partir
// vers quelqu'un qui vient de répondre — sans multiplier les requêtes.
const RELEVE_MINUTES = 15;
const PAUSE_MS = 24 * 60 * 60 * 1000; // pause 24 h sur compte restreint / déconnecté

/**
 * Pose les deux alarmes. Appelé à l'installation ET au démarrage du service
 * worker : `onInstalled` ne se déclenche pas quand Chrome redémarre, et une
 * extension mise à jour depuis une version qui ne connaissait pas la relève
 * n'aurait jamais eu son alarme. `chrome.alarms.create` sur un nom existant
 * remplace l'alarme sans en créer une seconde, l'appel est donc sans risque.
 */
function poserLesAlarmes() {
  chrome.alarms.create('pollLinkedIn', { periodInMinutes: POLL_MINUTES });
  chrome.alarms.create('releverReponses', { periodInMinutes: RELEVE_MINUTES });
}

chrome.runtime.onInstalled.addListener(poserLesAlarmes);
chrome.runtime.onStartup.addListener(poserLesAlarmes);
poserLesAlarmes();

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollLinkedIn') pollLinkedInQueue();
  if (alarm.name === 'releverReponses') releverReponses();
});

function getStored(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function getBaseUrl() {
  const { appBaseUrl } = await getStored(['appBaseUrl']);
  return (appBaseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function getToken() {
  const { extensionToken } = await getStored(['extensionToken']);
  return extensionToken || null;
}

async function getPausedUntil() {
  const { linkedinPausedUntil } = await getStored(['linkedinPausedUntil']);
  const until = linkedinPausedUntil || 0;
  return until > Date.now() ? until : null;
}

async function pause(reason) {
  await chrome.storage.local.set({ linkedinPausedUntil: Date.now() + PAUSE_MS, linkedinPauseReason: reason });
  console.warn(`⏸️ LinkedIn en pause 24 h. Raison : ${reason}`);
}

async function postJson(base, path, payload) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res;
}

async function pollLinkedInQueue() {
  try {
    const token = await getToken();
    if (!token) return;

    const pausedUntil = await getPausedUntil();
    if (pausedUntil) return;

    const base = await getBaseUrl();
    const res = await postJson(base, '/api/extension/linkedin/next', { token });
    if (!res.ok) {
      console.error('❌ next a échoué :', res.status);
      return;
    }

    const data = await res.json();
    if (!data.action) {
      // reasons : outside_window | weekly_cap_reached | too_soon | daily_cap_reached
      //           | manual_mode | queue_empty | race_retry
      if (data.reason && data.reason !== 'queue_empty') {
        console.log(`ℹ️ LinkedIn : ${data.reason}`);
      }
      return;
    }

    // Une relève juste avant d'envoyer : on est déjà en train de parler à
    // LinkedIn, et c'est le dernier moment où une réponse reçue peut encore
    // annuler l'envoi. Si elle échoue, on envoie quand même — le pire serait
    // qu'une messagerie momentanément indisponible bloque toute la séquence.
    await releverReponses();

    const { id: queueId, kind, linkedinUrl, messageBody } = data.action;
    console.log(`📨 Action LinkedIn ${kind} → ${linkedinUrl}`);

    const result =
      kind === 'message'
        ? await self.sendLinkedInMessage(linkedinUrl, messageBody || '')
        : await self.sendLinkedInInvitation(linkedinUrl);
    console.log('📊 Résultat :', result);

    // En cas de succès on n'envoie ni code ni message : `result.code` vaut alors
    // 'sent', et le remonter renseignait `error_code` sur une ligne réussie —
    // une colonne d'erreur non nulle sur un envoi qui s'est bien passé rend
    // toute lecture de la file trompeuse.
    await postJson(base, '/api/extension/linkedin/update', {
      token,
      queue_id: queueId,
      status: result.ok ? 'sent' : 'failed',
      // L'URN résolu à l'envoi est remonté : c'est le SEUL moyen de reconnaître
      // l'auteur d'une réponse plus tard. Mesuré sur l'API : les messages reçus
      // ne portent jamais l'identifiant public de leur expéditeur, seulement son
      // URN — un contact qu'on ne connaît que par son URL resterait donc muet.
      ...(result.profileUrn ? { profile_urn: result.profileUrn } : {}),
      ...(result.ok ? {} : { error_code: result.code, error_message: result.message }),
    });

    if (!result.ok && (result.code === 'restricted' || result.code === 'not_logged_in')) {
      await pause(result.code);
    }
  } catch (err) {
    console.error('❌ pollLinkedInQueue :', err);
  }
}

/**
 * Relève les réponses reçues sur LinkedIn et les remonte à l'application.
 *
 * Le tri se fait ici : l'app dit quels profils elle suit, et seules les réponses
 * de ces personnes quittent le navigateur. La messagerie personnelle de
 * l'utilisateur n'est jamais transmise.
 */
/**
 * Remonte a l'application le compte LinkedIn depuis lequel l'extension enverra.
 *
 * Appelee apres la connexion, puis a chaque releve : la session LinkedIn du
 * navigateur peut changer sans que l'extension soit reinstallee, et l'ecran
 * afficherait alors un compte qui n'est plus celui qui enverra.
 *
 * Silencieuse en cas d'echec : ce n'est qu'un libelle d'ecran, il ne doit pas
 * empecher une releve de reponses de se faire.
 */
async function remonterProfil() {
  try {
    const token = await getToken();
    if (!token) return;
    const csrf = await self.linkedinGetCsrfToken();
    const identite = await self.linkedinGetSelfIdentity(csrf);
    if (!identite?.name && !identite?.publicIdentifier) return;
    const base = await getBaseUrl();
    await postJson(base, '/api/extension/linkedin/profile', {
      token,
      name: identite.name,
      publicIdentifier: identite.publicIdentifier,
    });
  } catch (err) {
    console.warn('⚠️ Profil LinkedIn non remonte :', err?.code || err?.message || err);
  }
}

async function releverReponses() {
  try {
    const token = await getToken();
    if (!token) return;
    if (await getPausedUntil()) return;

    const base = await getBaseUrl();
    const resListe = await postJson(base, '/api/extension/linkedin/watchlist', { token });
    if (!resListe.ok) return;
    const { profils } = await resListe.json();
    if (!Array.isArray(profils) || profils.length === 0) return;

    const { derniereReleve } = await getStored(['derniereReleve']);
    // Premier passage : on ne remonte que les douze dernières heures. Sans cette
    // borne, l'installation de l'extension ferait remonter d'anciennes
    // conversations comme si elles venaient d'arriver.
    const depuis = derniereReleve || Date.now() - 12 * 60 * 60 * 1000;

    // Rattrapage : les contacts contactés avant cette version n'ont pas d'URN,
    // et sans lui leurs réponses resteraient invisibles. Quelques-uns par tour.
    const resolus = await self.resoudreUrnManquants(profils);
    for (const r of resolus) {
      const cible = profils.find((p) => p.vanity === r.vanity);
      if (cible) cible.urn = r.urn;
    }

    const releve = await self.releverReponsesLinkedIn(profils, depuis);
    if (!releve.ok) {
      console.warn('⚠️ Relève des réponses impossible :', releve.code);
      if (releve.code === 'not_logged_in') await pause(releve.code);
      return;
    }

    if (releve.reponses.length > 0) {
      const res = await postJson(base, '/api/extension/linkedin/replies', {
        token,
        replies: releve.reponses,
        resolvedProfiles: resolus,
      });
      if (!res.ok) {
        // On ne déplace pas le curseur : ces réponses seront reproposées.
        console.error('❌ Remontée des réponses refusée :', res.status);
        return;
      }
      const bilan = await res.json();
      console.log(`💬 ${bilan.enregistrees} réponse(s) LinkedIn enregistrée(s), ${bilan.deja} déjà connue(s)`);
    }

    // Les URN résolus sont remontés même sans réponse à signaler : ils servent
    // aux relèves suivantes.
    if (releve.reponses.length === 0 && resolus.length > 0) {
      await postJson(base, '/api/extension/linkedin/replies', { token, replies: [], resolvedProfiles: resolus });
    }

    await chrome.storage.local.set({ derniereReleve: Date.now() });
    await remonterProfil();
  } catch (err) {
    console.error('❌ releverReponses :', err);
  }
}

// Messages du popup (statut, poll manuel, reset pause).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === 'JAY_REACH_REMONTER_PROFIL') {
    remonterProfil().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'POLL_NOW') {
    pollLinkedInQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'RELEVER_NOW') {
    releverReponses().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'RESET_PAUSE') {
    chrome.storage.local.remove(['linkedinPausedUntil', 'linkedinPauseReason'], () => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

async function getStatus() {
  const token = await getToken();
  const base = await getBaseUrl();
  const pausedUntil = await getPausedUntil();
  const { linkedinPauseReason } = await getStored(['linkedinPauseReason']);
  return {
    configured: !!token,
    baseUrl: base,
    pausedUntil: pausedUntil || null,
    pauseReason: pausedUntil ? linkedinPauseReason || null : null,
  };
}

// Réception du token depuis la page /settings/linkedin de l'app (handshake).
chrome.runtime.onMessageExternal.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'JAY_REACH_LINKEDIN_TOKEN' && typeof message.token === 'string') {
    const patch = { extensionToken: message.token };
    if (typeof message.baseUrl === 'string') patch.appBaseUrl = message.baseUrl.replace(/\/$/, '');
    chrome.storage.local.set(patch, () => {
      pollLinkedInQueue();
      // Juste apres la connexion : l'ecran de reglages attend de pouvoir dire a
      // quel compte il est connecte, sans faire patienter jusqu'a la releve
      // suivante.
      remonterProfil();
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'TRIGGER_LINKEDIN_POLL') {
    pollLinkedInQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'TRIGGER_LINKEDIN_RELEVE') {
    releverReponses().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Poll immédiat au démarrage si déjà configuré.
getToken().then((t) => {
  if (t) pollLinkedInQueue();
});

// Service worker Jay Reach — LinkedIn. Poll la file d'actions LinkedIn de
// l'app (invitations + messages) et les exécute via l'API interne Voyager, avec
// la propre session de l'utilisateur. Le pacing est appliqué CÔTÉ SERVEUR
// (fenêtre, plafonds, intervalle) : ici on ne fait que demander la prochaine
// action prête et remonter le résultat.

importScripts('linkedin-invite.js', 'linkedin-message.js');

const DEFAULT_BASE_URL = 'http://localhost:3000';
const POLL_MINUTES = 2;
const PAUSE_MS = 24 * 60 * 60 * 1000; // pause 24 h sur compte restreint / déconnecté

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('pollLinkedIn', { periodInMinutes: POLL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pollLinkedIn') pollLinkedInQueue();
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

    const { id: queueId, kind, linkedinUrl, messageBody } = data.action;
    console.log(`📨 Action LinkedIn ${kind} → ${linkedinUrl}`);

    const result =
      kind === 'message'
        ? await self.sendLinkedInMessage(linkedinUrl, messageBody || '')
        : await self.sendLinkedInInvitation(linkedinUrl);
    console.log('📊 Résultat :', result);

    await postJson(base, '/api/extension/linkedin/update', {
      token,
      queue_id: queueId,
      status: result.ok ? 'sent' : 'failed',
      error_code: result.code,
      error_message: result.message,
    });

    if (!result.ok && (result.code === 'restricted' || result.code === 'not_logged_in')) {
      await pause(result.code);
    }
  } catch (err) {
    console.error('❌ pollLinkedInQueue :', err);
  }
}

// Messages du popup (statut, poll manuel, reset pause).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    getStatus().then(sendResponse);
    return true;
  }
  if (message.type === 'POLL_NOW') {
    pollLinkedInQueue().then(() => sendResponse({ ok: true }));
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
      sendResponse({ ok: true });
    });
    return true;
  }
  if (message?.type === 'TRIGGER_LINKEDIN_POLL') {
    pollLinkedInQueue().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

// Poll immédiat au démarrage si déjà configuré.
getToken().then((t) => {
  if (t) pollLinkedInQueue();
});

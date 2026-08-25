// Envoi d'un message (DM) LinkedIn via l'API interne Voyager. NET-NEW pour Jay
// Reach : l'extension interne de JB ne faisait que les invitations. Même
// technique (session de l'utilisateur, token CSRF du cookie), endpoint de
// messagerie. Réutilise les helpers exposés par linkedin-invite.js.
//
// ⚠️ L'endpoint de messagerie Voyager évolue régulièrement côté LinkedIn : ce
// module est à VALIDER avec un vrai compte connecté (test manuel). On ne peut
// écrire qu'aux relations de 1er degré (sinon LinkedIn refuse → cannot_message).
//
// Exporte self.sendLinkedInMessage(linkedinUrl, text) → { ok, code, message }

const VOYAGER_MESSAGE_URL =
  'https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage';
const VOYAGER_ME_URL = 'https://www.linkedin.com/voyager/api/me';

const MESSAGE_HEADERS = {
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'fr_FR',
};

// URN du profil de l'expéditeur (mailboxUrn), lu depuis /voyager/api/me.
async function getSelfProfileUrn(csrf) {
  const res = await fetch(VOYAGER_ME_URL, {
    method: 'GET',
    credentials: 'include',
    headers: { ...MESSAGE_HEADERS, 'csrf-token': csrf },
  });
  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('not_logged_in'), { code: 'not_logged_in' });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`me_${res.status}`), { code: 'me_error' });
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw Object.assign(new Error('invalid_json_response'), { code: 'me_error' });
  }
  // Le profil courant est référencé sous *miniProfile (urn:li:fsd_profile:…),
  // avec un fallback sur included[].
  let urn = data?.data?.['*miniProfile'] || data?.data?.miniProfile;
  if ((!urn || !String(urn).includes('fsd_profile')) && Array.isArray(data?.included)) {
    const self = data.included.find((i) => i?.entityUrn?.startsWith('urn:li:fsd_profile:'));
    urn = self?.entityUrn || urn;
  }
  if (!urn) {
    throw Object.assign(new Error('self_urn_not_found'), { code: 'me_error' });
  }
  // Normalise vers urn:li:fsd_profile:<id>
  return String(urn).replace('urn:li:fs_miniProfile:', 'urn:li:fsd_profile:');
}

async function createMessage(senderUrn, recipientUrn, text, csrf) {
  const body = {
    message: {
      body: { text, attributes: [] },
      renderContentUnions: [],
    },
    mailboxUrn: senderUrn,
    trackingId: '',
    dedupeByClientGeneratedToken: false,
    hostRecipientUrns: [recipientUrn],
  };

  const res = await fetch(VOYAGER_MESSAGE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { ...MESSAGE_HEADERS, 'csrf-token': csrf, 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });

  if (res.status === 200 || res.status === 201) {
    return { ok: true, code: 'sent' };
  }

  let code = 'unknown';
  let message = `HTTP ${res.status}`;
  try {
    const data = await res.json();
    if (data?.message) message = data.message;
    if (data?.code) code = String(data.code);
  } catch {
    /* corps non-JSON */
  }

  if (res.status === 401) code = 'not_logged_in';
  else if (res.status === 429) code = 'restricted';
  else if (res.status === 403 || res.status === 422) {
    // Souvent : destinataire hors relation de 1er degré.
    code = /restrict|quota|limit/i.test(message) ? 'restricted' : 'cannot_message';
  } else if (res.status === 400) code = 'bad_request';

  return { ok: false, code, message: `${res.status} ${message}` };
}

async function sendLinkedInMessage(linkedinUrl, text) {
  try {
    if (!text || !String(text).trim()) {
      return { ok: false, code: 'empty_message', message: 'Corps du message vide' };
    }
    const vanity = self.linkedinExtractVanity(linkedinUrl);
    const csrf = await self.linkedinGetCsrfToken();
    const recipientUrn = await self.linkedinResolveProfileUrn(vanity, csrf);
    const senderUrn = await getSelfProfileUrn(csrf);
    return await createMessage(senderUrn, recipientUrn, String(text), csrf);
  } catch (err) {
    return { ok: false, code: err?.code || 'exception', message: err?.message || String(err) };
  }
}

self.sendLinkedInMessage = sendLinkedInMessage;

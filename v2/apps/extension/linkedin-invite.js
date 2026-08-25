// Envoi d'une invitation LinkedIn via l'API interne Voyager, depuis le service
// worker, avec la propre session de l'utilisateur (cookies attachés grâce à
// host_permissions linkedin.com ; token CSRF lu dans le cookie JSESSIONID).
// Repris de l'extension interne « Jay » (JB), inchangé sur le fond.
//
// Séquence :
//   1. getCsrfToken() depuis le cookie JSESSIONID
//   2. resolveProfileUrn(vanity) → URN exact du profil (endpoint identity)
//   3. sendInvitation(urn, csrf) → POST Voyager (sans note)
//
// Exporte self.sendLinkedInInvitation(linkedinUrl) → { ok, code, message }

const VOYAGER_INVITE_URL =
  'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2';

const INVITE_HEADERS = {
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
  'x-li-lang': 'fr_FR',
};

async function getCsrfToken() {
  return new Promise((resolve, reject) => {
    chrome.cookies.get({ url: 'https://www.linkedin.com', name: 'JSESSIONID' }, (cookie) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`Cookie API error: ${chrome.runtime.lastError.message}`));
        return;
      }
      if (!cookie) {
        reject(Object.assign(new Error('not_logged_in: JSESSIONID absent'), { code: 'not_logged_in' }));
        return;
      }
      resolve(cookie.value.replace(/^"|"$/g, ''));
    });
  });
}

// Slug du profil après /in/ dans l'URL LinkedIn.
function extractVanity(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (e) {
    throw Object.assign(new Error(`invalid_url: ${e.message}`), { code: 'invalid_url' });
  }
  if (!u.hostname.endsWith('linkedin.com')) {
    throw Object.assign(new Error('not_linkedin_url'), { code: 'invalid_url' });
  }
  const match = u.pathname.match(/^\/in\/([^/?#]+)/);
  if (!match) {
    throw Object.assign(new Error('no_vanity_in_url'), { code: 'invalid_url' });
  }
  return decodeURIComponent(match[1]);
}

// Résout le vanity name vers l'URN du profil (fiable, contrairement au scraping HTML).
async function resolveProfileUrn(vanity, csrf) {
  const url = `https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=${encodeURIComponent(vanity)}`;
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: { ...INVITE_HEADERS, 'csrf-token': csrf },
  });

  if (res.status === 401 || res.status === 403) {
    throw Object.assign(new Error('not_logged_in'), { code: 'not_logged_in' });
  }
  if (res.status === 404) {
    throw Object.assign(new Error('profile_not_found'), { code: 'profile_not_found' });
  }
  if (!res.ok) {
    throw Object.assign(new Error(`profile_resolve_${res.status}`), { code: 'profile_resolve_error' });
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw Object.assign(new Error('invalid_json_response'), { code: 'profile_resolve_error' });
  }

  const elements = data?.elements || data?.data?.elements;
  let entityUrn = null;
  if (Array.isArray(elements) && elements.length > 0) {
    entityUrn = elements[0]?.entityUrn || elements[0]?.['*entityUrn'];
  }
  if (!entityUrn && Array.isArray(data?.included)) {
    for (const item of data.included) {
      if (item?.entityUrn?.startsWith('urn:li:fsd_profile:') && item.publicIdentifier === vanity) {
        entityUrn = item.entityUrn;
        break;
      }
    }
  }

  if (!entityUrn || !entityUrn.startsWith('urn:li:fsd_profile:')) {
    throw Object.assign(new Error('urn_not_found'), { code: 'urn_not_found' });
  }
  return entityUrn;
}

async function sendInvitation(urn, csrf) {
  const body = { invitee: { inviteeUnion: { memberProfile: urn } } };
  const res = await fetch(VOYAGER_INVITE_URL, {
    method: 'POST',
    credentials: 'include',
    headers: { ...INVITE_HEADERS, 'csrf-token': csrf, 'content-type': 'application/json; charset=UTF-8' },
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
  else if (res.status === 422) {
    if (/already/i.test(message) || code === 'CANT_RESEND_YET') code = 'already_invited';
    else if (/quota|limit|restrict/i.test(message)) code = 'restricted';
    else code = 'cannot_invite';
  } else if (res.status === 400) code = 'bad_request';

  return { ok: false, code, message: `${res.status} ${message}` };
}

async function sendLinkedInInvitation(linkedinUrl) {
  try {
    const vanity = extractVanity(linkedinUrl);
    const csrf = await getCsrfToken();
    const urn = await resolveProfileUrn(vanity, csrf);
    return await sendInvitation(urn, csrf);
  } catch (err) {
    return { ok: false, code: err?.code || 'exception', message: err?.message || String(err) };
  }
}

// Exposés au service worker (utilisés aussi par linkedin-message.js).
self.sendLinkedInInvitation = sendLinkedInInvitation;
self.linkedinGetCsrfToken = getCsrfToken;
self.linkedinExtractVanity = extractVanity;
self.linkedinResolveProfileUrn = resolveProfileUrn;

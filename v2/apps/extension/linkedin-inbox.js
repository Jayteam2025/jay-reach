// Relève des réponses reçues sur LinkedIn.
//
// L'extension envoyait sans jamais lire : un prospect qui répondait ici
// continuait de recevoir les relances email, puisque rien ne le signalait au
// séquenceur.
//
// Un seul appel suffit. `messengerConversationsBySyncToken` renvoie les vingt
// dernières conversations AVEC leur dernier message — auteur, date, texte et
// identifiant — donc il est inutile d'ouvrir les fils un par un. C'est aussi ce
// qui rend la relève discrète : une requête par tour, celle que fait déjà la
// page messagerie quand on l'ouvre.
//
// Le tri se fait ICI, pas sur le serveur. L'extension lit la messagerie
// personnelle de l'utilisateur ; seules les réponses des personnes réellement
// démarchées quittent le navigateur.

const CONVERSATIONS_QUERY_ID = 'messengerConversations.b7affb08320b28f0d8bf883fe8590337';
const VOYAGER_GRAPHQL = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql';

/** Nombre de conversations demandées. Au-delà, on relève du bruit ancien. */
const NB_CONVERSATIONS = 20;

/** Extrait l'identifiant de profil d'un URN `urn:li:fsd_profile:<id>`. */
function idDeProfil(urn) {
  if (typeof urn !== 'string') return null;
  const m = urn.match(/urn:li:fsd_profile:([^,)\s]+)/);
  return m ? m[1] : null;
}

/**
 * Relève les réponses reçues depuis `depuisMs`, en ne gardant que les profils
 * surveillés.
 *
 * `surveilles` est la liste renvoyée par l'application : des URN et des
 * identifiants publics. On accepte les deux parce que les contacts importés
 * n'ont souvent que l'URL de leur profil, l'URN n'étant connu qu'après un
 * premier échange.
 */
async function releverReponsesLinkedIn(surveilles, depuisMs) {
  const csrf = await self.linkedinGetCsrfToken();
  const moi = await self.linkedinGetSelfProfileUrn(csrf);
  const monId = idDeProfil(moi);

  const url =
    `${VOYAGER_GRAPHQL}?queryId=${CONVERSATIONS_QUERY_ID}` +
    `&variables=(mailboxUrn:${encodeURIComponent(moi)},count:${NB_CONVERSATIONS})`;

  const res = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      'csrf-token': csrf,
      'x-restli-protocol-version': '2.0.0',
    },
  });
  if (!res.ok) {
    return { ok: false, code: res.status === 401 ? 'not_logged_in' : 'http_' + res.status, reponses: [] };
  }

  const donnees = await res.json();
  const cle = Object.keys(donnees?.data ?? {}).find((k) => k.startsWith('messengerConversations'));
  const conversations = donnees?.data?.[cle]?.elements ?? [];

  // Index des profils surveillés, par URN : c'est la seule clé qu'un message
  // reçu permette de comparer.
  const parId = new Set();
  for (const p of surveilles) {
    const id = idDeProfil(p.urn);
    if (id) parId.add(id);
  }

  const reponses = [];
  for (const conv of conversations) {
    if (typeof conv?.lastActivityAt === 'number' && conv.lastActivityAt <= depuisMs) continue;

    const message = conv?.messages?.elements?.[0];
    if (!message) continue;

    const auteurUrn = message.sender?.hostIdentityUrn;
    const auteurId = idDeProfil(auteurUrn);
    // Message envoyé par nous : ce n'est pas une réponse.
    if (!auteurId || auteurId === monId) continue;

    // Mesuré sur l'API : un message reçu ne porte JAMAIS l'identifiant public de
    // son expéditeur, seulement son URN. C'est donc la seule clé exploitable ici,
    // et c'est pourquoi l'URN est retenu au moment de l'envoi.
    if (!parId.has(auteurId)) continue;

    const texte = message.body?.text;
    if (typeof texte !== 'string' || texte.trim().length === 0) continue;

    reponses.push({
      profileUrn: auteurUrn,
      text: texte,
      messageId: message.entityUrn ?? null,
      receivedAt: new Date(message.deliveredAt ?? conv.lastActivityAt ?? Date.now()).toISOString(),
    });
  }

  return { ok: true, code: 'ok', reponses };
}

/**
 * Résout l'URN de quelques profils surveillés qui n'en ont pas encore.
 *
 * Les contacts importés ne portent que l'URL de leur profil, et un message reçu
 * ne permet de reconnaître son auteur que par son URN : sans cette résolution,
 * une réponse de ces contacts passerait inaperçue pour toujours. Les envois à
 * venir renseignent l'URN tout seuls ; ceci ne sert qu'à rattraper ceux qui ont
 * été contactés avant.
 *
 * Volontairement lent : quelques profils par tour, pour ne pas déclencher une
 * rafale de requêtes d'identification sur un compte LinkedIn.
 */
async function resoudreUrnManquants(surveilles, maximum = 3) {
  const aResoudre = surveilles.filter((p) => !p.urn && p.vanity).slice(0, maximum);
  if (aResoudre.length === 0) return [];

  const csrf = await self.linkedinGetCsrfToken();
  const resolus = [];
  for (const p of aResoudre) {
    try {
      const urn = await self.linkedinResolveProfileUrn(p.vanity, csrf);
      if (typeof urn === 'string' && urn.includes('fsd_profile')) {
        resolus.push({ vanity: p.vanity, urn });
      }
    } catch {
      // Profil supprimé, renommé, ou hors d'atteinte : on réessaiera plus tard.
    }
  }
  return resolus;
}

self.releverReponsesLinkedIn = releverReponsesLinkedIn;
self.resoudreUrnManquants = resoudreUrnManquants;

/**
 * Les appels Voyager d'ENVOI (lot 4b) : résoudre un profil, inviter, écrire.
 *
 * Portés de l'extension navigateur (`apps/extension/linkedin-invite.js` et
 * `linkedin-message.js`), éprouvée en production : URL, formes de corps et
 * correspondances de statuts sont ceux qu'elle employait, pas des inventions.
 * Les écarts sont signalés à l'endroit où ils ont lieu.
 *
 * Un envoi ne se rattrape pas. Deux conséquences dans ce fichier :
 *  - un statut qu'on ne sait pas lire LEVE une erreur nommée au lieu de rendre un
 *    refus : on ignore alors si l'action est partie, et rien ne doit la rejouer ;
 *  - aucun message d'erreur ne porte le corps d'une réponse LinkedIn ni une URL de
 *    proxy. Les erreurs ont un NOM, comme dans `navigateur.ts`.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ENTETES_VOYAGER } from './engageurs.js';
import type { Pilote } from './navigateur.js';

export type CodeRefus =
  | 'not_logged_in'
  | 'restricted'
  | 'already_invited'
  | 'cannot_invite'
  | 'cannot_message'
  | 'profile_not_found'
  | 'invalid_url'
  | 'bad_request'
  /**
   * Une note d'invitation a été demandée. Le champ Voyager qui la porte n'a jamais été
   * relevé (l'extension invitait sans note) : il reste à relever en recette. Code distinct
   * de `bad_request` pour que l'opérateur lise que le produit ne la supporte pas, et non
   * qu'il a mal saisi quelque chose.
   */
  | 'note_non_supportee'
  | 'defi';

export type ResultatEnvoi = { ok: true } | { ok: false; code: CodeRefus };

/** Refus de LinkedIn rendu par `resoudreProfil`, qui doit rendre une chaîne : il lève. Le message est le code, rien d'autre. */
export class ErreurEnvoi extends Error {
  constructor(readonly code: CodeRefus) {
    super(code);
    this.name = 'ErreurEnvoi';
  }
}

/** Une erreur dont le NOM dit la panne ; le message est écrit ici, jamais copié d'une réponse. */
function erreurNommee(nom: string, message: string): Error {
  const e = new Error(message);
  e.name = nom;
  return e;
}

/**
 * Statut qu'on ne sait pas lire. Le NOM dit si l'action a pu partir, car c'est la seule
 * chose que le projet consigne dans `engine_status.last_error` : `...Invitation` et
 * `...Message` sont des POST, JAMAIS rejouables ; `...Resolution` et `...Expediteur`
 * sont des GET, rejouables sans risque. Le statut est un entier que nous écrivons
 * nous-mêmes, il ne peut porter aucun secret.
 */
type NomStatutInattendu =
  | 'StatutInattenduResolution'
  | 'StatutInattenduExpediteur'
  | 'StatutInattenduInvitation'
  | 'StatutInattenduMessage';
const statutInattendu = (nom: NomStatutInattendu, statut: number) =>
  erreurNommee(nom, `LinkedIn a répondu ${statut}`);

const URL_PROFILS = 'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=';
const URL_INVITATION =
  'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships?action=verifyQuotaAndCreateV2';
const URL_MESSAGE = 'https://www.linkedin.com/voyager/api/voyagerMessagingDashMessengerMessages?action=createMessage';
const URL_MOI = 'https://www.linkedin.com/voyager/api/me';
const URL_FIL = 'https://www.linkedin.com/feed/';

const PREFIXE_PROFIL = 'urn:li:fsd_profile:';

/** `x-li-lang` : l'extension l'envoyait sur ces appels. Le `csrf-token` est posé par le pilote. */
const ENTETES = { ...ENTETES_VOYAGER, 'x-li-lang': 'fr_FR' };

/**
 * `requete` est `same-origin` : elle ne marche que depuis une page LinkedIn. On ne
 * navigue que si la page n'y est pas déjà, un chargement de plus par envoi serait
 * du trafic inutile sur un compte qu'on ménage.
 */
async function surLinkedin(pilote: Pilote): Promise<void> {
  const courante = await pilote.url();
  if (!/^https:\/\/www\.linkedin\.com\//.test(courante)) await pilote.aller(URL_FIL);
}

function lireJson(corps: string): unknown {
  try {
    return JSON.parse(corps);
  } catch {
    return undefined;
  }
}

/** Les statuts qui disent la même chose sur les trois appels. */
function refusCommun(statut: number): CodeRefus | null {
  if (statut === 999) return 'defi';
  if (statut === 401) return 'not_logged_in';
  if (statut === 429) return 'restricted';
  return null;
}

/** Seuls 200 et 201 sont un succès, comme dans l'extension : un autre 2xx est un cas qu'on ne connaît pas. */
const reussi = (statut: number) => statut === 200 || statut === 201;

const SchemaErreur = z.object({
  message: z.string().optional().catch(undefined),
  code: z.union([z.string(), z.number()]).optional().catch(undefined),
});

/** Motif d'un refus 4xx, lu pour CLASSER seulement : il n'est ni journalisé ni recopié. */
function lireMotif(corps: string): { message: string; code: string } {
  const lu = SchemaErreur.safeParse(lireJson(corps));
  return { message: lu.success ? (lu.data.message ?? '') : '', code: lu.success ? String(lu.data.code ?? '') : '' };
}

const PLAFOND = /quota|limit|restrict/i;

/** Slug après `/in/`, ou `null` : l'URL n'est pas une page de profil LinkedIn. */
function extraireIdentifiant(brute: string): string | null {
  let u: URL;
  try {
    u = new URL(brute.trim());
  } catch {
    return null;
  }
  // `endsWith('linkedin.com')` seul (l'extension) accepterait `evillinkedin.com`.
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // Un hôte à point final (`www.linkedin.com.`) est le même hôte.
  const hote = u.hostname.replace(/\.$/, '');
  if (hote !== 'linkedin.com' && !hote.endsWith('.linkedin.com')) return null;
  // Formes qu'on trouve dans un fichier importé : `/in/x`, `/IN/x`, `/mwlite/in/x`, `/pub/x/1/2/3`.
  // Si le slug ne désigne pas un identifiant public, la résolution le refuse (voir `resoudreProfil`).
  const m = /^\/(?:mwlite\/)?(?:in|pub)\/([^/?#]+)/i.exec(u.pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]!);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

const SchemaElements = z.array(
  z.object({
    entityUrn: z.string().optional(),
    '*entityUrn': z.string().optional(),
    publicIdentifier: z.string().optional(),
  }),
);
const SchemaInclus = z.array(z.object({ entityUrn: z.string().optional(), publicIdentifier: z.string().optional() }));

const SchemaProfils = z.object({
  elements: SchemaElements.optional().catch(undefined),
  data: z.object({ elements: SchemaElements.optional().catch(undefined) }).optional().catch(undefined),
  included: SchemaInclus.optional().catch(undefined),
});

/**
 * URN `urn:li:fsd_profile:…` d'une page de profil. Lève `ErreurEnvoi` pour un
 * refus lisible, une erreur nommée pour tout le reste.
 */
export async function resoudreProfil(pilote: Pilote, linkedinUrl: string): Promise<string> {
  const identifiant = extraireIdentifiant(linkedinUrl);
  if (identifiant === null) throw new ErreurEnvoi('invalid_url');

  await surLinkedin(pilote);
  const rep = await pilote.requete(`${URL_PROFILS}${encodeURIComponent(identifiant)}`, ENTETES);

  const commun = refusCommun(rep.statut);
  if (commun) throw new ErreurEnvoi(commun);
  // Un 403 sur une LECTURE est un cookie ou un jeton refusés (l'extension le lisait ainsi).
  if (rep.statut === 403) throw new ErreurEnvoi('not_logged_in');
  if (rep.statut === 404) throw new ErreurEnvoi('profile_not_found');
  if (rep.statut < 200 || rep.statut >= 300) throw statutInattendu('StatutInattenduResolution', rep.statut);

  const lu = SchemaProfils.safeParse(lireJson(rep.corps));
  if (!lu.success) throw erreurNommee('ReponseIllisible', 'Réponse LinkedIn illisible');

  // Le profil retenu doit PORTER l'identifiant demandé, sur les deux chemins : si LinkedIn
  // répond 200 pour un slug obsolète en rendant un profil voisin, on inviterait quelqu'un
  // qui n'a jamais été ciblé. Sans identifiant exploitable, on n'invite pas à l'aveugle.
  // LinkedIn rend l'identifiant dans sa casse, le contact peut l'avoir dans une autre.
  const inclus = lu.data.included ?? [];
  const memeIdentifiant = (a: string | undefined) => a !== undefined && a.toLowerCase() === identifiant.toLowerCase();
  const element = (lu.data.elements ?? lu.data.data?.elements ?? [])[0];
  const urnElement = element?.entityUrn ?? element?.['*entityUrn'];
  if (urnElement?.startsWith(PREFIXE_PROFIL)) {
    const porte = element?.publicIdentifier ?? inclus.find((i) => i.entityUrn === urnElement)?.publicIdentifier;
    if (memeIdentifiant(porte)) return urnElement;
  }
  const urn = inclus.find((i) => i.entityUrn?.startsWith(PREFIXE_PROFIL) && memeIdentifiant(i.publicIdentifier))
    ?.entityUrn;
  if (!urn) throw new ErreurEnvoi('profile_not_found');
  return urn;
}

/**
 * Invitation SANS note. L'extension n'en envoyait jamais : le champ qui porte une
 * note n'a pas été relevé (à relever en recette), et l'inventer enverrait un corps que
 * personne n'a éprouvé à une vraie personne. Une note RÉELLE est donc refusée sans appel,
 * sous un code à elle. Une note vide ou blanche vaut absence : une colonne `default ''`
 * ou un `note ?? ''` ne doivent pas faire refuser toutes les invitations.
 */
export async function envoyerInvitation(pilote: Pilote, urn: string, note: string | null): Promise<ResultatEnvoi> {
  if (!urn.startsWith(PREFIXE_PROFIL)) return { ok: false, code: 'bad_request' };
  if (note !== null && note.trim() !== '') return { ok: false, code: 'note_non_supportee' };

  await surLinkedin(pilote);
  const rep = await pilote.requete(URL_INVITATION, ENTETES, { invitee: { inviteeUnion: { memberProfile: urn } } });
  if (reussi(rep.statut)) return { ok: true };

  const commun = refusCommun(rep.statut);
  if (commun) return { ok: false, code: commun };
  // Écart assumé : l'extension ne traitait pas le 403 d'une invitation. Sur Voyager c'est
  // la session ou le jeton refusés ; le lire comme `not_logged_in` ARRÊTE le canal
  // plutôt que de poursuivre une suite d'envois refusés.
  if (rep.statut === 403) return { ok: false, code: 'not_logged_in' };
  if (rep.statut === 400) return { ok: false, code: 'bad_request' };
  if (rep.statut === 422) {
    const { message, code } = lireMotif(rep.corps);
    if (/already/i.test(message) || code === 'CANT_RESEND_YET') return { ok: false, code: 'already_invited' };
    if (PLAFOND.test(message)) return { ok: false, code: 'restricted' };
    return { ok: false, code: 'cannot_invite' };
  }
  throw statutInattendu('StatutInattenduInvitation', rep.statut);
}

const SchemaMoi = z.object({
  data: z
    .object({
      '*miniProfile': z.string().optional().catch(undefined),
      miniProfile: z
        .union([z.string(), z.object({ publicIdentifier: z.string().optional() })])
        .optional()
        .catch(undefined),
      publicIdentifier: z.string().optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  included: SchemaInclus.optional().catch(undefined),
});

/**
 * URN du compte qui écrit (le `mailboxUrn`). `/me` ne rend PAS le profil mais une
 * RÉFÉRENCE (`*miniProfile`, en `fs_miniProfile`), à normaliser en `fsd_profile`.
 * À défaut de référence, on cherche dans `included` (qui porte des `fs_miniProfile`,
 * forme mesurée sur la réponse réelle) le profil dont l'identifiant public est NOTRE
 * identifiant. Jamais un profil sans correspondance, jamais « le premier » : écrire
 * depuis la mauvaise boîte est pire que ne rien envoyer. `null` si rien ne se lit,
 * et le message ne part pas.
 */
function lireExpediteur(corps: unknown): string | null {
  const lu = SchemaMoi.safeParse(corps);
  if (!lu.success) return null;
  const { data, included = [] } = lu.data;
  const monIdentifiant =
    (typeof data?.miniProfile === 'object' ? data.miniProfile.publicIdentifier : undefined) ?? data?.publicIdentifier;
  let urn = data?.['*miniProfile'] ?? (typeof data?.miniProfile === 'string' ? data.miniProfile : undefined);
  if (!urn || !/fsd_profile|miniProfile/.test(urn)) {
    if (!monIdentifiant) return null;
    urn = included.find(
      (i) =>
        i.entityUrn !== undefined &&
        /fsd_profile|miniProfile/.test(i.entityUrn) &&
        i.publicIdentifier?.toLowerCase() === monIdentifiant.toLowerCase(),
    )?.entityUrn;
  }
  if (!urn) return null;
  const normalise = urn.replace('urn:li:fs_miniProfile:', PREFIXE_PROFIL);
  return normalise.startsWith(PREFIXE_PROFIL) ? normalise : null;
}

/**
 * L'URN de l'expéditeur est stable sur toute la session : un appel `/me` par message
 * doublerait le trafic Voyager d'un compte qu'on ménage. Une session = un pilote.
 * Seul un succès est mémorisé.
 */
const expediteurs = new WeakMap<Pilote, string>();

/**
 * Chaîne de 16 caractères dont chacun a le code d'un octet aléatoire (0 à 255), comme
 * l'extension : ce n'est ni du base64 ni de l'hexadécimal, et sur le fil JSON elle
 * occupe 16 à 32 octets selon l'encodage UTF-8 des caractères au-dessus de 127.
 * Un `trackingId` vide fait répondre 400 muet (retour terrain de l'extension).
 */
function trackingId(): string {
  return String.fromCharCode(...randomBytes(16));
}

export async function envoyerMessage(pilote: Pilote, urn: string, texte: string): Promise<ResultatEnvoi> {
  if (!urn.startsWith(PREFIXE_PROFIL) || texte.trim() === '') return { ok: false, code: 'bad_request' };

  await surLinkedin(pilote);
  let expediteur = expediteurs.get(pilote);
  if (expediteur === undefined) {
    const moi = await pilote.requete(URL_MOI, ENTETES);
    const refusMoi = refusCommun(moi.statut) ?? (moi.statut === 403 ? 'not_logged_in' : null);
    if (refusMoi) return { ok: false, code: refusMoi };
    if (moi.statut < 200 || moi.statut >= 300) throw statutInattendu('StatutInattenduExpediteur', moi.statut);
    const lu = lireExpediteur(lireJson(moi.corps));
    if (lu === null) throw erreurNommee('ExpediteurIntrouvable', "Profil de l'expéditeur introuvable");
    expediteur = lu;
    expediteurs.set(pilote, expediteur);
  }

  const rep = await pilote.requete(URL_MESSAGE, ENTETES, {
    message: {
      body: { text: texte, attributes: [] },
      renderContentUnions: [],
      // DANS `message`, pas à la racine du corps : à la racine, LinkedIn répond 400
      // (relevé sur l'extension en production).
      originToken: randomUUID(),
    },
    mailboxUrn: expediteur,
    trackingId: trackingId(),
    // Héritage de l'extension : la déduplication côté LinkedIn est DÉSACTIVÉE et l'`originToken`
    // change à chaque appel. Un jeton dérivé de l'action avec `true` protégerait du double
    // envoi, mais personne ne l'a éprouvé : à essayer en recette, pas à changer ici.
    dedupeByClientGeneratedToken: false,
    hostRecipientUrns: [urn],
  });
  if (reussi(rep.statut)) return { ok: true };

  const commun = refusCommun(rep.statut);
  if (commun) return { ok: false, code: commun };
  if (rep.statut === 400) return { ok: false, code: 'bad_request' };
  if (rep.statut === 403 || rep.statut === 422) {
    // Le plus souvent : destinataire hors du premier degré (point de vigilance 3).
    return { ok: false, code: PLAFOND.test(lireMotif(rep.corps).message) ? 'restricted' : 'cannot_message' };
  }
  throw statutInattendu('StatutInattenduMessage', rep.statut);
}

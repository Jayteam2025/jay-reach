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
  if (u.hostname !== 'linkedin.com' && !u.hostname.endsWith('.linkedin.com')) return null;
  const m = /^\/in\/([^/?#]+)/.exec(u.pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]!);
    return id.length > 0 ? id : null;
  } catch {
    return null;
  }
}

const SchemaElements = z.array(z.object({ entityUrn: z.string().optional(), '*entityUrn': z.string().optional() }));
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
  if (rep.statut < 200 || rep.statut >= 300) throw erreurNommee('StatutInattendu', 'LinkedIn a répondu un statut inattendu');

  const lu = SchemaProfils.safeParse(lireJson(rep.corps));
  if (!lu.success) throw erreurNommee('ReponseIllisible', 'Réponse LinkedIn illisible');

  const elements = lu.data.elements ?? lu.data.data?.elements ?? [];
  let urn: string | undefined = elements[0]?.entityUrn ?? elements[0]?.['*entityUrn'];
  if (!urn) {
    // Le profil retenu doit porter l'identifiant demandé : sans cela, on écrirait à quelqu'un d'autre.
    urn = lu.data.included?.find(
      (i) => i.entityUrn?.startsWith(PREFIXE_PROFIL) && i.publicIdentifier === identifiant,
    )?.entityUrn;
  }
  if (!urn || !urn.startsWith(PREFIXE_PROFIL)) throw new ErreurEnvoi('profile_not_found');
  return urn;
}

/**
 * Invitation SANS note. L'extension n'en envoyait jamais : le champ qui porte une
 * note n'a pas été relevé, et l'inventer enverrait un corps que personne n'a
 * éprouvé à une vraie personne. Une note demandée est donc REFUSÉE sans appel.
 */
export async function envoyerInvitation(pilote: Pilote, urn: string, note: string | null): Promise<ResultatEnvoi> {
  if (note !== null || !urn.startsWith(PREFIXE_PROFIL)) return { ok: false, code: 'bad_request' };

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
  throw erreurNommee('StatutInattendu', 'LinkedIn a répondu un statut inattendu');
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
 * À défaut de référence, on cherche dans `included` le profil qui porte NOTRE
 * identifiant public : prendre le premier venu écrirait depuis un autre profil.
 * `null` si rien ne se lit : le message ne part pas.
 */
function lireExpediteur(corps: unknown): string | null {
  const lu = SchemaMoi.safeParse(corps);
  if (!lu.success) return null;
  const { data, included = [] } = lu.data;
  const monIdentifiant =
    (typeof data?.miniProfile === 'object' ? data.miniProfile.publicIdentifier : undefined) ?? data?.publicIdentifier;
  let urn = data?.['*miniProfile'] ?? (typeof data?.miniProfile === 'string' ? data.miniProfile : undefined);
  if (!urn || !urn.includes('fsd_profile')) {
    const profils = included.filter((i) => i.entityUrn?.startsWith(PREFIXE_PROFIL));
    const moi = monIdentifiant ? profils.find((i) => i.publicIdentifier === monIdentifiant) : profils[0];
    urn = moi?.entityUrn ?? urn;
  }
  if (!urn) return null;
  const normalise = urn.replace('urn:li:fs_miniProfile:', PREFIXE_PROFIL);
  return normalise.startsWith(PREFIXE_PROFIL) ? normalise : null;
}

/** 16 octets bruts, pas du base64 : un `trackingId` vide fait répondre 400 muet (retour terrain de l'extension). */
function trackingId(): string {
  return String.fromCharCode(...randomBytes(16));
}

export async function envoyerMessage(pilote: Pilote, urn: string, texte: string): Promise<ResultatEnvoi> {
  if (!urn.startsWith(PREFIXE_PROFIL) || texte.trim() === '') return { ok: false, code: 'bad_request' };

  await surLinkedin(pilote);
  const moi = await pilote.requete(URL_MOI, ENTETES);
  const refusMoi = refusCommun(moi.statut) ?? (moi.statut === 403 ? 'not_logged_in' : null);
  if (refusMoi) return { ok: false, code: refusMoi };
  if (moi.statut < 200 || moi.statut >= 300) throw erreurNommee('StatutInattendu', 'LinkedIn a répondu un statut inattendu');
  const expediteur = lireExpediteur(lireJson(moi.corps));
  if (expediteur === null) throw erreurNommee('ExpediteurIntrouvable', "Profil de l'expéditeur introuvable");

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
  throw erreurNommee('StatutInattendu', 'LinkedIn a répondu un statut inattendu');
}

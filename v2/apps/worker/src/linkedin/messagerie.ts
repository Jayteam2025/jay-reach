import { normaliserUrnLinkedIn } from '@jay-reach/core';

/**
 * Lecture de la messagerie LinkedIn : logique PURE (aucun appel réseau ici).
 *
 * Source de vérité : l'appel de l'ancienne extension, gelée (`apps/extension/linkedin-inbox.js`).
 * Un seul appel rend les vingt dernières conversations AVEC leur dernier message.
 */

export const QUERY_ID_CONVERSATIONS = 'messengerConversations.b7affb08320b28f0d8bf883fe8590337';
const VOYAGER_GRAPHQL = 'https://www.linkedin.com/voyager/api/voyagerMessagingGraphQL/graphql';

export function urlConversations(mailboxUrn: string, nombre: number): string {
  return `${VOYAGER_GRAPHQL}?queryId=${QUERY_ID_CONVERSATIONS}&variables=(mailboxUrn:${encodeURIComponent(mailboxUrn)},count:${nombre})`;
}

export type MessageReleve = {
  readonly conversationUrn: string;
  readonly messageUrn: string;
  readonly expediteurUrn: string;
  readonly texte: string;
  readonly recuLe: Date;
};

export type Releve = {
  readonly entrants: readonly MessageReleve[];
  readonly ecartesNonUnAUn: number;
  readonly ecartesAnterieuresAuCurseur: number;
  /**
   * Conversations lues comme un-à-un faute d'indice contraire (ni `groupChat`, ni participants
   * lisibles). Un compteur qui monte à la recette dit que le critère un-à-un est à confirmer.
   */
  readonly unAUnSansIndice: number;
  /** Conversations traitées sans `lastActivityAt` : le curseur n'a pas pu les écarter. */
  readonly sansHorodatage: number;
  /** Messages entrants écartés faute d'identifiant ou de date exploitables : jamais un échec du passage. */
  readonly entrantsIllisibles: number;
};

/** Tous les compteurs d'une relève, pour le journal du passage. `Record` exhaustif : un compteur ajouté à `Releve` sans l'être ici ne compile plus. */
export function compteursDuReleve(r: Releve): Readonly<Record<Exclude<keyof Releve, 'entrants'>, number>> {
  return {
    ecartesNonUnAUn: r.ecartesNonUnAUn,
    ecartesAnterieuresAuCurseur: r.ecartesAnterieuresAuCurseur,
    unAUnSansIndice: r.unAUnSansIndice,
    sansHorodatage: r.sansHorodatage,
    entrantsIllisibles: r.entrantsIllisibles,
  };
}

/**
 * Une charge utile qui n'a pas la forme attendue. Le jour où LinkedIn périme le `queryId` ou
 * renomme ses champs, rendre « zéro conversation » serait indistinguable d'une boîte vide : une
 * réponse passerait inaperçue pendant des semaines. On lève une erreur que l'opérateur voit.
 * Le message est construit ici et ne cite jamais la charge utile (elle contient des messages privés).
 */
export class ErreurMessagerie extends Error {
  readonly code = 'IllisibleMessagerie' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IllisibleMessagerie';
  }
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Les conversations de la réponse, ou `null` si elle n'a pas la forme attendue (`data.<clé>.elements[]`). */
function extraireConversations(corps: unknown): readonly unknown[] | null {
  if (!estObjet(corps) || !estObjet(corps.data)) return null;
  // Le nom du champ porte la requête et change avec le queryId : on le cherche par préfixe,
  // on ne le code pas en dur (même principe que `extrairePostsDePage`).
  const cle = Object.keys(corps.data).find((k) => k.startsWith('messengerConversations'));
  if (cle === undefined) return null;
  const noeud = corps.data[cle];
  if (!estObjet(noeud) || !Array.isArray(noeud.elements)) return null;
  return noeud.elements;
}

/**
 * CRITÈRE NON ATTESTÉ. Aucun relevé réel de la messagerie n'existe dans le dépôt : l'extension gelée
 * ne lit ni `groupChat` ni les participants. Les deux signaux ci-dessous sont les noms Voyager
 * habituels, posés comme HYPOTHÈSE à confirmer sur une charge réelle :
 *  - `groupChat === true` ;
 *  - `conversationParticipants` (tableau, ou objet portant `elements`) de plus de deux membres.
 * Sans aucun des deux, on ne sait pas : on lit comme un-à-un (cas majoritaire en prospection) et on
 * le COMPTE à part (`unAUnSansIndice`). Éteindre toute la relève sur un champ inventé serait pire
 * que le risque couvert.
 */
function typeDeConversation(conv: Objet): 'groupe' | 'un_a_un' | 'sans_indice' {
  if (conv.groupChat === true) return 'groupe';
  const p = conv.conversationParticipants;
  const liste = Array.isArray(p) ? p : estObjet(p) && Array.isArray(p.elements) ? p.elements : null;
  if (liste !== null && liste.length > 2) return 'groupe';
  if (conv.groupChat === false || liste !== null) return 'un_a_un';
  return 'sans_indice';
}

const nombre = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Trie les conversations d'une relève.
 *
 * - `compteUrn` : le compte connecté. Un message est ENTRANT quand l'identifiant de son expéditeur
 *   diffère du sien, tous deux passés par `normaliserUrnLinkedIn` (la même personne s'écrit sous deux formes).
 * - `depuis` : curseur ; une conversation dont l'activité est antérieure ou égale est écartée et comptée.
 * - Seules les conversations un-à-un sont lues. Un InMail, un message système ou un groupe n'a pas
 *   d'en-tête à lire : classé réponse humaine, il causerait une exclusion définitive sur un faux
 *   positif. Elles sont comptées, jamais lues.
 */
export function analyserConversations(brut: string, compteUrn: string, depuis: Date): Releve {
  const moi = normaliserUrnLinkedIn(compteUrn);
  if (moi === null) {
    // Sans identité du compte, chaque message sortant passerait pour une réponse.
    throw new ErreurMessagerie('L’identité du compte LinkedIn est illisible : la relève ne peut pas distinguer ses messages.');
  }

  let corps: unknown;
  try {
    corps = JSON.parse(brut);
  } catch {
    throw new ErreurMessagerie('La réponse de la messagerie LinkedIn n’est pas lisible.');
  }
  const conversations = extraireConversations(corps);
  if (conversations === null) {
    throw new ErreurMessagerie('LinkedIn a changé la forme de sa messagerie : la relève ne sait plus la lire.');
  }

  const entrants: MessageReleve[] = [];
  let ecartesNonUnAUn = 0;
  let ecartesAnterieuresAuCurseur = 0;
  let unAUnSansIndice = 0;
  let sansHorodatage = 0;
  let entrantsIllisibles = 0;

  for (const conv of conversations) {
    if (!estObjet(conv)) {
      ecartesNonUnAUn += 1;
      continue;
    }
    const activite = nombre(conv.lastActivityAt);
    if (activite === null) {
      // On ne perd rien : sans date, impossible de dire que la conversation est ancienne, donc on la
      // traite (le dédoublonnage par identifiant de message en aval absorbe un éventuel rejeu).
      sansHorodatage += 1;
    } else if (activite <= depuis.getTime()) {
      ecartesAnterieuresAuCurseur += 1;
      continue;
    }
    const type = typeDeConversation(conv);
    if (type === 'groupe') {
      ecartesNonUnAUn += 1;
      continue;
    }
    if (type === 'sans_indice') unAUnSansIndice += 1;

    const elements = estObjet(conv.messages) ? conv.messages.elements : undefined;
    const message = Array.isArray(elements) ? elements[0] : undefined;
    if (!estObjet(message)) continue; // conversation un-à-un sans message : rien à relever

    const hostUrn = estObjet(message.sender) ? message.sender.hostIdentityUrn : undefined;
    const expediteur = typeof hostUrn === 'string' ? normaliserUrnLinkedIn(hostUrn) : null;
    if (expediteur === null) {
      // Expéditeur qui n'est pas un membre (système, organisation) : jamais une réponse humaine.
      ecartesNonUnAUn += 1;
      continue;
    }
    if (expediteur === moi) continue; // notre propre message

    const messageUrn = message.entityUrn;
    const conversationUrn = conv.entityUrn;
    const quand = nombre(message.deliveredAt) ?? activite;
    if (typeof messageUrn !== 'string' || typeof conversationUrn !== 'string' || quand === null) {
      // Un message biscornu ne doit pas emporter le passage : le curseur n'avancerait pas et toutes
      // les autres réponses seraient perdues à chaque passage suivant. On le compte.
      entrantsIllisibles += 1;
      continue;
    }
    const texte = estObjet(message.body) && typeof message.body.text === 'string' ? message.body.text : '';
    entrants.push({ conversationUrn, messageUrn, expediteurUrn: expediteur, texte, recuLe: new Date(quand) });
  }

  return { entrants, ecartesNonUnAUn, ecartesAnterieuresAuCurseur, unAUnSansIndice, sansHorodatage, entrantsIllisibles };
}

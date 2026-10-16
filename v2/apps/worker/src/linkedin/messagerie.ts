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
  /** URL publique du profil de l'expéditeur, lue chez le participant de même identité ; `null` si elle n'est pas établie. */
  readonly expediteurUrl: string | null;
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
  /** Conversations un-à-un lues dont `messages.elements[0]` est absent. */
  readonly sansMessage: number;
  /** Conversations lues dont l'expéditeur du dernier message n'est pas un identifiant de membre lisible. */
  readonly expediteursIllisibles: number;
  /** Éléments de la liste qui ne sont même pas un objet. */
  readonly conversationsIllisibles: number;
  /** Messages entrants écartés faute d'identifiant ou de date exploitables : jamais un échec du passage. */
  readonly entrantsIllisibles: number;
};

/** Tous les compteurs d'une relève, pour le journal du passage. `Record` exhaustif : un compteur ajouté à `Releve` sans l'être ici ne compile plus. */
export function compteursDuReleve(r: Releve): Readonly<Record<Exclude<keyof Releve, 'entrants'>, number>> {
  return {
    ecartesNonUnAUn: r.ecartesNonUnAUn,
    ecartesAnterieuresAuCurseur: r.ecartesAnterieuresAuCurseur,
    unAUnSansIndice: r.unAUnSansIndice,
    sansMessage: r.sansMessage,
    expediteursIllisibles: r.expediteursIllisibles,
    conversationsIllisibles: r.conversationsIllisibles,
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

/** Les participants d'une conversation : `conversationParticipants` est un tableau (relevé réel, 20 conversations). */
function participantsDe(conv: Objet): readonly unknown[] | null {
  const p = conv.conversationParticipants;
  return Array.isArray(p) ? p : estObjet(p) && Array.isArray(p.elements) ? p.elements : null;
}

/**
 * Un-à-un ou groupe. Relevé réel : `groupChat` (booléen) est sur chaque conversation et
 * `conversationParticipants` compte 2 éléments dans le cas nominal. Les deux signaux sont lus ;
 * sans aucun des deux, on lit comme un-à-un et on le COMPTE à part (`unAUnSansIndice`) : si la
 * forme change, ce compteur monte, alors qu'éteindre la relève ne dirait rien.
 */
function typeDeConversation(conv: Objet): 'groupe' | 'un_a_un' | 'sans_indice' {
  if (conv.groupChat === true) return 'groupe';
  const liste = participantsDe(conv);
  if (liste !== null && liste.length > 2) return 'groupe';
  if (conv.groupChat === false || liste !== null) return 'un_a_un';
  return 'sans_indice';
}

/**
 * L'URL de profil de l'expéditeur : le `sender` d'un message ne porte que son URN, mais le
 * participant de même identité porte `participantType.member.profileUrl` (relevé réel).
 */
function urlDeLExpediteur(conv: Objet, expediteur: string): string | null {
  for (const part of participantsDe(conv) ?? []) {
    if (!estObjet(part) || typeof part.hostIdentityUrn !== 'string') continue;
    if (normaliserUrnLinkedIn(part.hostIdentityUrn) !== expediteur) continue;
    const type = part.participantType;
    const membre = estObjet(type) ? type.member : undefined;
    const url = estObjet(membre) ? membre.profileUrl : undefined;
    return typeof url === 'string' && url.trim() !== '' ? url : null;
  }
  return null;
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
  let sansMessage = 0;
  let expediteursIllisibles = 0;
  let conversationsIllisibles = 0;
  // Conversations qui ont franchi le curseur ET le filtre « groupe » : la base de la garde de volume.
  // Ce n'est pas `conversations.length`, qui compte aussi les anciennes et les groupes.
  let lues = 0;

  for (const conv of conversations) {
    if (!estObjet(conv)) {
      conversationsIllisibles += 1;
      lues += 1; // illisible = dérive possible, donc comptée dans le volume lu
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
    lues += 1;

    const elements = estObjet(conv.messages) ? conv.messages.elements : undefined;
    const message = Array.isArray(elements) ? elements[0] : undefined;
    if (!estObjet(message)) {
      sansMessage += 1;
      continue;
    }

    const hostUrn = estObjet(message.sender) ? message.sender.hostIdentityUrn : undefined;
    const expediteur = typeof hostUrn === 'string' ? normaliserUrnLinkedIn(hostUrn) : null;
    if (expediteur === null) {
      // Expéditeur qui n'est pas un membre (système, organisation) : jamais une réponse humaine.
      expediteursIllisibles += 1;
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
    // Un texte vide est rendu tel quel : une pièce jointe seule reste une réponse humaine, et l'ancienne
    // extension la perdait. Aval : l'en-tête et le contenu décident, pas ce filtre.
    const texte = estObjet(message.body) && typeof message.body.text === 'string' ? message.body.text : '';
    entrants.push({ conversationUrn, messageUrn, expediteurUrn: expediteur, expediteurUrl: urlDeLExpediteur(conv, expediteur), texte, recuLe: new Date(quand) });
  }

  // Garde de volume. Une dérive de forme (`messages` renommé, format de `hostIdentityUrn` changé) ne
  // lève rien plus haut : chaque conversation serait sautée et la relève rendrait vide, tous les
  // compteurs à zéro, indistinguable d'une boîte vide. On lève quand au moins 3 conversations ont été
  // lues, qu'aucun entrant n'en sort, et que TOUTES relèvent de la dérive (sans message, ou
  // expéditeur illisible). Seuil de 3 : compromis assumé. Avec une seule conversation lue, une
  // conversation légitimement sans message ferait lever à tort ; la relève est un sondage répété,
  // une vraie dérive se reverra au passage suivant.
  // La dérive peut survenir à n'importe quel étage (conversation, message, expéditeur, identifiant du
  // message) : tous les compteurs de dérive entrent dans la règle, sinon un champ renommé à l'étage
  // non couvert donnerait une boîte qui paraît vide, en permanence puisque le curseur n'avance pas.
  // `entrants.length === 0` est redondant aujourd'hui (un entrant n'est jamais compté parmi ces cas) ;
  // on le garde : il dit l'intention, et protège si un futur compteur était alimenté en même temps
  // qu'un entrant valide. Ne pas le retirer en croyant simplifier.
  const derives = sansMessage + expediteursIllisibles + conversationsIllisibles + entrantsIllisibles;
  if (lues >= 3 && entrants.length === 0 && derives === lues) {
    throw new ErreurMessagerie('LinkedIn a changé la forme de ses conversations : aucune n’a pu être lue.');
  }

  return { entrants, ecartesNonUnAUn, ecartesAnterieuresAuCurseur, unAUnSansIndice, sansMessage, expediteursIllisibles, conversationsIllisibles, sansHorodatage, entrantsIllisibles };
}

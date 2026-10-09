/**
 * Trouver les POSTS d'où partir, avant d'en lire les engageurs.
 *
 * Le collecteur d'`engageurs.ts` part d'un post qu'on lui donne. Les trois sources à fort
 * rendement (créateur, page concurrente, mot-clé) ne diffèrent que par la façon de TROUVER
 * ces posts — c'est ce que mesure
 * `_internal/2026-09-10-gojiberry-sources-catalogue-et-rendement.md`. Ce module porte donc
 * les stratégies de recherche ; la lecture des engageurs, elle, ne bouge pas.
 *
 * Une seule stratégie est écrite ici : les posts d'une PAGE ENTREPRISE. C'est la seule dont
 * la chaîne ait été relevée en réel (`_internal/2026-10-09-releve-voyager-posts.md`). Les deux
 * autres viendront derrière la même interface quand leurs points d'entrée seront connus — on
 * ne code pas ce qu'on n'a pas observé.
 */
import { ErreurCollecte, ENTETES_VOYAGER, frictionDuStatut, urnDActivite } from './engageurs.js';
import type { ArretCollecte, Budget, Friction } from './engageurs.js';
import type { Pilote } from './navigateur.js';

/**
 * L'identifiant de requête GraphQL, relevé le 09/10/2026 sur le navigateur du serveur.
 *
 * **Il est périssable.** LinkedIn verrouille ses requêtes GraphQL par cette empreinte, qui
 * change à chacun de ses déploiements. Le jour où elle ne vaut plus, la requête échoue — et
 * c'est le comportement qu'on veut : voir plus bas pourquoi une liste vide serait pire.
 */
export const QUERY_ID_POSTS_DE_PAGE = 'voyagerFeedDashOrganizationalPageUpdates.22f65769d754b16c73f7c9d9a8d2fd46';

/** Ce que LinkedIn sert par page sur ce point d'entrée, observé : dix. */
export const POSTS_PAR_PAGE = 10;

/** Garde-fou de boucle, comme dans `engageurs.ts` : un `total` incohérent ne tourne pas sans fin. */
export const PAGES_MAX = 20;

/**
 * Combien de fois redemander la page quand LinkedIn sert sa coquille vide.
 *
 * **Mesuré le 09/10, pas supposé** : sur deux séries de trois requêtes rapprochées vers des pages
 * entreprise, c'est la TROISIÈME qui est revenue en coquille, les deux fois — 929 Ko d'ossature
 * d'application sans le moindre `universalName`, sans `fsd_company`, sans balise canonique. La page
 * existe, elle est simplement servie sans son modèle de données.
 *
 * Deux essais de plus, espacés, suffisent : la quatrième requête de chaque série, elle, portait de
 * nouveau le modèle.
 */
export const TENTATIVES_RESOLUTION = 3;

/** L'attente entre deux tentatives. Généreuse : c'est le rapprochement qui déclenche la coquille. */
export const DELAI_RETENTATIVE_MS = 5_000;

const pauseReelle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Ce que l'opérateur lit quand LinkedIn rend un verdict sur son compte. Mêmes mots que le
 * handler (`MSG.defi`, `MSG.cookie_refuse`) : une seule cause, une seule phrase, d'où qu'elle
 * vienne.
 */
const MESSAGES_FRICTION: Record<Friction['type'], string> = {
  defi: 'LinkedIn demande une vérification : collecte arrêtée.',
  cookie_refuse: 'LinkedIn a refusé la session : collecte arrêtée.',
  liste_vide: 'LinkedIn n’a livré aucun post : collecte arrêtée.',
  post_introuvable: 'Page ou post introuvable, supprimé ou privé : vérifiez l’adresse.',
};

/**
 * L'identifiant de la société dont la page porte ce nom public, lu dans le HTML rendu par
 * LinkedIn.
 *
 * **Piège mesuré le 09/10** : l'appel `voyagerOrganizationDashCompanies(universalName:…)` a
 * l'air d'être la résolution, mais il porte `ByViewerPermissions` et rend les pages que le
 * COMPTE ADMINISTRE. En visitant la page Microsoft, il répond la page de l'opérateur. S'y fier
 * collecterait la mauvaise page sans que rien ne le signale.
 *
 * Le HTML, lui, porte l'entité de la société regardée, avec son `universalName` et son URN. Les
 * autres URN de la page appartiennent aux pages « similaires » de la barre latérale : on prend
 * donc celui qui est le PLUS PROCHE du nom public, jamais le premier du document.
 */
export function idSocieteDepuisHtml(html: string, nomPublic: string): string | null {
  const nom = nomPublic.trim().toLowerCase();
  if (nom.length === 0) return null;
  // Le modèle JSON est embarqué dans le HTML avec ses guillemets échappés.
  const plat = html.replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const ancre = plat.toLowerCase().indexOf(`"universalname":"${nom}"`);
  if (ancre < 0) return null;

  let meilleur: { id: string; distance: number } | null = null;
  const motif = /urn:li:fsd_company:(\d+)/g;
  for (const trouve of plat.matchAll(motif)) {
    const id = trouve[1];
    if (id === undefined) continue;
    const distance = Math.abs((trouve.index ?? 0) - ancre);
    if (meilleur === null || distance < meilleur.distance) meilleur = { id, distance };
  }
  return meilleur?.id ?? null;
}

/**
 * L'URN de page d'une société. Son identifiant est CELUI de la société : mesuré le 09/10 sur
 * trois exemples indépendants (1035, 809064, 28968904), jamais supposé.
 */
export function urnPageDepuisId(idSociete: string): string {
  return `urn:li:fsd_organizationalPage:${idSociete}`;
}

/** L'adresse d'une page de posts. `start`/`count`, pagination observée en train de se dérouler. */
export function urlPostsDePage(urnPage: string, debut: number, nombre: number = POSTS_PAR_PAGE): string {
  const variables = `(count:${nombre},start:${debut},moduleKey:ORGANIZATION_MEMBER_FEED_DESKTOP,organizationalPageUrn:${encodeURIComponent(urnPage)})`;
  return `https://www.linkedin.com/voyager/api/graphql?variables=${variables}&queryId=${QUERY_ID_POSTS_DE_PAGE}`;
}

/** Ce qu'une page de résultats apprend : les posts trouvés, et combien la page en annonce en tout. */
export interface PagePosts {
  readonly urns: readonly string[];
  readonly total: number;
  /**
   * Combien d'éléments LinkedIn a servis, retenus ou non.
   *
   * L'offset de la pagination avance de CE nombre, pas du nombre d'URN gardés : un élément
   * qu'on ne sait pas lire décalerait sinon toute la suite, et la page suivante redemanderait
   * des posts déjà vus jusqu'au garde-fou de boucle. Du trafic payé pour rien.
   */
  readonly servis: number;
}

/**
 * Les URN d'activité d'une réponse, et le total annoncé. Rend `null` quand la réponse n'a PAS
 * la forme attendue — et c'est la décision de conception la plus importante de ce module.
 *
 * Le jour où LinkedIn change son `queryId` ou la forme de sa réponse, rendre « zéro post »
 * serait la pire des sorties : la collecte tournerait, se clôturerait en succès, et n'écrirait
 * plus rien, pendant des semaines, sans que personne ne puisse le distinguer d'un concurrent
 * qui ne publie pas. `null` oblige l'appelant à lever une erreur que l'opérateur voit.
 *
 * Une page réellement vide, elle, a bien la forme attendue : elle rend `{ urns: [], total }`.
 */
export function extrairePostsDePage(corps: unknown): PagePosts | null {
  if (typeof corps !== 'object' || corps === null) return null;
  const data = (corps as { data?: { data?: Record<string, unknown> } }).data?.data;
  if (typeof data !== 'object' || data === null) return null;
  // Le nom du champ porte la requête : on ne le code pas en dur, on prend le seul noeud qui
  // ressemble à un flux pagine. LinkedIn renomme ses champs aussi souvent que ses queryId.
  const noeud = Object.values(data).find(
    (v): v is Record<string, unknown> => typeof v === 'object' && v !== null && '*elements' in v,
  );
  if (!noeud) return null;
  const elements = noeud['*elements'];
  if (!Array.isArray(elements)) return null;

  const urns: string[] = [];
  for (const brut of elements) {
    if (typeof brut !== 'string') continue;
    // `urn:li:fsd_update:(urn:li:activity:123,COMPANY_FEED_RELEVANCE,…)` : l'URN d'activité est
    // à l'intérieur. `urnDActivite` est le MÊME lecteur que celui du collecteur d'engageurs, pour
    // qu'un post soit reconnu sous une seule identité des deux côtés.
    const urn = urnDActivite(brut);
    if (urn !== null && !urns.includes(urn)) urns.push(urn);
  }

  const paging = noeud.paging;
  const total =
    typeof paging === 'object' && paging !== null && typeof (paging as { total?: unknown }).total === 'number'
      ? (paging as { total: number }).total
      : urns.length;
  return { urns, total, servis: elements.length };
}

/**
 * Le HTML reçu porte-t-il le modèle de données de LinkedIn, ou seulement l'ossature de
 * l'application ?
 *
 * **Mesuré le 09/10** : la troisième de trois requêtes rapprochées est revenue avec 929 Ko de
 * squelette — aucun `universalName`, aucune `fsd_company`, pas même une balise canonique. La page
 * existait pourtant : la même adresse, redemandée plus tard, portait son modèle.
 *
 * Confondre cette coquille avec une page introuvable ferait dire à l'écran « la page n'a pas livré
 * son identifiant » pour une page parfaitement valide, et l'opérateur irait corriger une adresse
 * qui n'a rien.
 */
export function modeleAbsentDuHtml(html: string): boolean {
  // Deux marqueurs indépendants du modèle. La coquille mesurée n'avait ni l'un ni l'autre ; une
  // page servie avec son modèle porte toujours les deux.
  return !html.includes('universalName') && !html.includes('urn:li:fsd_company:');
}

/**
 * L'URN de page d'une adresse de page entreprise (`linkedin.com/company/<nom>/`).
 *
 * `surRequete` est appelé AVANT chaque appel, comme dans `lireEngageurs` : une requête dont la
 * réponse se perd est quand même partie vers LinkedIn, et ces requêtes-ci se paient sur le même
 * budget horaire que celles du collecteur. Les compter après sous-estimerait le trafic réel
 * exactement quand les choses vont mal.
 */
export async function resoudrePageEntreprise(
  pilote: Pilote,
  urlPage: string,
  surRequete: () => Promise<void> = async () => undefined,
  /** Injectée pour que les tests n'attendent pas réellement. */
  pause: (ms: number) => Promise<void> = pauseReelle,
  /**
   * Combien de requêtes il reste au budget, relu AVANT chaque tentative.
   *
   * Sans lui, trois tentatives de résolution partaient quoi qu'il arrive : avec une seule requête
   * de budget, le plafond horaire était dépassé de deux requêtes — tracées, donc bien réelles.
   */
  restantes: () => number = () => Number.POSITIVE_INFINITY,
): Promise<string> {
  const nom = nomPublicDePage(urlPage);
  if (nom === null) {
    throw new ErreurCollecte(`Adresse de page entreprise illisible : ${urlPage}`, 'PageIllisible', false);
  }
  const adresse = `https://www.linkedin.com/company/${encodeURIComponent(nom)}/`;

  for (let tentative = 0; tentative < TENTATIVES_RESOLUTION; tentative += 1) {
    if (restantes() <= 0) {
      throw new ErreurCollecte(
        `Plafond de requêtes atteint avant d’avoir pu lire la page ${nom}.`,
        'PlafondAvantResolution',
        false,
      );
    }
    if (tentative > 0) await pause(DELAI_RETENTATIVE_MS);
    await surRequete();
    const rep = await pilote.requete(adresse);
    if (rep.statut < 200 || rep.statut >= 300) {
      // Un défi ou un cookie refusé sont des verdicts sur NOTRE compte, pas sur cette page :
      // ils remontent comme frictions pour que la session soit suspendue et l'opérateur prévenu.
      const friction = frictionDuStatut(rep.statut);
      if (friction) {
        throw new ErreurCollecte(
          MESSAGES_FRICTION[friction.type],
          'FrictionLinkedIn',
          friction.type === 'defi' || friction.type === 'cookie_refuse',
          friction,
        );
      }
      throw new ErreurCollecte(`La page ${nom} n’a pas répondu (${rep.statut}).`, 'PageIntrouvable', false);
    }
    const id = idSocieteDepuisHtml(rep.corps, nom);
    if (id !== null) return urnPageDepuisId(id);
    // Le modèle est là mais ne porte pas ce nom : redemander n'y changera rien. C'est l'adresse
    // qui est fausse, ou la page qui a été renommée — et ça, l'opérateur peut le corriger.
    if (!modeleAbsentDuHtml(rep.corps)) {
      throw new ErreurCollecte(`La page ${nom} n’a pas livré son identifiant.`, 'PageIllisible', false);
    }
  }
  throw new ErreurCollecte(
    `LinkedIn n’a pas servi le contenu de la page ${nom} après ${TENTATIVES_RESOLUTION} essais.`,
    'PageSansModele',
    false,
  );
}

/**
 * L'adresse d'un post à partir de son URN.
 *
 * Le trouveur rend des URN, parce que c'est sous cette identité que la mémoire les garde et que
 * `urnDActivite` les reconnaît. Mais le collecteur d'engageurs commence par CHARGER la page du
 * post (`pilote.aller`) : il lui faut une adresse. Donner l'URN brut à une navigation ne mène
 * nulle part, et l'URL se retrouverait telle quelle dans `signals.url`, où elle doit rester
 * cliquable pour l'opérateur.
 */
export function urlDePost(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

/** Le nom public d'une adresse de page : `linkedin.com/company/<nom>/…`. */
export function nomPublicDePage(url: string): string | null {
  const m = /linkedin\.com\/(?:company|showcase)\/([^/?#]+)/i.exec(url.trim());
  const nom = m?.[1];
  return nom ? decodeURIComponent(nom) : null;
}

/**
 * Une page de posts. Lève plutôt que de rendre une liste vide quand la réponse n'est pas
 * lisible : voir `extrairePostsDePage`.
 */
export async function listerPostsDePage(pilote: Pilote, urnPage: string, debut: number): Promise<PagePosts> {
  const rep = await pilote.requete(urlPostsDePage(urnPage, debut), ENTETES_VOYAGER);
  if (rep.statut < 200 || rep.statut >= 300) {
    const friction = frictionDuStatut(rep.statut);
    if (friction) {
      throw new ErreurCollecte(
        MESSAGES_FRICTION[friction.type],
        'FrictionLinkedIn',
        friction.type === 'defi' || friction.type === 'cookie_refuse',
        friction,
      );
    }
    // Un 429 n'est pas une friction nommée mais reste un verdict sur notre rythme.
    throw new ErreurCollecte(
      `La liste des posts n’a pas répondu (${rep.statut}).`,
      'PostsIndisponibles',
      rep.statut === 429,
    );
  }
  let corps: unknown;
  try {
    corps = JSON.parse(rep.corps);
  } catch {
    throw new ErreurCollecte('La liste des posts n’est pas lisible.', 'PostsIllisibles', false);
  }
  const page = extrairePostsDePage(corps);
  if (page === null) {
    // Le cas du `queryId` périmé tombe ici. Une erreur nommée, pas une liste vide.
    throw new ErreurCollecte(
      'LinkedIn a changé la forme de sa liste de posts : la collecte ne sait plus la lire.',
      'PostsIllisibles',
      false,
    );
  }
  return page;
}

/**
 * Les posts d'une page entreprise à traiter maintenant : résolution, pagination, et retrait de
 * ceux que cette source a déjà traités.
 *
 * **La mémoire est le nerf de l'affaire.** Une page comme celle relevée le 09/10 annonce 501 posts
 * et n'en sert que dix par requête, toujours les mêmes en tête. Sans `dejaTraites`, un suivi
 * continu relirait indéfiniment les mêmes posts, brûlerait le plafond du jour, et n'ajouterait plus
 * une seule personne au bout de deux passages.
 *
 * **L'ordre n'est pas chronologique** : le point d'entrée porte `COMPANY_FEED_RELEVANCE`, LinkedIn
 * classe par pertinence. On ne peut donc pas s'arrêter au premier post déjà vu en supposant que la
 * suite est plus ancienne — il faut continuer à parcourir, d'où le garde-fou de pages.
 *
 * Rend ce qui a été trouvé AVANT l'arrêt, comme `lireEngageurs` : un plafond atteint au milieu de
 * la pagination garde ses posts plutôt que de faire rejouer le passage pour redépasser le même
 * plafond.
 */
export async function trouverPostsDePage(
  pilote: Pilote,
  urlPage: string,
  options: {
    readonly dejaTraites: ReadonlySet<string>;
    readonly budget: Budget;
    readonly surRequete: () => Promise<void>;
    /** Injectée pour que les tests n'attendent pas réellement. */
    readonly pause?: (ms: number) => Promise<void>;
  },
): Promise<{ urns: string[]; arret: ArretCollecte }> {
  const { dejaTraites, budget, surRequete } = options;
  const pause = options.pause ?? pauseReelle;
  if (budget.postsRestants <= 0 || budget.requetesRestantes <= 0) return { urns: [], arret: 'plafond' };

  let restantes = budget.requetesRestantes;
  const compter = async (): Promise<void> => {
    await surRequete();
    restantes -= 1;
  };

  const urnPage = await resoudrePageEntreprise(pilote, urlPage, compter, pause, () => restantes);

  const retenus: string[] = [];
  let debut = 0;
  for (let page = 0; page < PAGES_MAX; page += 1) {
    if (restantes <= 0) return { urns: retenus, arret: 'plafond' };
    // Toujours une pause avant d'appeler : enchaîner sans délai est ce qui se repère le mieux.
    await pause(DELAI_RETENTATIVE_MS);
    await compter();

    const lot = await listerPostsDePage(pilote, urnPage, debut);
    for (const urn of lot.urns) {
      if (dejaTraites.has(urn) || retenus.includes(urn)) continue;
      retenus.push(urn);
      if (retenus.length >= budget.postsRestants) return { urns: retenus, arret: 'plafond' };
    }
    debut += lot.servis;
    // Une page vide ou un total atteint : il n'y a plus rien à parcourir. Le premier cas compte,
    // sinon une page qui ne sert soudain plus rien ferait tourner la boucle jusqu'à PAGES_MAX.
    if (lot.servis === 0 || debut >= lot.total) {
      return { urns: retenus, arret: retenus.length === 0 ? { type: 'liste_vide' } : 'fini' };
    }
  }
  return { urns: retenus, arret: retenus.length === 0 ? { type: 'liste_vide' } : 'fini' };
}

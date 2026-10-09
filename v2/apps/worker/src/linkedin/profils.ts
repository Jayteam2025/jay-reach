/**
 * Trouver les posts récents d'une PERSONNE, pour la source « posts d'un créateur ».
 *
 * Rien à voir avec `posts.ts`, qui interroge Voyager pour une page entreprise : ici tout se lit
 * dans le HTML de la page d'activité. Aucune requête Voyager ne charge ces posts, donc aucun
 * `queryId` périssable à entretenir — relevé le 09/10/2026 dans un vrai navigateur.
 *
 * Trois choses qui ne se devinent pas, chacune payée par une mesure :
 *
 *  1. **Le nom public est obligatoire.** `/in/<URN>/recent-activity/all/` rend une coquille sans
 *     un seul post. Mais `/in/<URN>/` REDIRIGE vers `/in/<nom-public>/`, et l'URL d'arrivée donne
 *     le nom : c'est `resoudreNomPublic`, une requête, aucune API.
 *  2. **Un profil qui n'existe pas rend lui aussi une coquille, sans rediriger vers /404.** Seule
 *     `/in/<nom>/` (sans `recent-activity`) répond `linkedin.com/404/`. On passe donc TOUJOURS par
 *     la résolution, même quand l'opérateur a déjà saisi un nom public : c'est elle qui distingue
 *     « ce profil n'existe pas » de « ce profil n'a rien publié ».
 *  3. **Compter les URN du HTML est une impasse.** Le document fait ~14 Mo et porte des milliers
 *     d'occurrences d'`urn:li:activity:` (5172 sur un profil mesuré) qui sont du bruit de
 *     traçage, plus une vingtaine d'`urn:li:share:` venus d'ailleurs. Les posts du profil sont
 *     ceux que la page MET EN LIEN : `href=".../feed/update/<urn>/"`, 1 ou 2 par profil, exactement
 *     ce que l'écran affiche. Extraire les URN bruts donnerait quinze faux posts sur dix-sept.
 */
import {
  ErreurCollecte,
  MESSAGES_FRICTION,
  frictionDeLUrl,
  frictionDuStatut,
  type ArretCollecte,
  type Budget,
} from './engageurs.js';
import type { Pilote } from './navigateur.js';

/** Les trois types d'identifiant qu'un post peut porter dans un lien de la page d'activité. */
const TYPES_DE_POST = ['share', 'activity', 'ugcPost'] as const;

/**
 * Les posts d'un profil, dans l'ordre où la page les met en lien (le plus récent d'abord).
 *
 * Volontairement bornée à ce que la page sert d'emblée : le défilement n'ajoute rien de mesurable
 * et le plafond de posts du jour vaut 3. Pagination inutile.
 */
export function extrairePostsDeProfil(html: string): string[] {
  const motif = new RegExp(`/feed/update/(urn:li:(?:${TYPES_DE_POST.join('|')}):\\d+)`, 'g');
  const vus = new Set<string>();
  for (const m of html.matchAll(motif)) {
    const urn = m[1];
    if (urn !== undefined) vus.add(urn);
  }
  return [...vus];
}

/**
 * Le nom public, ou l'URN, qu'une adresse de profil désigne : `linkedin.com/in/<nom>/…`.
 *
 * Rend `null` sur tout ce qui n'est pas une adresse de profil LinkedIn — c'est la seule garde qui
 * empêche une saisie d'opérateur d'envoyer le navigateur ailleurs que sur linkedin.com.
 */
export function identifiantDeProfil(url: string): string | null {
  const m = /linkedin\.com\/in\/([^/?#]+)/i.exec(url.trim());
  const nom = m?.[1];
  return nom ? decodeURIComponent(nom) : null;
}

/**
 * Cet identifiant est-il un URN interne (`ACoAA…`) plutôt qu'un nom public ?
 *
 * Sert seulement à nommer les cas dans les messages et les tests : la résolution part de toute
 * façon, parce qu'elle vérifie aussi que le profil existe.
 */
export function estUrnDeProfil(identifiant: string): boolean {
  return /^ACoA/i.test(identifiant);
}

/** L'adresse canonique d'un profil, reconstruite — jamais la saisie de l'opérateur telle quelle. */
export function adresseDeProfil(identifiant: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(identifiant)}/`;
}

/** L'adresse de la page d'activité d'un profil, à partir de son NOM PUBLIC. */
export function adresseActivite(nomPublic: string): string {
  return `https://www.linkedin.com/in/${encodeURIComponent(nomPublic)}/recent-activity/all/`;
}

/** Vrai quand LinkedIn a répondu par sa page « ce membre n'existe pas ». */
export function estPageIntrouvable(url: string): boolean {
  return /linkedin\.com\/404(?:\/|$|\?)/i.test(url);
}

/**
 * Le nom public d'un profil, obtenu en ouvrant `/in/<identifiant>/` et en lisant l'URL d'arrivée.
 *
 * Deux services rendus par la même requête, et c'est pour le second qu'on la fait même lorsque
 * l'opérateur a saisi un nom public : elle dit aussi si le profil EXISTE. Sans elle, un profil
 * supprimé ou renommé donnerait une page d'activité vide, indistinguable d'un profil qui ne
 * publie pas — on annoncerait « aucun post » là où il faut dire « corrige l'adresse ».
 */
export async function resoudreNomPublic(
  pilote: Pilote,
  urlProfil: string,
  surRequete: () => Promise<void> = async () => undefined,
): Promise<string> {
  const identifiant = identifiantDeProfil(urlProfil);
  if (identifiant === null) {
    throw new ErreurCollecte(`Adresse de profil LinkedIn illisible : ${urlProfil}`, 'ProfilIllisible', false);
  }

  await surRequete();
  await pilote.aller(adresseDeProfil(identifiant));
  const arrivee = await pilote.url();

  const friction = frictionDeLUrl(arrivee);
  if (friction) {
    throw new ErreurCollecte(
      MESSAGES_FRICTION[friction.type],
      'FrictionLinkedIn',
      friction.type === 'defi' || friction.type === 'cookie_refuse',
      friction,
    );
  }
  if (estPageIntrouvable(arrivee)) {
    throw new ErreurCollecte(
      `Ce profil LinkedIn n’existe plus : ${identifiant}.`,
      'ProfilIntrouvable',
      false,
    );
  }

  const resolu = identifiantDeProfil(arrivee);
  if (resolu === null) {
    throw new ErreurCollecte(
      `LinkedIn n’a pas mené à un profil depuis ${identifiant}.`,
      'ProfilIllisible',
      false,
    );
  }
  // Un URN qui reste un URN après la redirection : la page ne s'est pas résolue, et sa page
  // d'activité serait vide. Le dire ici plutôt que de rendre « aucun post » plus loin.
  if (estUrnDeProfil(resolu)) {
    throw new ErreurCollecte(
      `LinkedIn n’a pas donné le nom public du profil ${identifiant}.`,
      'ProfilSansNomPublic',
      false,
    );
  }
  return resolu;
}

/**
 * Les posts récents d'un créateur, prêts à passer au collecteur d'engageurs.
 *
 * Rend des URN, comme `trouverPostsDePage` : c'est sous cette identité que la mémoire des posts
 * déjà traités les garde, et `urlDePost` sait en refaire une adresse.
 *
 * Deux requêtes par profil, pas plus : la résolution, puis la page d'activité. Le budget est
 * relu avant chacune — un plafond atteint entre les deux rend ce qui a été trouvé plutôt que de
 * lever, exactement comme le trouveur de pages.
 */
export async function trouverPostsDeProfil(
  pilote: Pilote,
  urlProfil: string,
  options: {
    readonly dejaTraites: ReadonlySet<string>;
    readonly budget: Budget;
    readonly surRequete: () => Promise<void>;
  },
): Promise<{ urns: string[]; arret: ArretCollecte }> {
  const { dejaTraites, budget, surRequete } = options;
  if (budget.postsRestants <= 0 || budget.requetesRestantes <= 0) return { urns: [], arret: 'plafond' };

  let restantes = budget.requetesRestantes;
  const compter = async (): Promise<void> => {
    await surRequete();
    restantes -= 1;
  };

  const nomPublic = await resoudreNomPublic(pilote, urlProfil, compter);
  if (restantes <= 0) return { urns: [], arret: 'plafond' };

  await compter();
  const rep = await pilote.requete(adresseActivite(nomPublic));
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
    throw new ErreurCollecte(
      `L’activité de ${nomPublic} n’a pas répondu (${rep.statut}).`,
      'ActiviteIntrouvable',
      false,
    );
  }

  const retenus: string[] = [];
  for (const urn of extrairePostsDeProfil(rep.corps)) {
    if (dejaTraites.has(urn)) continue;
    retenus.push(urn);
    if (retenus.length >= budget.postsRestants) return { urns: retenus, arret: 'plafond' };
  }
  // `liste_vide` dit « ce profil ne publie pas », et c'est une information juste : l'existence du
  // profil a déjà été prouvée par la résolution. Sans elle, ce même message aurait couvert une
  // adresse périmée.
  return { urns: retenus, arret: retenus.length === 0 ? { type: 'liste_vide' } : 'fini' };
}

/**
 * Lecture des engageurs d'un post LinkedIn (lot 4a, tâche 7).
 *
 * Les appels partent par `pilote.requete()`, donc DEPUIS LE CONTEXTE DE LA PAGE :
 * les cookies de la session partent avec, le statut HTTP reste lisible — c'est la
 * seule façon de voir un 999 — et aucun HTML n'est analysé. La friction se lit sur
 * le statut et sur l'URL courante, jamais sur le contenu de la page : un rendu
 * LinkedIn change toutes les semaines, un code de statut non.
 *
 * Rien ici n'écrit en base. Le handler décide quoi faire de ce qui remonte.
 *
 * ⚠️ Les deux adresses Voyager ci-dessous ne sont PAS vérifiées contre la
 * production : le proxy résidentiel n'est pas acheté et aucune connexion n'a eu
 * lieu. Elles sont isolées dans `urlReactions` / `urlCommentaires` pour n'avoir
 * qu'un endroit à corriger à la première recette avec le compte réel.
 */
import type { Pilote } from './navigateur.js';
import type { Engageur } from '../handlers/post-engagement.js';

/** Ce qu'il reste à dépenser quand le passage démarre. Les deux plafonds de la tâche 4. */
export type Budget = { requetesRestantes: number; postsRestants: number };

/** Ce qui arrête un passage sans que ce soit une panne. */
export type Friction = { type: 'defi' | 'cookie_refuse' | 'liste_vide' | 'post_introuvable' };

export type ArretCollecte = 'fini' | 'plafond' | Friction;

/**
 * Erreur du collecteur. Deux choses qu'une `Error` nue ne porte pas :
 *  - un `name` parlant, parce que le handler ne consigne QUE le nom de la classe
 *    (le message d'origine d'une erreur quelconque peut porter l'URL du proxy avec
 *    ses identifiants). Un message construit ici, lui, est sûr par construction ;
 *  - `engageLeCompte` : est-ce que cet échec dit quelque chose de l'état du compte
 *    LinkedIn ? Le disjoncteur protège le COMPTE d'une activité répétée qui
 *    l'expose, PAS nos bugs. Une réponse que notre parseur ne sait pas lire est
 *    une requête qui a abouti : LinkedIn n'a rien vu d'anormal, et bloquer la
 *    session imposerait à l'opérateur une reconnexion — l'opération la plus
 *    risquée du lot — qui ne corrigerait rien.
 */
export class ErreurCollecte extends Error {
  constructor(
    message: string,
    type: string,
    readonly engageLeCompte: boolean,
  ) {
    super(message);
    this.name = type;
  }
}

const PAR_PAGE = 50;
/** Délai entre deux requêtes : jamais de cadence régulière, qui se repère d'un coup d'œil côté LinkedIn. */
const DELAI_MIN_MS = 2_000;
const DELAI_MAX_MS = 6_000;
/** Garde-fou de boucle : un `total` incohérent ne doit pas faire tourner la pagination sans fin. */
const PAGES_MAX = 40;
/**
 * Profondeur de descente dans la réponse Voyager.
 *
 * Mesuré, pas supposé : sur la forme commentaires, le chemin
 * `data → socialMetadata → comments → elements → élément → commenter → profile`
 * met le profil à la profondeur **7**. Une décoration de plus (`*elements`,
 * `commenterResolutionResult`, `miniProfile`) suffit à en ajouter trois. On garde
 * donc plus du double de marge, et toute troncature laisse une trace : une perte
 * muette ferait chercher la panne du côté de LinkedIn.
 */
const PROFONDEUR_MAX = 16;

/**
 * En-têtes de l'API interne. `normalized+json` donne une réponse où les profils
 * vivent dans `included`, ce que `extraireEngageurs` sait lire. Le jeton CSRF
 * n'est pas posé ici : il se lit dans le cookie `JSESSIONID`, donc côté page
 * (voir `navigateur.ts`), jamais depuis ce processus.
 */
const ENTETES_VOYAGER: Record<string, string> = {
  accept: 'application/vnd.linkedin.normalized+json+2.1',
  'x-restli-protocol-version': '2.0.0',
};

/**
 * URN d'activité porté par l'adresse d'un post. Même repère que
 * `normaliserUrlPost` du cœur (`activity`, `ugcPost` ou `share` suivi d'un
 * nombre) : les deux doivent reconnaître le même post, sinon un passage
 * collecterait sous une identité que le dédoublonnage ne retrouverait pas.
 * `null` si l'adresse n'en porte pas : il n'y a alors rien à demander à Voyager.
 */
export function urnDActivite(urlPost: string): string | null {
  const brut = urlPost.trim();
  let lisible = brut;
  try {
    lisible = decodeURIComponent(brut);
  } catch {
    // adresse mal encodée : on cherche dans la forme brute
  }
  const m = /(activity|ugcPost|share)[-:](\d+)/i.exec(lisible);
  if (!m?.[1] || !m[2]) return null;
  const brutType = m[1].toLowerCase();
  const type = brutType === 'ugcpost' ? 'ugcPost' : brutType === 'share' ? 'share' : 'activity';
  return `urn:li:${type}:${m[2]}`;
}

function urlReactions(urn: string, debut: number): string {
  return `https://www.linkedin.com/voyager/api/voyagerSocialDashReactions?q=reactionType&count=${PAR_PAGE}&start=${debut}&threadUrn=${encodeURIComponent(urn)}`;
}

function urlCommentaires(urn: string, debut: number): string {
  return `https://www.linkedin.com/voyager/api/socialMetadata/${encodeURIComponent(urn)}/comments?q=comments&count=${PAR_PAGE}&start=${debut}&sortOrder=REVERSE_CHRONOLOGICAL`;
}

/** Les listes demandées par la source, réactions d'abord (la plus fournie, donc la plus représentative du post). */
function adressesDemandees(garder: readonly string[]): ((urn: string, debut: number) => string)[] {
  const listes: ((urn: string, debut: number) => string)[] = [];
  if (garder.includes('reagi')) listes.push(urlReactions);
  if (garder.includes('commente')) listes.push(urlCommentaires);
  return listes;
}

function lireJson(corps: string): unknown {
  try {
    return JSON.parse(corps) as unknown;
  } catch {
    return undefined;
  }
}

/** Un champ de texte Voyager : une chaîne, ou un `{ text }` (TextViewModel). */
function texteDe(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  if (v !== null && typeof v === 'object' && 'text' in v) return texteDe((v as { text: unknown }).text);
  return undefined;
}

const PREFIXES_PROFIL = ['urn:li:fsd_profile:', 'urn:li:fs_miniProfile:', 'urn:li:member:'];

/** L'URN s'il désigne bien une personne — tout le reste (post, entreprise, réaction) est ignoré. */
function urnDeProfil(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const prefixe = PREFIXES_PROFIL.find((p) => v.startsWith(p));
  if (!prefixe) return null;
  // Un URN décoré porte parfois une suite entre parenthèses : seul l'identifiant compte.
  const id = v.slice(prefixe.length).split(/[,)]/)[0]?.trim() ?? '';
  return id.length > 0 ? `${prefixe}${id}` : null;
}

const SEPARATEUR_ENTREPRISE = /\s+(?:chez|at|@|bij)\s+/i;

/**
 * L'entreprise quand l'intitulé la donne (« Directrice commerciale chez Acme »).
 * Texte libre assumé, jamais un identifiant d'entreprise : la spec le dit, et
 * `enregistrerEngageur` le range dans `enrichment`, pas dans `accounts`.
 */
export function entrepriseDeLIntitule(intitule: string): string | undefined {
  const morceaux = intitule.split(SEPARATEUR_ENTREPRISE);
  if (morceaux.length < 2) return undefined;
  const dernier = morceaux[morceaux.length - 1];
  const e = dernier?.split(/\s*[|·•]\s*/)[0]?.trim();
  return e !== undefined && e.length > 0 && e.length <= 120 ? e : undefined;
}

/**
 * Ce que l'objet source valait sur chaque champ, pour départager deux objets du
 * même URN. « Le premier vu fait foi » ne suffit pas : la descente visite `data`
 * avant `included`, donc la VIGNETTE d'affichage arrive en premier — et c'est
 * précisément elle que LinkedIn tronque. Un hors-réseau s'y affiche « Ada L. »
 * alors que l'entité profil porte `firstName: Ada, lastName: Lovelace`. Garder la
 * vignette ferait acheter à la tâche 8 une adresse sur un nom tronqué.
 */
export interface ProvenanceEngageur {
  /** 0 absent · 1 chaîne d'affichage · 2 chaîne d'affichage d'une entité profil · 3 nom structuré d'une entité profil. */
  readonly rangNom: number;
  /** 0 absent · 1 vignette · 2 entité profil. */
  readonly rangIntitule: number;
}

/** Un engageur, plus ce qu'on sait de la qualité de ses champs. La provenance ne sort pas d'ici : `engageurSchema` l'écarte. */
export type EngageurVu = Engageur & { readonly provenance: ProvenanceEngageur };

/**
 * Fusionne deux vues de la même personne, CHAMP PAR CHAMP et seulement sur une
 * valeur renseignée. Jamais en bloc : une entité mince (`entityUrn` +
 * `publicIdentifier`, ni `firstName` ni `headline`) effacerait le nom et
 * l'intitulé qu'une vignette avait apportés, et on échangerait une troncature
 * contre une disparition.
 *
 * `entreprise` suit l'intitulé retenu — elle en est déduite, la prendre d'un
 * intitulé qu'on ne garde pas donnerait une entreprise sans rapport avec le poste.
 *
 * Sert DEUX FOIS : à l'intérieur d'une réponse, et entre les réponses. Quelqu'un
 * qui réagit ET commente apparaît dans les deux listes, les réactions sont
 * demandées en premier, et rien ne dit que c'est la plus complète.
 */
export function fusionner(connu: EngageurVu, neuf: EngageurVu): EngageurVu {
  const prendreNom = neuf.provenance.rangNom > connu.provenance.rangNom;
  const pourIntitule = neuf.provenance.rangIntitule > connu.provenance.rangIntitule ? neuf : connu;
  const urlProfil = connu.urlProfil ?? neuf.urlProfil;
  return {
    urn: connu.urn,
    nom: prendreNom ? neuf.nom : connu.nom,
    intitule: pourIntitule.intitule,
    ...(pourIntitule.entreprise !== undefined ? { entreprise: pourIntitule.entreprise } : {}),
    ...(urlProfil !== undefined ? { urlProfil } : {}),
    provenance: {
      rangNom: Math.max(connu.provenance.rangNom, neuf.provenance.rangNom),
      rangIntitule: Math.max(connu.provenance.rangIntitule, neuf.provenance.rangIntitule),
    },
  };
}

/**
 * Les personnes d'une réponse Voyager, quelle que soit sa forme.
 *
 * La descente est RÉCURSIVE et non une lecture de chemins fixes : LinkedIn range
 * ses profils tantôt dans `included` (réponse normalisée), tantôt dans les
 * éléments eux-mêmes, et change la décoration sans prévenir.
 *
 * TROIS filtres, et il faut les connaître tous les trois : le jour où des profils
 * manqueront, c'est ici qu'il faut regarder, pas chez LinkedIn.
 *  1. **URN de personne** : trois préfixes reconnus, rien d'autre. Un URN de post,
 *     d'entreprise, de réaction ou de commentaire ne passe pas.
 *  2. **Au moins un attribut de personne** (nom, intitulé ou identifiant public).
 *     Un URN cité en simple référence — auteur d'un commentaire parent, mention —
 *     est écarté. Un nom VIDE descend en revanche jusqu'au schéma d'entrée du
 *     handler, qui décide seul de ce qui mérite un contact.
 *  3. **`PROFONDEUR_MAX`** : une branche plus profonde n'est pas explorée. Le
 *     nombre de branches coupées est rendu dans `tronques`, et l'appelant doit en
 *     faire quelque chose — sans ça la perte serait muette.
 *
 * Deux objets qui portent le MÊME URN sont FUSIONNÉS par `fusionner`, champ par
 * champ et par qualité de source, jamais par ordre de rencontre : `data` est visité
 * avant `included`, donc l'ordre donnerait systématiquement raison à la vignette
 * d'affichage contre l'entité profil.
 *
 * `urlProfil` vient de `publicIdentifier` : sans lui, l'adresse de repli déduite
 * de l'URN (`lienProfilDeduit`) ne rejoindra jamais celle que rend FullEnrich, et
 * un contact déjà connu ne serait pas rattaché. C'est le collecteur, et lui seul,
 * qui dispose de cette information.
 */
export function extraireEngageurs(corps: unknown): { personnes: EngageurVu[]; tronques: number } {
  const vus = new Map<string, EngageurVu>();
  let tronques = 0;
  const visiter = (noeud: unknown, profondeur: number): void => {
    if (noeud === null || typeof noeud !== 'object') return;
    if (profondeur > PROFONDEUR_MAX) {
      tronques += 1;
      return;
    }
    if (Array.isArray(noeud)) {
      for (const e of noeud) visiter(e, profondeur + 1);
      return;
    }
    const o = noeud as Record<string, unknown>;
    const urn = urnDeProfil(o.entityUrn) ?? urnDeProfil(o.objectUrn);
    if (urn !== null) {
      const structure = [texteDe(o.firstName), texteDe(o.lastName)].filter(Boolean).join(' ');
      // `o.name` est une chaîne d'AFFICHAGE : c'est elle que LinkedIn abrège.
      const nom = structure.length > 0 ? structure : (texteDe(o.name) ?? '');
      const intitule = texteDe(o.headline) ?? texteDe(o.occupation) ?? '';
      const identifiant = texteDe(o.publicIdentifier);
      // `publicIdentifier` ne figure que sur l'entité profil, jamais sur une vignette.
      const autorite = identifiant !== undefined ? 1 : 0;
      const provenance: ProvenanceEngageur = {
        rangNom: nom.length === 0 ? 0 : 1 + autorite + (structure.length > 0 ? 1 : 0),
        rangIntitule: intitule.length === 0 ? 0 : 1 + autorite,
      };
      // Il faut au moins UN attribut de personne : une réponse Voyager est pleine
      // d'URN de profil cités en référence (auteur d'un commentaire parent,
      // mention), sans rien d'autre. Un nom VIDE est en revanche conservé — c'est
      // une personne réellement vue, que LinkedIn n'a pas nommée (profil
      // anonymisé). Elle est comptée dans `vus`, puis écartée par le schéma
      // d'entrée du handler, qui refuse un contact sans nom.
      if (nom.length > 0 || intitule.length > 0 || identifiant !== undefined) {
        const entreprise = entrepriseDeLIntitule(intitule);
        const candidat: EngageurVu = {
          urn,
          nom,
          intitule,
          provenance,
          ...(entreprise !== undefined ? { entreprise } : {}),
          ...(identifiant !== undefined
            ? { urlProfil: `https://www.linkedin.com/in/${encodeURIComponent(identifiant)}` }
            : {}),
        };
        const connu = vus.get(urn);
        vus.set(urn, connu === undefined ? candidat : fusionner(connu, candidat));
      }
    }
    for (const v of Object.values(o)) visiter(v, profondeur + 1);
  };
  visiter(corps, 0);
  return { personnes: [...vus.values()], tronques };
}

/** Nombre total annoncé par la pagination Voyager, quand elle le donne. */
function totalAnnonce(corps: unknown): number | undefined {
  const racine = corps as { data?: { paging?: { total?: unknown } }; paging?: { total?: unknown } } | null;
  const brut = racine?.data?.paging?.total ?? racine?.paging?.total;
  return typeof brut === 'number' && Number.isFinite(brut) ? brut : undefined;
}

/**
 * Friction lue sur l'URL où le navigateur a atterri. Un checkpoint est une
 * vérification que le serveur ne sait pas passer ; une page de connexion veut
 * dire que le cookie de session n'est plus accepté.
 */
export function frictionDeLUrl(url: string): Friction | null {
  let chemin: string;
  try {
    chemin = new URL(url).pathname;
  } catch {
    return null;
  }
  if (chemin.startsWith('/checkpoint')) return { type: 'defi' };
  if (/^\/(login|uas\/|authwall|signup)/.test(chemin)) return { type: 'cookie_refuse' };
  return null;
}

/** Friction lue sur le statut HTTP. Tout autre statut hors 2xx est une panne, pas une friction. */
export function frictionDuStatut(statut: number): Friction | null {
  if (statut === 999) return { type: 'defi' };
  if (statut === 401 || statut === 403) return { type: 'cookie_refuse' };
  if (statut === 404 || statut === 410) return { type: 'post_introuvable' };
  return null;
}

const delaiAleatoire = (): number => DELAI_MIN_MS + Math.floor(Math.random() * (DELAI_MAX_MS - DELAI_MIN_MS));
const pauseReelle = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Lit les engageurs d'un post, dans la limite du budget.
 *
 * `surRequete` est appelé AVANT chaque appel, jamais après : la trace doit dire
 * ce qui est parti vers LinkedIn, et une requête dont la réponse se perd est
 * quand même partie. Compter après sous-estimerait le quota exactement quand
 * les choses vont mal.
 *
 * Ce qui a été lu avant l'arrêt est TOUJOURS rendu : un plafond atteint au
 * milieu de la pagination garde ses personnes, et le passage se termine
 * proprement plutôt que d'être rejoué pour redépasser le même plafond.
 */
export async function lireEngageurs(
  pilote: Pilote,
  urlPost: string,
  garder: string[],
  budget: Budget,
  surRequete: () => Promise<void>,
  /** Injectée pour que les tests n'attendent pas réellement. */
  pause: (ms: number) => Promise<void> = pauseReelle,
): Promise<{ personnes: Engageur[]; arret: ArretCollecte }> {
  if (budget.postsRestants <= 0 || budget.requetesRestantes <= 0) return { personnes: [], arret: 'plafond' };

  const urn = urnDActivite(urlPost);
  // Pas d'identifiant d'activité dans l'adresse : rien à demander. C'est une
  // adresse que l'opérateur a mal collée, pas une friction LinkedIn.
  if (urn === null) return { personnes: [], arret: { type: 'post_introuvable' } };

  // Il faut être SUR une page LinkedIn avant d'appeler Voyager : `pilote.requete`
  // part en `same-origin`, donc depuis `about:blank` aucun cookie ne partirait.
  //
  // Ce chargement de page EST du trafic LinkedIn, et le plus lourd du passage : il
  // se trace et se paie comme les autres. Le laisser hors du compteur ferait valoir
  // le trafic réel « plafond + un » par post, sur deux plafonds qui reposent
  // justement sur cette table.
  const vus = new Map<string, EngageurVu>();
  const personnes = (): Engageur[] => [...vus.values()];
  let restantes = budget.requetesRestantes;
  let premiereReponse = true;

  await surRequete();
  restantes -= 1;
  await pilote.aller(urlPost);
  const frictionArrivee = frictionDeLUrl(await pilote.url());
  if (frictionArrivee) return { personnes: [], arret: frictionArrivee };

  for (const fabriquer of adressesDemandees(garder)) {
    let debut = 0;
    for (let page = 0; page < PAGES_MAX; page += 1) {
      if (restantes <= 0) return { personnes: personnes(), arret: 'plafond' };
      // Toujours une pause : la précédente « requête » est au minimum le chargement
      // de la page du post, et enchaîner sans délai est ce qui se repère le mieux.
      await pause(delaiAleatoire());
      await surRequete();
      restantes -= 1;

      const rep = await pilote.requete(fabriquer(urn, debut), ENTETES_VOYAGER);
      const friction = frictionDuStatut(rep.statut);
      if (friction) return { personnes: personnes(), arret: friction };
      if (rep.statut < 200 || rep.statut >= 300) {
        // Un statut anormal est un verdict de LinkedIn sur nous (429, 5xx répétés) :
        // il engage le compte.
        throw new ErreurCollecte(`LinkedIn a répondu un statut inattendu (${rep.statut}).`, 'StatutInattendu', true);
      }
      const corps = lireJson(rep.corps);
      // La requête a abouti ; c'est NOTRE contrat de lecture qui ne tient plus.
      // Les frictions, elles, se lisent sur le statut et sur l'URL (voir la spec).
      if (corps === undefined) {
        throw new ErreurCollecte('Réponse LinkedIn illisible : ce n’est pas du JSON.', 'ReponseIllisible', false);
      }

      const { personnes: lot, tronques } = extraireEngageurs(corps);
      const total = totalAnnonce(corps);
      if (tronques > 0) {
        console.warn(
          `[collecte-linkedin] réponse Voyager plus profonde que ${PROFONDEUR_MAX} niveaux : ${tronques} branche(s) non explorée(s)`,
        );
      }
      // Le post annonce des engageurs et la liste n'en donne aucun : LinkedIn
      // retient la donnée. Ce n'est ni un post vide ni une panne — on s'arrête,
      // sans toucher à la session.
      if (premiereReponse && lot.length === 0 && total !== undefined && total > 0) {
        // Sauf si c'est NOUS qui n'avons pas regardé assez loin : accuser LinkedIn
        // de retenir la donnée serait un faux diagnostic de plus, et l'opérateur
        // chercherait la panne du mauvais côté.
        if (tronques > 0) {
          throw new ErreurCollecte(
            `Les profils de cette réponse LinkedIn sont imbriqués plus profond que ${PROFONDEUR_MAX} niveaux : le collecteur ne sait pas les lire.`,
            'ProfondeurVoyager',
            false,
          );
        }
        return { personnes: [], arret: { type: 'liste_vide' } };
      }
      premiereReponse = false;
      // Fusion ENTRE réponses, pas seulement à l'intérieur de l'une : quelqu'un qui
      // réagit et commente apparaît dans les deux listes, et les réactions, demandées
      // en premier, ne sont pas forcément les mieux décorées.
      for (const e of lot) {
        const connu = vus.get(e.urn);
        vus.set(e.urn, connu === undefined ? e : fusionner(connu, e));
      }

      if (lot.length === 0) break;
      debut += PAR_PAGE;
      if (total !== undefined && debut >= total) break;
    }
  }
  return { personnes: personnes(), arret: 'fini' };
}

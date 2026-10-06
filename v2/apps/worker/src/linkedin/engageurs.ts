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

const PAR_PAGE = 50;
/** Délai entre deux requêtes : jamais de cadence régulière, qui se repère d'un coup d'œil côté LinkedIn. */
const DELAI_MIN_MS = 2_000;
const DELAI_MAX_MS = 6_000;
/** Garde-fou de boucle : un `total` incohérent ne doit pas faire tourner la pagination sans fin. */
const PAGES_MAX = 40;
/** Profondeur de descente dans la réponse Voyager (les profils sont imbriqués, jamais à ce point). */
const PROFONDEUR_MAX = 8;

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
 * Les personnes d'une réponse Voyager, quelle que soit sa forme.
 *
 * La descente est RÉCURSIVE et non une lecture de chemins fixes : LinkedIn range
 * ses profils tantôt dans `included` (réponse normalisée), tantôt dans les
 * éléments eux-mêmes, et change la décoration sans prévenir. On retient un objet
 * dès qu'il porte un URN de PERSONNE (trois préfixes reconnus, rien d'autre) ET
 * au moins un attribut de personne. Un URN cité en simple référence, sans aucun
 * attribut, est écarté ici — c'est le seul filtre de cette fonction. Tout le
 * reste (nom vide, intitulé vide) descend au schéma d'entrée du handler, qui
 * décide seul de ce qui mérite un contact.
 *
 * `urlProfil` vient de `publicIdentifier` : sans lui, l'adresse de repli déduite
 * de l'URN (`lienProfilDeduit`) ne rejoindra jamais celle que rend FullEnrich, et
 * un contact déjà connu ne serait pas rattaché. C'est le collecteur, et lui seul,
 * qui dispose de cette information.
 */
export function extraireEngageurs(corps: unknown): Engageur[] {
  const vus = new Map<string, Engageur>();
  const visiter = (noeud: unknown, profondeur: number): void => {
    if (profondeur > PROFONDEUR_MAX || noeud === null || typeof noeud !== 'object') return;
    if (Array.isArray(noeud)) {
      for (const e of noeud) visiter(e, profondeur + 1);
      return;
    }
    const o = noeud as Record<string, unknown>;
    const urn = urnDeProfil(o.entityUrn) ?? urnDeProfil(o.objectUrn);
    if (urn !== null && !vus.has(urn)) {
      const nom = [texteDe(o.firstName), texteDe(o.lastName)].filter(Boolean).join(' ') || texteDe(o.name) || '';
      const intitule = texteDe(o.headline) ?? texteDe(o.occupation) ?? '';
      const identifiant = texteDe(o.publicIdentifier);
      // Il faut au moins UN attribut de personne : une réponse Voyager est pleine
      // d'URN de profil cités en référence (auteur d'un commentaire parent,
      // mention), sans rien d'autre. Un nom VIDE est en revanche conservé — c'est
      // une personne réellement vue, que LinkedIn n'a pas nommée (profil
      // anonymisé). Elle est comptée dans `vus`, puis écartée par le schéma
      // d'entrée du handler, qui refuse un contact sans nom.
      if (nom.length > 0 || intitule.length > 0 || identifiant !== undefined) {
        const entreprise = entrepriseDeLIntitule(intitule);
        vus.set(urn, {
          urn,
          nom,
          intitule,
          ...(entreprise !== undefined ? { entreprise } : {}),
          ...(identifiant !== undefined
            ? { urlProfil: `https://www.linkedin.com/in/${encodeURIComponent(identifiant)}` }
            : {}),
        });
      }
    }
    for (const v of Object.values(o)) visiter(v, profondeur + 1);
  };
  visiter(corps, 0);
  return [...vus.values()];
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
  await pilote.aller(urlPost);
  const frictionArrivee = frictionDeLUrl(await pilote.url());
  if (frictionArrivee) return { personnes: [], arret: frictionArrivee };

  const vus = new Map<string, Engageur>();
  const personnes = (): Engageur[] => [...vus.values()];
  let restantes = budget.requetesRestantes;
  let faites = 0;

  for (const fabriquer of adressesDemandees(garder)) {
    let debut = 0;
    for (let page = 0; page < PAGES_MAX; page += 1) {
      if (restantes <= 0) return { personnes: personnes(), arret: 'plafond' };
      if (faites > 0) await pause(delaiAleatoire());
      await surRequete();
      restantes -= 1;
      faites += 1;

      const rep = await pilote.requete(fabriquer(urn, debut), ENTETES_VOYAGER);
      const friction = frictionDuStatut(rep.statut);
      if (friction) return { personnes: personnes(), arret: friction };
      if (rep.statut < 200 || rep.statut >= 300) {
        throw new Error(`Réponse LinkedIn inattendue (statut ${rep.statut})`);
      }
      const corps = lireJson(rep.corps);
      if (corps === undefined) throw new Error('Réponse LinkedIn illisible');

      const lot = extraireEngageurs(corps);
      const total = totalAnnonce(corps);
      // Le post annonce des engageurs et la liste n'en donne aucun : LinkedIn
      // retient la donnée. Ce n'est ni un post vide ni une panne — on s'arrête,
      // sans toucher à la session.
      if (faites === 1 && lot.length === 0 && total !== undefined && total > 0) {
        return { personnes: [], arret: { type: 'liste_vide' } };
      }
      for (const e of lot) if (!vus.has(e.urn)) vus.set(e.urn, e);

      if (lot.length === 0) break;
      debut += PAR_PAGE;
      if (total !== undefined && debut >= total) break;
    }
  }
  return { personnes: personnes(), arret: 'fini' };
}

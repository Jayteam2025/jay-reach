/**
 * La fiche d'un post LinkedIn : qui l'a écrit, de quoi il parle, quand il est paru.
 *
 * Sert l'accroche qui NOMME le post (« je vous ai vu réagir au post de Christelle sur… »).
 *
 * **Rien de ce qui suit n'a été confronté à une page vivante** : la session LinkedIn de
 * production ne sort que par son proxy, et aucune mesure n'a pu être faite depuis le poste de
 * développement. La page se lit dans le DOM RENDU, par `pilote.texte(selecteur)`, sans aucune requête :
 * `engageurs.ts` a déjà chargé la page du post, la capturer est gratuite. Les sélecteurs sont des
 * SUPPOSITIONS (aucun n'est relevé dans le dépôt), tous rassemblés dans `SELECTEURS` : corriger
 * une forme réelle se fait là, et nulle part ailleurs.
 *
 * **Ne lève jamais.** Une page illisible rend une fiche aux champs nuls : l'appelant décide
 * alors de ne pas nommer le post, il n'a pas à rattraper une exception.
 */
import { frictionDeLUrl, urnDActivite } from './engageurs.js';
import type { Pilote } from './navigateur.js';

export type AuteurDePost = {
  kind: 'person' | 'page';
  nom: string;
  nomAffiche: string;
  nomPublic: string | null;
  url: string | null;
};
export type FichePost = {
  urn: string | null;
  url: string;
  auteur: AuteurDePost | null;
  texte: string | null;
  date: Date | null;
};

/** Longueur maximale du texte gardé : assez pour nommer le sujet, pas pour stocker le post. */
export const TEXTE_MAX = 1_200;

/** Le prénom d'une personne, le nom entier d'une page. */
export function nomAffichePourAuteur(kind: 'person' | 'page', nom: string): string {
  const propre = nom.trim().replace(/\s+/g, ' ');
  if (kind === 'page') return propre;
  return propre.split(' ')[0] ?? '';
}

/**
 * L'auteur lu sur la page, complété par ce que la source sait par construction (la page ou le
 * profil dont on lit les posts). Le connu prime sur `kind` (l'heuristique de la page est moins sûre)
 * et fournit nom public et adresse, que la page ne rend pas. Sans auteur lu, le connu sert tel quel :
 * `nomAffiche` y est vide, car un slug ne se lit pas dans « le post de ... ».
 */
export function auteurAvecRepli(lu: AuteurDePost | null, connu: AuteurDePost | null): AuteurDePost | null {
  if (connu === null) return lu;
  if (lu === null) return connu;
  return { ...lu, kind: connu.kind, nomPublic: lu.nomPublic ?? connu.nomPublic, url: lu.url ?? connu.url };
}

const DEBUT_LINKEDIN_MS = Date.UTC(2003, 0, 1);

/**
 * La date de publication portée par l'identifiant d'un post : les 41 bits de poids fort sont un
 * horodatage en millisecondes (identifiants de type « flocon »). DÉDUIT, jamais mesuré ici ; on
 * refuse tout résultat hors de [2003, demain], ce qui écarte un identifiant d'un autre format
 * plutôt que de rendre une date fausse.
 */
export function dateDeLActivite(urn: string): Date | null {
  const m = /^urn:li:(?:activity|ugcPost|share):(\d+)$/.exec(urn);
  if (!m?.[1]) return null;
  const ms = Number(BigInt(m[1]) >> 22n);
  if (!Number.isFinite(ms) || ms < DEBUT_LINKEDIN_MS || ms > Date.now() + 86_400_000) return null;
  return new Date(ms);
}

// ---------------------------------------------------------------------------------------------
// SELECTEURS : tout ce qui suppose une forme de la page est ici. TOUS sont des suppositions.
// Chaque liste est essayée dans l'ordre ; la première qui rend du texte l'emporte.
// ---------------------------------------------------------------------------------------------
export const SELECTEURS = {
  auteur: [
    '.update-components-actor__title span[aria-hidden="true"]',
    '.update-components-actor__name',
    '[data-testid="actor-name"]',
    '.feed-shared-actor__name',
  ],
  /** Ligne sous le nom : « 12 345 abonnés » pour une page, un degré ou « Suivre » pour une personne. */
  sousTitreAuteur: ['.update-components-actor__description', '.update-components-actor__sub-description', '.feed-shared-actor__description'],
  texte: [
    '.update-components-text',
    '.feed-shared-update-v2__description',
    '[data-testid="expandable-text-box"]',
    '.feed-shared-text',
  ],
} as const;

/** Délai laissé au rendu du texte du post avant de le chercher. */
const ATTENTE_RENDU_MS = 4_000;

const MOTIF_ABONNES = /\b(abonn[ée]s?|followers?|volgers)\b/i;

async function premierTexte(pilote: Pilote, selecteurs: readonly string[]): Promise<string | null> {
  for (const s of selecteurs) {
    const t = (await pilote.texte(s)).trim();
    if (t !== '') return t;
  }
  return null;
}

/** LinkedIn double parfois le nom (version visible et version pour lecteur d'écran) : « Ana Ana ». */
function sansDoublon(ligne: string): string {
  const mots = ligne.split(' ');
  const moitie = mots.length / 2;
  if (Number.isInteger(moitie) && moitie > 0 && mots.slice(0, moitie).join(' ') === mots.slice(moitie).join(' ')) {
    return mots.slice(0, moitie).join(' ');
  }
  return ligne;
}

/**
 * Lit la fiche sur la page DÉJÀ OUVERTE : aucune navigation, aucune requête.
 *
 * `nomPublic` et `url` restent `null` : `Pilote.texte` ne rend que du texte, jamais l'adresse
 * d'un lien. `kind` est une HEURISTIQUE : une ligne « abonnés » sous le nom veut dire une page.
 * Ne lève jamais.
 */
export async function lireFichePostDepuisPageOuverte(pilote: Pilote): Promise<FichePost> {
  let url = '';
  const fiche: FichePost = { urn: null, url, auteur: null, texte: null, date: null };
  try {
    url = await pilote.url();
    fiche.url = url;
    fiche.urn = urnDActivite(url);
    fiche.date = fiche.urn === null ? null : dateDeLActivite(fiche.urn);
    if (frictionDeLUrl(url)) return fiche;

    await pilote.attendre(SELECTEURS.texte.join(', '), ATTENTE_RENDU_MS);

    const brut = (await premierTexte(pilote, SELECTEURS.texte))?.replace(/\s+/g, ' ').trim();
    if (brut) fiche.texte = brut.length > TEXTE_MAX ? brut.slice(0, TEXTE_MAX).trimEnd() : brut;

    const nom = sansDoublon(((await premierTexte(pilote, SELECTEURS.auteur)) ?? '').split('\n')[0]?.trim() ?? '');
    if (nom !== '') {
      const sousTitre = (await premierTexte(pilote, SELECTEURS.sousTitreAuteur)) ?? '';
      const kind = MOTIF_ABONNES.test(sousTitre) ? 'page' : 'person';
      fiche.auteur = { kind, nom, nomAffiche: nomAffichePourAuteur(kind, nom), nomPublic: null, url: null };
    }
  } catch {
    // contrat : une page illisible rend ce qui a été lu avant, jamais une exception
  }
  return fiche;
}

/** Ouvre le post puis le lit. Une navigation, aucune requête. Ne lève jamais. */
export async function lireFichePost(pilote: Pilote, url: string): Promise<FichePost> {
  try {
    await pilote.aller(url);
  } catch {
    return { urn: urnDActivite(url), url, auteur: null, texte: null, date: dateDeUrl(url) };
  }
  const fiche = await lireFichePostDepuisPageOuverte(pilote);
  // L'adresse demandée prime sur celle d'arrivée (redirection) pour l'identité du post.
  return { ...fiche, url, urn: urnDActivite(url) ?? fiche.urn };
}

function dateDeUrl(url: string): Date | null {
  const urn = urnDActivite(url);
  return urn === null ? null : dateDeLActivite(urn);
}

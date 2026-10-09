/**
 * Chercher des PERSONNES sur LinkedIn par mots-clés, pour la source « recherche par mot-clé ».
 *
 * Comme la page d'activité d'un profil (`profils.ts`), tout se lit dans le HTML : aucune requête
 * Voyager ne sert ces résultats, donc aucun `queryId` périssable. Relevé le 09/10/2026 dans un
 * vrai navigateur, sur deux pages de résultats.
 *
 * **Ce que cette source rapporte est meilleur qu'un engageur de page.** Les résultats portent le
 * NOM PUBLIC de chaque personne, pas un URN : leur adresse de profil est donc réelle et non
 * déduite, donc cherchable et enrichissable (voir `sqlAdresseResolvable`). Là où les réacteurs
 * d'un post de page arrivent tous avec une adresse fabriquée, ceux-ci arrivent utilisables.
 *
 * Deux choses relevées, chacune contre-intuitive :
 *
 *  1. **Deux gardes, et elles ne font pas le même travail.** Compter les `/in/<nom>` du document
 *     donne 32 liens là où la page affiche 10 résultats, et ce bruit est le MÊME d'une page à
 *     l'autre : 4 « résultats » communs entre la page 1 et la page 2, avant correction.
 *     - C'est l'`aria-label` qui écarte le bruit : mesuré sur une page entière, AUCUN lien de
 *       navigation n'en porte, et tous les liens de résultat en portent un. Le chevauchement
 *       tombe alors à zéro.
 *     - Le découpage sur `role="listitem"` sert à autre chose : délimiter UNE personne, pour
 *       que son intitulé soit bien le sien et non celui du résultat suivant.
 *  2. **La pagination passe par l'URL, pas par le défilement.** Faire défiler n'ajoute rien, ce
 *     qui avait fait croire la source impossible. `&page=N` sert bien une page distincte.
 */
import {
  ErreurCollecte,
  MESSAGES_FRICTION,
  frictionDeLUrl,
  frictionDuStatut,
  type ArretCollecte,
} from './engageurs.js';
import type { Pilote } from './navigateur.js';

/** Une personne trouvée par la recherche. Pas d'URN : le nom public EST l'identité. */
export interface PersonneTrouvee {
  /** Le nom public, tel qu'il apparaît dans `linkedin.com/in/<nomPublic>`. */
  readonly nomPublic: string;
  /** L'adresse canonique du profil, reconstruite depuis le nom public. */
  readonly urlProfil: string;
  readonly nom: string;
  /** L'intitulé affiché sous le nom (« Directeur commercial chez … »). Jamais vide. */
  readonly intitule: string;
}

/**
 * Le degré de relation, affiché entre le nom et l'intitulé (« • 2e »). Ce n'est pas un intitulé,
 * et c'est le seul texte qui s'intercale systématiquement : sans ce filtre, une personne sur deux
 * serait scorée sur la chaîne « • 2e ».
 */
const DEGRE_DE_RELATION = /^[•\s]*(1er|2e|3e\+?|Hors réseau|Out of network)$/i;

/** Au-delà, LinkedIn ne sert plus de résultats nouveaux : garde-fou, pas une cible. */
export const PAGES_MAX_RECHERCHE = 10;

/** L'adresse d'une page de résultats, reconstruite — jamais une saisie d'opérateur telle quelle. */
export function urlRecherche(motsCles: string, page: number): string {
  const q = encodeURIComponent(motsCles.trim());
  const base = `https://www.linkedin.com/search/results/people/?keywords=${q}`;
  return page <= 1 ? base : `${base}&page=${page}`;
}

/**
 * Les personnes d'une page de résultats.
 *
 * Un bloc sans lien ou sans nom est IGNORÉ sans bruit : la liste porte aussi des entrées qui ne
 * sont pas des personnes (encarts, « voir tous les résultats »). Mesuré : 9 personnes pour 10
 * `role="listitem"` sur une page. Les compter comme des échecs ferait passer une page normale
 * pour une page fautive.
 */
export function extrairePersonnes(html: string): PersonneTrouvee[] {
  const personnes: PersonneTrouvee[] = [];
  const vus = new Set<string>();
  for (const bloc of html.split('role="listitem"').slice(1)) {
    const nomPublic = (/href="https:\/\/www\.linkedin\.com\/in\/([^"?#/]+)/.exec(bloc) ?? [])[1];
    const nom = (/aria-label="([^"]+)"/.exec(bloc) ?? [])[1];
    if (nomPublic === undefined || nom === undefined) continue;
    const identifiant = decodeURIComponent(nomPublic);
    if (vus.has(identifiant)) continue;

    // Les textes du bloc, dans l'ordre d'affichage : nom, degré de relation, intitulé, lieu…
    // L'intitulé est le premier qui n'est ni le nom ni un degré.
    const textes = [...bloc.matchAll(/>([^<>]{2,120})</g)]
      .map((m) => (m[1] ?? '').trim())
      .filter((t) => t.length > 0);
    const intitule = textes.find((t) => t !== nom && !DEGRE_DE_RELATION.test(t));
    if (intitule === undefined) continue;

    vus.add(identifiant);
    personnes.push({
      nomPublic: identifiant,
      urlProfil: `https://www.linkedin.com/in/${encodeURIComponent(identifiant)}/`,
      nom,
      intitule,
    });
  }
  return personnes;
}

/**
 * Parcourt les pages de résultats jusqu'au plafond de personnes ou de requêtes.
 *
 * Rend ce qui a été trouvé AVANT l'arrêt, comme les autres collecteurs : un plafond atteint au
 * milieu de la pagination garde sa récolte plutôt que de faire rejouer le passage pour redépasser
 * le même plafond.
 *
 * `dejaVus` porte les noms publics déjà enregistrés pour cette source : une recherche rejouée
 * demain reverra les mêmes personnes en tête, et les relire coûterait le plafond du jour sans
 * ajouter personne.
 */
export async function chercherPersonnes(
  pilote: Pilote,
  motsCles: string,
  options: {
    readonly dejaVus: ReadonlySet<string>;
    readonly personnesMax: number;
    readonly requetesRestantes: () => number;
    readonly surRequete: () => Promise<void>;
    readonly pause: (ms: number) => Promise<void>;
    readonly delaiMs?: number;
  },
): Promise<{ personnes: PersonneTrouvee[]; arret: ArretCollecte }> {
  const { dejaVus, personnesMax, requetesRestantes, surRequete, pause } = options;
  const delai = options.delaiMs ?? 5_000;
  if (motsCles.trim().length === 0) {
    throw new ErreurCollecte('Aucun mot-clé n’est renseigné : ajoutez-en à la source.', 'MotsClesAbsents', false);
  }
  if (personnesMax <= 0 || requetesRestantes() <= 0) return { personnes: [], arret: 'plafond' };

  const retenues: PersonneTrouvee[] = [];
  const vus = new Set(dejaVus);
  for (let page = 1; page <= PAGES_MAX_RECHERCHE; page += 1) {
    if (requetesRestantes() <= 0) return { personnes: retenues, arret: 'plafond' };
    // Toujours une pause avant d'appeler : enchaîner sans délai est ce qui se repère le mieux.
    if (page > 1) await pause(delai);
    await surRequete();

    const rep = await pilote.requete(urlRecherche(motsCles, page));
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
      throw new ErreurCollecte(`La recherche n’a pas répondu (${rep.statut}).`, 'RechercheIndisponible', false);
    }

    const lot = extrairePersonnes(rep.corps);
    // Une page SANS aucun résultat met fin au parcours : c'est la fin des résultats. Une page qui
    // n'apporte que des personnes déjà vues, elle, ne l'arrête pas — les pages suivantes peuvent
    // encore en porter de nouvelles.
    if (lot.length === 0) break;
    for (const p of lot) {
      if (vus.has(p.nomPublic)) continue;
      vus.add(p.nomPublic);
      retenues.push(p);
      if (retenues.length >= personnesMax) return { personnes: retenues, arret: 'plafond' };
    }
  }
  return { personnes: retenues, arret: retenues.length === 0 ? { type: 'liste_vide' } : 'fini' };
}

/**
 * Va sur LinkedIn avant toute recherche, et rend la friction lue sur l'URL d'arrivée.
 *
 * `pilote.requete` exécute son appel DEPUIS LE CONTEXTE DE LA PAGE, en same-origin : depuis
 * `about:blank` il lève une DOMException et le passage s'arrête sur « Collecte interrompue » dès
 * la première requête. Mesuré en réel le 09/10 sur la première source de pages créée — aucun
 * pilote factice ne pouvait l'attraper, puisque le contexte de page n'existe que dans un vrai
 * navigateur.
 */
export async function arriverSurLaRecherche(
  pilote: Pilote,
  motsCles: string,
  surRequete: () => Promise<void>,
): Promise<Exclude<ArretCollecte, 'fini' | 'plafond'> | null> {
  await surRequete();
  await pilote.aller(urlRecherche(motsCles, 1));
  return frictionDeLUrl(await pilote.url()) ?? null;
}

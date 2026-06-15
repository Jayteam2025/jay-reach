/**
 * Helpers de cascade geographique pour les recherches FullEnrich.
 *
 * Permet de cibler la recherche de contacts au plus pres d'une adresse
 * connue (ex : "POINT.P @ Nanterre" -> on commence par chercher des
 * contacts a Nanterre, puis Hauts-de-Seine, puis Ile-de-France, puis France).
 *
 * Pourquoi : sur les multinationales (Sodexo, Carrefour, ELIS, POINT.P...),
 * une recherche "France seule" ramene 30 DRH dispatches partout, dont 1 seul
 * pertinent pour la filiale ciblee. La cascade permet de payer 1 credit pour
 * le contact local au lieu de 10 credits pour 10 contacts random.
 *
 * FullEnrich /people/search confirme :
 *   - person_locations est un OR (pas un ranking)
 *   - filtre strict (Roubaix seul -> 0 contact si pas de DRH la-bas)
 *   - les calls vides (0 contact) coutent 0 credit (verifie 04/2026)
 * => cascade = strategie optimale.
 */

import type { SearchFilter } from "./fullenrich.ts";

/**
 * Code postal -> nom de departement (FR metropole + DROM).
 *
 * Les codes Corse (20) sont mappes a 2A/2B selon le numero, mais pour la
 * recherche FullEnrich on retourne "Corse" puisque l'API est tolerante au
 * niveau region.
 */
const DEPARTMENTS: Record<string, string> = {
  "01": "Ain",
  "02": "Aisne",
  "03": "Allier",
  "04": "Alpes-de-Haute-Provence",
  "05": "Hautes-Alpes",
  "06": "Alpes-Maritimes",
  "07": "Ardeche",
  "08": "Ardennes",
  "09": "Ariege",
  "10": "Aube",
  "11": "Aude",
  "12": "Aveyron",
  "13": "Bouches-du-Rhone",
  "14": "Calvados",
  "15": "Cantal",
  "16": "Charente",
  "17": "Charente-Maritime",
  "18": "Cher",
  "19": "Correze",
  "21": "Cote-d'Or",
  "22": "Cotes-d'Armor",
  "23": "Creuse",
  "24": "Dordogne",
  "25": "Doubs",
  "26": "Drome",
  "27": "Eure",
  "28": "Eure-et-Loir",
  "29": "Finistere",
  "2A": "Corse-du-Sud",
  "2B": "Haute-Corse",
  "30": "Gard",
  "31": "Haute-Garonne",
  "32": "Gers",
  "33": "Gironde",
  "34": "Herault",
  "35": "Ille-et-Vilaine",
  "36": "Indre",
  "37": "Indre-et-Loire",
  "38": "Isere",
  "39": "Jura",
  "40": "Landes",
  "41": "Loir-et-Cher",
  "42": "Loire",
  "43": "Haute-Loire",
  "44": "Loire-Atlantique",
  "45": "Loiret",
  "46": "Lot",
  "47": "Lot-et-Garonne",
  "48": "Lozere",
  "49": "Maine-et-Loire",
  "50": "Manche",
  "51": "Marne",
  "52": "Haute-Marne",
  "53": "Mayenne",
  "54": "Meurthe-et-Moselle",
  "55": "Meuse",
  "56": "Morbihan",
  "57": "Moselle",
  "58": "Nievre",
  "59": "Nord",
  "60": "Oise",
  "61": "Orne",
  "62": "Pas-de-Calais",
  "63": "Puy-de-Dome",
  "64": "Pyrenees-Atlantiques",
  "65": "Hautes-Pyrenees",
  "66": "Pyrenees-Orientales",
  "67": "Bas-Rhin",
  "68": "Haut-Rhin",
  "69": "Rhone",
  "70": "Haute-Saone",
  "71": "Saone-et-Loire",
  "72": "Sarthe",
  "73": "Savoie",
  "74": "Haute-Savoie",
  "75": "Paris",
  "76": "Seine-Maritime",
  "77": "Seine-et-Marne",
  "78": "Yvelines",
  "79": "Deux-Sevres",
  "80": "Somme",
  "81": "Tarn",
  "82": "Tarn-et-Garonne",
  "83": "Var",
  "84": "Vaucluse",
  "85": "Vendee",
  "86": "Vienne",
  "87": "Haute-Vienne",
  "88": "Vosges",
  "89": "Yonne",
  "90": "Territoire de Belfort",
  "91": "Essonne",
  "92": "Hauts-de-Seine",
  "93": "Seine-Saint-Denis",
  "94": "Val-de-Marne",
  "95": "Val-d'Oise",
  "971": "Guadeloupe",
  "972": "Martinique",
  "973": "Guyane",
  "974": "La Reunion",
  "976": "Mayotte",
};

/**
 * Departement -> region administrative.
 */
const DEPT_TO_REGION: Record<string, string> = {
  // Auvergne-Rhone-Alpes
  "01": "Auvergne-Rhone-Alpes", "03": "Auvergne-Rhone-Alpes",
  "07": "Auvergne-Rhone-Alpes", "15": "Auvergne-Rhone-Alpes",
  "26": "Auvergne-Rhone-Alpes", "38": "Auvergne-Rhone-Alpes",
  "42": "Auvergne-Rhone-Alpes", "43": "Auvergne-Rhone-Alpes",
  "63": "Auvergne-Rhone-Alpes", "69": "Auvergne-Rhone-Alpes",
  "73": "Auvergne-Rhone-Alpes", "74": "Auvergne-Rhone-Alpes",
  // Bourgogne-Franche-Comte
  "21": "Bourgogne-Franche-Comte", "25": "Bourgogne-Franche-Comte",
  "39": "Bourgogne-Franche-Comte", "58": "Bourgogne-Franche-Comte",
  "70": "Bourgogne-Franche-Comte", "71": "Bourgogne-Franche-Comte",
  "89": "Bourgogne-Franche-Comte", "90": "Bourgogne-Franche-Comte",
  // Bretagne
  "22": "Bretagne", "29": "Bretagne", "35": "Bretagne", "56": "Bretagne",
  // Centre-Val de Loire
  "18": "Centre-Val de Loire", "28": "Centre-Val de Loire",
  "36": "Centre-Val de Loire", "37": "Centre-Val de Loire",
  "41": "Centre-Val de Loire", "45": "Centre-Val de Loire",
  // Corse
  "2A": "Corse", "2B": "Corse",
  // Grand Est
  "08": "Grand Est", "10": "Grand Est", "51": "Grand Est",
  "52": "Grand Est", "54": "Grand Est", "55": "Grand Est",
  "57": "Grand Est", "67": "Grand Est", "68": "Grand Est",
  "88": "Grand Est",
  // Hauts-de-France
  "02": "Hauts-de-France", "59": "Hauts-de-France",
  "60": "Hauts-de-France", "62": "Hauts-de-France",
  "80": "Hauts-de-France",
  // Ile-de-France
  "75": "Ile-de-France", "77": "Ile-de-France", "78": "Ile-de-France",
  "91": "Ile-de-France", "92": "Ile-de-France", "93": "Ile-de-France",
  "94": "Ile-de-France", "95": "Ile-de-France",
  // Normandie
  "14": "Normandie", "27": "Normandie", "50": "Normandie",
  "61": "Normandie", "76": "Normandie",
  // Nouvelle-Aquitaine
  "16": "Nouvelle-Aquitaine", "17": "Nouvelle-Aquitaine",
  "19": "Nouvelle-Aquitaine", "23": "Nouvelle-Aquitaine",
  "24": "Nouvelle-Aquitaine", "33": "Nouvelle-Aquitaine",
  "40": "Nouvelle-Aquitaine", "47": "Nouvelle-Aquitaine",
  "64": "Nouvelle-Aquitaine", "79": "Nouvelle-Aquitaine",
  "86": "Nouvelle-Aquitaine", "87": "Nouvelle-Aquitaine",
  // Occitanie
  "09": "Occitanie", "11": "Occitanie", "12": "Occitanie",
  "30": "Occitanie", "31": "Occitanie", "32": "Occitanie",
  "34": "Occitanie", "46": "Occitanie", "48": "Occitanie",
  "65": "Occitanie", "66": "Occitanie", "81": "Occitanie",
  "82": "Occitanie",
  // Pays de la Loire
  "44": "Pays de la Loire", "49": "Pays de la Loire",
  "53": "Pays de la Loire", "72": "Pays de la Loire",
  "85": "Pays de la Loire",
  // Provence-Alpes-Cote d'Azur
  "04": "Provence-Alpes-Cote d'Azur", "05": "Provence-Alpes-Cote d'Azur",
  "06": "Provence-Alpes-Cote d'Azur", "13": "Provence-Alpes-Cote d'Azur",
  "83": "Provence-Alpes-Cote d'Azur", "84": "Provence-Alpes-Cote d'Azur",
  // DROM (chaque DROM est sa propre region)
  "971": "Guadeloupe", "972": "Martinique", "973": "Guyane",
  "974": "La Reunion", "976": "Mayotte",
};

/**
 * Extrait le code departement depuis un code postal francais.
 * Gere les DROM (3 chiffres) et la Corse (2A/2B selon le 3eme chiffre).
 *
 * @example
 *   postalToDepartmentCode("75001") => "75"
 *   postalToDepartmentCode("97110") => "971"
 *   postalToDepartmentCode("20000") => "2A"
 *   postalToDepartmentCode("20200") => "2B"
 */
export function postalToDepartmentCode(postal: string | null | undefined): string | null {
  if (!postal) return null;
  const cleaned = String(postal).replace(/\s+/g, "").trim();
  if (!/^\d{5}$/.test(cleaned)) return null;

  // DROM : 971, 972, 973, 974, 976 (975 = St-Pierre-Miquelon, hors scope)
  const prefix3 = cleaned.slice(0, 3);
  if (["971", "972", "973", "974", "976"].includes(prefix3)) {
    return prefix3;
  }

  // Corse : 20XXX
  const prefix2 = cleaned.slice(0, 2);
  if (prefix2 === "20") {
    const third = parseInt(cleaned.slice(2, 3), 10);
    return third < 2 ? "2A" : "2B";
  }

  return prefix2;
}

/**
 * Code postal -> nom de departement.
 * @example postalToDepartment("59100") => "Nord"
 */
export function postalToDepartment(postal: string | null | undefined): string | null {
  const code = postalToDepartmentCode(postal);
  return code ? DEPARTMENTS[code] || null : null;
}

/**
 * Code postal -> nom de region administrative.
 * @example postalToRegion("59100") => "Hauts-de-France"
 */
export function postalToRegion(postal: string | null | undefined): string | null {
  const code = postalToDepartmentCode(postal);
  return code ? DEPT_TO_REGION[code] || null : null;
}

/**
 * Title-case une chaine pour les noms de villes (FullEnrich n'aime pas
 * les MAJUSCULES type INSEE "PARIS" ou "MERDRIGNAC").
 * @example titleCase("MERDRIGNAC") => "Merdrignac"
 */
export function titleCase(s: string | null | undefined): string | null {
  if (!s) return null;
  const cleaned = String(s).trim();
  if (!cleaned) return null;
  return cleaned
    .toLowerCase()
    .split(/(\s|-)/)
    .map((part) => (/[a-z]/.test(part) ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join("");
}

export interface GeoCascadeInput {
  /** Ville (ex: "PARIS", "Nanterre"). Sera title-case automatiquement. */
  city?: string | null;
  /** Code postal francais (5 chiffres). Sert a deduire dept + region. */
  postalCode?: string | null;
}

/**
 * Construit la cascade geographique du plus precis au plus large pour
 * une recherche FullEnrich.
 *
 * Retourne 1 a 4 niveaux selon ce qui est dispo, toujours termine par
 * "France" comme fallback final.
 *
 * @example
 *   buildGeoCascade({ city: "Nanterre", postalCode: "92000" })
 *   => [{value:"Nanterre"}, {value:"Hauts-de-Seine"}, {value:"Ile-de-France"}, {value:"France"}]
 *
 *   buildGeoCascade({})
 *   => [{value:"France"}]
 *
 *   buildGeoCascade({ postalCode: "59100" })
 *   => [{value:"Nord"}, {value:"Hauts-de-France"}, {value:"France"}]
 */
/**
 * Suffixes regionaux/geographiques a supprimer en queue de nom de boite
 * pour la recherche FullEnrich. Sur LinkedIn, les employes d'une filiale
 * regionale se declarent typiquement sous le nom court ("IDEA") plutot
 * que sous le nom complet "IDEA Nouvelle Aquitaine" — la region est portee
 * par leur location, qu'on filtre ensuite via la cascade geo.
 *
 * Liste limitee aux regions et libelles multi-mots non ambigus. On exclut
 * volontairement les directions cardinales seules ("Nord", "Sud") qui
 * peuvent faire partie integrante d'une marque (ex: "Credit du Nord").
 */
const GEO_SUFFIX_PATTERNS: RegExp[] = [
  /[\s\-,]+nouvelle[\s\-]+aquitaine\s*$/i,
  /[\s\-,]+[îi]le[\s\-]+de[\s\-]+france\s*$/i,
  /[\s\-,]+idf\s*$/i,
  /[\s\-,]+auvergne[\s\-]+rh[oô]ne[\s\-]+alpes\s*$/i,
  /[\s\-,]+ara\s*$/i,
  /[\s\-,]+hauts[\s\-]+de[\s\-]+france\s*$/i,
  /[\s\-,]+centre[\s\-]+val\s+de\s+loire\s*$/i,
  /[\s\-,]+pays\s+de\s+la\s+loire\s*$/i,
  /[\s\-,]+provence[\s\-]+alpes[\s\-]+c[oô]te\s+d['']?azur\s*$/i,
  /[\s\-,]+paca\s*$/i,
  /[\s\-,]+grand\s+est\s*$/i,
  /[\s\-,]+bourgogne[\s\-]+franche[\s\-]+comt[eé]\s*$/i,
  /[\s\-,]+bretagne\s*$/i,
  /[\s\-,]+normandie\s*$/i,
  /[\s\-,]+occitanie\s*$/i,
  /[\s\-,]+corse\s*$/i,
];

/**
 * Si `name` finit par un suffixe regional connu, retourne le nom court
 * (sans le suffixe). Sinon, retourne null.
 *
 * @example
 *   stripGeoSuffix("IDEA Nouvelle Aquitaine") => "IDEA"
 *   stripGeoSuffix("Auchan - Hauts-de-France") => "Auchan"
 *   stripGeoSuffix("IDEA")                     => null
 *   stripGeoSuffix("Bretagne")                 => null  // resultat trop court
 */
export function stripGeoSuffix(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  for (const pattern of GEO_SUFFIX_PATTERNS) {
    const stripped = trimmed.replace(pattern, "").trim();
    if (stripped !== trimmed && stripped.length >= 2) {
      return stripped;
    }
  }
  return null;
}

export function buildGeoCascade(input: GeoCascadeInput): SearchFilter[] {
  const cascade: SearchFilter[] = [];
  const seen = new Set<string>();

  const push = (value: string | null | undefined) => {
    if (!value) return;
    const v = value.trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) return;
    seen.add(key);
    cascade.push({ value: v });
  };

  push(titleCase(input.city));
  push(postalToDepartment(input.postalCode));
  push(postalToRegion(input.postalCode));
  push("France");

  return cascade;
}

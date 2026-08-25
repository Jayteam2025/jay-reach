/**
 * Detection de pattern email a partir d'echantillons connus.
 *
 * Permet de deduire l'email d'un nouveau contact d'une boite dont on connait
 * deja >=3 emails existants : si tous suivent "prenom.nom@domaine.com", on
 * peut generer "marie.dupont@domaine.com" pour Marie Dupont sans payer un
 * crédit FullEnrich supplementaire.
 *
 * Verifie empiriquement (04/2026) sur 15 domaines reels :
 * - 8 HIGH (>=85% confidence) -> deduction sans verif Reoon (paprec, elis,
 *   pointp, theodore, paritel, saint-gobain, bio3g, safrangroup)
 * - 6 MEDIUM (65-84%) -> deduction + verif Reoon avant display
 * - 1 SKIP : trop peu d'echantillons ou pattern hetereogene
 */

export type PatternId =
  | "first.last"
  | "first_last"
  | "first-last"
  | "firstlast"
  | "flast"
  | "f.last"
  | "first"
  | "last"
  | "last.f"
  | "first.l";

export type PatternTier = "high" | "medium" | "skip";

/**
 * Seuils de classification.
 *
 * NOTE 2026-04-28 : medium remonte de 0.65 a 0.85 apres observation prod.
 * Sur 20 verifs Reoon power de deductions tier=medium (ex: soprasteria 73%,
 * rexel 76%, pg 81%, yoplait 84%), Reoon a refuse tous les emails (14
 * "invalid" + 6 "unknown", 0 "valid"). Conclusion : sous 85% de confidence,
 * la deduction est trop fragile et Reoon le confirme. On gaspillait des
 * credits Reoon sans rien obtenir. Le tier MEDIUM devient donc un range
 * vide ; tout < 85% retombe en SKIP (pas de deduction du tout).
 *
 * Si plus tard on observe que certains patterns 80-85% sont effectivement
 * valides (apres plus d'enrichissements pour ces domaines), on rebaissera
 * ce seuil avec donnees en prod a l'appui.
 */
export const TIER_THRESHOLDS = {
  high: 0.85,
  medium: 0.85,
} as const;

interface PatternBuilder {
  id: PatternId;
  build: (first: string, last: string) => string | null;
}

/**
 * Normalise un nom : retire accents, trim, lowercase, retire espaces internes
 * (les noms composes type "Le Bras" deviennent "lebras", "Jean-Pierre" garde
 * son tiret car c'est une variante de prenom).
 *
 * Pourquoi : les emails B2B suivent des conventions strictes sans accent et
 * sans espace, mais les tirets dans les prenoms composes sont preserves
 * (verifie sur paprec, elis, pointp).
 */
export function normalizeNamePart(s: string | null | undefined, opts: { stripSpaces?: boolean } = {}): string {
  if (!s) return "";
  let out = String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents
    .toLowerCase()
    .trim();
  if (opts.stripSpaces) {
    out = out.replace(/\s+/g, "");
  }
  return out;
}

const FIRST = (s: string | null | undefined) => normalizeNamePart(s);
const LAST = (s: string | null | undefined) => normalizeNamePart(s, { stripSpaces: true });

const PATTERNS: PatternBuilder[] = [
  { id: "first.last", build: (f, l) => (f && l ? `${FIRST(f)}.${LAST(l)}` : null) },
  { id: "first_last", build: (f, l) => (f && l ? `${FIRST(f)}_${LAST(l)}` : null) },
  { id: "first-last", build: (f, l) => (f && l ? `${FIRST(f)}-${LAST(l)}` : null) },
  { id: "firstlast", build: (f, l) => (f && l ? `${FIRST(f)}${LAST(l)}` : null) },
  { id: "flast", build: (f, l) => (f && l ? `${FIRST(f).slice(0, 1)}${LAST(l)}` : null) },
  { id: "f.last", build: (f, l) => (f && l ? `${FIRST(f).slice(0, 1)}.${LAST(l)}` : null) },
  { id: "first", build: (f) => (f ? FIRST(f) : null) },
  { id: "last", build: (_f, l) => (l ? LAST(l) : null) },
  { id: "last.f", build: (f, l) => (f && l ? `${LAST(l)}.${FIRST(f).slice(0, 1)}` : null) },
  { id: "first.l", build: (f, l) => (f && l ? `${FIRST(f)}.${LAST(l).slice(0, 1)}` : null) },
];

export interface EmailSample {
  first_name: string | null | undefined;
  last_name: string | null | undefined;
  email: string | null | undefined;
}

export interface PatternDetectionResult {
  pattern: PatternId | null;
  confidence: number; // 0..1
  tier: PatternTier;
  hits: number;
  total: number;
  /** Pattern secondaire (rare mais utile pour le debug). */
  secondary: { pattern: PatternId; hits: number } | null;
}

/**
 * Verifie qu'un sample est exploitable pour la detection. Skip les lignes
 * tronquees (first ou last < 2 chars, type "A H") et les initiales coupees
 * ("LAURENT F.", "julien T."). Ces lignes viennent de scraps LinkedIn
 * sur des profils prives et faussent la confidence sans signal utile sur
 * le pattern reel. Bug observe sur Rexel 2026-05 : 7 samples polluants
 * tiraient la confidence de 92% a 80.7%.
 */
function isUsableSample(s: EmailSample): boolean {
  const f = String(s.first_name ?? "").trim();
  const l = String(s.last_name ?? "").trim();
  if (!f || !l || !s.email) return false;
  if (f.length < 2 || l.length < 2) return false;
  if (/\.\s*$/.test(f) || /\.\s*$/.test(l)) return false;
  return true;
}

/**
 * Match tolerant entre la chaine construite par un pattern et le local-part
 * d'un email. Les sources convertissent parfois "Marie Laure" en
 * "marie-laure" (ou inversement), ou strippent l'espace. Sans tolerance, ces
 * cas sont des miss qui faussent la confidence.
 */
function matchesLocal(built: string, localPart: string): boolean {
  if (built === localPart) return true;
  if (built.includes(" ") && built.replace(/\s+/g, "-") === localPart) return true;
  if (built.includes("-") && built.replace(/-/g, " ") === localPart) return true;
  if (built.includes(" ") && built.replace(/\s+/g, "") === localPart) return true;
  // Nom compose tronque cote email : "pierre.thoreau-mambourg" -> "pierre.thoreau".
  // Restreint aux patterns avec separateur principal (./_) pour ne pas
  // s'appliquer faussement au pattern "first-last" (ou tout dash compte).
  // On exige : built start with localPart+"-" ET localPart contient un . ou _.
  if (/[._]/.test(localPart) && built.startsWith(localPart + "-")) return true;
  return false;
}

/**
 * Essaie de matcher un sample contre tous les patterns, en mode normal puis
 * en swappant first/last. Le swap couvre les imports ou les noms sont
 * inverses a la source (ex : "Galichet Jean - Charles" / "jgalichet" — c'est
 * "Jean - Charles GALICHET" en realite). Le swap compte comme un hit.
 */
function classifySample(s: EmailSample, localPart: string): PatternId | null {
  const f = s.first_name ?? "";
  const l = s.last_name ?? "";
  for (const p of PATTERNS) {
    const built = p.build(f, l);
    if (built && matchesLocal(built, localPart)) return p.id;
  }
  for (const p of PATTERNS) {
    const built = p.build(l, f);
    if (built && matchesLocal(built, localPart)) return p.id;
  }
  return null;
}

/**
 * Detecte le pattern email dominant a partir d'une liste d'echantillons.
 *
 * Pour chaque email, on essaie de matcher le local part (avant @) avec
 * chaque pattern dans l'ordre defini. Le 1er pattern qui matche compte.
 * Le pattern le plus frequent l'emporte, et la confidence = hits / usable.
 *
 * Tier :
 *   - high (>=85%)  : deduction directe, pas besoin de verif externe
 *   - medium (>=65%) : deduction + verif Reoon recommandee
 *   - skip (<65%)   : pattern trop ambigu, ne pas deduire
 */
export function detectPattern(samples: EmailSample[]): PatternDetectionResult {
  const hits = new Map<PatternId, number>(PATTERNS.map((p) => [p.id, 0]));
  let usable = 0;

  for (const s of samples) {
    if (!isUsableSample(s)) continue;
    const localPart = String(s.email).split("@")[0]?.toLowerCase().trim();
    if (!localPart) continue;
    usable++;
    const matched = classifySample(s, localPart);
    if (matched) {
      hits.set(matched, (hits.get(matched) ?? 0) + 1);
    }
  }

  const ranked = [...hits.entries()]
    .filter(([_, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);

  const top = ranked[0];
  if (!top || usable === 0) {
    return { pattern: null, confidence: 0, tier: "skip", hits: 0, total: usable, secondary: null };
  }

  const [topPattern, topHits] = top;
  const confidence = topHits / usable;
  const tier: PatternTier = confidence >= TIER_THRESHOLDS.high
    ? "high"
    : confidence >= TIER_THRESHOLDS.medium
    ? "medium"
    : "skip";

  const second = ranked[1];
  return {
    pattern: topPattern,
    confidence,
    tier,
    hits: topHits,
    total: usable,
    secondary: second ? { pattern: second[0], hits: second[1] } : null,
  };
}

/**
 * Construit un email a partir d'un pattern + nom + domaine.
 * Retourne null si first/last ne suffisent pas pour le pattern (ex : pattern
 * "first.last" mais last_name vide).
 */
export function buildEmail(
  pattern: PatternId,
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  domain: string,
): string | null {
  const builder = PATTERNS.find((p) => p.id === pattern);
  if (!builder) return null;
  const local = builder.build(firstName ?? "", lastName ?? "");
  if (!local) return null;
  // Strip espaces du local-part : un email RFC 5322 valide n'en contient
  // jamais. Bug Engie 2026-05-18 : first_name compose "EL YAMANI" produisait
  // "el yamani.idrissi@engie.com" (invalide). Le strip cote build evite ca
  // sans casser la detection tolerante (Marie Laure / marie-laure).
  const cleanLocal = local.replace(/\s+/g, "");
  if (!cleanLocal) return null;
  const cleanDomain = String(domain).trim().toLowerCase().replace(/^@/, "");
  if (!cleanDomain) return null;
  return `${cleanLocal}@${cleanDomain}`;
}

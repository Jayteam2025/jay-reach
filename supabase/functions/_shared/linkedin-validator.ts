/**
 * Détecte les URLs LinkedIn invalides ou placeholder.
 * Utilisé par enqueue-prospect-import pour déclencher enrich-linkedin
 * sur les boites dont l'utilisateur n'a pas trouvé le LinkedIn manuellement.
 */

const INVALID_PATTERNS = [
  /^non trouv/i,
  /^à rechercher$/i,
  /^a rechercher$/i,
  /^tbd$/i,
  /^n\s*\/\s*a$/i,
  /^aucun/i,
  /^pas de linkedin/i,
];

export function isInvalidLinkedinUrl(value: string | null | undefined): boolean {
  if (!value) return true;
  const trimmed = value.trim();
  if (!trimmed) return true;

  // Pas une URL HTTP(S)
  if (!trimmed.toLowerCase().startsWith("http")) return true;

  const lower = trimmed.toLowerCase();

  // URL de recherche LinkedIn (pas un profil direct)
  if (lower.includes("/search/results/")) return true;
  if (lower.includes("linkedin.com/search")) return true;

  // Pas un domaine LinkedIn
  if (!lower.includes("linkedin.com")) return true;

  // Patterns texte placeholder
  for (const pattern of INVALID_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Normalise une URL LinkedIn pour qu'elle passe la CHECK constraint
 * prospect_profiles_linkedin_url_check qui exige `^https://(www\.)?linkedin\.com/`.
 *
 * LinkedIn redirige les sous-domaines pays (fr.linkedin.com, lu.linkedin.com,
 * uk.linkedin.com, etc.) vers www, donc remplacer le sous-domaine pays par
 * "www" pointe sur le meme profil. Sans cette normalisation, l'INSERT
 * prospect_profiles est rejete et le contact importe est perdu.
 *
 * Retourne null si l'URL est invalide selon isInvalidLinkedinUrl().
 */
export function normalizeLinkedinUrl(value: string | null | undefined): string | null {
  if (isInvalidLinkedinUrl(value)) return null;
  const trimmed = (value as string).trim();
  // Remplace les sous-domaines pays type fr./lu./uk./be./de. par www.
  // Garde tel quel si deja www. ou pas de sous-domaine.
  return trimmed.replace(/^https?:\/\/[a-z]{2,3}\.linkedin\.com\//i, "https://www.linkedin.com/");
}

// ─── Statuts entrants : smart-skip outreach ────────────

interface StatusPattern {
  regex: RegExp;
  reason: string;
}

const STATUS_PATTERNS: StatusPattern[] = [
  { regex: /invitation.*envoy|invit[ée].*linkedin|connexion.*demand/i, reason: "linkedin_invitation_sent" },
  { regex: /en.*contact|en.*discussion|en.*[ée]change|conversation.*active/i, reason: "active_conversation" },
  { regex: /d[ée]j[àa].*r[ée]seau|1er.*degr[ée]|connect[ée]/i, reason: "already_connected" },
  { regex: /message.*envoy|relanc[ée]|outreach/i, reason: "outreach_sent" },
];

/**
 * Détecte les raisons de smart-skip outreach à partir du statut entrant du fichier.
 * Retourne null si le statut est OK pour outreach.
 */
export function detectDoNotOutreachReasons(status: string | null | undefined): string[] | null {
  if (!status) return null;
  const reasons: string[] = [];

  for (const pattern of STATUS_PATTERNS) {
    if (pattern.regex.test(status)) {
      reasons.push(pattern.reason);
    }
  }

  return reasons.length > 0 ? reasons : null;
}

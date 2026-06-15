/**
 * Miroir front du validateur LinkedIn de supabase/functions/_shared/linkedin-validator.ts.
 * Utilisé pour pré-flagger les rows dans la preview avant commit.
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
  if (!trimmed.toLowerCase().startsWith("http")) return true;

  const lower = trimmed.toLowerCase();
  if (lower.includes("/search/results/")) return true;
  if (lower.includes("linkedin.com/search")) return true;
  if (!lower.includes("linkedin.com")) return true;

  for (const pattern of INVALID_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  return false;
}

const STATUS_PATTERNS: { regex: RegExp; reason: string }[] = [
  { regex: /invitation.*envoy|invit[ée].*linkedin|connexion.*demand/i, reason: "linkedin_invitation_sent" },
  { regex: /en.*contact|en.*discussion|en.*[ée]change|conversation.*active/i, reason: "active_conversation" },
  { regex: /d[ée]j[àa].*r[ée]seau|1er.*degr[ée]|connect[ée]/i, reason: "already_connected" },
  { regex: /message.*envoy|relanc[ée]|outreach/i, reason: "outreach_sent" },
];

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

export function formatDoNotOutreachReason(reason: string): string {
  switch (reason) {
    case "linkedin_invitation_sent":
      return "Invitation LinkedIn déjà envoyée";
    case "active_conversation":
      return "Conversation en cours";
    case "already_connected":
      return "Déjà connecté";
    case "outreach_sent":
      return "Message déjà envoyé";
    default:
      return reason;
  }
}

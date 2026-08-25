/**
 * Email gate : decide si un profil enriche peut etre pousse a Smartlead.
 *
 * Pure function, testable, sans dependances externes.
 * Cf docs/superpowers/specs/2026-05-13-bouncer-integration-bounce-learning-design.md section 5.2
 *
 * Le verdict lu est deliverability_status (colonne provider-agnostique, ecrite
 * par Bouncer OU Reoon). Les codes de raison "bouncer_*" / "pending_bouncer"
 * sont conserves tels quels : persistes dans smartlead_push_reason et testes
 * programmatiquement (send-via-smartlead) — les renommer casserait l'historique.
 */

export type GateDecision = {
  allow: boolean;
  reason: string;
  detail?: string;
};

export type GateInput = {
  email: string;
  email_source: "deduced" | "fullenrich" | "crm" | "manual" | "unknown";
  email_validation_status: string | null;
  deliverability_status: "valid" | "invalid" | "risky" | "disposable" | "role" | "unknown" | null;
  deliverability_reason: string | null;
  first_name: string;
  last_name: string;
  domain_pattern: {
    pattern: string;
    confidence: number;
    tier: "high" | "medium" | "low" | "skip";
    sample_count: number;
    empirical_sends: number;
    empirical_bounces: number;
    downgraded_at: string | null;
  } | null;
};

const ROLE_PREFIXES = [
  "info", "contact", "hello", "admin", "support", "sales",
  "rh", "recrutement", "commercial", "service", "noreply", "no-reply",
];

function isSuspiciousName(s: string): boolean {
  const trimmed = s.trim();
  if (trimmed.length < 2) return true;
  if (/\.$/.test(trimmed)) return true;
  if (/^[A-Z]\.?$/.test(trimmed)) return true;
  return false;
}

export function shouldPushToSmartlead(input: GateInput): GateDecision {
  if (input.deliverability_status === "invalid") {
    return { allow: false, reason: "bouncer_invalid", detail: input.deliverability_reason ?? undefined };
  }
  if (input.deliverability_status === "disposable") {
    return { allow: false, reason: "bouncer_disposable" };
  }
  if (input.deliverability_status === "role") {
    return { allow: false, reason: "bouncer_role" };
  }

  const local = input.email.split("@")[0]?.toLowerCase() ?? "";
  if (ROLE_PREFIXES.some(p => local === p || local.startsWith(`${p}.`) || local.startsWith(`${p}-`))) {
    return { allow: false, reason: "role_local_part" };
  }

  if (isSuspiciousName(input.first_name) || isSuspiciousName(input.last_name)) {
    return { allow: false, reason: "suspicious_name" };
  }

  if (input.deliverability_status === null) {
    return { allow: false, reason: "pending_bouncer" };
  }

  // bouncer=valid prime sur tout le reste : une verification individuelle
  // recente est plus forte que la statistique de pattern globale.
  if (input.deliverability_status === "valid") {
    return { allow: true, reason: "bouncer_valid" };
  }

  // Pattern downgraded : ne s'applique qu'aux deduced encore non valides
  // (risky/unknown). Les valid sont deja sortis ci-dessus.
  if (input.email_source === "deduced" && input.domain_pattern?.downgraded_at) {
    return { allow: false, reason: "pattern_downgraded" };
  }

  if (input.deliverability_status === "risky" || input.deliverability_status === "unknown") {
    if (input.email_source === "fullenrich") {
      if (
        input.domain_pattern?.tier === "high" &&
        input.domain_pattern.confidence >= 0.85
      ) {
        return { allow: true, reason: "fullenrich_risky_pattern_high" };
      }
      return { allow: false, reason: "fullenrich_risky_no_pattern" };
    }

    const p = input.domain_pattern;
    if (!p) return { allow: false, reason: "deduced_no_pattern" };
    if (p.tier !== "high") return { allow: false, reason: "deduced_low_tier" };
    if (p.confidence < 0.90) return { allow: false, reason: "deduced_low_conf" };
    if (p.sample_count < 20) return { allow: false, reason: "deduced_low_samples" };

    if (p.empirical_sends >= 10) {
      const bounceRate = p.empirical_bounces / p.empirical_sends;
      if (bounceRate > 0.15) return { allow: false, reason: "empirical_high_bounce" };
    }

    return { allow: true, reason: "deduced_risky_pattern_strong" };
  }

  return { allow: false, reason: `unknown_deliverability_status:${input.deliverability_status}` };
}

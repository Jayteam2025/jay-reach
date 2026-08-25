/**
 * Client Reoon Email Verifier (https://emailverifier.reoon.com).
 *
 * Free tier : 20 credits/jour (renouveles a minuit UTC) + 100 instant credits
 * one-shot. 1 credit par verification (quick OU power).
 *
 * Modes :
 *   - quick : ~200ms, syntax + MX + role/disposable detection. Pas de RCPT TO.
 *   - power : 5-30s, full SMTP RCPT TO + catch-all detection. Necessaire pour
 *             confirmer qu'un email deduit existe vraiment.
 *
 * Strategie d'usage dans le pipeline :
 *   - Emails deduits HIGH (>=85% pattern confidence) : pas de Reoon
 *   - Emails deduits MEDIUM (65-84%) : verif Reoon power (1 credit)
 *   - Detection catch-all par domaine : 1 verif power sur "fake-xxx@domain"
 *     mise en cache permanente
 *
 * Si le compteur quotidien est plein, on tombe en mode "deduced_unverified"
 * (display sans badge "verifie") au lieu de bloquer le pipeline.
 */

const REOON_BASE_URL = "https://emailverifier.reoon.com/api/v1";

// Enum complet de l'API Reoon power mode (doc officielle, vérifiée 2026-06-11).
// NB : "valid" n'existe PAS côté Reoon — les emails sains sont "safe".
export type ReoonStatus =
  | "safe"        // email sain, sûr à envoyer
  | "valid"       // jamais renvoyé par Reoon power, gardé par sécurité
  | "invalid"
  | "disabled"    // jadis valide, désactivé depuis (≈ invalid)
  | "disposable"
  | "inbox_full"  // existe mais boîte pleine → risque de bounce
  | "catch_all"
  | "role_account"
  | "spamtrap"    // NE JAMAIS envoyer (blacklist)
  | "unknown"
  | "error";

export interface ReoonVerifyResponse {
  email: string;
  domain: string;
  username: string;
  status: ReoonStatus;
  is_valid_syntax: boolean;
  mx_accepts_mail: boolean;
  is_catch_all: boolean | null;
  is_deliverable: boolean | null;
  is_disposable: boolean;
  is_free_email: boolean;
  is_role_account: boolean;
  is_spamtrap: boolean;
  is_safe_to_send: boolean;
  can_connect_smtp: boolean | null;
  is_disabled: boolean | null;
  has_inbox_full: boolean | null;
  overall_score: number | null;
  mx_records: string[];
  /** present sur erreur API (clef invalide, credits epuises, etc.). */
  reason?: string;
}

export class ReoonError extends Error {
  constructor(public reason: string, public status?: number) {
    super(`Reoon error: ${reason}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "ReoonError";
  }
}

/**
 * Verifie un email via Reoon.
 *
 * @param mode "quick" (rapide, sans RCPT) ou "power" (avec SMTP, lent mais
 *   fiable). Default "power" puisqu'on veut detecter les catch-all.
 * @param timeoutMs Timeout total. Default 35s (Reoon power peut etre long).
 */
export async function verifyEmail(
  apiKey: string,
  email: string,
  mode: "quick" | "power" = "power",
  timeoutMs = 35_000,
): Promise<ReoonVerifyResponse> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned || !cleaned.includes("@")) {
    throw new ReoonError(`invalid email: "${email}"`);
  }

  const url = `${REOON_BASE_URL}/verify?email=${encodeURIComponent(cleaned)}&key=${encodeURIComponent(apiKey)}&mode=${mode}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    clearTimeout(t);
    if (err instanceof Error && err.name === "AbortError") {
      throw new ReoonError(`timeout after ${timeoutMs}ms`);
    }
    throw new ReoonError(err instanceof Error ? err.message : String(err));
  }
  clearTimeout(t);

  let payload: Partial<ReoonVerifyResponse>;
  try {
    payload = await res.json();
  } catch {
    throw new ReoonError(`invalid JSON response (HTTP ${res.status})`, res.status);
  }

  if (!res.ok || payload.status === "error") {
    throw new ReoonError(payload.reason || `HTTP ${res.status}`, res.status);
  }

  return payload as ReoonVerifyResponse;
}

/**
 * Detecte si un domaine est catch-all (accepte tous les emails).
 *
 * Methode : on verifie un email avec un local part purement aleatoire qui
 * ne peut pas exister. Si le serveur dit "valid", c'est catch-all.
 *
 * Couts : 1 credit Reoon par detection. A cacher en DB une fois detecte
 * (les domaines changent rarement de config).
 *
 * @returns
 *   - true : domaine catch-all confirme (deductions futures sont a marquer
 *     "ambiguous", on ne peut pas verifier individuellement)
 *   - false : domaine non catch-all (deductions verifiables)
 *   - null : indetermine (timeout, status="unknown", etc.) - retry plus tard
 */
export async function detectCatchAll(
  apiKey: string,
  domain: string,
  timeoutMs = 35_000,
): Promise<{ isCatchAll: boolean | null; raw: ReoonVerifyResponse | null }> {
  const cleanDomain = domain.trim().toLowerCase().replace(/^@/, "");
  if (!cleanDomain || !cleanDomain.includes(".")) {
    throw new ReoonError(`invalid domain: "${domain}"`);
  }

  // Local part aleatoire qui ne peut pas exister dans une vraie boite
  const fakeLocal = `xqwzy-fake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fakeEmail = `${fakeLocal}@${cleanDomain}`;

  let res: ReoonVerifyResponse | null = null;
  try {
    res = await verifyEmail(apiKey, fakeEmail, "power", timeoutMs);
  } catch (err) {
    if (err instanceof ReoonError) {
      // On expose null pour qu'on puisse retry plus tard
      return { isCatchAll: null, raw: null };
    }
    throw err;
  }

  // Logique de decision :
  //   - status === "catch_all"  -> catch-all confirme
  //   - status === "valid" pour un email random -> catch-all (le serveur ment)
  //   - is_catch_all === true   -> catch-all confirme
  //   - status === "invalid"    -> non catch-all (rejette les inconnus)
  //   - status === "unknown" / autres -> indetermine
  if (res.is_catch_all === true || res.status === "catch_all") {
    return { isCatchAll: true, raw: res };
  }
  if (res.status === "safe" || res.status === "valid") {
    return { isCatchAll: true, raw: res };
  }
  if (res.status === "invalid" || res.is_catch_all === false) {
    return { isCatchAll: false, raw: res };
  }
  return { isCatchAll: null, raw: res };
}

/**
 * Resume Reoon -> notre format interne email_verification_cache.status.
 */
export function classifyReoonResult(r: ReoonVerifyResponse): "valid" | "invalid" | "catch_all" | "unknown" {
  // Ordre important : invalid/disabled prime sur status="valid" car certains
  // serveurs renvoient status=valid + is_disabled=true sur des comptes
  // existants mais inactifs (a ne pas envoyer).
  if (r.status === "spamtrap" || r.is_spamtrap === true) return "invalid";
  if (r.status === "invalid" || r.status === "disabled" || r.is_disabled === true) return "invalid";
  if (r.status === "catch_all" || r.is_catch_all === true) return "catch_all";
  // Reoon power renvoie status="safe" (pas "valid") pour les emails sains — doc + pilote 2026-06-04.
  if (r.status === "safe" || (r.status === "valid" && r.is_safe_to_send)) return "valid";
  return "unknown";
}

/**
 * Reoon → EmailVerdict normalisé (valid|invalid|risky|disposable|role|unknown).
 * Utilisé par l'adapter EmailValidator pour mapper les verdicts Reoon.
 */
export function reoonToVerdict(r: ReoonVerifyResponse): "valid" | "invalid" | "risky" | "disposable" | "role" | "unknown" {
  // Spamtrap : NE JAMAIS envoyer (blacklist garantie) → invalid. Priorité absolue.
  if (r.status === "spamtrap" || r.is_spamtrap === true) return "invalid";
  // Invalide ou compte désactivé (disabled = jadis valide, désactivé depuis).
  if (r.status === "invalid" || r.status === "disabled" || r.is_disabled === true) return "invalid";
  // Jetable.
  if (r.status === "disposable" || r.is_disposable === true) return "disposable";
  // Compte générique/rôle (contact@, info@…).
  if (r.status === "role_account" || r.is_role_account === true) return "role";
  // Catch-all (ambigü : serveur accepte tout).
  if (r.status === "catch_all" || r.is_catch_all === true) return "risky";
  // Boîte pleine : l'adresse existe mais risque de bounce → risky.
  if (r.status === "inbox_full" || r.has_inbox_full === true) return "risky";
  // Reoon power renvoie status="safe" (jamais "valid") pour les emails sains — doc + pilote 2026-06-04.
  if (r.status === "safe" || (r.status === "valid" && r.is_safe_to_send)) return "valid";
  // Indéterminé
  return "unknown";
}

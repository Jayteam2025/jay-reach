/**
 * Rate Limiter pour Edge Functions
 * ISO 27001 - A2.2 Rate Limiting global
 *
 * Utilise PostgreSQL pour stocker les compteurs de requêtes.
 * Limites par catégorie d'endpoint (standards SaaS).
 */

import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Configuration des limites par catégorie
 */
export const RATE_LIMITS = {
  oauth: { maxRequests: 10, windowSeconds: 60 },    // Auth: strict
  webhook: { maxRequests: 200, windowSeconds: 60 }, // Webhooks: trafic élevé
  admin: { maxRequests: 30, windowSeconds: 60 },    // Admin: modéré
  api: { maxRequests: 60, windowSeconds: 60 },      // API standard
  public: { maxRequests: 30, windowSeconds: 60 },   // Endpoints publics
} as const;

export type RateLimitCategory = keyof typeof RATE_LIMITS;
export type IdentifierType = "ip" | "user";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  limit: number;
}

/**
 * Vérifie et met à jour le rate limit pour un identifier
 *
 * @param supabase - Client Supabase avec service role
 * @param identifier - IP address ou user_id
 * @param identifierType - 'ip' ou 'user'
 * @param category - Catégorie d'endpoint
 * @returns Résultat avec allowed, remaining, resetAt
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  identifier: string,
  identifierType: IdentifierType,
  category: RateLimitCategory
): Promise<RateLimitResult> {
  const config = RATE_LIMITS[category];
  const windowStart = new Date(Date.now() - config.windowSeconds * 1000);
  const resetAt = new Date(Date.now() + config.windowSeconds * 1000);

  try {
    // 1. Nettoyer les vieilles entrées (> 5 minutes)
    await supabase
      .from("api_rate_limits")
      .delete()
      .lt("window_start", new Date(Date.now() - 5 * 60 * 1000).toISOString());

    // 2. Compter les requêtes dans la fenêtre actuelle
    const { data: existingRecords, error: selectError } = await supabase
      .from("api_rate_limits")
      .select("id, request_count, window_start")
      .eq("identifier", identifier)
      .eq("endpoint_category", category)
      .gte("window_start", windowStart.toISOString())
      .order("window_start", { ascending: false })
      .limit(1);

    if (selectError) {
      // H2: En cas d'erreur DB, refuser la requete (fail closed) pour eviter les abus
      console.error("[RATE-LIMIT] DB error, failing closed:", selectError);
      return { allowed: false, remaining: 0, resetAt, limit: config.maxRequests };
    }

    const currentCount = existingRecords?.[0]?.request_count || 0;
    const remaining = Math.max(0, config.maxRequests - currentCount - 1);

    // 3. Si limite dépassée, refuser
    if (currentCount >= config.maxRequests) {
      console.log(`[RATE-LIMIT] Limit exceeded for ${identifierType}:${identifier} on ${category} (${currentCount}/${config.maxRequests})`);
      return { allowed: false, remaining: 0, resetAt, limit: config.maxRequests };
    }

    // 4. Incrémenter le compteur ou créer une nouvelle entrée
    if (existingRecords && existingRecords.length > 0) {
      // Update existing record
      const { error: updateError } = await supabase
        .from("api_rate_limits")
        .update({ request_count: currentCount + 1 })
        .eq("id", existingRecords[0].id);

      if (updateError) {
        console.error("[RATE-LIMIT] Error updating rate limit:", updateError);
      }
    } else {
      // Insert new record
      const { error: insertError } = await supabase
        .from("api_rate_limits")
        .insert({
          identifier,
          identifier_type: identifierType,
          endpoint_category: category,
          request_count: 1,
          window_start: new Date().toISOString(),
        });

      if (insertError) {
        console.error("[RATE-LIMIT] Error inserting rate limit:", insertError);
      }
    }

    console.log(`[RATE-LIMIT] ${identifierType}:${identifier} on ${category}: ${currentCount + 1}/${config.maxRequests}`);
    return { allowed: true, remaining, resetAt, limit: config.maxRequests };

  } catch (error) {
    // H2: En cas d'erreur inattendue, refuser la requete (fail closed) pour eviter les abus
    console.error("[RATE-LIMIT] Unexpected error, failing closed:", error);
    return { allowed: false, remaining: 0, resetAt, limit: config.maxRequests };
  }
}

/**
 * Extrait l'adresse IP du client depuis les headers de la requête
 *
 * @param req - Request object
 * @returns IP address (ou 'unknown' si non trouvée)
 */
export function getClientIP(req: Request): string {
  // Headers standards pour les proxies
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Prendre la première IP (client original)
    return forwardedFor.split(",")[0].trim();
  }

  const realIP = req.headers.get("x-real-ip");
  if (realIP) {
    return realIP.trim();
  }

  // Header Cloudflare
  const cfConnectingIP = req.headers.get("cf-connecting-ip");
  if (cfConnectingIP) {
    return cfConnectingIP.trim();
  }

  // Fallback
  return "unknown";
}

/**
 * Génère une réponse HTTP 429 Too Many Requests
 *
 * @param result - Résultat du rate limiting
 * @param corsHeaders - Headers CORS
 * @returns Response 429
 */
export function rateLimitResponse(
  result: RateLimitResult,
  corsHeaders: HeadersInit
): Response {
  const retryAfter = Math.ceil((result.resetAt.getTime() - Date.now()) / 1000);

  return new Response(
    JSON.stringify({
      error: "Too Many Requests",
      message: `Rate limit exceeded. Try again in ${retryAfter} seconds.`,
      retryAfter,
    }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.floor(result.resetAt.getTime() / 1000)),
      },
    }
  );
}

/**
 * Helper pour appliquer le rate limiting en une ligne
 *
 * @example
 * ```typescript
 * const rateLimitResult = await applyRateLimit(supabase, req, "oauth", corsHeaders);
 * if (rateLimitResult) return rateLimitResult; // 429 response
 * // Continue with normal logic...
 * ```
 */
export async function applyRateLimit(
  supabase: SupabaseClient,
  req: Request,
  category: RateLimitCategory,
  corsHeaders: HeadersInit,
  userId?: string
): Promise<Response | null> {
  const identifier = userId || getClientIP(req);
  const identifierType: IdentifierType = userId ? "user" : "ip";

  const result = await checkRateLimit(supabase, identifier, identifierType, category);

  if (!result.allowed) {
    return rateLimitResponse(result, corsHeaders);
  }

  return null; // Pas de rate limit, continuer
}

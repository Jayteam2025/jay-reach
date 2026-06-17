/**
 * Helper de validation Zod pour Edge Functions
 * @see docs/plans/2026-01-19-zod-validation-design.md
 */

import { z, ZodSchema, ZodError } from "npm:zod@3.24.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Mode de validation :
 * - "strict" : bloque la requête si invalide (production)
 * - "warn" : log l'erreur mais laisse passer (migration progressive)
 */
export type ValidationMode = "strict" | "warn";

/**
 * Contexte optionnel pour le logging des erreurs de validation
 */
export interface ValidationContext {
  functionName: string;
  userId?: string;
}

/**
 * Résultat de validation
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; error: ZodError; data: T | null };

/**
 * Log une erreur de validation dans la table validation_errors (non-bloquant)
 */
async function logValidationError(
  context: ValidationContext,
  errors: Array<{ path: string; message: string; code: string }>,
  receivedData: string
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.warn("Warning: Cannot log validation error: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return;
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    await supabase.from("validation_errors").insert({
      function_name: context.functionName,
      errors: errors,
      received_data: receivedData.slice(0, 1000), // Tronqué pour sécurité
      user_id: context.userId || null,
    });
  } catch (err) {
    // Ne jamais faire planter la requête à cause du logging
    console.error("[ERROR] Failed to log validation error to database:", err);
  }
}

/**
 * Valide les données d'une requête avec un schéma Zod
 *
 * @example
 * ```typescript
 * const validation = validateRequest(OAuthInitSchema, body, "warn");
 * if (!validation.success && validation.data === null) {
 *   return validationErrorResponse(validation.error, corsHeaders);
 * }
 * const { redirectUri, code_challenge } = validation.data!;
 * ```
 */
export function validateRequest<T>(
  schema: ZodSchema<T>,
  data: unknown,
  mode: ValidationMode = "strict",
  context?: ValidationContext
): ValidationResult<T> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const formattedErrors = result.error.issues.map(i => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));

  const receivedDataStr = JSON.stringify(data).slice(0, 500);

  // Mode "warn" : log l'erreur mais laisse passer (migration progressive)
  if (mode === "warn") {
    console.warn("[VALIDATION WARNING] Non-blocking validation error:", {
      functionName: context?.functionName || "unknown",
      errors: formattedErrors,
      receivedData: receivedDataStr,
    });

    // Log en base de données si le contexte est fourni (fire and forget)
    if (context) {
      logValidationError(context, formattedErrors, receivedDataStr).catch(() => {});
    }

    // Retourne les données brutes pour ne pas bloquer
    return { success: false, error: result.error, data: data as T };
  }

  // Mode "strict" : bloque la requête
  return { success: false, error: result.error, data: null };
}

/**
 * Génère une réponse d'erreur HTTP 400 formatée pour les erreurs de validation
 */
export function validationErrorResponse(
  error: ZodError,
  corsHeaders: HeadersInit
): Response {
  const details = error.issues.map(issue => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

  console.error("[VALIDATION ERROR]", { details });

  return new Response(
    JSON.stringify({
      error: "Validation failed",
      details,
    }),
    {
      status: 400,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    }
  );
}

/**
 * Valide et retourne directement une Response en cas d'erreur
 * Utile pour simplifier le code des handlers
 *
 * @param schema - Schéma Zod pour la validation
 * @param data - Données à valider
 * @param corsHeaders - Headers CORS pour la réponse d'erreur
 * @param mode - "strict" (bloque) ou "warn" (log et laisse passer)
 * @param context - Contexte optionnel pour le logging en DB (functionName, userId)
 *
 * @example
 * ```typescript
 * const validation = validateOrRespond(OAuthInitSchema, body, corsHeaders, "warn", {
 *   functionName: "google-oauth",
 *   userId: user?.id
 * });
 * if (validation.response) return validation.response;
 * const { redirectUri, code_challenge } = validation.data;
 * ```
 */
export function validateOrRespond<T>(
  schema: ZodSchema<T>,
  data: unknown,
  corsHeaders: HeadersInit,
  mode: ValidationMode = "strict",
  context?: ValidationContext
): { data: T; response?: never } | { data?: never; response: Response } {
  const result = validateRequest(schema, data, mode, context);

  if (result.success) {
    return { data: result.data };
  }

  if (mode === "warn" && result.data !== null) {
    // Mode warn : on laisse passer avec les données brutes
    return { data: result.data };
  }

  return { response: validationErrorResponse(result.error, corsHeaders) };
}

/**
 * Parse les query params d'une URL et les valide
 * Utile pour les requêtes GET
 *
 * @example
 * ```typescript
 * const params = validateQueryParams(req.url, PaginationSchema, corsHeaders, "warn", {
 *   functionName: "admin-get-users"
 * });
 * if (params.response) return params.response;
 * const { limit, offset } = params.data;
 * ```
 */
export function validateQueryParams<T>(
  url: string,
  schema: ZodSchema<T>,
  corsHeaders: HeadersInit,
  mode: ValidationMode = "strict",
  context?: ValidationContext
): { data: T; response?: never } | { data?: never; response: Response } {
  const urlObj = new URL(url);
  const params: Record<string, string> = {};

  urlObj.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  return validateOrRespond(schema, params, corsHeaders, mode, context);
}

// Re-export Zod pour que les fonctions puissent l'importer depuis ce fichier
export { z, ZodSchema, ZodError };

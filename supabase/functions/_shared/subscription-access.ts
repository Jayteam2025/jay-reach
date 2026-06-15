/**
 * Subscription Access Control (OSS no-op paywall)
 * Module partagé pour vérifier l'accès aux features
 *
 * En OSS, le paywall est désactivé — toutes les features sont autorisées.
 * extractUserId reste la vraie implémentation pour l'authentification JWT.
 */

import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Types pour les fonctionnalités
export type PlanFeature =
  | "ocr"
  | "email-generation"
  | "analytics-dashboard"
  | "teams"
  | "priority-support"
  | "onboarding-formation"
  | "hide-badge"
  | "structured-fields"
  | "multi-crm"
  | "meeting-brief";

// Types pour les plans
export type PlanName =
  | 'free'
  | 'pro'
  | 'business'
  | 'entreprise'
  | 'trial'
  | 'admin';

// Résultat de la vérification d'accès
export interface FeatureAccessResult {
  allowed: boolean;
  plan?: string;
  isAdmin?: boolean;
  errorResponse?: Response;
}

/**
 * Normalise le nom du plan pour la comparaison.
 * En OSS, retourne toujours 'free'.
 */
export function normalizePlan(plan: string | null): PlanName {
  if (!plan) return 'free';
  const lowerPlan = plan.toLowerCase().trim();
  const validPlans: PlanName[] = ['free', 'pro', 'business', 'entreprise', 'trial', 'admin'];
  if (validPlans.includes(lowerPlan as PlanName)) {
    return lowerPlan as PlanName;
  }
  return 'free';
}

/**
 * No-op paywall : autorise toujours.
 * En OSS, aucun plan payant n'existe.
 */
export async function checkFeatureAccess(
  _userId: string,
  _feature: PlanFeature
): Promise<FeatureAccessResult> {
  return { allowed: true };
}

/**
 * No-op paywall : ne jette jamais.
 * En OSS, tous les appels réussissent silencieusement.
 */
export async function requireFeatureAccess(
  _userId: string,
  _feature: PlanFeature
): Promise<void> {
  /* no-op : jamais bloquant en OSS */
}

/**
 * Extrait le userId depuis le token JWT de l'Authorization header
 * Retourne le userId du body seulement si appelé avec service_role
 *
 * IMPLÉMENTATION RÉELLE : préservée de la version payante.
 * Security: no auth = no access (XSS-VULN-03 fix — removed bodyUserId fallback)
 *
 * @param supabase - Client Supabase
 * @param req - Request HTTP
 * @param bodyUserId - userId passé dans le body (fallback pour service_role)
 */
export async function extractUserId(
  supabase: SupabaseClient,
  req: Request,
  bodyUserId?: string
): Promise<{ userId: string | null; error?: string }> {
  const authHeader = req.headers.get('Authorization');

  if (!authHeader) {
    // Security: no auth = no access (XSS-VULN-03 fix — removed bodyUserId fallback)
    return { userId: null, error: 'Authorization header missing' };
  }

  const token = authHeader.replace('Bearer ', '');

  // Check if it's a service_role token — only then accept bodyUserId
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (serviceRoleKey && token === serviceRoleKey) {
    // Service role call (from other Edge Functions) — accept bodyUserId
    if (bodyUserId) {
      return { userId: bodyUserId };
    }
    return { userId: null, error: 'Service role call but no userId provided' };
  }

  // Verify user JWT
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      // Security: invalid token = reject (no bodyUserId fallback)
      return { userId: null, error: 'Invalid token' };
    }

    // Valid user token — always use their ID (ignore bodyUserId to prevent IDOR)
    return { userId: user.id };
  } catch {
    return { userId: null, error: 'Authentication failed' };
  }
}

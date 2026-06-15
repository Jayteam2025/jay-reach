/**
 * CORS Configuration with Origin Whitelist
 *
 * SECURITY: Ne jamais utiliser '*' en production.
 * Seuls les domaines explicitement listés sont autorisés.
 */

const APP_URL = Deno.env.get("APP_URL") || "https://jay-assistant.fr";

const ALLOWED_ORIGINS = [
  // Dynamique via APP_URL (prod ou staging)
  APP_URL,
  APP_URL.replace('https://', 'https://www.'),
  // Production (toujours autorisé pour les callbacks OAuth cross-env)
  'https://jay-assistant.fr',
  'https://www.jay-assistant.fr',
  // Chrome Extension publique (production)
  'chrome-extension://napclllinbhgdndgkhefajafnndjepam',
  // Chrome Extension interne (admin-only, ID stable via manifest.key)
  'chrome-extension://fodechpohbcfbnhdodjocfepanlegodo',
  // Development
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:8080',
  'http://127.0.0.1:5173',
];

/**
 * Vérifie si l'origin est autorisée (incluant les extensions Chrome en dev)
 */
function isOriginAllowed(origin: string): boolean {
  // Check exact match first
  if (ALLOWED_ORIGINS.includes(origin)) {
    return true;
  }
  // In development, allow any Chrome extension origin for testing
  if (
    (Deno.env.get('ENVIRONMENT') === 'development' || !Deno.env.get('ENVIRONMENT')) &&
    origin.startsWith('chrome-extension://')
  ) {
    return true;
  }
  return false;
}

/**
 * Génère les headers CORS pour une origin donnée.
 * Si l'origin n'est pas dans la whitelist, utilise le domaine de production par défaut.
 */
export function getCorsHeaders(requestOrigin?: string | null): Record<string, string> {
  const origin = requestOrigin && isOriginAllowed(requestOrigin)
    ? requestOrigin
    : ALLOWED_ORIGINS[0]; // Fallback vers production

  return {
    // CORS headers
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS, DELETE, PUT, PATCH',
    'Access-Control-Allow-Credentials': 'true',
    // Security headers (ISO 27001 - A2.8b)
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
}

/**
 * @deprecated SUPPRIME - Utiliser getCorsHeaders(request.headers.get('origin'))
 * L'export avec '*' a ete supprime pour des raisons de securite (ISO 27001).
 * Si vous voyez une erreur de compilation, migrez vers getCorsHeaders().
 */
// Export supprime volontairement - voir getCorsHeaders()

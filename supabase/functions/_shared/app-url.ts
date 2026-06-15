/**
 * Résolution dynamique de l'URL de l'application.
 * Permet de basculer entre staging et production via la variable d'environnement APP_URL.
 */
export function getAppUrl(): string {
  return Deno.env.get("APP_URL") || Deno.env.get("SITE_URL") || "https://jay-assistant.fr";
}

import type { ProviderCategory } from "./types.ts";

export interface CredentialField {
  name: string;          // clé dans l'objet credential
  label: string;         // libellé UI
  secret: boolean;       // masqué dans l'UI
}

export interface ProviderDescriptor {
  category: ProviderCategory;
  providerType: string;
  label: string;
  credentialSchema: CredentialField[];
  fallbackEnv: Record<string, string>;  // champ → nom de variable d'env
}

export const PROVIDER_CATALOG: ProviderDescriptor[] = [
  { category: "llm", providerType: "anthropic", label: "Anthropic (Claude)",
    credentialSchema: [{ name: "api_key", label: "Clé API", secret: true }],
    fallbackEnv: { api_key: "ANTHROPIC_API_KEY" } },
  { category: "llm", providerType: "openai_compatible", label: "OpenAI-compatible (OpenAI, Mistral)",
    credentialSchema: [
      { name: "api_key", label: "Clé API", secret: true },
      { name: "base_url", label: "Base URL (ex. https://api.openai.com/v1)", secret: false },
      { name: "model_fast", label: "Modèle rapide (micro-tâches)", secret: false },
      { name: "model_smart", label: "Modèle avancé (scoring, imports)", secret: false }],
    fallbackEnv: { api_key: "OPENAI_COMPAT_API_KEY", base_url: "OPENAI_COMPAT_BASE_URL",
      model_fast: "OPENAI_COMPAT_MODEL_FAST", model_smart: "OPENAI_COMPAT_MODEL_SMART" } },
  { category: "source", providerType: "adzuna", label: "Adzuna",
    credentialSchema: [
      { name: "app_id", label: "App ID", secret: false },
      { name: "app_key", label: "App Key", secret: true }],
    fallbackEnv: { app_id: "ADZUNA_APP_ID", app_key: "ADZUNA_APP_KEY" } },
  { category: "source", providerType: "france_travail", label: "France Travail",
    credentialSchema: [
      { name: "client_id", label: "Client ID", secret: false },
      { name: "client_secret", label: "Client Secret", secret: true }],
    fallbackEnv: { client_id: "FRANCE_TRAVAIL_CLIENT_ID", client_secret: "FRANCE_TRAVAIL_CLIENT_SECRET" } },
  { category: "source", providerType: "apify_linkedin", label: "Apify (LinkedIn Jobs)",
    // actor_id est optionnel : le scraper retombe sur APIFY_JOBS_ACTOR_ID puis
    // sur l'actor harvestapi par defaut. Ne PAS le mettre dans fallbackEnv, sinon
    // credentialFromEnv renverrait null quand seul le token est configure.
    credentialSchema: [
      { name: "api_token", label: "Token API Apify", secret: true },
      { name: "actor_id", label: "Actor ID (optionnel)", secret: false }],
    fallbackEnv: { api_token: "APIFY_API_TOKEN" } },
  { category: "enricher", providerType: "fullenrich", label: "FullEnrich",
    credentialSchema: [{ name: "api_key", label: "Clé API", secret: true }],
    fallbackEnv: { api_key: "FULLENRICH_API_KEY" } },
  { category: "validator", providerType: "bouncer", label: "Bouncer",
    credentialSchema: [{ name: "api_key", label: "Clé API", secret: true }],
    fallbackEnv: {} },
  { category: "validator", providerType: "reoon", label: "Reoon",
    credentialSchema: [{ name: "api_key", label: "Clé API", secret: true }],
    fallbackEnv: { api_key: "REOON_API_KEY" } },
  { category: "outreach", providerType: "smartlead", label: "Smartlead",
    credentialSchema: [{ name: "api_key", label: "Clé API", secret: true }],
    fallbackEnv: { api_key: "SMARTLEAD_API_KEY" } },
];

export function getProviderDescriptor(providerType: string): ProviderDescriptor | null {
  return PROVIDER_CATALOG.find((d) => d.providerType === providerType) ?? null;
}

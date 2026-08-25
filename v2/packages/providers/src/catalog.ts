/**
 * Catalogue des providers (manifests). Décrit, pour chaque provider externe,
 * sa catégorie et les champs de credentials à saisir — ce qui permet de
 * **générer l'écran de configuration** sans le coder à la main (ticket T5).
 * Les vrais appels (test de connexion, envoi…) arrivent avec chaque provider.
 */
import type { ProviderManifest } from './manifest.js';

export const PROVIDER_CATALOG: readonly ProviderManifest[] = [
  {
    id: 'smartlead',
    category: 'email',
    labelKey: 'providers.smartlead',
    fields: [{ name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true, fallbackEnv: 'SMARTLEAD_API_KEY' }],
  },
  {
    id: 'fullenrich',
    category: 'enrichment',
    labelKey: 'providers.fullenrich',
    fields: [{ name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true, fallbackEnv: 'FULLENRICH_API_KEY' }],
  },
  {
    id: 'dropcontact',
    category: 'enrichment',
    labelKey: 'providers.dropcontact',
    fields: [{ name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true, fallbackEnv: 'DROPCONTACT_API_KEY' }],
  },
  {
    id: 'bouncer',
    category: 'enrichment',
    labelKey: 'providers.bouncer',
    fields: [{ name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true, fallbackEnv: 'BOUNCER_API_KEY' }],
  },
  {
    id: 'anthropic',
    category: 'ai',
    labelKey: 'providers.anthropic',
    fields: [{ name: 'api_key', labelKey: 'providers.field.apiKey', type: 'password', secret: true, required: true, fallbackEnv: 'ANTHROPIC_API_KEY' }],
  },
  {
    id: 'francetravail',
    category: 'signals',
    labelKey: 'providers.francetravail',
    fields: [
      { name: 'client_id', labelKey: 'providers.field.clientId', type: 'text', secret: false, required: true, fallbackEnv: 'FRANCE_TRAVAIL_CLIENT_ID' },
      { name: 'client_secret', labelKey: 'providers.field.clientSecret', type: 'password', secret: true, required: true, fallbackEnv: 'FRANCE_TRAVAIL_CLIENT_SECRET' },
    ],
  },
  {
    id: 'adzuna',
    category: 'signals',
    labelKey: 'providers.adzuna',
    fields: [
      { name: 'app_id', labelKey: 'providers.field.appId', type: 'text', secret: false, required: true, fallbackEnv: 'ADZUNA_APP_ID' },
      { name: 'app_key', labelKey: 'providers.field.appKey', type: 'password', secret: true, required: true, fallbackEnv: 'ADZUNA_APP_KEY' },
    ],
  },
  {
    id: 'apify',
    category: 'signals',
    labelKey: 'providers.apify',
    fields: [{ name: 'api_token', labelKey: 'providers.field.apiToken', type: 'password', secret: true, required: true, fallbackEnv: 'APIFY_TOKEN' }],
  },
];

export function getProviderEntry(id: string): ProviderManifest | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

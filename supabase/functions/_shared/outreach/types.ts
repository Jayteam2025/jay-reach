// Phase 1.4 : abstraction des providers d'envoi outreach.
// Chaque provider implemente OutreachProvider. send-via-smartlead resout
// le provider actif pour (workspace_id, channel) via workspace_outreach_providers.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface OutreachLead {
  prospect_id: string;
  workspace_id: string;
  persona_id: string | null;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  /** Body HTML pret a envoyer (deja inclut les attachments inline). */
  body_html: string;
  subject: string;
  /** Donnees d'enrichissement libres (website, city, etc.). */
  enrichment: Record<string, unknown>;
}

export interface OutreachPushResult {
  added: number;
  skipped: number;
  /** Identifiant cote provider (campaign_id, message_id, ...). */
  provider_ref?: string | number | null;
  /** Donnees libres a logger / renvoyer. */
  meta?: Record<string, unknown>;
}

export interface OutreachProviderConfig {
  /** Row workspace_providers (config JSONB) — Jay Reach 1.5.2. */
  config: Record<string, unknown>;
  workspace_id: string;
  /** API key resolue via Vault > env fallback. */
  apiKey: string;
}

export interface OutreachProvider {
  readonly type: string;
  push(lead: OutreachLead, ctx: OutreachProviderConfig, supabase: SupabaseClient): Promise<OutreachPushResult>;
}

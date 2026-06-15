/**
 * Smartlead API client — thin wrapper around the v1 REST API.
 *
 * Authentication : API key via query param `?api_key=...`
 * Base URL : https://server.smartlead.ai/api/v1
 *
 * Key endpoints used :
 * - POST /campaigns/{id}/leads           : add leads with per-lead custom fields
 * - POST /campaigns/{id}/webhooks        : subscribe to per-campaign events
 * - PATCH /campaigns/{id}/status         : activate/pause campaign
 */

const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

export interface SmartleadLead {
  email: string;
  first_name?: string;
  last_name?: string;
  company_name?: string;
  phone_number?: string;
  website?: string;
  location?: string;
  custom_fields?: Record<string, string>;
  linkedin_profile?: string;
}

export interface AddLeadsResponse {
  ok?: boolean;
  added_count?: number;
  skipped_count?: number;
  total_leads?: number;
  bulk_upload_id?: string;
  error?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * Add a batch of leads to a specific campaign.
 * Returns the raw Smartlead response with added_count / skipped_count.
 *
 * Jay Reach 1.5.2 : apiKey est obligatoire en parametre (avant : lu de Deno.env).
 * L'appelant doit l'avoir resolu via resolveOutreachProvider() pour respecter
 * le multi-tenant.
 */
export async function addLeadsToCampaign(
  campaignId: number | string,
  leads: SmartleadLead[],
  apiKey: string
): Promise<AddLeadsResponse> {
  if (!leads.length) {
    throw new Error("addLeadsToCampaign: leads array is empty");
  }
  if (leads.length > 400) {
    throw new Error("addLeadsToCampaign: Smartlead limits 400 leads per request");
  }

  const url = `${SMARTLEAD_BASE}/campaigns/${campaignId}/leads?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lead_list: leads }),
  });

  const text = await res.text();
  let parsed: AddLeadsResponse;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Smartlead addLeads: invalid JSON response (status ${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`Smartlead addLeads failed (${res.status}): ${parsed.message || parsed.error || text.slice(0, 300)}`);
  }

  return parsed;
}

/**
 * Ensure a campaign is in a given status. Idempotent — Smartlead accepts re-START
 * on an already-ACTIVE campaign without error. Useful to wake a COMPLETED campaign
 * after adding new leads to it.
 */
export async function setCampaignStatus(
  campaignId: number | string,
  status: "START" | "PAUSED" | "STOPPED",
  apiKey: string
): Promise<void> {
  const url = `${SMARTLEAD_BASE}/campaigns/${campaignId}/status?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Smartlead setCampaignStatus failed (${res.status}): ${text.slice(0, 300)}`);
  }
}

/**
 * Create or update a campaign webhook (for receiving sent/opened/replied/etc.).
 * Event types : "LEAD_REPLIED" | "LEAD_OPENED" | "LEAD_CLICKED" | "EMAIL_SENT" | "EMAIL_BOUNCED"
 */
export async function upsertCampaignWebhook(
  campaignId: number | string,
  params: {
    id?: number | null;
    name: string;
    webhook_url: string;
    event_types: string[];
  },
  apiKey: string
): Promise<Record<string, unknown>> {
  const url = `${SMARTLEAD_BASE}/campaigns/${campaignId}/webhooks?api_key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: params.id ?? null,
      name: params.name,
      webhook_url: params.webhook_url,
      event_types: params.event_types,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Smartlead upsertCampaignWebhook failed (${res.status}): ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

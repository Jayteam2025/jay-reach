// SmartleadProvider : implementation actuelle du push Smartlead.
// Resout le campaign_id depuis smartlead_campaigns par persona_id uniquement,
// puis push via l'API Smartlead.

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { addLeadsToCampaign, setCampaignStatus, type SmartleadLead } from "../smartlead.ts";
import type { OutreachLead, OutreachProvider, OutreachProviderConfig, OutreachPushResult } from "./types.ts";

export const smartleadProvider: OutreachProvider = {
  type: "smartlead",

  async push(lead: OutreachLead, ctx: OutreachProviderConfig, supabase: SupabaseClient): Promise<OutreachPushResult> {
    // 1. Resolve campaign : persona_id uniquement (fail-fast si null ou pas de campagne enabled)
    if (!lead.persona_id) {
      throw new Error(`No persona_id provided for prospect. Cannot resolve Smartlead campaign.`);
    }

    const { data: campaign } = await supabase
      .from("smartlead_campaigns")
      .select("campaign_id, campaign_name, enabled")
      .eq("workspace_id", lead.workspace_id)
      .eq("persona_id", lead.persona_id)
      .maybeSingle();

    if (!campaign || !campaign.enabled) {
      throw new Error(`No active Smartlead campaign configured for persona=${lead.persona_id}.`);
    }

    // 2. Build le SmartleadLead
    const smartleadLead: SmartleadLead = {
      email: lead.email,
      first_name: lead.first_name || undefined,
      last_name: lead.last_name || undefined,
      company_name: lead.company_name || undefined,
      linkedin_profile: lead.linkedin_url || undefined,
      website: (lead.enrichment.company_website as string) || undefined,
      location: (lead.enrichment.company_city as string) || undefined,
      custom_fields: {
        subject: lead.subject,
        body: lead.body_html,
        job_title: lead.job_title || "",
        prospect_id: lead.prospect_id,
        persona_id: lead.persona_id ?? "",
      },
    };

    console.log(`[smartlead-provider] push lead ${lead.email} -> campaign ${campaign.campaign_id} (persona=${lead.persona_id ?? "n/a"})`);
    const result = await addLeadsToCampaign(campaign.campaign_id, [smartleadLead], ctx.apiKey);

    // Smartlead laisse une campagne en COMPLETED apres le dernier lead ; on reveille.
    try {
      await setCampaignStatus(campaign.campaign_id, "START", ctx.apiKey);
    } catch (err) {
      console.warn(`[smartlead-provider] could not wake campaign ${campaign.campaign_id}:`, err);
    }

    return {
      added: result.added_count,
      skipped: result.skipped_count,
      provider_ref: campaign.campaign_id,
      meta: { campaign_name: campaign.campaign_name },
    };
  },
};

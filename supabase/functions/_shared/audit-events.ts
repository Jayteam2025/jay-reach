import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export interface AuditGeneratedInput {
  prospect_id: string;
  email: string;
  email_source: "deduced" | "fullenrich" | "crm" | "manual" | "unknown";
  pattern_id?: string | null;
  pattern_confidence?: number | null;
  fullenrich_status?: string | null;
}

export async function logEmailGenerated(
  supabase: SupabaseClient,
  input: AuditGeneratedInput,
): Promise<void> {
  const domain = input.email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return; // email malformé, skip

  const { error } = await supabase.from("pattern_audit_events").insert({
    prospect_id: input.prospect_id,
    email: input.email.toLowerCase(),
    domain,
    email_source: input.email_source,
    pattern_id: input.pattern_id ?? null,
    pattern_confidence: input.pattern_confidence ?? null,
    fullenrich_status: input.fullenrich_status ?? null,
    event_type: "generated",
  });

  if (error) {
    console.warn(`[audit-events] insert generated failed for ${input.email}: ${error.message}`);
  }
}

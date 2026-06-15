/**
 * Edge Function: send-prospect-email
 * Envoie des emails de prospect approuvés via Resend
 *
 * Authentification: Admin role check via JWT
 * Workflow:
 * 1. Valider CORS + OPTIONS
 * 2. Authentifier l'utilisateur (admin requis)
 * 3. Charger le message (status = 'approved', channel = 'email')
 * 4. Charger le prospect et valider l'email
 * 5. Envoyer via Resend
 * 6. Mettre à jour le statut du message
 * 7. Créer un log d'audit
 */

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { extractUserId } from "../_shared/subscription-access.ts";
import { resolveUserWorkspace } from "../_shared/workspace.ts";
import { createResendService } from "../_shared/resend.ts";
import { validateOrRespond, z } from "../_shared/validation.ts";

const SendProspectEmailRequestSchema = z.object({
  message_id: z.string().uuid(),
});

interface RequestBody {
  message_id: string;
}

interface ProspectMessage {
  id: string;
  prospect_id: string;
  subject: string;
  body: string;
  status: string;
  channel: string;
}

interface ProspectProfile {
  id: string;
  email: string | null;
  email_validation_status: string;
  first_name: string;
  last_name: string;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Handle OPTIONS
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Only POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    // Supabase clients
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return new Response(
        JSON.stringify({ error: "Internal server error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Extract user ID from JWT
    const { userId, error: extractError } = await extractUserId(supabase, req);

    if (extractError || !userId) {
      console.warn("[send-prospect-email] Auth failed:", extractError);
      return new Response(
        JSON.stringify({ error: "Unauthorized", message: extractError }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Check admin role
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      console.error("[send-prospect-email] Profile fetch failed:", profileError);
      return new Response(
        JSON.stringify({ error: "Profile not found" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (profile.role !== "admin") {
      console.warn(`[send-prospect-email] Non-admin user ${userId} attempted to send prospect email`);
      return new Response(
        JSON.stringify({ error: "Admin role required" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Parse request body
    let body: RequestBody = { message_id: "" };
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const _validation = validateOrRespond(SendProspectEmailRequestSchema, body, corsHeaders, "strict", { functionName: "send-prospect-email" });
    if (_validation.response) return _validation.response;

    // Fetch the message
    const { data: message, error: messageError } = await supabase
      .from("prospect_messages")
      .select("*")
      .eq("id", body.message_id)
      .eq("channel", "email")
      .eq("status", "approved")
      .single();

    if (messageError || !message) {
      console.warn(
        `[send-prospect-email] Message not found or not approved: ${body.message_id}`,
        messageError
      );
      return new Response(
        JSON.stringify({
          error: "Message not found or not in approved status",
        }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const prospectMessage = message as ProspectMessage;

    // Fetch prospect profile
    const { data: prospect, error: prospectError } = await supabase
      .from("prospect_profiles")
      .select("*")
      .eq("id", prospectMessage.prospect_id)
      .single();

    if (prospectError || !prospect) {
      console.error(
        `[send-prospect-email] Prospect not found: ${prospectMessage.prospect_id}`,
        prospectError
      );
      return new Response(
        JSON.stringify({ error: "Prospect not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const prospectProfile = prospect as ProspectProfile;

    // Validate email
    if (!prospectProfile.email) {
      console.warn(
        `[send-prospect-email] Prospect ${prospectProfile.id} has no email address`
      );
      return new Response(
        JSON.stringify({ error: "Prospect has no email address" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (prospectProfile.email_validation_status === "bounced") {
      console.warn(
        `[send-prospect-email] Email bounced for prospect ${prospectProfile.id}: ${prospectProfile.email}`
      );
      return new Response(
        JSON.stringify({ error: "Email address has bounced" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Wrap body in basic HTML template
    const htmlTemplate = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
      padding: 0 16px;
    }
    .container {
      padding: 24px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    ${prospectMessage.body}
  </div>
</body>
</html>`;

    // Send email via Resend
    let resend;
    try {
      resend = createResendService();
    } catch (error) {
      console.error("[send-prospect-email] Resend service initialization failed:", error);
      return new Response(
        JSON.stringify({ error: "Email service not configured" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const sendResult = await resend.sendEmail({
      to: prospectProfile.email,
      subject: prospectMessage.subject,
      html: htmlTemplate,
    });

    if (!sendResult.success) {
      console.error(
        `[send-prospect-email] Resend failed for message ${prospectMessage.id}:`,
        sendResult.error
      );

      // Log the failure but don't update message status
      try {
        await supabase.from("edge_function_logs").insert({
          function_name: "send-prospect-email",
          log_level: "error",
          message: `Failed to send prospect email: ${sendResult.error}`,
          metadata: {
            message_id: prospectMessage.id,
            prospect_id: prospectMessage.prospect_id,
            email: prospectProfile.email,
          },
        });
      } catch (logError) {
        console.error("[send-prospect-email] Failed to log error:", logError);
      }

      return new Response(
        JSON.stringify({
          error: "Failed to send email",
          details: sendResult.error,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Update message status to 'sent' with sent_at timestamp
    const { error: updateError } = await supabase
      .from("prospect_messages")
      .update({
        status: "sent",
        sent_at: new Date().toISOString(),
      })
      .eq("id", prospectMessage.id);

    if (updateError) {
      console.error(
        `[send-prospect-email] Failed to update message status: ${prospectMessage.id}`,
        updateError
      );
      return new Response(
        JSON.stringify({ error: "Failed to update message status" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Insert audit log
    try {
      const auditWorkspaceId = await resolveUserWorkspace(supabase, userId);
      await supabase.from("prospect_data_access_logs").insert({
        admin_id: userId,
        workspace_id: auditWorkspaceId,
        action: "email_send",
        prospect_ids: [prospectMessage.prospect_id],
        metadata: {
          message_id: prospectMessage.id,
          email: prospectProfile.email,
          resend_id: sendResult.id,
        },
      });
    } catch (auditError) {
      console.error("[send-prospect-email] Failed to create audit log:", auditError);
      // Don't fail the request if audit logging fails
    }

    // Success response
    console.log(
      `[send-prospect-email] Successfully sent email for message ${prospectMessage.id} to ${prospectProfile.email}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message_id: prospectMessage.id,
        prospect_id: prospectMessage.prospect_id,
        email: prospectProfile.email,
        resend_id: sendResult.id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[send-prospect-email] Unexpected error:", error);
    const corsHeaders = getCorsHeaders(req.headers.get("origin"));
    return new Response(
      JSON.stringify({
        error: "Internal server error",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

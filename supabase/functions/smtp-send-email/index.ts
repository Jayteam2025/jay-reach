import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireFeatureAccess, extractUserId } from "../_shared/subscription-access.ts";
import { validateRequest } from "../_shared/validation.ts";
import { SmtpEmailRequestSchema } from "../_shared/schemas/email.ts";
import { decryptTokenSafe } from '../_shared/token-encryption.ts';
import { getAppUrl } from "../_shared/app-url.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Decrypt password using AES-256-GCM (with fallback to legacy base64)
 */
async function decryptPassword(encrypted: string): Promise<string> {
  return await decryptTokenSafe(encrypted, 'email_password');
}

/**
 * Base64 encode for SMTP AUTH
 */
function base64Encode(str: string): string {
  return btoa(str);
}

/**
 * Refresh Yahoo OAuth token if expired
 */
async function refreshYahooToken(refreshToken: string): Promise<string> {
  const clientId = Deno.env.get("YAHOO_CLIENT_ID");
  const clientSecret = Deno.env.get("YAHOO_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Yahoo OAuth not configured");
  }

  const response = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh Yahoo token");
  }

  const data = await response.json();
  return data.access_token;
}

/**
 * Get SMTP password - handles both password-based and OAuth connections
 */
async function getSmtpPassword(connection: {
  auth_type: string;
  encrypted_password?: string;
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: string;
  id: string;
}): Promise<string> {
  if (connection.auth_type === "password") {
    if (!connection.encrypted_password) {
      throw new Error("No password configured");
    }
    return await decryptPassword(connection.encrypted_password);
  }

  // OAuth2 - check if token is expired
  if (connection.auth_type === "oauth2") {
    if (!connection.access_token) {
      throw new Error("No OAuth token configured");
    }

    // Check if token is expired
    if (connection.token_expires_at) {
      const expiresAt = new Date(connection.token_expires_at);
      const now = new Date();

      if (now >= expiresAt && connection.refresh_token) {
        console.log("OAuth token expired, refreshing...");
        const newToken = await refreshYahooToken(connection.refresh_token);

        // Update token in database
        await supabase
          .from("email_connections")
          .update({
            access_token: newToken,
            token_expires_at: new Date(Date.now() + 3600 * 1000).toISOString(),
          })
          .eq("id", connection.id);

        return newToken;
      }
    }

    return connection.access_token;
  }

  throw new Error("Unknown auth type");
}

/**
 * Get email connection for user
 */
async function getEmailConnection(userId: string, provider?: string, fromEmail?: string) {
  let query = supabase
    .from("email_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("is_verified", true);

  // Filter by specific email or provider if provided
  if (fromEmail) {
    query = query.eq("email", fromEmail);
  } else if (provider) {
    query = query.eq("provider", provider);
  } else {
    // Get default connection
    query = query.eq("is_default", true);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    // Fallback to any verified connection
    const { data: fallback, error: fallbackError } = await supabase
      .from("email_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_verified", true)
      .limit(1)
      .single();

    if (fallbackError || !fallback) {
      throw new Error("No email connection found");
    }
    return fallback;
  }

  return data;
}

/**
 * Create HTML email template (same style as Gmail/Outlook)
 */
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function createEmailHtml(subject: string, body: string): string {
  // Sanitize for HTML context (INJ-VULN-11 fix)
  const safeSubject = escapeHtml(subject);
  const safeBody = escapeHtml(body).replace(/\n/g, '<br>');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${safeSubject}</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        .email-content {
            background-color: #ffffff;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .jay-footer {
            margin-top: 20px;
            padding-top: 15px;
            border-top: 1px solid #e9ecef;
            text-align: center;
            font-size: 12px;
            color: #6c757d;
        }
        .jay-footer a {
            color: #667eea;
            text-decoration: none;
        }
    </style>
</head>
<body>
    <div class="email-content">
        ${safeBody}
        <div class="jay-footer">
            Envoyé avec Jay - Assistant vocal intelligent<br>
            <a href="${getAppUrl()}/">${getAppUrl()}/</a>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Read response from SMTP server with timeout
 * SMTP multi-line responses use:
 *   250-First line (hyphen = more lines coming)
 *   250-Second line
 *   250 Last line (space = final line)
 */
async function readSmtpResponse(reader: ReadableStreamDefaultReader<Uint8Array>, timeoutMs = 10000): Promise<string> {
  const decoder = new TextDecoder();
  let response = "";
  const startTime = Date.now();

  while (true) {
    if (Date.now() - startTime > timeoutMs) {
      throw new Error("SMTP response timeout");
    }

    const { value, done } = await reader.read();
    if (done) break;

    response += decoder.decode(value, { stream: true });

    // Check if we have a complete response
    if (response.includes("\r\n")) {
      // Get all non-empty lines
      const lines = response.split("\r\n").filter(l => l.length > 0);

      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1];
        // Final line has SPACE after 3-digit code (not hyphen)
        // Examples: "220 Welcome", "250 OK", "235 Authentication successful"
        if (/^\d{3} /.test(lastLine)) {
          break;
        }
        // Also handle single-digit responses like "354 Start mail input"
        // The hyphen (250-xxx) indicates more lines coming
      }
    }
  }

  return response.trim();
}

/**
 * Send SMTP command and get response
 */
async function sendSmtpCommand(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  reader: ReadableStreamDefaultReader<Uint8Array>,
  command: string
): Promise<string> {
  const encoder = new TextEncoder();
  await writer.write(encoder.encode(command + "\r\n"));
  return await readSmtpResponse(reader);
}

/**
 * Encode email for SMTP DATA command (handle special characters and line length)
 */
function encodeEmailForSmtp(from: string, to: string, subject: string, htmlBody: string, cc?: string): string {
  // Encode subject for MIME (UTF-8 base64)
  const encodedSubject = `=?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`;

  // Generate boundary for multipart
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`;

  // Build email headers and body
  let email = `From: ${from}\r\n`;
  email += `To: ${to}\r\n`;
  if (cc) {
    email += `Cc: ${cc}\r\n`;
  }
  email += `Subject: ${encodedSubject}\r\n`;
  email += `MIME-Version: 1.0\r\n`;
  email += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
  email += `\r\n`;

  // Plain text version (strip HTML)
  const plainText = htmlBody
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  email += `--${boundary}\r\n`;
  email += `Content-Type: text/plain; charset="UTF-8"\r\n`;
  email += `Content-Transfer-Encoding: base64\r\n`;
  email += `\r\n`;
  email += `${btoa(unescape(encodeURIComponent(plainText)))}\r\n`;

  // HTML version
  email += `--${boundary}\r\n`;
  email += `Content-Type: text/html; charset="UTF-8"\r\n`;
  email += `Content-Transfer-Encoding: base64\r\n`;
  email += `\r\n`;
  email += `${btoa(unescape(encodeURIComponent(htmlBody)))}\r\n`;

  email += `--${boundary}--\r\n`;

  return email;
}

/**
 * Send email via native Deno SMTP implementation
 * Uses raw TCP/TLS connections to avoid denomailer event loop issues
 */
async function sendSmtpEmail(
  connection: {
    id: string;
    email: string;
    auth_type: string;
    encrypted_password?: string;
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: string;
    smtp_host: string;
    smtp_port: number;
    smtp_secure: boolean;
  },
  recipient: string,
  subject: string,
  body: string,
  cc?: string,
  _bcc?: string // BCC handled differently in SMTP
): Promise<void> {
  // Get password/token based on auth type
  const password = await getSmtpPassword(connection);

  let conn: Deno.TcpConn | Deno.TlsConn | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  try {
    console.log(`Connecting to SMTP server ${connection.smtp_host}:${connection.smtp_port} (secure: ${connection.smtp_secure})`);

    // Connect with TLS if secure, otherwise plain TCP
    if (connection.smtp_secure) {
      conn = await Deno.connectTls({
        hostname: connection.smtp_host,
        port: connection.smtp_port,
      });
    } else {
      conn = await Deno.connect({
        hostname: connection.smtp_host,
        port: connection.smtp_port,
      });
    }

    reader = conn.readable.getReader();
    writer = conn.writable.getWriter();

    // Read server greeting
    const greeting = await readSmtpResponse(reader);
    console.log("SMTP greeting received");

    if (!greeting.startsWith("220")) {
      throw new Error(`Unexpected server greeting: ${greeting}`);
    }

    // Send EHLO
    const ehloResponse = await sendSmtpCommand(writer, reader, `EHLO client`);
    if (!ehloResponse.startsWith("250")) {
      throw new Error(`EHLO failed: ${ehloResponse}`);
    }

    // Authenticate - try AUTH LOGIN first, then AUTH PLAIN
    const authResponse = await sendSmtpCommand(writer, reader, "AUTH LOGIN");

    if (authResponse.startsWith("334")) {
      // Server expects username in base64
      const userResponse = await sendSmtpCommand(writer, reader, base64Encode(connection.email));

      if (userResponse.startsWith("334")) {
        // Server expects password in base64
        const passResponse = await sendSmtpCommand(writer, reader, base64Encode(password));

        if (!passResponse.startsWith("235")) {
          throw new Error(`Authentication failed: ${passResponse}`);
        }
        console.log("SMTP authentication successful (LOGIN)");
      } else {
        throw new Error(`Unexpected response after username: ${userResponse}`);
      }
    } else if (authResponse.startsWith("504") || authResponse.startsWith("502")) {
      // AUTH LOGIN not supported, try AUTH PLAIN
      const plainAuth = base64Encode(`\0${connection.email}\0${password}`);
      const plainResponse = await sendSmtpCommand(writer, reader, `AUTH PLAIN ${plainAuth}`);

      if (!plainResponse.startsWith("235")) {
        throw new Error(`Authentication failed: ${plainResponse}`);
      }
      console.log("SMTP authentication successful (PLAIN)");
    } else {
      throw new Error(`AUTH command failed: ${authResponse}`);
    }

    // MAIL FROM
    const mailFromResponse = await sendSmtpCommand(writer, reader, `MAIL FROM:<${connection.email}>`);
    if (!mailFromResponse.startsWith("250")) {
      throw new Error(`MAIL FROM failed: ${mailFromResponse}`);
    }

    // RCPT TO (main recipient)
    const rcptToResponse = await sendSmtpCommand(writer, reader, `RCPT TO:<${recipient}>`);
    if (!rcptToResponse.startsWith("250")) {
      throw new Error(`RCPT TO failed: ${rcptToResponse}`);
    }

    // RCPT TO (CC if provided)
    if (cc) {
      const ccRecipients = cc.split(',').map(e => e.trim()).filter(e => e);
      for (const ccEmail of ccRecipients) {
        const ccResponse = await sendSmtpCommand(writer, reader, `RCPT TO:<${ccEmail}>`);
        if (!ccResponse.startsWith("250")) {
          console.warn(`CC recipient ${ccEmail} failed: ${ccResponse}`);
        }
      }
    }

    // DATA
    const dataResponse = await sendSmtpCommand(writer, reader, "DATA");
    if (!dataResponse.startsWith("354")) {
      throw new Error(`DATA command failed: ${dataResponse}`);
    }

    // Create and send email content
    const htmlBody = createEmailHtml(subject, body);
    const emailContent = encodeEmailForSmtp(connection.email, recipient, subject, htmlBody, cc);

    // Send email content followed by <CRLF>.<CRLF>
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(emailContent + "\r\n.\r\n"));

    // Read response after DATA
    const dataEndResponse = await readSmtpResponse(reader);
    if (!dataEndResponse.startsWith("250")) {
      throw new Error(`Email send failed: ${dataEndResponse}`);
    }

    console.log("Email sent successfully via SMTP");

    // Send QUIT (don't wait for response, server may close connection)
    try {
      await writer.write(encoder.encode("QUIT\r\n"));
    } catch {
      // Ignore QUIT errors
    }

  } finally {
    // Release locks and close connection gracefully
    // We do this in a specific order to avoid stream errors
    if (reader) {
      try {
        reader.releaseLock();
      } catch {
        // Ignore release errors
      }
    }
    if (writer) {
      try {
        writer.releaseLock();
      } catch {
        // Ignore release errors
      }
    }
    if (conn) {
      try {
        conn.close();
      } catch {
        // Ignore close errors - connection may already be closed by server
      }
    }
  }
}

/**
 * Update pending email status
 */
async function updatePendingEmailStatus(
  pendingEmailId: string,
  status: "sent" | "failed",
  errorMessage?: string
) {
  const updateData: Record<string, unknown> = {
    status,
    ...(status === "sent" ? { sent_at: new Date().toISOString() } : {}),
    ...(errorMessage ? { error_message: errorMessage } : {}),
  };

  await supabase
    .from("pending_emails")
    .update(updateData)
    .eq("id", pendingEmailId);
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Parse et valider le body avec Zod (ISO 27001 - A1.6)
    const rawBody = await req.json();
    const validation = validateRequest(SmtpEmailRequestSchema, rawBody, "strict", {
      functionName: "smtp-send-email"
    });

    if (!validation.success) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'validation_error',
          message: validation.error.issues.map((i: { message: string }) => i.message).join(', ')
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400
        }
      );
    }

    const {
      user_id,
      provider,
      from_email,
      recipient,
      subject,
      body: emailBody,
      cc,
      bcc,
      pending_email_id,
    } = validation.data;

    // Extraire userId du JWT ou utiliser celui du body (sécurisé)
    const { userId: effectiveUserId, error: userIdError } = await extractUserId(supabase, req, user_id);

    if (!effectiveUserId || userIdError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'authentication_required',
          message: userIdError || 'User authentication required'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 401
        }
      );
    }

    // === VÉRIFICATION DU PLAN - email-generation requiert Pro+ ===
    const accessDenied = await requireFeatureAccess(supabase, effectiveUserId, 'email-generation', corsHeaders);
    if (accessDenied) {
      return accessDenied;
    }

    console.log(`Sending SMTP email for user ${effectiveUserId} to ${recipient}`);

    // Get email connection
    const connection = await getEmailConnection(effectiveUserId, provider, from_email);

    if (!connection) {
      const errorMsg = "No email connection configured";
      if (pending_email_id) {
        await updatePendingEmailStatus(pending_email_id, "failed", errorMsg);
      }
      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email
    try {
      await sendSmtpEmail(connection, recipient, subject || '', emailBody, cc ?? undefined, bcc ?? undefined);

      // Update pending email status if provided
      if (pending_email_id) {
        await updatePendingEmailStatus(pending_email_id, "sent");
      }

      // Update last_used_at
      await supabase
        .from("email_connections")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", connection.id);

      console.log(`Email sent successfully from ${connection.email} to ${recipient}`);

      return new Response(
        JSON.stringify({ success: true, from: connection.email }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (sendError) {
      const errorMsg = sendError instanceof Error ? sendError.message : "Failed to send email";
      console.error("Error sending email:", errorMsg);

      if (pending_email_id) {
        await updatePendingEmailStatus(pending_email_id, "failed", errorMsg);
      }

      return new Response(
        JSON.stringify({ success: false, error: errorMsg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Error in smtp-send-email:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Internal server error",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

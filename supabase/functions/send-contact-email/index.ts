import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { wrapEmailContent, EmailComponents } from "../_shared/email-templates.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const CONTACT_RELAY_ALLOWLIST = Deno.env.get("CONTACT_RELAY_ALLOWLIST") || "";
const RESEND_FROM = Deno.env.get("RESEND_FROM") || "contact@example.com";

/** Escape HTML special characters to prevent HTML injection in emails */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface ContactRequest {
  name: string;
  email: string;
  subject: string;
  message: string;
  to: string;
  cc?: string[];
}

const CATEGORY_TAGS: Record<string, string> = {
  "Bug": "BUG",
  "Nouvelle fonctionnalité": "FEATURE",
  "New feature": "FEATURE",
  "Amélioration": "IMPROVE",
  "Improvement": "IMPROVE",
  "Autre": "OTHER",
  "Other": "OTHER",
};

function getCategoryTag(subject: string): string {
  for (const [keyword, tag] of Object.entries(CATEGORY_TAGS)) {
    if (subject.includes(keyword)) return tag;
  }
  return "OTHER";
}

function buildFeedbackHtml(name: string, email: string, category: string, message: string): string {
  const { title, paragraph, divider } = EmailComponents;
  const tag = getCategoryTag(category);

  const content = `
    ${title("Nouveau feedback")}
    ${paragraph(`<strong>${name}</strong> (<a href="mailto:${email}" style="color: #7c3aed; text-decoration: none;">${email}</a>) a envoyé un feedback depuis le dashboard.`)}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td style="padding: 16px 20px; background-color: #ede9fe; border-radius: 12px;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="vertical-align: middle; padding-right: 12px;">
                <span style="display: inline-block; padding: 4px 10px; background-color: #7c3aed; color: #ffffff; font-size: 11px; font-weight: 700; border-radius: 4px; letter-spacing: 0.5px;">${tag}</span>
              </td>
              <td style="vertical-align: middle;">
                <p style="margin: 0; font-size: 17px; font-weight: 700; color: #5b21b6;">${category}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${divider()}

    <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Message</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding: 20px 24px; background-color: #f8fafc; border-radius: 12px; border: 2px solid #e2e8f0;">
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #1e293b; white-space: pre-wrap;">${message}</p>
        </td>
      </tr>
    </table>
  `;

  return wrapEmailContent(content, {
    preheader: `Feedback de ${name} : ${category}`,
    showFooter: false,
  });
}

function buildContactHtml(name: string, email: string, subject: string, message: string): string {
  const { title, paragraph, divider } = EmailComponents;

  const content = `
    ${title("Nouveau message de contact")}
    ${paragraph(`<strong>${name}</strong> (<a href="mailto:${email}" style="color: #7c3aed; text-decoration: none;">${email}</a>) vous a envoyé un message.`)}

    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td style="padding: 16px 20px; background-color: #ede9fe; border-radius: 12px;">
          <p style="margin: 0 0 4px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Sujet</p>
          <p style="margin: 0; font-size: 17px; font-weight: 700; color: #5b21b6;">${subject}</p>
        </td>
      </tr>
    </table>

    ${divider()}

    <p style="margin: 0 0 12px; font-size: 12px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Message</p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="padding: 20px 24px; background-color: #f8fafc; border-radius: 12px; border: 2px solid #e2e8f0;">
          <p style="margin: 0; font-size: 15px; line-height: 1.7; color: #1e293b; white-space: pre-wrap;">${message}</p>
        </td>
      </tr>
    </table>
  `;

  return wrapEmailContent(content, {
    preheader: `Message de ${name} : ${subject}`,
    showFooter: false,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: getCorsHeaders(req.headers.get('origin')) });
  }

  try {
    const { name, email, subject, message, to, cc }: ContactRequest = await req.json();

    if (!name || !email || !subject || !message || !to) {
      return new Response(
        JSON.stringify({ error: "Tous les champs sont requis" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
        }
      );
    }

    // Security: only allow sending to configured allowlist emails (open relay fix INJ-VULN-10)
    if (!CONTACT_RELAY_ALLOWLIST) {
      return new Response(
        JSON.stringify({ error: "CONTACT_RELAY_ALLOWLIST not configured" }),
        {
          status: 500,
          headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
        }
      );
    }

    const allowedRecipients = CONTACT_RELAY_ALLOWLIST.split(',').map(e => e.trim().toLowerCase());
    if (!allowedRecipients.includes(to.toLowerCase())) {
      return new Response(
        JSON.stringify({ error: "Recipient not allowed" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
        }
      );
    }

    // Security: cc must also be restricted to allowlist
    if (cc && cc.length > 0) {
      const invalidCc = cc.filter((addr: string) => !allowedRecipients.includes(addr.toLowerCase()));
      if (invalidCc.length > 0) {
        return new Response(
          JSON.stringify({ error: "CC recipients not allowed" }),
          {
            status: 400,
            headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
          }
        );
      }
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return new Response(
        JSON.stringify({ error: "Adresse email invalide" }),
        {
          status: 400,
          headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
        }
      );
    }

    // Sanitize all user inputs before HTML interpolation
    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safeSubject = escapeHtml(subject);
    const safeMessage = escapeHtml(message);

    const isFeedback = subject.startsWith("[Feedback]");
    const category = isFeedback ? subject.replace("[Feedback] ", "") : subject;
    const safeCategory = escapeHtml(category);

    const emailHtml = isFeedback
      ? buildFeedbackHtml(safeName, safeEmail, safeCategory, safeMessage)
      : buildContactHtml(safeName, safeEmail, safeSubject, safeMessage);

    const emailText = `
${isFeedback ? "Nouveau feedback" : "Nouveau message de contact"}

Nom: ${name.slice(0, 200)}
Email: ${email}
${isFeedback ? "Catégorie" : "Sujet"}: ${category.slice(0, 500)}

Message:
${message.slice(0, 5000)}

---
Envoyé depuis le dashboard.
    `.trim();

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: RESEND_FROM,
        to: [to],
        ...(cc && cc.length > 0 ? { cc } : {}),
        reply_to: email,
        subject: isFeedback ? `[${getCategoryTag(category)}] ${subject}` : `[Contact] ${subject}`,
        html: emailHtml,
        text: emailText,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      console.error("Erreur Resend:", error);
      throw new Error(`Erreur Resend: ${res.status}`);
    }

    const data = await res.json();
    console.log("Email envoyé avec succès:", data);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Email envoyé avec succès",
        id: data.id
      }),
      {
        status: 200,
        headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Erreur lors de l'envoi de l'email:", error);
    return new Response(
      JSON.stringify({
        error: "Erreur lors de l'envoi de l'email",
        details: error.message
      }),
      {
        status: 500,
        headers: { ...getCorsHeaders(req.headers.get('origin')), "Content-Type": "application/json" },
      }
    );
  }
});

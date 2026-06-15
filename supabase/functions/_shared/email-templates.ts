/**
 * Templates email brandés pour Jay
 * Sprint Autonomie & Viralité
 *
 * Design: Clean, high-contrast, professional
 * Optimisé pour compatibilité email (pas de gradients CSS, couleurs solides)
 */

import { getAppUrl } from "./app-url.ts";

// =============================================================================
// Configuration
// =============================================================================

const BRAND = {
  colors: {
    // Primary palette
    primary: "#7c3aed",        // Violet plus saturé pour meilleur contraste
    primaryDark: "#5b21b6",    // Violet foncé pour texte sur fond clair
    primaryLight: "#ede9fe",   // Fond violet très léger

    // Secondary
    secondary: "#3b82f6",      // Bleu vif

    // Neutrals
    dark: "#0f172a",           // Slate 900 - presque noir
    text: "#1e293b",           // Slate 800 - texte principal
    textMuted: "#64748b",      // Slate 500 - texte secondaire
    light: "#f8fafc",          // Slate 50 - fond clair
    white: "#ffffff",

    // Accents
    success: "#059669",        // Emerald 600
    warning: "#d97706",        // Amber 600

    // Borders
    border: "#e2e8f0",         // Slate 200
  },
  logo: `${getAppUrl()}/lovable-uploads/6dad498b-3366-4562-a074-ad6e4160314c.png`,
  url: getAppUrl(),
  name: "Jay",
};

// =============================================================================
// Base Template
// =============================================================================

interface EmailTemplateOptions {
  preheader?: string;
  showFooter?: boolean;
  ctaUrl?: string;
  ctaText?: string;
  language?: string;
}

export function wrapEmailContent(
  content: string,
  options: EmailTemplateOptions = {}
): string {
  const { preheader, showFooter = true, ctaUrl, ctaText, language = 'fr' } = options;

  // CTA Button avec couleur solide (pas de gradient pour compatibilité)
  const ctaButton = ctaUrl && ctaText ? `
    <tr>
      <td align="center" style="padding: 32px 0 40px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${ctaUrl}" style="height:52px;v-text-anchor:middle;width:240px;" arcsize="15%" strokecolor="${BRAND.colors.primary}" fillcolor="${BRAND.colors.primary}">
          <w:anchorlock/>
          <center style="color:#ffffff;font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${ctaText}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-->
        <a href="${ctaUrl}"
           style="display: inline-block; padding: 16px 40px; background-color: ${BRAND.colors.primary}; color: ${BRAND.colors.white}; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 16px; text-align: center; min-width: 200px; box-shadow: 0 4px 14px 0 rgba(124, 58, 237, 0.4);">
          ${ctaText}
        </a>
        <!--<![endif]-->
      </td>
    </tr>
  ` : "";

  const footerText = language === 'en'
    ? 'You receive this email because you have a Jay account.'
    : language === 'nl'
      ? 'Je ontvangt deze e-mail omdat je een Jay-account hebt.'
      : 'Tu reçois cet email car tu as un compte Jay.';
  const footerLink = language === 'en'
    ? 'Manage my preferences'
    : language === 'nl'
      ? 'Mijn voorkeuren beheren'
      : 'Gérer mes préférences';

  const footer = showFooter ? `
    <tr>
      <td style="padding: 32px; background-color: ${BRAND.colors.dark}; border-radius: 0 0 16px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td align="center" style="padding-bottom: 16px;">
              <a href="${BRAND.url}" style="color: ${BRAND.colors.white}; text-decoration: none; font-size: 14px; font-weight: 600;">
                jay-assistant.fr
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="color: #94a3b8; font-size: 13px; line-height: 1.6;">
              ${footerText}<br>
              <a href="${BRAND.url}/dashboard?tab=settings" style="color: #60a5fa; text-decoration: underline;">
                ${footerLink}
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  ` : "";

  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Jay</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <style type="text/css">
    body, table, td, p, a, li { font-family: Arial, sans-serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin: 0; padding: 0; background-color: ${BRAND.colors.light}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; max-height: 0; overflow: hidden; mso-hide: all;">${preheader}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>` : ""}

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.colors.light};">
    <tr>
      <td align="center" style="padding: 48px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width: 560px;">

          <!-- Header with Logo -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <a href="${BRAND.url}" style="text-decoration: none;">
                <img src="${BRAND.logo}" alt="Jay" width="56" height="56" style="display: block; border-radius: 14px; border: 0;">
              </a>
            </td>
          </tr>

          <!-- Main Content Card -->
          <tr>
            <td>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${BRAND.colors.white}; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);">

                <!-- Accent Bar -->
                <tr>
                  <td style="height: 6px; background-color: ${BRAND.colors.primary};"></td>
                </tr>

                <!-- Content -->
                <tr>
                  <td style="padding: 40px 36px 24px;">
                    ${content}
                  </td>
                </tr>

                ${ctaButton}

                ${footer}

              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}

// =============================================================================
// Components
// =============================================================================

export const EmailComponents = {
  /**
   * Titre principal
   */
  title: (text: string) => `
    <h1 style="margin: 0 0 20px; font-size: 26px; font-weight: 700; color: ${BRAND.colors.text}; line-height: 1.3; letter-spacing: -0.02em;">
      ${text}
    </h1>
  `,

  /**
   * Paragraphe
   */
  paragraph: (text: string) => `
    <p style="margin: 0 0 18px; font-size: 16px; line-height: 1.7; color: ${BRAND.colors.text};">
      ${text}
    </p>
  `,

  /**
   * Salutation
   */
  greeting: (name: string, lang: "fr" | "en" = "fr") => {
    const greet = lang === "en" ? "Hi" : "Salut";
    const displayName = name ? ` ${name}` : "";
    return `
      <p style="margin: 0 0 24px; font-size: 17px; line-height: 1.6; color: ${BRAND.colors.text};">
        ${greet}${displayName},
      </p>
    `;
  },

  /**
   * Bonus highlight box - HIGH CONTRAST VERSION
   * Fond violet foncé avec texte blanc pour contraste maximum
   */
  bonusBox: (text: string, emoji: string = "🎁") => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td style="padding: 20px 24px; background-color: ${BRAND.colors.primaryDark}; border-radius: 12px;">
          <table cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-right: 12px; vertical-align: middle;">
                <span style="font-size: 24px;">${emoji}</span>
              </td>
              <td style="vertical-align: middle;">
                <p style="margin: 0; font-size: 17px; font-weight: 700; color: ${BRAND.colors.white}; line-height: 1.4;">
                  ${text}
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `,

  /**
   * Exemple de commande vocale
   */
  voiceExample: (text: string, lang: "fr" | "en" = "fr") => {
    const label = lang === "en" ? "Try saying" : "Essaie";
    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
        <tr>
          <td style="padding: 20px 24px; background-color: ${BRAND.colors.light}; border-radius: 12px; border: 2px solid ${BRAND.colors.border};">
            <p style="margin: 0 0 10px; font-size: 12px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 1px;">
              🎤 ${label}
            </p>
            <p style="margin: 0; font-size: 16px; font-style: italic; color: ${BRAND.colors.text}; line-height: 1.5;">
              "${text}"
            </p>
          </td>
        </tr>
      </table>
    `;
  },

  /**
   * Liste à puces
   */
  bulletList: (items: string[]) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
      ${items.map(item => `
        <tr>
          <td style="padding: 6px 0; vertical-align: top; width: 24px;">
            <span style="color: ${BRAND.colors.primary}; font-size: 18px;">•</span>
          </td>
          <td style="padding: 6px 0 6px 8px; font-size: 15px; color: ${BRAND.colors.text}; line-height: 1.5;">
            ${item}
          </td>
        </tr>
      `).join("")}
    </table>
  `,

  /**
   * Divider
   */
  divider: () => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 28px 0;">
      <tr>
        <td style="border-top: 1px solid ${BRAND.colors.border};"></td>
      </tr>
    </table>
  `,

  /**
   * Small text
   */
  smallText: (text: string) => `
    <p style="margin: 20px 0 0; font-size: 14px; color: ${BRAND.colors.textMuted}; line-height: 1.6;">
      ${text}
    </p>
  `,

  /**
   * Feature list avec icônes - meilleur contraste
   */
  featureList: (features: Array<{ icon: string; text: string }>) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 20px 0;">
      ${features.map(f => `
        <tr>
          <td style="padding: 10px 0; vertical-align: middle; width: 36px;">
            <span style="display: inline-block; width: 28px; height: 28px; background-color: ${BRAND.colors.primaryLight}; border-radius: 6px; text-align: center; line-height: 28px; font-size: 14px;">${f.icon}</span>
          </td>
          <td style="padding: 10px 0 10px 12px; font-size: 15px; color: ${BRAND.colors.text}; line-height: 1.5;">
            ${f.text}
          </td>
        </tr>
      `).join("")}
    </table>
  `,

  /**
   * Info card pour prix ou info importante
   */
  infoCard: (label: string, value: string) => `
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin: 24px 0;">
      <tr>
        <td style="padding: 20px 24px; background-color: ${BRAND.colors.light}; border-radius: 12px; text-align: center;">
          <p style="margin: 0 0 4px; font-size: 13px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">
            ${label}
          </p>
          <p style="margin: 0; font-size: 24px; font-weight: 700; color: ${BRAND.colors.primary};">
            ${value}
          </p>
        </td>
      </tr>
    </table>
  `,
};

// =============================================================================
// Pre-built Templates
// =============================================================================

export type ActivationReminderType =
  | "no_vocal_24h"
  | "no_value_72h"
  | "no_value_7d"
  | "whatsapp_not_linked"
  | "crm_not_connected";

interface ReminderTemplateData {
  firstName: string | null;
  language: "fr" | "en";
}

export function getActivationReminderEmail(
  type: ActivationReminderType,
  data: ReminderTemplateData
): { subject: string; html: string } {
  const { firstName, language } = data;
  const name = firstName || "";
  const { greeting, paragraph, bonusBox, voiceExample, smallText, featureList } = EmailComponents;

  const templates: Record<ActivationReminderType, Record<"fr" | "en", { subject: string; content: string; cta: { url: string; text: string } }>> = {
    no_vocal_24h: {
      fr: {
        subject: "Ton premier vocal t'attend",
        content: `
          ${greeting(name, "fr")}
          ${paragraph("<strong>Ce qu'on te demande :</strong> Envoie ton premier vocal sur WhatsApp après un rendez-vous.")}
          ${voiceExample("J'ai vu Pierre de ACME, il rappelle vendredi", "fr")}
          ${paragraph("<strong>Pourquoi ?</strong> Jay analyse ton message et met à jour ton CRM automatiquement. Plus de saisie manuelle.")}
          ${paragraph("<strong>Résultat :</strong> Ton contact est créé, tes tâches sont planifiées, et tu gagnes du temps dès le premier vocal.")}
        `,
        cta: { url: `${BRAND.url}/dashboard`, text: "Envoyer mon premier vocal" },
      },
      en: {
        subject: "Your first voice note awaits",
        content: `
          ${greeting(name, "en")}
          ${paragraph("<strong>What to do:</strong> Send your first voice note on WhatsApp after a meeting.")}
          ${voiceExample("I met Pierre from ACME, he'll call back Friday", "en")}
          ${paragraph("<strong>Why?</strong> Jay analyzes your message and updates your CRM automatically. No more manual entry.")}
          ${paragraph("<strong>Result:</strong> Your contact is created, tasks are scheduled, and you save time from the very first note.")}
        `,
        cta: { url: `${BRAND.url}/dashboard`, text: "Send my first voice note" },
      },
    },
    no_value_72h: {
      fr: {
        subject: "Jay peut faire bien plus pour toi",
        content: `
          ${greeting(name, "fr")}
          ${paragraph("<strong>Ce qu'on te demande :</strong> Connecte ton CRM à Jay pour automatiser tes mises à jour.")}
          ${bonusBox("+30 vocaux bonus en connectant ton CRM", "🎁")}
          ${paragraph("<strong>Pourquoi ?</strong> Sans CRM connecté, Jay ne peut pas créer tes contacts et tâches automatiquement.")}
          ${paragraph("<strong>Résultat :</strong> Un vocal après un rendez-vous et ton CRM est à jour. Fini la saisie manuelle.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=integrations`, text: "Connecter mon CRM" },
      },
      en: {
        subject: "Jay can do much more for you",
        content: `
          ${greeting(name, "en")}
          ${paragraph("<strong>What to do:</strong> Connect your CRM to Jay to automate your updates.")}
          ${bonusBox("+30 bonus voice notes when you connect your CRM", "🎁")}
          ${paragraph("<strong>Why?</strong> Without a connected CRM, Jay can't create your contacts and tasks automatically.")}
          ${paragraph("<strong>Result:</strong> One voice note after a meeting and your CRM is up to date. No more manual entry.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=integrations`, text: "Connect my CRM" },
      },
    },
    no_value_7d: {
      fr: {
        subject: "Dernier rappel : Jay t'attend",
        content: `
          ${greeting(name, "fr")}
          ${paragraph("Ça fait une semaine qu'on ne s'est pas vus. On serait triste de te voir partir !")}
          ${paragraph("Un problème ? Une question ? Réponds à cet email, on t'aide.")}
          ${smallText("PS : Tes 50 crédits de démarrage expirent bientôt...")}
        `,
        cta: { url: `${BRAND.url}/dashboard`, text: "Revenir sur Jay" },
      },
      en: {
        subject: "Last reminder: Jay is waiting",
        content: `
          ${greeting(name, "en")}
          ${paragraph("It's been a week since we've seen you. We'd be sad to see you go!")}
          ${paragraph("Any issues? Questions? Reply to this email, we'll help.")}
          ${smallText("PS: Your 50 starter credits are expiring soon...")}
        `,
        cta: { url: `${BRAND.url}/dashboard`, text: "Come back to Jay" },
      },
    },
    whatsapp_not_linked: {
      fr: {
        subject: "Ouvre une conversation avec Jay sur WhatsApp",
        content: `
          ${greeting(name, "fr")}
          ${paragraph("<strong>Ce qu'on te demande :</strong> Ouvre une conversation WhatsApp avec Jay en un clic.")}
          ${bonusBox("+10 vocaux bonus en liant WhatsApp", "📱")}
          ${paragraph("<strong>Pourquoi ?</strong> WhatsApp te permet d'envoyer des vocaux et des photos de cartes de visite à Jay, où que tu sois.")}
          ${paragraph("<strong>Résultat :</strong> Après un rendez-vous, un simple vocal et ton CRM est à jour. Jay n'accède qu'aux messages que tu lui envoies.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=whatsapp`, text: "Ouvrir la conversation" },
      },
      en: {
        subject: "Start a conversation with Jay on WhatsApp",
        content: `
          ${greeting(name, "en")}
          ${paragraph("<strong>What to do:</strong> Start a WhatsApp conversation with Jay in one click.")}
          ${bonusBox("+10 bonus voice notes when you link WhatsApp", "📱")}
          ${paragraph("<strong>Why?</strong> WhatsApp lets you send voice notes and business card photos to Jay, wherever you are.")}
          ${paragraph("<strong>Result:</strong> After a meeting, one voice note and your CRM is up to date. Jay only accesses the messages you send.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=whatsapp`, text: "Start the conversation" },
      },
    },
    crm_not_connected: {
      fr: {
        subject: "Connecte ton CRM et gagne +30 vocaux",
        content: `
          ${greeting(name, "fr")}
          ${paragraph("<strong>Ce qu'on te demande :</strong> Connecte ton CRM en 2 clics depuis le dashboard.")}
          ${bonusBox("+30 vocaux bonus en connectant ton CRM", "🔗")}
          ${paragraph("<strong>Pourquoi ?</strong> Jay a besoin de ton CRM pour y créer automatiquement tes contacts et tâches.")}
          ${featureList([
            { icon: "✓", text: "HubSpot, Salesforce, Pipedrive..." },
            { icon: "✓", text: "Mise à jour automatique des contacts" },
            { icon: "✓", text: "Création de rappels et tâches" },
          ])}
          ${paragraph("<strong>Résultat :</strong> Chaque vocal envoyé met à jour ton CRM sans effort.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=integrations`, text: "Connecter mon CRM" },
      },
      en: {
        subject: "Connect your CRM and earn +30 voice notes",
        content: `
          ${greeting(name, "en")}
          ${paragraph("<strong>What to do:</strong> Connect your CRM in 2 clicks from the dashboard.")}
          ${bonusBox("+30 bonus voice notes when you connect your CRM", "🔗")}
          ${paragraph("<strong>Why?</strong> Jay needs your CRM to automatically create your contacts and tasks.")}
          ${featureList([
            { icon: "✓", text: "HubSpot, Salesforce, Pipedrive..." },
            { icon: "✓", text: "Automatic contact updates" },
            { icon: "✓", text: "Reminder and task creation" },
          ])}
          ${paragraph("<strong>Result:</strong> Every voice note updates your CRM effortlessly.")}
        `,
        cta: { url: `${BRAND.url}/dashboard?tab=integrations`, text: "Connect my CRM" },
      },
    },
  };

  const template = templates[type][language];

  return {
    subject: template.subject,
    html: wrapEmailContent(template.content, {
      preheader: template.subject,
      ctaUrl: template.cta.url,
      ctaText: template.cta.text,
      language,
    }),
  };
}

// =============================================================================
// Subscription Emails
// =============================================================================

interface RenewalReminderData {
  firstName: string | null;
  planName: string;
  expirationDate: string;
  language: "fr" | "en";
}

export function getSubscriptionRenewalEmail(data: RenewalReminderData): { subject: string; html: string } {
  const { firstName, planName, expirationDate, language } = data;
  const name = firstName || "";
  const { greeting, paragraph, bonusBox, featureList } = EmailComponents;

  const content = language === "en" ? `
    ${greeting(name, "en")}
    ${paragraph(`Your <strong>${planName}</strong> subscription expires on <strong>${expirationDate}</strong>.`)}
    ${bonusBox("Action required: Renew to keep your access", "⏰")}
    <p style="margin: 24px 0 16px; font-size: 13px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">
      What you'll lose without renewal
    </p>
    ${featureList([
      { icon: "📝", text: "Unlimited voice notes" },
      { icon: "🔗", text: "CRM integrations" },
      { icon: "📞", text: "Priority support" },
      { icon: "🚀", text: "All advanced features" },
    ])}
    ${paragraph("Questions? Reply to this email, our team is here to help!")}
  ` : `
    ${greeting(name, "fr")}
    ${paragraph(`Ton abonnement <strong>${planName}</strong> expire le <strong>${expirationDate}</strong>.`)}
    ${bonusBox("Action requise : Renouvelle pour garder ton accès", "⏰")}
    <p style="margin: 24px 0 16px; font-size: 13px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">
      Ce que tu perdras sans renouvellement
    </p>
    ${featureList([
      { icon: "📝", text: "Vocaux illimités" },
      { icon: "🔗", text: "Intégrations CRM" },
      { icon: "📞", text: "Support prioritaire" },
      { icon: "🚀", text: "Toutes les fonctionnalités avancées" },
    ])}
    ${paragraph("Des questions ? Réponds à cet email, notre équipe est là pour t'aider !")}
  `;

  const subject = language === "en"
    ? `Your ${planName} subscription expires on ${expirationDate}`
    : `Ton abonnement ${planName} expire le ${expirationDate}`;

  return {
    subject,
    html: wrapEmailContent(content, {
      preheader: language === "en" ? "Renew now to keep your access" : "Renouvelle maintenant pour garder ton accès",
      ctaUrl: `${BRAND.url}/dashboard?tab=subscription`,
      ctaText: language === "en" ? "Renew my subscription" : "Renouveler mon abonnement",
      language,
    }),
  };
}

interface WelcomeEmailData {
  firstName: string | null;
  planName: string;
  price: string;
  features: string[];
  language: "fr" | "en";
}

export function getWelcomeSubscriptionEmail(data: WelcomeEmailData): { subject: string; html: string } {
  const { firstName, planName, price, features, language } = data;
  const name = firstName || "";
  const { greeting, paragraph, featureList, infoCard } = EmailComponents;

  const content = language === "en" ? `
    ${greeting(name, "en")}
    ${paragraph(`Welcome to <strong>${planName}</strong>! Your subscription is now active.`)}
    ${price ? infoCard("Your plan", price) : ""}
    ${features.length > 0 ? `
      <p style="margin: 24px 0 16px; font-size: 13px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">
        Included in your plan
      </p>
      ${featureList(features.map(f => ({ icon: "✓", text: f })))}
    ` : ""}
    ${paragraph("You're all set! Start using Jay to save time on your CRM.")}
  ` : `
    ${greeting(name, "fr")}
    ${paragraph(`Bienvenue sur <strong>${planName}</strong> ! Ton abonnement est maintenant actif.`)}
    ${price ? infoCard("Ton plan", price) : ""}
    ${features.length > 0 ? `
      <p style="margin: 24px 0 16px; font-size: 13px; font-weight: 600; color: ${BRAND.colors.textMuted}; text-transform: uppercase; letter-spacing: 0.5px;">
        Inclus dans ton plan
      </p>
      ${featureList(features.map(f => ({ icon: "✓", text: f })))}
    ` : ""}
    ${paragraph("Tu es prêt ! Commence à utiliser Jay pour gagner du temps sur ton CRM.")}
  `;

  const subject = language === "en"
    ? `Welcome to ${planName}`
    : `Bienvenue sur ${planName}`;

  return {
    subject,
    html: wrapEmailContent(content, {
      preheader: subject,
      ctaUrl: `${BRAND.url}/dashboard`,
      ctaText: language === "en" ? "Go to Dashboard" : "Aller au Dashboard",
      language,
    }),
  };
}

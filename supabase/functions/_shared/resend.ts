interface EmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: {
    email: string;
    name: string;
  };
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

interface ResendResponse {
  id?: string;
  error?: {
    message: string;
    name: string;
  };
}

export class ResendEmailService {
  private apiKey: string;
  private defaultFrom: { email: string; name: string };

  constructor(apiKey: string, defaultFrom: { email: string; name: string }) {
    this.apiKey = apiKey;
    this.defaultFrom = defaultFrom;
  }

  async sendEmail(options: EmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
    try {
      const payload: any = {
        from: options.from ? `${options.from.name} <${options.from.email}>` : `${this.defaultFrom.name} <${this.defaultFrom.email}>`,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
      };

      // Ajouter les champs optionnels
      if (options.text) payload.text = options.text;
      if (options.replyTo) payload.reply_to = options.replyTo;
      if (options.tags) payload.tags = options.tags;

      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result: ResendResponse = await response.json();

      if (!response.ok) {
        console.error("Erreur Resend:", result.error);
        return {
          success: false,
          error: result.error?.message || `HTTP ${response.status}`
        };
      }

      return {
        success: true,
        id: result.id
      };

    } catch (error) {
      console.error("Erreur lors de l'envoi d'email:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Erreur inconnue"
      };
    }
  }
}

// Instance par défaut configurée avec les variables d'environnement
export function createResendService(): ResendEmailService {
  const apiKey = (globalThis as any).Deno?.env?.get("RESEND_API_KEY");
  if (!apiKey) {
    throw new Error("RESEND_API_KEY n'est pas définie dans les variables d'environnement");
  }

  const fromEmail = (globalThis as any).Deno?.env?.get("RESEND_FROM_EMAIL") || "noreply@example.com";
  const fromName = (globalThis as any).Deno?.env?.get("RESEND_FROM_NAME") || "Reach";

  return new ResendEmailService(apiKey, {
    email: fromEmail,
    name: fromName
  });
}

// Fonction utilitaire pour envoyer des emails avec des templates
export async function sendTemplateEmail(
  to: string | string[],
  subject: string,
  templateName: string,
  templateData: Record<string, any> = {}
): Promise<{ success: boolean; id?: string; error?: string }> {
  const resendService = createResendService();
  
  // Ici tu peux ajouter des templates prédéfinis
  const templates: Record<string, (data: Record<string, any>) => string> = {
    welcome: (data) => `
      <h1>Bienvenue ${data.name || ''} !</h1>
      <p>Merci de vous être inscrit à Jay.</p>
    `,
    reminder: (data) => `
      <h1>Rappel d'abonnement</h1>
      <p>Votre abonnement ${data.planName || ''} expire bientôt.</p>
    `,
    // Ajoute d'autres templates selon tes besoins
  };

  const template = templates[templateName];
  if (!template) {
    throw new Error(`Template '${templateName}' non trouvé`);
  }

  return await resendService.sendEmail({
    to,
    subject,
    html: template(templateData)
  });
}
/**
 * Schémas Zod pour les fonctions email
 * @see docs/plans/2026-01-19-zod-validation-design.md
 */

import { z } from "npm:zod@3.24.1";
import { EmailSchema } from "./common.ts";

// === Adresse email (simple ou avec nom) ===
export const EmailAddressSchema = z.union([
  EmailSchema,
  z.object({
    email: EmailSchema,
    name: z.string().max(100).optional(),
  }),
]);

// === Pièce jointe ===
export const AttachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z.string(),
  contentType: z.string().optional(),
});

// === Envoyer email (gmail-send-email, microsoft-send-email, outlook-send-email) ===
export const SendEmailSchema = z.object({
  to: z.array(EmailAddressSchema).min(1).max(50),
  cc: z.array(EmailAddressSchema).max(50).optional(),
  bcc: z.array(EmailAddressSchema).max(50).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100000),
  isHtml: z.boolean().optional().default(false),
  replyTo: EmailSchema.optional(),
  attachments: z.array(AttachmentSchema).max(10).optional(),
});

// === Connexion provider email (email-provider-connect) ===
export const IMAPConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  tls: z.boolean().optional().default(true),
});

export const SMTPConfigSchema = z.object({
  host: z.string().min(1),
  port: z.coerce.number().int().min(1).max(65535),
  username: z.string().min(1),
  password: z.string().min(1),
  tls: z.boolean().optional().default(true),
});

export const EmailProviderConnectSchema = z.object({
  provider: z.enum(["gmail", "outlook", "protonmail", "imap"]),
  imap: IMAPConfigSchema.optional(),
  smtp: SMTPConfigSchema.optional(),
});

// === Recherche contacts (search-google-contacts, search-microsoft-contacts) ===
export const SearchContactsSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
});

// === Gmail/Microsoft Email Request (Edge Function specific) ===
export const OAuthEmailRequestSchema = z.object({
  recipient: z.string()
    .min(1, "Recipient email is required")
    .email("Invalid recipient email format")
    .max(254, "Email address too long"), // RFC 5321 limit
  subject: z.string()
    .max(998, "Subject too long") // RFC 5322 limit
    .default(""),
  body: z.string()
    .min(1, "Email body is required")
    .max(1000000, "Email body too large"), // 1MB limit
  pendingEmailId: z.string().uuid().optional(),
  userId: z.string().uuid("Invalid user ID format"),
});

// === SMTP Email Request (Edge Function specific) ===
export const SmtpEmailRequestSchema = z.object({
  user_id: z.string().uuid("Invalid user ID format").optional(),
  provider: z.enum(['ovh', 'infomaniak', 'proton', 'yahoo', 'custom']).optional(),
  from_email: z.string().email().optional(),
  recipient: z.string()
    .min(1, "Recipient email is required")
    .email("Invalid recipient email format")
    .max(254, "Email address too long"),
  subject: z.string()
    .max(998, "Subject too long")
    .default(""),
  body: z.string()
    .min(1, "Email body is required")
    .max(1000000, "Email body too large"),
  cc: z.string().email("Invalid CC email format").optional().nullable(),
  bcc: z.string().email("Invalid BCC email format").optional().nullable(),
  pending_email_id: z.string().uuid().optional(),
});

// === Types ===
export type EmailAddress = z.infer<typeof EmailAddressSchema>;
export type SendEmail = z.infer<typeof SendEmailSchema>;
export type EmailProviderConnect = z.infer<typeof EmailProviderConnectSchema>;
export type SearchContacts = z.infer<typeof SearchContactsSchema>;
export type OAuthEmailRequest = z.infer<typeof OAuthEmailRequestSchema>;
export type SmtpEmailRequest = z.infer<typeof SmtpEmailRequestSchema>;

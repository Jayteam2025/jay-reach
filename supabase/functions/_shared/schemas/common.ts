/**
 * Schémas Zod communs - Types de base réutilisables
 * @see docs/plans/2026-01-19-zod-validation-design.md
 */

import { z } from "npm:zod@3.24.1";

// === Types de base ===
export const UUIDSchema = z.string().uuid();
export const EmailSchema = z.string().email();
export const URLSchema = z.string().url();
export const ISODateSchema = z.string().datetime();

// === Pagination (admin, listes) ===
export const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
  offset: z.coerce.number().int().min(0).optional().default(0),
});

// === Auth header (extrait user_id du token) ===
export const AuthHeaderSchema = z.string().regex(
  /^Bearer .+$/,
  "Authorization header must be 'Bearer <token>'"
);

// === Types utilitaires ===
export type UUID = z.infer<typeof UUIDSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;

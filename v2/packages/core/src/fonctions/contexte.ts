/**
 * Socle commun à toutes les fonctions métier du lot 2 (spec « une fonction, deux
 * façades » : un écran et le futur serveur MCP appellent la même fonction avec
 * le même `Contexte`, sans jamais dupliquer l'autorisation ou la validation).
 */
import type { z } from 'zod';
import type { Executeur } from '../executeur.js';
import { requireRole, type MembershipRole } from '../roles.js';

/** Ce que chaque fonction métier reçoit : accès base, organisation courante, appelant. */
export interface Contexte {
  ex: Executeur;
  organisationId: string;
  utilisateurId: string | null;
  role: MembershipRole | null;
}

/** Entrée qui ne passe pas son schéma Zod — `details` porte le détail Zod (`flatten()`), pour l'écran comme pour le MCP. */
export class ErreurEntree extends Error {
  constructor(public readonly details: unknown) {
    super('Entrée invalide');
    this.name = 'ErreurEntree';
  }
}

/** Ressource demandée absente (ou hors de l'organisation courante, ce qui revient au même côté appelant). */
export class ErreurIntrouvable extends Error {
  constructor(quoi: string) {
    super(`${quoi} introuvable`);
    this.name = 'ErreurIntrouvable';
  }
}

/** Exige un rôle minimum sur le contexte courant, sinon lève `ForbiddenError` (roles.ts). */
export function exiger(ctx: Contexte, min: MembershipRole): void {
  requireRole(ctx.role, min);
}

/** Valide une entrée contre un schéma Zod, sinon lève `ErreurEntree`. */
export function valider<S extends z.ZodTypeAny>(schema: S, entree: unknown): z.infer<S> {
  const r = schema.safeParse(entree);
  if (!r.success) throw new ErreurEntree(r.error.flatten());
  return r.data;
}

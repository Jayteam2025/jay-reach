/**
 * Les quatre rôles d'organisation (docs/02-data-model.md) et leur hiérarchie.
 * Miroir TypeScript de `app.role_rank()` en base — même ordre, même seuils.
 */

export const MEMBERSHIP_ROLES = ['viewer', 'operator', 'admin', 'owner'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const RANK: Record<MembershipRole, number> = {
  viewer: 1,
  operator: 2,
  admin: 3,
  owner: 4,
};

export function roleRank(role: MembershipRole): number {
  return RANK[role];
}

export function isMembershipRole(value: string): value is MembershipRole {
  return (MEMBERSHIP_ROLES as readonly string[]).includes(value);
}

/** `role` satisfait-il le rôle minimum `min` ? */
export function hasMinRole(role: MembershipRole, min: MembershipRole): boolean {
  return roleRank(role) >= roleRank(min);
}

/** Erreur d'autorisation — le glue serveur la traduit en 403/redirection. */
export class ForbiddenError extends Error {
  constructor(
    public readonly required: MembershipRole,
    public readonly actual: MembershipRole | null,
  ) {
    super(
      actual === null
        ? `Rôle « ${required} » requis, aucun rôle sur cette organisation`
        : `Rôle « ${required} » requis, rôle courant « ${actual} »`,
    );
    this.name = 'ForbiddenError';
  }
}

/**
 * Vérifie qu'un rôle atteint le minimum requis, sinon lève `ForbiddenError`.
 * Pur et testable : ne connaît ni Supabase ni la requête.
 */
export function requireRole(actual: MembershipRole | null, min: MembershipRole): MembershipRole {
  if (actual === null || !hasMinRole(actual, min)) {
    throw new ForbiddenError(min, actual);
  }
  return actual;
}

import { requireRole as coreRequireRole, type MembershipRole } from '@jay-reach/core';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';

/** Utilisateur connecté, ou null. */
export async function getUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
}

/** Exige un utilisateur connecté, sinon redirige vers /login. */
export async function requireUser() {
  const user = await getUser();
  if (!user) {
    redirect('/login');
  }
  return user;
}

/** Rôle de l'utilisateur courant dans une organisation (null si non-membre). */
export async function getMembershipRole(organizationId: string): Promise<MembershipRole | null> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return null;
  }
  const { data } = await supabase
    .from('memberships')
    .select('role')
    .eq('organization_id', organizationId)
    .eq('user_id', userData.user.id)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return (role as MembershipRole | undefined) ?? null;
}

/**
 * Exige au moins le rôle `min` dans l'organisation. Lève `ForbiddenError`
 * (de @jay-reach/core) si insuffisant — à traduire en 403 par l'appelant.
 */
export async function requireRole(
  organizationId: string,
  min: MembershipRole,
): Promise<MembershipRole> {
  const role = await getMembershipRole(organizationId);
  return coreRequireRole(role, min);
}

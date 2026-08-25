'use server';

import { isMembershipRole } from '@jay-reach/core';
import { createClient } from '../../lib/supabase/server';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/** Crée une organisation et rattache l'utilisateur courant en owner. */
export async function createOrganization(name: string, slug: string): Promise<ActionResult<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: name,
    p_slug: slug,
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as string };
}

/** Invite une adresse email dans une organisation (admin+ requis par la RLS). */
export async function inviteMember(
  organizationId: string,
  email: string,
  role: string,
): Promise<ActionResult> {
  if (!isMembershipRole(role)) {
    return { ok: false, error: `Rôle invalide : ${role}` };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from('invitations')
    .insert({ organization_id: organizationId, email, role });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: undefined };
}

/** Accepte une invitation via son jeton ; retourne l'id de l'organisation. */
export async function acceptInvitation(token: string): Promise<ActionResult<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, data: data as string };
}

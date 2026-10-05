'use server';

import { revalidatePath } from 'next/cache';

import { ErreurEntree, ErreurIntrouvable, ForbiddenError, isMembershipRole, modifierOrganisation } from '@jay-reach/core';
import { createClient } from '../../lib/supabase/server';
import { contexteCourant } from '../../lib/contexte';

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string };

function resultatDErreur(err: unknown): ActionResult {
  if (err instanceof ForbiddenError) return { ok: false, error: 'Droit insuffisant pour cette action.' };
  if (err instanceof ErreurEntree) {
    const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
    const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
      (m): m is string => typeof m === 'string',
    );
    return { ok: false, error: issues[0] ?? 'Entrée invalide.' };
  }
  if (err instanceof ErreurIntrouvable) return { ok: false, error: err.message };
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/** Réglages › Compte : identité de l'organisation (nom, fuseau, langue — `packages/core/src/fonctions/compte.ts`). */
export async function actionModifierOrganisation(input: { nom: string; fuseau: string; langue: string }): Promise<ActionResult> {
  try {
    const ctx = await contexteCourant();
    await modifierOrganisation(ctx, input);
    revalidatePath('/settings/account');
    // Nom d'organisation et langue sont rendus par le layout.
    revalidatePath('/', 'layout');
    return { ok: true, data: undefined };
  } catch (err) {
    return resultatDErreur(err);
  }
}

/**
 * Retire une invitation encore en attente (jamais une adhésion déjà acceptée :
 * révoquer un membre réel demande de garantir qu'il reste au moins un
 * propriétaire, une règle que cette tâche ne pose pas — hors périmètre du
 * plan, `listerMembres` reste lecture seule pour les adhésions acceptées).
 * La RLS (`invitations_write`, admin+) refuse déjà toute autre organisation.
 */
export async function actionRevoquerInvitation(invitationId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from('invitations').delete().eq('id', invitationId).is('accepted_at', null);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/account');
  return { ok: true, data: undefined };
}

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
  revalidatePath('/');
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
  revalidatePath('/');
  revalidatePath('/settings/account');
  return { ok: true, data: undefined };
}

/** Accepte une invitation via son jeton ; retourne l'id de l'organisation. */
export async function acceptInvitation(token: string): Promise<ActionResult<string>> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('accept_invitation', { p_token: token });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/');
  return { ok: true, data: data as string };
}

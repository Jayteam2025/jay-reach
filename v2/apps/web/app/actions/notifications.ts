'use server';

import { revalidatePath } from 'next/cache';

import { getUser } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type MarkResult = { ok: true } | { ok: false; error: string };

/** Marque comme lues toutes les notifications non lues de l'utilisateur courant. */
export async function markNotificationsRead(): Promise<MarkResult> {
  const user = await getUser();
  if (!user) {
    return { ok: false, error: 'Non authentifié.' };
  }
  const svc = createServiceClient();
  const { error } = await svc
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/');
  return { ok: true };
}

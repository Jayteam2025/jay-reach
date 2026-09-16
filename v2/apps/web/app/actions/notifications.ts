'use server';

import { revalidatePath } from 'next/cache';

import { getUser } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';
import { createClient } from '../../lib/supabase/server';
import { contexteCourant } from '../../lib/contexte';
import {
  DEFAUT_ACTIF_NOTIFICATION,
  EVENEMENTS_NOTIFICATION,
  type EvenementNotification,
  type PreferenceNotification,
} from '../../lib/notification-events';

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

// ---------------------------------------------------------------------------
// Réglages › Compte, carte « Mes notifications » (tâche 23).
//
// `notification_preferences` (migration `20260817120000_init_schema`) existait
// sans jamais avoir été lue ni écrite nulle part dans ce dépôt. Sa RLS
// (`notification_preferences_own`) n'exige qu'un `user_id = auth.uid()` — pas
// de contrôle de rôle, une préférence est personnelle, pas un réglage
// d'organisation. Un même bouton de la maquette (« par email et dans l'app »)
// pilote donc LES DEUX canaux ensemble : le schéma distingue `channel`, mais
// rien à l'écran ne les sépare, on écrit les deux lignes à chaque bascule.
// ---------------------------------------------------------------------------

const CANAUX = ['email', 'push'] as const;

export async function listerPreferencesNotifications(): Promise<PreferenceNotification[]> {
  const ctx = await contexteCourant();
  // `contexteCourant()` vient de `requireUser()` : l'utilisateur est déjà
  // authentifié ici, `utilisateurId` n'est donc jamais `null` en pratique —
  // le type de base (`Contexte`) le permet pour d'autres appelants
  // (ex. worker), d'où cette garde plutôt qu'un cast.
  if (!ctx.utilisateurId) return EVENEMENTS_NOTIFICATION.map((event) => ({ event, actif: DEFAUT_ACTIF_NOTIFICATION[event] }));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('notification_preferences')
    .select('event, enabled')
    .eq('user_id', ctx.utilisateurId)
    .eq('organization_id', ctx.organisationId);
  if (error) {
    console.warn('[notifications] lecture des préférences échouée', error.message);
  }
  const parEvent = new Map((data ?? []).map((r) => [r.event, r.enabled]));
  return EVENEMENTS_NOTIFICATION.map((event) => ({
    event,
    actif: parEvent.get(event) ?? DEFAUT_ACTIF_NOTIFICATION[event],
  }));
}

export async function actionModifierPreferenceNotification(event: string, actif: boolean): Promise<MarkResult> {
  if (!(EVENEMENTS_NOTIFICATION as readonly EvenementNotification[]).includes(event as EvenementNotification)) {
    return { ok: false, error: `Type de notification inconnu : ${event}` };
  }
  const ctx = await contexteCourant();
  if (!ctx.utilisateurId) return { ok: false, error: 'Non authentifié.' };
  const supabase = await createClient();
  const { error } = await supabase.from('notification_preferences').upsert(
    CANAUX.map((channel) => ({
      user_id: ctx.utilisateurId as string,
      organization_id: ctx.organisationId,
      channel,
      event,
      enabled: actif,
    })),
    { onConflict: 'user_id,organization_id,channel,event' },
  );
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/account');
  return { ok: true };
}

'use server';

import webpush from 'web-push';
import { getUser } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

export type PushResult = { ok: true; sent?: number } | { ok: false; error: string };

interface WebPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function configureVapid(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:contact@jay-reach.fr', pub, priv);
  return true;
}

/** Enregistre l'abonnement push du navigateur pour l'utilisateur courant. */
export async function savePushSubscription(sub: WebPushSubscription, userAgent: string): Promise<PushResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };

  const svc = createServiceClient();
  await svc.from('push_subscriptions').delete().eq('user_id', user.id).eq('endpoint', sub.endpoint);
  const { error } = await svc.from('push_subscriptions').insert({
    user_id: user.id,
    endpoint: sub.endpoint,
    keys: sub.keys,
    user_agent: userAgent.slice(0, 300),
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Envoie une notification bureau de test à tous les abonnements de l'utilisateur. */
export async function sendTestPush(): Promise<PushResult> {
  const user = await getUser();
  if (!user) return { ok: false, error: 'Non authentifié.' };
  if (!configureVapid()) return { ok: false, error: 'Clés VAPID non configurées.' };

  const svc = createServiceClient();
  const subs =
    ((await svc.from('push_subscriptions').select('endpoint,keys').eq('user_id', user.id)).data as
      | { endpoint: string; keys: { p256dh: string; auth: string } }[]
      | null) ?? [];

  const payload = JSON.stringify({
    title: 'Jay Reach',
    body: 'Notification bureau activée ✓ — vous serez prévenu des réponses et rendez-vous.',
    url: '/',
  });

  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      sent += 1;
    } catch {
      // Abonnement expiré/invalide : on le retire.
      await svc.from('push_subscriptions').delete().eq('endpoint', s.endpoint);
    }
  }
  return { ok: true, sent };
}

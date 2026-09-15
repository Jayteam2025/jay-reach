'use server';

import { revalidatePath } from 'next/cache';

import { requireRole, getCurrentOrganizationId } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';
import { getPool } from '../../lib/db';
import { classifyReply, repondreAuFil, texteVersHtml, ErreurEntree, type ReplyClassification } from '@jay-reach/core';
import { messageErreurReponse } from '../../lib/erreur-reponse';
import { classifyReplyWithModel, generateSuggestedReply, resolveAnthropicKey } from '../../lib/anthropic';
import { resolveGraphConfig } from '../../lib/graph';
import { repondreDansLaBoite } from '@jay-reach/providers/mail';
import { resolveSalesblinkKey } from '../../lib/salesblink';
import { repondreDansLeFil } from '@jay-reach/providers/outreach';

export type ClassifyResult = { ok: true; count: number } | { ok: false; error: string };
export type SuggestResult = { ok: true; draft: string } | { ok: false; error: string };

/**
 * Génère une proposition de réponse pour un fil (T26b). Jamais envoyée : la
 * proposition est renvoyée pour relecture humaine. Nécessite la clé Anthropic.
 */
export async function suggestReply(organizationId: string, threadId: string): Promise<SuggestResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }
  const apiKey = await resolveAnthropicKey(organizationId);
  if (!apiKey) {
    return { ok: false, error: 'Clé IA (Anthropic) requise — ajoutez-la pour activer les réponses suggérées.' };
  }
  const svc = createServiceClient();
  const th = (
    await svc
      .from('threads')
      .select('id, contact_id, contacts(first_name,last_name,accounts(name)), thread_messages(direction,body,sent_at)')
      .eq('id', threadId)
      .eq('organization_id', organizationId)
      .maybeSingle()
  ).data as
    | {
        contact_id: string | null;
        contacts: { first_name: string | null; last_name: string | null; accounts: { name: string | null } | null } | null;
        thread_messages: { direction: 'in' | 'out'; body: string; sent_at: string }[] | null;
      }
    | null;
  if (!th) return { ok: false, error: 'Fil introuvable.' };

  const msgs = [...(th.thread_messages ?? [])].sort((a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime());
  const lastIn = [...msgs].reverse().find((m) => m.direction === 'in');
  if (!lastIn) return { ok: false, error: 'Aucun message reçu à traiter.' };

  // Campagne (via une inscription du contact), best-effort.
  let campaignName = '—';
  if (th.contact_id) {
    const enr = (
      await svc.from('enrollments').select('campaigns(name)').eq('contact_id', th.contact_id).limit(1).maybeSingle()
    ).data as { campaigns: { name: string | null } | null } | null;
    campaignName = enr?.campaigns?.name ?? '—';
  }

  const draft = await generateSuggestedReply({
    receivedMessage: lastIn.body,
    contactName: `${th.contacts?.first_name ?? ''} ${th.contacts?.last_name ?? ''}`.trim() || 'ce contact',
    company: th.contacts?.accounts?.name ?? '—',
    campaignName,
    history: msgs
      .slice(-4)
      .map((m) => `${m.direction === 'in' ? 'Reçu' : 'Envoyé'} : ${m.body}`)
      .join(' | '),
  }, apiKey);
  if (!draft) return { ok: false, error: 'Génération indisponible.' };
  return { ok: true, draft };
}

/** Effet sur l'inscription active selon la classification de la réponse. */
function enrollmentPatch(c: ReplyClassification, resumeAt: string | null): Record<string, unknown> | null {
  const now = new Date().toISOString();
  if (c === 'human_reply') return { status: 'replied', ended_at: now };
  if (c === 'auto_absence') return { status: 'paused_absence', resume_at: resumeAt, next_action_at: resumeAt };
  if (c === 'auto_left_company') return { status: 'stopped', stop_reason: 'contact_left', ended_at: now };
  return null;
}

/**
 * Classe automatiquement les réponses reçues (3 passes : en-têtes, motifs
 * multilingues, puis modèle IA en dernier recours si la clé est configurée),
 * met à jour `threads.classification` et applique l'effet sur l'inscription
 * (arrêt sur réponse humaine, pause datée sur absence, arrêt sur départ).
 * Exige le rôle operator.
 */
export async function classifyInbox(organizationId: string): Promise<ClassifyResult> {
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }

  // Resolue une fois pour tout le lot : le tri peut porter sur des dizaines de
  // fils, et rien ne justifie d'interroger le coffre a chaque message.
  const cleIa = await resolveAnthropicKey(organizationId);

  const svc = createServiceClient();
  const threads =
    ((await svc.from('threads').select('id,contact_id').eq('organization_id', organizationId)).data as
      | { id: string; contact_id: string | null }[]
      | null) ?? [];

  let count = 0;
  for (const th of threads) {
    const msg = (
      await svc
        .from('thread_messages')
        .select('body,headers')
        .eq('thread_id', th.id)
        .eq('direction', 'in')
        .order('sent_at', { ascending: false })
        .limit(1)
        .maybeSingle()
    ).data as { body: string; headers: Record<string, unknown> | null } | null;
    if (!msg) continue;

    const rules = classifyReply(msg.body, msg.headers);
    let classification: ReplyClassification;
    let resumeInDays: number | undefined;
    if (rules) {
      classification = rules.classification;
      resumeInDays = rules.resumeInDays;
    } else {
      // Passe 3 : modèle (ou défaut « réponse humaine » sans clé).
      classification = (await classifyReplyWithModel(msg.body, cleIa)) ?? 'human_reply';
    }

    const resumeAt =
      classification === 'auto_absence'
        ? new Date(Date.now() + (resumeInDays ?? 7) * 86_400_000).toISOString()
        : null;

    await svc.from('threads').update({ classification, resume_at: resumeAt }).eq('id', th.id);

    if (th.contact_id) {
      const patch = enrollmentPatch(classification, resumeAt);
      if (patch) {
        await svc
          .from('enrollments')
          .update(patch)
          .eq('contact_id', th.contact_id)
          .in('status', ['active', 'paused', 'paused_absence']);
      }
    }
    count += 1;
  }

  revalidatePath('/inbox');
  return { ok: true, count };
}

export type RepondreResult = { ok: true } | { ok: false; error: string };

/**
 * Envoie une réponse dans un fil de la Réception (lot 3 bis, tâche 3). Le
 * transport — Microsoft Graph ou SalesBlink — n'est jamais choisi ici : il
 * est imposé par l'origine du dernier message reçu du fil, voir
 * `repondreAuFil` (`@jay-reach/core`). Exige le rôle operator ; l'organisation
 * vient de la session, jamais d'un identifiant fourni par l'appelant.
 */
export async function repondre(threadId: string, corps: string): Promise<RepondreResult> {
  const organizationId = await getCurrentOrganizationId();
  if (!organizationId) {
    return { ok: false, error: 'Session ou organisation introuvable.' };
  }
  try {
    await requireRole(organizationId, 'operator');
  } catch {
    return { ok: false, error: 'Droit opérateur requis.' };
  }

  const texte = corps.trim();
  if (!texte) {
    return { ok: false, error: 'La réponse est vide.' };
  }

  try {
    await repondreAuFil(
      getPool(),
      organizationId,
      { threadId, corpsHtml: texteVersHtml(texte) },
      {
        graph: async (mailbox, messageId, corpsHtml) => {
          const config = await resolveGraphConfig(organizationId);
          if (!config) {
            throw new ErreurEntree("Microsoft Graph n'est pas configuré pour cette organisation.");
          }
          await repondreDansLaBoite(config, mailbox, messageId, corpsHtml);
        },
        salesblink: async (messageId, corpsHtml) => {
          const cle = await resolveSalesblinkKey(organizationId);
          if (!cle) {
            throw new ErreurEntree("SalesBlink n'est pas configuré pour cette organisation.");
          }
          return repondreDansLeFil(messageId, corpsHtml, cle);
        },
      },
    );
  } catch (err) {
    // Une seule règle, dans `lib/erreur-reponse` : message de l'opérateur pour
    // une `ErreurEntree`, texte propre à Microsoft pour un refus de la boîte,
    // générique sinon. Jamais le corps de réponse d'un fournisseur.
    return { ok: false, error: messageErreurReponse(err) };
  }

  revalidatePath('/inbox');
  return { ok: true };
}

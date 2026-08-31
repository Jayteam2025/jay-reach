'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { validateTemplateVariables } from '@jay-reach/core';

export type StepMessageResult = { ok: true; templateParentId: string } | { ok: false; error: string };
export type SimpleResult = { ok: true } | { ok: false; error: string };

/** Message écrit directement dans une étape de séquence. */
export interface StepMessageInput {
  /** Objet : email seulement. LinkedIn et courrier n'en ont pas. */
  readonly subject: string;
  readonly body: string;
  readonly channel: 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';
  readonly locale: string;
  /** Nature de la campagne, pour savoir quelles variables sont disponibles. */
  readonly nature: 'signal' | 'list';
  /** Modèle existant à réécrire, s'il y en a un. */
  readonly templateParentId: string | null;
}

/**
 * Enregistre le message d'une étape.
 *
 * Le message reste un `message_templates` : c'est lui qui porte le versionnage,
 * la résolution des variables et la validation, et une seconde façon de stocker
 * un corps aurait dupliqué tout ça. Il naît avec `origin = 'step'`, donc
 * invisible dans la bibliothèque — sinon chaque brouillon écrit dans une
 * campagne viendrait polluer une liste censée contenir des modèles qu'on
 * réutilise.
 *
 * Réécrire un message existant crée une VERSION plutôt que d'écraser : des
 * envois déjà partis pointent sur la version en cours, et les écraser ferait
 * mentir la mesure sur ce qui a réellement été envoyé.
 */
export async function saveStepMessage(
  organizationId: string,
  campaignId: string,
  input: StepMessageInput,
): Promise<StepMessageResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const corps = input.body.trim();
  if (!corps) {
    return { ok: false, error: 'Le message est vide.' };
  }
  if (input.channel === 'email' && !input.subject.trim()) {
    return { ok: false, error: 'Un email a besoin d’un objet.' };
  }

  // Une variable inconnue bloquerait l'envoi bien plus tard, au moment où le
  // message devait partir. On refuse ici, pendant qu'on l'écrit.
  const problemes = validateTemplateVariables(corps, input.nature);
  if (problemes.length > 0) {
    return { ok: false, error: problemes.map((p) => p.message).join(' ') };
  }

  const supabase = await createClient();

  // Une seule fonction de versionnage pour toute l'application : elle calcule
  // la version suivante, désactive l'active et insère la nouvelle d'un bloc.
  // Un index n'autorise qu'une version active par (famille, langue), et le
  // faire en deux écritures laisserait la famille sans version active entre les
  // deux — donc l'étape sans message si la seconde échouait.
  const { data: campagne } = await supabase
    .from('campaigns')
    .select('name')
    .eq('id', campaignId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  const { data, error } = await supabase.rpc('save_message_template_version', {
    p_org: organizationId,
    p_family: input.templateParentId,
    // Le nom reprend celui de la campagne : il n'a pas vocation à être choisi,
    // seulement à rester reconnaissable si on verse le message plus tard.
    p_name: (campagne as { name?: string } | null)?.name ?? 'Message',
    p_channel: input.channel,
    p_locale: input.locale,
    p_subject: input.channel === 'email' ? input.subject.trim() : null,
    p_body: corps,
    // Un message écrit dans une étape appartient à sa campagne. Une version
    // suivante hérite de l'origine de sa famille, donc réécrire un modèle de
    // bibliothèque ne le fait pas basculer.
    p_origin: 'step',
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath(`/campaigns/${campaignId}`);
  return { ok: true, templateParentId: input.templateParentId ?? String(data) };
}

/**
 * Verse dans la bibliothèque un message écrit dans une étape (retour 9.3).
 *
 * Le flux marche donc dans les deux sens : on pioche un modèle depuis la
 * séquence, et on y renvoie un message qui a fait ses preuves.
 */
export async function promoteStepMessage(
  organizationId: string,
  campaignId: string,
  templateParentId: string,
  name: string,
): Promise<SimpleResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const nom = name.trim();
  if (!nom) {
    return { ok: false, error: 'Donnez un nom au modèle.' };
  }

  const supabase = await createClient();
  // Toute la famille bascule : les versions d'un même modèle ne peuvent pas
  // être moitié dans la bibliothèque, moitié hors d'elle.
  const { error } = await supabase
    .from('message_templates')
    .update({ origin: 'library', name: nom })
    .eq('organization_id', organizationId)
    .or(`id.eq.${templateParentId},parent_id.eq.${templateParentId}`);
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath(`/campaigns/${campaignId}`);
  revalidatePath('/settings/templates');
  return { ok: true };
}

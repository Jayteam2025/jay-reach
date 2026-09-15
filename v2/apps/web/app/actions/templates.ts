'use server';

import { revalidatePath } from 'next/cache';
import {
  enregistrerVersionModele,
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  type CampaignNature,
} from '@jay-reach/core';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';
import { contexteCourant } from '../../lib/contexte';

/** Canaux qui portent un corps de message éditable. */
export type TemplateChannel = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter';

export interface TemplateVersionInput {
  /** Lignée existante à versionner, ou null/undefined pour créer une nouvelle famille. */
  readonly familyId?: string | null;
  readonly name: string;
  readonly channel: TemplateChannel;
  readonly locale: string;
  readonly subject?: string | null;
  readonly body: string;
  /** Nature de campagne visée : décide des variables disponibles à la validation. */
  readonly nature: CampaignNature;
}

export type TemplateSaveResult =
  | { ok: true; id: string }
  | { ok: false; error: string; issues?: string[] };

/**
 * Enregistre une NOUVELLE version d'un template (jamais en place, spec §7).
 * Façade fine sur `enregistrerVersionModele` (`packages/core/src/fonctions/sequence.ts`,
 * origin `library`) : validation des variables, versionnage (calcul de version,
 * désactivation de l'ancienne, insertion) et écriture désormais portés par
 * `Contexte`/`pg`, plus par la RPC `save_message_template_version` (qui
 * dépendait de `auth.uid()`, indisponible hors d'une requête Supabase
 * authentifiée — jamais depuis le futur serveur MCP).
 */
export async function saveTemplateVersion(
  organizationId: string,
  input: TemplateVersionInput,
): Promise<TemplateSaveResult> {
  try {
    const ctx = await contexteCourant();
    if (ctx.organisationId !== organizationId) {
      return { ok: false, error: 'Organisation invalide.' };
    }
    if (!input.name.trim()) return { ok: false, error: 'Nom requis.' };
    if (!input.body.trim()) return { ok: false, error: 'Message requis.' };

    const { id } = await enregistrerVersionModele(ctx, {
      familyId: input.familyId ?? null,
      nom: input.name.trim(),
      canal: input.channel,
      locale: input.locale,
      sujet: input.subject?.trim() ? input.subject.trim() : null,
      corps: input.body,
      nature: input.nature,
      origin: 'library',
    });
    revalidatePath('/settings/templates');
    return { ok: true, id };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'Droit administrateur requis.' };
    if (err instanceof ErreurEntree) {
      const details = err.details as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> };
      const issues = [...(details.formErrors ?? []), ...Object.values(details.fieldErrors ?? {}).flat()].filter(
        (m): m is string => typeof m === 'string',
      );
      return { ok: false, error: 'Variables invalides.', issues: issues.length > 0 ? issues : undefined };
    }
    if (err instanceof ErreurIntrouvable) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

/**
 * Retour arrière : réactive une version antérieure (désactive l'autre active).
 *
 * Hors périmètre de la tâche 12 (rollback de la bibliothèque, jamais appelée
 * par l'onglet Séquence) : laissée sur la RPC `activate_message_template_version`
 * (Supabase-js, `auth.uid()`) plutôt que migrée vers `Contexte`/`pg`, pour ne
 * pas élargir cette tâche à une fonctionnalité qu'elle ne touche pas.
 */
export async function activateTemplateVersion(
  organizationId: string,
  versionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc('activate_message_template_version', { p_id: versionId });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/templates');
  return { ok: true };
}

'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type SnippetResult = { ok: true } | { ok: false; error: string };

/**
 * Textes fixes réutilisables dans les messages : signature, mentions légales.
 *
 * Ce n'est pas une variable de personnalisation — la valeur ne dépend pas du
 * prospect. Mais elle se résout au même moment et s'écrit pareil,
 * `{{signature}}` comme `{{prenom}}` : imposer une seconde syntaxe à
 * l'opérateur n'aurait servi qu'à traduire une distinction technique.
 *
 * Résolu à l'ENVOI et non copié à la rédaction : changer un numéro de
 * téléphone met à jour tous les messages déjà écrits, ce qui est précisément
 * la raison d'être de la fonctionnalité.
 */
export interface SnippetInput {
  /** Le nom EST la variable. Minuscules, sans accent ni espace. */
  readonly name: string;
  readonly body: string;
}

/** Même forme qu'une variable, sinon l'extrait serait impossible à appeler. */
const NOM_VALIDE = /^[a-z][a-z0-9_]*$/;

export async function saveSnippet(
  organizationId: string,
  input: SnippetInput,
): Promise<SnippetResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const nom = input.name.trim().toLowerCase();
  if (!NOM_VALIDE.test(nom)) {
    return {
      ok: false,
      error: 'Le nom doit commencer par une lettre et ne contenir que des lettres, chiffres ou tirets bas.',
    };
  }
  if (input.body.trim() === '') {
    return { ok: false, error: 'Le texte ne peut pas être vide.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('message_snippets')
    .upsert(
      { organization_id: organizationId, name: nom, body: input.body, updated_at: new Date().toISOString() },
      { onConflict: 'organization_id,name' },
    );

  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/templates');
  return { ok: true };
}

export async function deleteSnippet(organizationId: string, name: string): Promise<SnippetResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const supabase = await createClient();

  // Un extrait encore appelé par un message laisserait ce message bloqué à
  // l'envoi, avec une variable que plus rien ne résout. On refuse plutôt que
  // de casser à distance.
  const { data: modeles } = await supabase
    .from('message_templates')
    .select('name, body')
    .eq('organization_id', organizationId);
  const motif = new RegExp(`\\{\\{\\s*${name}\\s*(\\|[^}]*)?\\}\\}`);
  const utilisateurs = ((modeles ?? []) as { name: string; body: string }[])
    .filter((m) => motif.test(m.body))
    .map((m) => m.name);
  if (utilisateurs.length > 0) {
    return {
      ok: false,
      error: `Encore utilisé par : ${[...new Set(utilisateurs)].join(', ')}. Retirez-le de ces messages d'abord.`,
    };
  }

  const { error } = await supabase
    .from('message_snippets')
    .delete()
    .eq('organization_id', organizationId)
    .eq('name', name);

  if (error) return { ok: false, error: error.message };
  revalidatePath('/settings/templates');
  return { ok: true };
}

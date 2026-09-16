'use server';

import { revalidatePath } from 'next/cache';

import { createHash, randomBytes } from 'node:crypto';
import { requireRole, getUser } from '../../lib/auth';
import { createServiceClient } from '../../lib/supabase/service';

/**
 * Réglages d'envoi LinkedIn.
 *
 * Le délai aléatoire entre deux actions n'y figure pas : il protège le compte,
 * et l'exposer inviterait à le réduire.
 */
export interface LinkedInSettings {
  /** Messages par semaine. Le plafond dur reste 200. */
  readonly weeklyCap: number;
  /** Jours d'envoi, 1 = lundi ... 7 = dimanche (ISO 8601). */
  readonly sendDays: number[];
  readonly sendFromHour: number;
  readonly sendToHour: number;
  /** Ce qui donne son sens aux heures ci-dessus. */
  readonly timezone: string;
}
export type TokenResult = { ok: true; token: string } | { ok: false; error: string };
export type SettingsResult = { ok: true } | { ok: false; error: string };

/**
 * Génère (ou régénère) un jeton d'extension pour l'organisation. Désactive les
 * jetons précédents de l'utilisateur pour cette org. Exige le rôle admin.
 * Le jeton est renvoyé une seule fois : la page le transmet à l'extension.
 */
export async function generateExtensionToken(organizationId: string): Promise<TokenResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  const user = await getUser();
  if (!user) {
    return { ok: false, error: 'Non authentifié.' };
  }

  // Le clair ne quitte cette fonction que pour l'extension : la base ne recoit
  // que son empreinte, et ne pourra donc jamais le redonner a personne.
  const token = `lkx_${randomBytes(24).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const service = createServiceClient();

  await service
    .from('extension_tokens')
    .update({ is_active: false })
    .eq('organization_id', organizationId)
    .eq('user_id', user.id);

  const { error } = await service.from('extension_tokens').insert({
    token_hash: tokenHash,
    organization_id: organizationId,
    user_id: user.id,
    label: 'Extension LinkedIn',
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/linkedin');
  return { ok: true, token };
}

/** Enregistre les réglages d'envoi. Exige le rôle admin. */
export async function saveLinkedInSettings(
  organizationId: string,
  settings: LinkedInSettings,
): Promise<SettingsResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const weekly = Math.max(0, Math.min(200, Math.round(settings.weeklyCap)));
  const jours = [...new Set(settings.sendDays)].filter((j) => Number.isInteger(j) && j >= 1 && j <= 7).sort();
  if (jours.length === 0) {
    return { ok: false, error: 'Choisissez au moins un jour d’envoi.' };
  }
  const debut = Math.max(0, Math.min(23, Math.round(settings.sendFromHour)));
  const fin = Math.max(1, Math.min(24, Math.round(settings.sendToHour)));
  if (fin <= debut) {
    // Une plage qui se termine avant de commencer n'enverrait jamais rien, et
    // l'écran n'aurait aucune raison de le dire.
    return { ok: false, error: 'L’heure de fin doit être postérieure à l’heure de début.' };
  }
  if (!estUnFuseauConnu(settings.timezone)) {
    return { ok: false, error: `Fuseau horaire inconnu : ${settings.timezone}` };
  }

  const service = createServiceClient();
  const { error } = await service.from('linkedin_settings').upsert(
    {
      organization_id: organizationId,
      weekly_cap: weekly,
      send_days: jours,
      send_from_hour: debut,
      send_to_hour: fin,
      timezone: settings.timezone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'organization_id' },
  );
  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/linkedin');
  return { ok: true };
}

/**
 * Un fuseau que l'environnement ne connaît pas ferait échouer tous les calculs
 * d'échéance plus tard, loin d'ici. On refuse à la saisie plutôt que d'écrire
 * une valeur qui cassera le séquenceur.
 */
function estUnFuseauConnu(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Réglages › Expéditeurs (tâche 20) — façade mince sur
// `packages/core/src/fonctions/expediteurs.ts` (spec « une fonction, deux
// façades »), pour la section « Comptes LinkedIn » de la nouvelle page.
// Cohabite avec `generateExtensionToken`/`saveLinkedInSettings` ci-dessus,
// qui restent au service de l'ancienne page `/settings/linkedin` (orpheline
// depuis que plus aucun lien n'y mène — nettoyage laissé à la tâche 24).
// ---------------------------------------------------------------------------
import {
  ErreurEntree,
  ErreurIntrouvable,
  ForbiddenError,
  listerComptesLinkedIn as listerComptesLinkedInCoeur,
  modifierCompteLinkedIn as modifierCompteLinkedInCoeur,
  type CompteLinkedIn,
} from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';

export type ResultatComptesLinkedIn<T = void> = { ok: true; valeur: T } | { ok: false; error: string };

function resultatDErreurLinkedIn<T>(err: unknown): ResultatComptesLinkedIn<T> {
  if (err instanceof ForbiddenError) {
    return { ok: false, error: 'Droit administrateur requis.' };
  }
  if (err instanceof ErreurEntree) {
    return { ok: false, error: 'Entrée invalide.' };
  }
  if (err instanceof ErreurIntrouvable) {
    return { ok: false, error: err.message };
  }
  return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
}

/** Comptes LinkedIn connectés (Réglages › Expéditeurs). */
export async function listerComptesLinkedInAction(): Promise<ResultatComptesLinkedIn<CompteLinkedIn[]>> {
  try {
    const ctx = await contexteCourant();
    const comptes = await listerComptesLinkedInCoeur(ctx);
    return { ok: true, valeur: comptes };
  } catch (err) {
    return resultatDErreurLinkedIn(err);
  }
}

/** Modifie un compte LinkedIn : activation du jeton visé, plafonds et fenêtre d'envoi partagés. */
export async function actionModifierCompteLinkedIn(entree: unknown): Promise<ResultatComptesLinkedIn> {
  try {
    const ctx = await contexteCourant();
    await modifierCompteLinkedInCoeur(ctx, entree);
    revalidatePath('/settings/senders');
    return { ok: true, valeur: undefined };
  } catch (err) {
    return resultatDErreurLinkedIn<void>(err);
  }
}

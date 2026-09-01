'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '../../lib/auth';
import { createClient } from '../../lib/supabase/server';

export type SenderActionResult = { ok: true } | { ok: false; error: string };

/**
 * Champs d'un expéditeur qu'un opérateur peut régler depuis l'application.
 *
 * L'identité (adresse email, identifiant LinkedIn) n'en fait pas partie : elle
 * vient du compte branché chez le provider. La changer ici ne changerait rien à
 * ce qui part réellement, et laisserait croire le contraire.
 */
export interface SenderInput {
  readonly displayName: string;
  /** Plafonds d'envoi. `null` = aucun plafond propre à cet expéditeur. */
  readonly dailyQuota: number | null;
  readonly hourlyQuota: number | null;
  readonly isActive: boolean;
  /**
   * Fenêtre d'envoi : heures pleines de début et de fin, et jours ISO
   * (1 = lundi … 7 = dimanche).
   *
   * Le séquenceur lit ces valeurs depuis toujours et se rabat sur 9 h - 18 h du
   * lundi au vendredi quand elles manquent. Aucun écran ne les écrivait : il
   * fallait passer par la base pour décaler un envoi d'une heure.
   */
  readonly startHour: number;
  readonly endHour: number;
  readonly days: number[];
  readonly timezone: string;
}

/** Ce qu'il faut pour faire naître un expéditeur, en plus de ses réglages. */
export interface NouvelExpediteur extends SenderInput {
  readonly kind: 'email' | 'linkedin';
  /**
   * Adresse d'envoi ou identifiant LinkedIn. Fixée à la création et jamais
   * modifiable ensuite : elle désigne le compte branché chez le provider, et la
   * changer après coup laisserait croire qu'on a changé ce qui part.
   */
  readonly identity: string;
}

/**
 * Fenêtre d'envoi valide ?
 *
 * Une fenêtre vide (aucun jour, ou fin avant début) n'est pas un réglage
 * restrictif : c'est un expéditeur qui n'enverra jamais rien, sans rien dire.
 */
function verifierFenetre(input: SenderInput): string | null {
  if (!Number.isInteger(input.startHour) || input.startHour < 0 || input.startHour > 23) {
    return 'L’heure de début doit être comprise entre 0 h et 23 h.';
  }
  if (!Number.isInteger(input.endHour) || input.endHour < 1 || input.endHour > 24) {
    return 'L’heure de fin doit être comprise entre 1 h et 24 h.';
  }
  if (input.endHour <= input.startHour) {
    return 'L’heure de fin doit venir après l’heure de début.';
  }
  if (input.days.length === 0) {
    return 'Choisissez au moins un jour d’envoi.';
  }
  if (input.days.some((j) => !Number.isInteger(j) || j < 1 || j > 7)) {
    return 'Jours d’envoi invalides.';
  }
  return null;
}

function normaliserQuota(valeur: number | null): number | null | 'invalide' {
  if (valeur === null) {
    return null;
  }
  if (!Number.isInteger(valeur) || valeur < 0) {
    return 'invalide';
  }
  return valeur;
}

/** Met à jour un expéditeur de l'organisation (droit administrateur requis). */
export async function updateSender(
  organizationId: string,
  senderId: string,
  input: SenderInput,
): Promise<SenderActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const quotidien = normaliserQuota(input.dailyQuota);
  const horaire = normaliserQuota(input.hourlyQuota);
  if (quotidien === 'invalide' || horaire === 'invalide') {
    return { ok: false, error: 'Les plafonds doivent être des entiers positifs.' };
  }
  const fenetreInvalide = verifierFenetre(input);
  if (fenetreInvalide) {
    return { ok: false, error: fenetreInvalide };
  }
  if (quotidien !== null && horaire !== null && horaire > quotidien) {
    // Un plafond horaire au-dessus du quotidien ne veut rien dire : le
    // séquenceur retient le plus contraignant, donc l'horaire serait ignoré
    // sans que personne ne s'en aperçoive.
    return { ok: false, error: 'Le plafond horaire ne peut pas dépasser le plafond quotidien.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('senders')
    .update({
      display_name: input.displayName.trim() || null,
      daily_quota: quotidien,
      hourly_quota: horaire,
      is_active: input.isActive,
      business_hours: { startHour: input.startHour, endHour: input.endHour, days: [...input.days].sort() },
      timezone: input.timezone,
    })
    .eq('id', senderId)
    .eq('organization_id', organizationId);

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/senders');
  return { ok: true };
}

/**
 * Crée un expéditeur pour l'organisation (droit administrateur requis).
 *
 * Jusqu'ici l'application savait lister et modifier des expéditeurs, jamais en
 * créer : le jeu d'amorçage n'en pose que pour l'organisation de démonstration.
 * Une instance neuve n'en avait donc aucun, et chaque inscription se mettait en
 * pause dès sa première étape — avec un simple avertissement dans le journal,
 * que personne ne lit.
 */
export async function createSender(
  organizationId: string,
  input: NouvelExpediteur,
): Promise<SenderActionResult> {
  try {
    await requireRole(organizationId, 'admin');
  } catch {
    return { ok: false, error: 'Droit administrateur requis.' };
  }

  const identite = input.identity.trim();
  if (!identite) {
    return { ok: false, error: 'Renseignez l’adresse d’envoi ou l’identifiant LinkedIn.' };
  }
  // Une adresse mal formée ne se voit qu'au premier envoi raté, une fois la
  // séquence lancée. Le contrôle est volontairement simple : c'est le provider
  // qui fait autorité, on écarte seulement ce qui ne peut pas être une adresse.
  if (input.kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identite)) {
    return { ok: false, error: 'Cette adresse d’envoi n’est pas valide.' };
  }

  const quotidien = normaliserQuota(input.dailyQuota);
  const horaire = normaliserQuota(input.hourlyQuota);
  if (quotidien === 'invalide' || horaire === 'invalide') {
    return { ok: false, error: 'Les plafonds doivent être des entiers positifs.' };
  }
  if (quotidien !== null && horaire !== null && horaire > quotidien) {
    return { ok: false, error: 'Le plafond horaire ne peut pas dépasser le plafond quotidien.' };
  }
  const fenetreInvalide = verifierFenetre(input);
  if (fenetreInvalide) {
    return { ok: false, error: fenetreInvalide };
  }

  const supabase = await createClient();

  // Deux expéditeurs sur la même identité enverraient chacun leur part sans
  // connaître les envois de l'autre : les plafonds seraient tenus deux fois,
  // et le compte réel les dépasserait. La base porte déjà trois exemplaires
  // dont deux identiques, créés par script.
  const { data: deja } = await supabase
    .from('senders')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('kind', input.kind)
    .ilike('identity', identite)
    .limit(1);
  if ((deja ?? []).length > 0) {
    return { ok: false, error: 'Un expéditeur utilise déjà cette identité.' };
  }

  const { error } = await supabase.from('senders').insert({
    organization_id: organizationId,
    kind: input.kind,
    identity: identite,
    display_name: input.displayName.trim() || null,
    daily_quota: quotidien,
    hourly_quota: horaire,
    is_active: input.isActive,
    business_hours: { startHour: input.startHour, endHour: input.endHour, days: [...input.days].sort() },
    timezone: input.timezone,
  });

  if (error) {
    return { ok: false, error: error.message };
  }
  revalidatePath('/settings/senders');
  return { ok: true };
}

/**
 * Heures d'envoi LinkedIn de l'organisation : la fenêtre, les jours actifs et le
 * fuseau dans lesquels le moteur s'autorise à envoyer (`linkedin_settings`).
 *
 * Pourquoi ce fichier plutôt que `modifierCompteLinkedIn` (`fonctions/expediteurs.ts`),
 * qui écrit déjà les mêmes colonnes : cette fonction-là part d'un `compteId`, c'est
 * à dire d'un jeton d'extension (`extension_tokens.user_id`), et synchronise une
 * ligne `senders`. Sur une instance dont le canal LinkedIn est tenu par la session
 * du serveur, il n'existe ni jeton d'extension ni ligne `senders` : son écran
 * n'affiche aucune carte, et le réglage devenait inatteignable. Le volume d'envoi,
 * lui, se règle par `organization_settings` (`linkedin_invitations_par_semaine`,
 * `linkedin_messages_par_semaine`) comme les autres plafonds du produit.
 *
 * Les colonnes de plafond de `linkedin_settings` ne sont volontairement PAS
 * touchées ici : deux endroits qui écrivent le même réglage, c'est deux vérités.
 */
import { z } from 'zod';
import type { Contexte } from '../fonctions/contexte.js';
import { exiger, valider } from '../fonctions/contexte.js';

/**
 * Fenêtre d'envoi par défaut, celle des colonnes de `linkedin_settings` : une
 * organisation qui n'a jamais rien réglé envoie de 9 h à 18 h, du lundi au
 * vendredi, heure de Paris.
 */
export const HEURES_ENVOI_LINKEDIN_PAR_DEFAUT = {
  debutHeure: 9,
  finHeure: 18,
  jours: [1, 2, 3, 4, 5],
  fuseau: 'Europe/Paris',
} as const;

/**
 * Heures pleines : la base ne stocke que des heures entières (`send_from_hour`,
 * `send_to_hour`), et l'écran ne propose que des heures pleines. `finHeure` va
 * jusqu'à 24 (minuit du jour suivant), `debutHeure` s'arrête à 23.
 */
export const schemaHeuresEnvoiLinkedIn = z.object({
  debutHeure: z.number().int().min(0).max(23),
  finHeure: z.number().int().min(1).max(24),
  jours: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  fuseau: z.string().min(1).max(64),
});

export type HeuresEnvoiLinkedIn = z.infer<typeof schemaHeuresEnvoiLinkedIn>;

/**
 * Lit les heures d'envoi de l'organisation. Rend les valeurs par défaut quand
 * aucune ligne n'existe — le cas d'une instance neuve — et JAMAIS `null` : un
 * écran qui afficherait des champs vides laisserait croire qu'aucune fenêtre ne
 * s'applique, alors que le moteur, lui, applique bien une fenêtre.
 */
export async function lireHeuresEnvoiLinkedIn(ctx: Contexte): Promise<HeuresEnvoiLinkedIn> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<{
    send_from_hour: number;
    send_to_hour: number;
    send_days: number[];
    timezone: string;
  }>(
    `select send_from_hour, send_to_hour, send_days, timezone
       from linkedin_settings /* jr:linkedin_heures_envoi_lire */
      where organization_id = $1`,
    [ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) return { ...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT, jours: [...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.jours] };
  const jours = [...ligne.send_days].filter((j) => j >= 1 && j <= 7).sort((a, b) => a - b);
  return {
    debutHeure: ligne.send_from_hour,
    finHeure: ligne.send_to_hour,
    jours: jours.length > 0 ? jours : [...HEURES_ENVOI_LINKEDIN_PAR_DEFAUT.jours],
    fuseau: ligne.timezone,
  };
}

/**
 * Enregistre les heures d'envoi (droit administrateur). N'écrit que les quatre
 * colonnes de fenêtre : les plafonds gardés par `linkedin_settings` restent à
 * leur valeur, puisque le pacing ne les lit plus.
 */
export async function enregistrerHeuresEnvoiLinkedIn(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const e = valider(schemaHeuresEnvoiLinkedIn, entree);

  if (e.finHeure <= e.debutHeure) {
    throw new Error("L'heure de fin doit venir après l'heure de début.");
  }

  const jours = [...new Set(e.jours)].sort((a, b) => a - b);

  await ctx.ex.query(
    `insert into linkedin_settings /* jr:linkedin_heures_envoi_ecrire */
       (organization_id, send_from_hour, send_to_hour, send_days, timezone, updated_at)
     values ($1, $2, $3, $4, $5, now())
     on conflict (organization_id) do update
       set send_from_hour = excluded.send_from_hour,
           send_to_hour = excluded.send_to_hour,
           send_days = excluded.send_days,
           timezone = excluded.timezone,
           updated_at = now()`,
    [ctx.organisationId, e.debutHeure, e.finHeure, jours, e.fuseau],
  );
}

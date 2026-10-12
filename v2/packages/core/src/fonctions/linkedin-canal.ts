/**
 * Le canal chiffré de la connexion LinkedIn (lot 5, spec §5 et §7).
 *
 * Le mot de passe ne touche JAMAIS la base : il part de la server action en `pg_notify`
 * sur `jr_linkedin_connexion`, chiffré en AES-GCM par la clé d'instance, et seul le
 * worker (qui écoute) le déchiffre. Si le worker est éteint, le message se perd : voulu.
 *
 * Aucune erreur de ce fichier ne porte la charge, le clair ou la clé (`ErreurChiffrement`
 * se signale par son `code`).
 */
import { z } from 'zod';
import { chiffrer, dechiffrer, ErreurChiffrement } from '../chiffrement.js';
import type { Contexte } from './contexte.js';

export const CANAL_CONNEXION_LINKEDIN = 'jr_linkedin_connexion';

const base = { demandeId: z.string().min(1), organizationId: z.string().min(1) };

export const schemaMessageConnexion = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('secrets'), identifiant: z.string().min(1), motDePasse: z.string().min(1) }),
  z.object({ ...base, type: z.literal('code'), code: z.string().min(1) }),
  z.object({ ...base, type: z.literal('deconnexion') }),
]);

export type MessageConnexion = z.infer<typeof schemaMessageConnexion>;

/** Valide, chiffre, puis émet. Une entrée invalide lève sans rien émettre. */
export async function emettreMessageConnexion(ctx: Contexte, message: MessageConnexion): Promise<void> {
  const valide = schemaMessageConnexion.parse(message);
  const charge = await chiffrer(JSON.stringify(valide));
  await ctx.ex.query('select pg_notify($1, $2) /* jr:connexion_linkedin */', [CANAL_CONNEXION_LINKEDIN, charge]);
}

/**
 * Déchiffre et valide une charge reçue. Toute anomalie (clé différente, charge altérée,
 * JSON ou forme inattendus) lève `ErreurChiffrement('charge_illisible')`, sans détail.
 */
export async function lireMessageConnexion(charge: string): Promise<MessageConnexion> {
  const clair = await dechiffrer(charge);
  let brut: unknown;
  try {
    brut = JSON.parse(clair);
  } catch {
    throw new ErreurChiffrement('charge_illisible');
  }
  const resultat = schemaMessageConnexion.safeParse(brut);
  if (!resultat.success) throw new ErreurChiffrement('charge_illisible');
  return resultat.data;
}

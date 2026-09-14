/**
 * Contexte métier de la requête courante (spec « une fonction, deux façades ») :
 * utilisateur authentifié, organisation courante, rôle, accès base. Toute
 * fonction de `packages/core/src/fonctions` reçoit ce `Contexte` — jamais un
 * client Supabase ni une session directement.
 */
import { cache } from 'react';
import { cookies } from 'next/headers';
import type { Contexte } from '@jay-reach/core';
import { requireUser, getMembershipRole } from './auth';
import { getPool } from './db';

/** Cookie qui tranche quand l'utilisateur appartient à plusieurs organisations. */
const COOKIE_ORGANISATION = 'jr-org';

interface LigneAdhesion {
  organization_id: string;
}

/**
 * Contexte courant, mémoïsé pour la durée du rendu (une requête RSC peut
 * l'appeler depuis la coquille ET depuis la page sans relire deux fois la
 * base).
 *
 * Organisation : la seule adhésion de l'utilisateur ; s'il en a plusieurs, le
 * cookie `jr-org` tranche s'il pointe vers l'une d'elles, sinon la première
 * par nom.
 */
export const contexteCourant = cache(async (): Promise<Contexte> => {
  const utilisateur = await requireUser();
  const pool = getPool();

  const { rows } = await pool.query<LigneAdhesion>(
    `select m.organization_id
       from memberships m
       join organizations o on o.id = m.organization_id
      where m.user_id = $1
      order by o.name asc`,
    [utilisateur.id],
  );
  if (rows.length === 0) {
    // Modèle standalone mono-opérateur (docs racine) : une instance sans
    // aucune organisation créée pour son unique utilisateur est une instance
    // mal installée, pas un cas à faire passer silencieusement pour un
    // contexte vide (les requêtes suivantes comparant `organization_id` à une
    // chaîne vide échoueraient de toute façon, en uuid, avec un message opaque).
    throw new Error("Aucune organisation associée à cet utilisateur.");
  }

  let organisationId = rows[0]!.organization_id;
  if (rows.length > 1) {
    const cookieStore = await cookies();
    const choisie = cookieStore.get(COOKIE_ORGANISATION)?.value;
    if (choisie && rows.some((r) => r.organization_id === choisie)) {
      organisationId = choisie;
    }
  }

  const role = await getMembershipRole(organisationId);
  return { ex: pool, organisationId, utilisateurId: utilisateur.id, role };
});

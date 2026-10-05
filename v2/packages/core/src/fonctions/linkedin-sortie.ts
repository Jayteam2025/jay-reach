/**
 * Contrôle de l'IP de sortie du navigateur LinkedIn (lot 4a).
 *
 * Aucun appel réseau ici : la relève est injectée. Elle doit être exécutée PAR
 * le navigateur (tâche 3), jamais par le worker, dont l'IP publique est celle du
 * VPS : mesurée depuis le worker, l'IP vue égalerait l'IP attendue figée à la
 * première connexion et le contrôle dirait « conforme » à chaque passage.
 */
import type { Contexte } from './contexte.js';
import { bloquerSessionLinkedIn } from './linkedin-session.js';

export type Sortie = { ip: string; operateur?: string; pays?: string };

/**
 * Compare la sortie observée à l'IP attendue et bloque la session si elles
 * diffèrent. Seule l'égalité des IP décide ; l'opérateur et le pays sont
 * informatifs. Sans IP attendue (première connexion), rien à comparer : ok.
 *
 * Si la relève échoue, la sortie n'est pas prouvée : la session est bloquée
 * (motif `sortie_inattendue`) et l'erreur rendue est générique. L'erreur
 * d'origine peut porter l'URL du proxy avec ses identifiants : elle n'est ni
 * consignée ni chaînée en `cause`.
 */
export async function verifierSortie(
  ctx: Contexte,
  attendue: string | null,
  releve: () => Promise<Sortie>,
): Promise<{ ok: boolean; sortie: Sortie }> {
  let sortie: Sortie;
  try {
    sortie = await releve();
  } catch {
    await bloquerSessionLinkedIn(ctx, 'sortie_inattendue');
    throw new Error('Relève de la sortie LinkedIn impossible');
  }
  const ok = attendue === null || sortie.ip === attendue;
  if (!ok) await bloquerSessionLinkedIn(ctx, 'sortie_inattendue');
  return { ok, sortie };
}

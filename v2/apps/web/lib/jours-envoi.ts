/**
 * Libellé compact des jours d'envoi d'un expéditeur (Réglages › Expéditeurs,
 * tâche 20) : « lundi à vendredi » et « tous les jours » sont les deux cas
 * réels du produit (défauts spec §7, boîtes et comptes LinkedIn) — une liste
 * simple couvre tout le reste sans un algorithme de compression de plages
 * qu'aucun réglage actuel n'exercerait.
 */
const NOMS_JOURS: Record<number, string> = {
  1: 'lundi',
  2: 'mardi',
  3: 'mercredi',
  4: 'jeudi',
  5: 'vendredi',
  6: 'samedi',
  7: 'dimanche',
};

export function libelleJoursEnvoi(jours: readonly number[]): string {
  const tries = [...jours].sort((a, b) => a - b);
  if (tries.length === 7) return 'tous les jours';
  if (tries.length === 5 && tries.every((j, i) => j === i + 1)) return 'lundi à vendredi';
  return tries.map((j) => NOMS_JOURS[j] ?? '?').join(', ');
}

/**
 * Type `Persona` partagé par Réglages › Personas (`persona-board.tsx`).
 *
 * Ce module s'appelait à l'origine `sample-personas.ts` et portait aussi des
 * personas de démonstration pour les écrans d'avant la refonte — retirées à
 * la tâche 24 avec ces écrans, `Persona` restant le seul export en usage.
 */
export interface Persona {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly title_patterns: string[];
  readonly title_exclusions: string[];
  readonly seniority: string | null;
  readonly scoring_prompt: string | null;
  readonly is_active: boolean;
}

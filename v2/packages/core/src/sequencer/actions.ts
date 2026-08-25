/**
 * Génération d'actions au tick + idempotence. Un tick rejoué ne doit jamais
 * créer deux actions pour la même (inscription, étape). Pur.
 */

/** Clé d'idempotence stable d'une action. */
export function actionIdempotencyKey(enrollmentId: string, stepId: string, attempt = 0): string {
  return `${enrollmentId}:${stepId}:${attempt}`;
}

/** Filtre les actions dont la clé existe déjà (rejeu de tick). */
export function dedupeActions<T extends { readonly idempotencyKey: string }>(
  existingKeys: readonly string[],
  candidates: readonly T[],
): T[] {
  const seen = new Set(existingKeys);
  const out: T[] = [];
  for (const candidate of candidates) {
    if (!seen.has(candidate.idempotencyKey)) {
      seen.add(candidate.idempotencyKey);
      out.push(candidate);
    }
  }
  return out;
}

export function isCallStep(channel: string): boolean {
  return channel === 'call';
}

/**
 * Résultat d'appel `callback` : décale TOUTES les étapes suivantes de la même
 * durée (pas seulement la prochaine).
 */
export function shiftRemainingSteps<T extends { readonly scheduledFor: number }>(
  steps: readonly T[],
  shiftMs: number,
): T[] {
  return steps.map((step) => ({ ...step, scheduledFor: step.scheduledFor + shiftMs }));
}

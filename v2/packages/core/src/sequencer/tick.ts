/**
 * Composition pure d'un « tick » de séquence pour UNE inscription due.
 * Décide l'action à émettre pour l'étape courante et le nouvel état de
 * l'inscription. Aucune I/O : le worker fournit les données (étapes,
 * suppression, approbation) et applique le résultat en base.
 *
 * S'appuie sur les helpers purs existants (`actionIdempotencyKey`, machine à
 * états). Le pacing d'envoi LinkedIn reste appliqué en aval (file + serveur).
 */
import { actionIdempotencyKey } from './actions.js';
import type { EnrollmentStatus } from './state-machine.js';

/** Canaux tels que stockés en base (`channel_kind`). */
export type TickChannel = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';

/** Statut d'action à la création (sous-ensemble de `action_status`). */
export type EmitStatus = 'scheduled' | 'pending_approval' | 'blocked';

export interface TickStep {
  readonly id: string;
  readonly channel: TickChannel;
  readonly delayHours: number;
}

export interface ComposeTickInput {
  readonly now: number;
  readonly enrollmentId: string;
  readonly currentStep: number;
  /** Étapes de la campagne, triées par position croissante. */
  readonly steps: readonly TickStep[];
  /** Une suppression active couvre ce contact (email/domaine/linkedin/compte). */
  readonly suppressed: boolean;
  /** L'étape requiert une validation humaine (courrier, mode manuel, politique). */
  readonly requiresApproval: boolean;
  /** Le canal est envoyable (ex. URL LinkedIn présente). Sinon → bloqué. */
  readonly sendable: boolean;
}

export interface EmittedAction {
  readonly idempotencyKey: string;
  readonly stepId: string;
  readonly channel: TickChannel;
  readonly scheduledForMs: number;
  readonly status: EmitStatus;
  readonly blockReason?: string;
}

export interface ComposeTickResult {
  /** Action à insérer (idempotente), ou null si plus rien à faire. */
  readonly action: EmittedAction | null;
  readonly nextStatus: EnrollmentStatus;
  readonly nextStep: number;
  readonly nextActionAtMs: number | null;
  readonly stopReason: string | null;
  /** Faut-il enfiler un job d'envoi (`actions.dispatch`) ? */
  readonly dispatch: boolean;
}

/**
 * Décide l'action de l'étape courante et l'avancement de l'inscription.
 * - Étapes épuisées → `completed`.
 * - Suppression active → action `blocked`, inscription `stopped`.
 * - Canal non envoyable → action `blocked`, inscription `stopped`.
 * - Validation requise → action `pending_approval`, on N'AVANCE PAS (attente
 *   humaine ; `next_action_at` remis à null jusqu'à approbation).
 * - Sinon → action `scheduled`, on avance ; `dispatch = true`.
 */
export function composeTick(input: ComposeTickInput): ComposeTickResult {
  const { now, enrollmentId, currentStep, steps } = input;

  if (currentStep >= steps.length) {
    return { action: null, nextStatus: 'completed', nextStep: currentStep, nextActionAtMs: null, stopReason: null, dispatch: false };
  }

  const step = steps[currentStep]!;
  const isLast = currentStep === steps.length - 1;
  const idempotencyKey = actionIdempotencyKey(enrollmentId, step.id);
  const base = { idempotencyKey, stepId: step.id, channel: step.channel, scheduledForMs: now } as const;

  if (input.suppressed) {
    return {
      action: { ...base, status: 'blocked', blockReason: 'suppression' },
      nextStatus: 'stopped',
      nextStep: currentStep,
      nextActionAtMs: null,
      stopReason: 'suppression',
      dispatch: false,
    };
  }

  if (!input.sendable) {
    return {
      action: { ...base, status: 'blocked', blockReason: 'not_sendable' },
      nextStatus: 'stopped',
      nextStep: currentStep,
      nextActionAtMs: null,
      stopReason: 'not_sendable',
      dispatch: false,
    };
  }

  if (input.requiresApproval) {
    // File d'attente : on garde l'étape courante, en attente de validation.
    return {
      action: { ...base, status: 'pending_approval' },
      nextStatus: 'active',
      nextStep: currentStep,
      nextActionAtMs: null,
      stopReason: null,
      dispatch: false,
    };
  }

  const nextStep = currentStep + 1;
  const nextActionAtMs = isLast ? null : now + (steps[nextStep]?.delayHours ?? 0) * 3_600_000;
  return {
    action: { ...base, status: 'scheduled' },
    nextStatus: isLast ? 'completed' : 'active',
    nextStep,
    nextActionAtMs,
    stopReason: null,
    dispatch: true,
  };
}

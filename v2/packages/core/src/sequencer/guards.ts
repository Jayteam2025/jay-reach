/**
 * Garde-fous transverses (docs/04). Appelés avant tout dispatch, dans l'ordre.
 * Chaque garde-fou renvoie une décision EXPLICITE : `allow`, `defer` (avec date)
 * ou `block` (avec motif) — jamais un booléen : on veut savoir pourquoi.
 */

export type GuardDecision =
  | { readonly kind: 'allow' }
  | { readonly kind: 'defer'; readonly until: number; readonly reason: string }
  | { readonly kind: 'block'; readonly reason: string };

export const ALLOW: GuardDecision = { kind: 'allow' };
export function block(reason: string): GuardDecision {
  return { kind: 'block', reason };
}
export function defer(until: number, reason: string): GuardDecision {
  return { kind: 'defer', until, reason };
}

export interface GuardContext {
  readonly channel: string;
  readonly now: number;
  /** Suppression active (email/domaine/linkedin/postal/account, client, opposition légale). */
  readonly suppression?: { scope: string; reason: string } | null;
  /** Un autre contact du même compte a déjà été touché aujourd'hui. */
  readonly accountContactedToday?: boolean;
  readonly nextAccountSlot?: number;
  /** Variables du message non résolues (bloque et les nomme). */
  readonly unresolvedVariables?: readonly string[];
  /** Courrier : adresse postale vérifiée ? */
  readonly postalVerified?: boolean;
  /** Quota du sender restant (0 → report). */
  readonly quotaRemaining?: number;
  readonly quotaResetAt?: number;
  /** Hors fenêtre horaire → prochain créneau (ms), sinon null/undefined. */
  readonly businessHoursNextSlot?: number | null;
  /** L'action ferait franchir le plafond de dépense. */
  readonly spendWouldExceed?: boolean;
  /** Interrupteur d'arrêt global de l'organisation. */
  readonly killSwitch?: boolean;
}

/**
 * Exécute les garde-fous dans l'ordre et renvoie la PREMIÈRE décision non-allow.
 * Une étape `call` n'envoie rien : ni quota, ni fenêtre d'envoi, ni suppression d'envoi.
 */
export function runGuards(ctx: GuardContext): GuardDecision {
  // 9. Interrupteur d'arrêt global — prioritaire.
  if (ctx.killSwitch) {
    return block('Arrêt global de l’organisation activé.');
  }

  // 1. Liste de suppression (y compris client & opposition légale).
  if (ctx.suppression) {
    return block(ctx.suppression.reason);
  }

  const isCall = ctx.channel === 'call';

  // 3. Un contact par compte et par jour.
  if (!isCall && ctx.accountContactedToday) {
    return defer(ctx.nextAccountSlot ?? ctx.now, 'Un contact de ce compte a déjà été touché aujourd’hui.');
  }

  // 4. Variables toutes résolues.
  if (ctx.unresolvedVariables && ctx.unresolvedVariables.length > 0) {
    return block(`Variable(s) non résolue(s) : ${ctx.unresolvedVariables.join(', ')}.`);
  }

  // 5. Adresse postale vérifiée (courrier uniquement).
  if (ctx.channel === 'letter' && ctx.postalVerified !== true) {
    return block('Adresse postale non vérifiée pour ce compte.');
  }

  // Les gardes d'ENVOI ne s'appliquent pas au canal `call`.
  if (!isCall) {
    // 8. Plafond de dépense.
    if (ctx.spendWouldExceed) {
      return block('Plafond de dépense mensuel atteint.');
    }
    // 6. Quotas du sender.
    if (ctx.quotaRemaining !== undefined && ctx.quotaRemaining <= 0) {
      return defer(ctx.quotaResetAt ?? ctx.now, 'Quota du sender atteint, report au prochain créneau.');
    }
    // 7. Fenêtre horaire.
    if (ctx.businessHoursNextSlot != null) {
      return defer(ctx.businessHoursNextSlot, 'Hors fenêtre horaire, report à la prochaine fenêtre ouvrée.');
    }
  }

  return ALLOW;
}

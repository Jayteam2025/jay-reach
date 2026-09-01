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
  /**
   * Une personne de CETTE persona a déjà été touchée aujourd'hui chez ce compte.
   *
   * La règle regardait le compte seul, sans distinguer la personne : dès que le
   * directeur commercial recevait quelque chose, tous les commerciaux de la
   * même entreprise étaient repoussés au lendemain. Comme une campagne touche
   * son compte presque chaque jour pendant deux semaines, la seconde campagne
   * glissait indéfiniment sans jamais partir.
   */
  readonly personaContactedToday?: boolean;
  readonly nextAccountSlot?: number;
  /**
   * Personnes distinctes déjà touchées aujourd'hui chez ce compte, et combien
   * on en admet.
   *
   * C'est ce couple qui conserve la protection d'origine : sur les données
   * réelles, une entreprise publiant huit offres générait huit messages le même
   * jour. Distinguer les personas sans plafonner le total aurait rouvert cette
   * porte.
   */
  readonly accountPeopleToday?: number;
  readonly accountPeopleCap?: number;
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

  // 3. Une personne par persona et par jour, et pas plus de N personnes par
  //    entreprise le même jour.
  if (!isCall && ctx.personaContactedToday) {
    return defer(ctx.nextAccountSlot ?? ctx.now, 'Cette persona a déjà été touchée aujourd’hui chez ce compte.');
  }
  if (
    !isCall &&
    ctx.accountPeopleCap !== undefined &&
    (ctx.accountPeopleToday ?? 0) >= ctx.accountPeopleCap
  ) {
    return defer(
      ctx.nextAccountSlot ?? ctx.now,
      `Déjà ${ctx.accountPeopleCap} personne(s) touchée(s) dans cette entreprise aujourd’hui.`,
    );
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

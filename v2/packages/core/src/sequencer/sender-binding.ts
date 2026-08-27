/**
 * Attribution et liaison des expéditeurs (docs/04). Un contact est lié à un
 * sender à sa première action et CONSERVE ce lien à vie. Si le sender lié
 * devient inactif, l'inscription est mise en pause — jamais réattribuée en silence.
 */
export interface SenderInfo {
  readonly id: string;
  readonly kind: string;
  readonly isActive: boolean;
  readonly usedToday: number;
}

export interface Binding {
  readonly contactId: string;
  readonly senderId: string;
  /**
   * Type de l'expéditeur lié. Le lien vaut POUR UN CANAL : une séquence
   * multicanale touche le même contact par email puis par LinkedIn, et le lien
   * email ne doit pas répondre pour une étape LinkedIn.
   */
  readonly kind: string;
}

export interface SenderResolution {
  readonly senderId: string | null;
  readonly newBinding: boolean;
  /** true → mettre l'inscription en pause (sender lié inactif ou aucun dispo). */
  readonly paused: boolean;
}

export function resolveSender(
  contactId: string,
  kind: string,
  senders: readonly SenderInfo[],
  bindings: readonly Binding[],
): SenderResolution {
  // Le lien recherché est celui de CE canal : un contact peut être lié à un
  // expéditeur email et à un expéditeur LinkedIn, chacun à vie de son côté.
  const existing = bindings.find((b) => b.contactId === contactId && b.kind === kind);
  if (existing) {
    const bound = senders.find((s) => s.id === existing.senderId);
    if (bound && bound.isActive) {
      return { senderId: bound.id, newBinding: false, paused: false };
    }
    // Sender lié inactif : on met en pause, on ne réattribue pas.
    return { senderId: null, newBinding: false, paused: true };
  }

  // Première action : le sender actif du bon type ayant la plus faible conso du jour.
  const candidates = senders
    .filter((s) => s.kind === kind && s.isActive)
    .sort((a, b) => a.usedToday - b.usedToday);
  const chosen = candidates[0];
  if (!chosen) {
    return { senderId: null, newBinding: false, paused: true };
  }
  return { senderId: chosen.id, newBinding: true, paused: false };
}

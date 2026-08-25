/**
 * Types de domaine — squelette (T1).
 * Le détail canonique vit dans `docs/02-data-model.md` ; ces types seront
 * complétés et générés (Supabase) au fil des tickets. Aucun SDK externe ici.
 */

export type ChannelKind = 'email' | 'linkedin' | 'mail';
export type SignalKind = 'job_posting' | 'appointment' | 'tradeshow';

export interface RawSignal {
  readonly externalId: string;
  readonly raw: unknown;
}

export interface Signal {
  readonly externalId: string;
  readonly kind: SignalKind;
  readonly occurredAt: string;
  readonly companyHint?: string;
  readonly title?: string;
  readonly url?: string;
}

export interface RunContext {
  readonly organizationId: string;
  readonly cursor?: unknown;
}

export interface Outcome {
  readonly type: string;
  readonly occurredAt: string;
  readonly raw?: unknown;
}

export interface OutboundAction {
  readonly id: string;
  readonly channel: ChannelKind;
  readonly payload: unknown;
}

export interface DispatchResult {
  readonly providerRef?: string;
  readonly costEur?: number;
}

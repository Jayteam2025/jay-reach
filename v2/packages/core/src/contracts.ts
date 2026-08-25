/**
 * Les sept interfaces de providers (docs/01-architecture.md).
 * Le cœur ne connaît QUE des interfaces ; toute implémentation vit dans
 * `packages/providers/*`. Squelette T1 : signatures posées, corps à venir.
 */
import type {
  ChannelKind,
  DispatchResult,
  OutboundAction,
  Outcome,
  RawSignal,
  RunContext,
  Signal,
} from './types.js';

/** Schéma de validation (Zod, injecté par l'implémentation). */
export type ConfigSchema = unknown;

export interface SignalProvider {
  readonly id: string;
  readonly labelKey: string;
  readonly configSchema: ConfigSchema;
  readonly freshnessWindowDays: number;
  discover(ctx: RunContext): AsyncIterable<RawSignal>;
  /** Pur, testable, sans I/O. */
  normalize(raw: RawSignal): Signal;
}

export type EnrichmentCapability =
  | 'company'
  | 'contact'
  | 'email'
  | 'phone'
  | 'linkedin_url'
  | 'postal_address';

export interface EnrichmentProvider {
  readonly id: string;
  readonly capabilities: readonly EnrichmentCapability[];
  enrichCompany?(input: unknown): Promise<unknown>;
  enrichContact?(input: unknown): Promise<unknown>;
  findEmail?(input: unknown): Promise<unknown>;
  estimateCost(operations: number): Promise<{ amountEur: number }>;
}

export interface ChannelProvider<T extends ChannelKind = ChannelKind> {
  readonly id: string;
  readonly kind: T;
  readonly leadTimeHours: number;
  readonly unitCostEur: number;
  dispatch(action: OutboundAction): Promise<DispatchResult>;
  pollOutcomes?(since: Date): Promise<Outcome[]>;
  handleWebhook?(payload: unknown): Outcome[];
}

export interface InboxProvider {
  readonly id: string;
  syncThreads(since: Date): AsyncIterable<unknown>;
  sendReply(threadId: string, body: string): Promise<void>;
}

export interface AIProvider {
  readonly id: string;
  complete(input: { system: string; prompt: string; json?: unknown }): Promise<string | object>;
}

export interface ImportParser {
  readonly id: string;
  parse(file: Buffer): Promise<unknown>;
  suggestMapping(headers: string[]): Record<string, string>;
}

export interface CrmProvider {
  readonly id: string;
  pushContact(contact: unknown, thread: unknown, reason: string): Promise<{ externalId: string }>;
}

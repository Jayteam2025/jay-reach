/**
 * Provider abstractions (Jay Reach 1.4.2).
 *
 * Chaque categorie de service externe est modelisee par une interface :
 * - EmailValidator : verifie qu'un email est deliverable (Bouncer, ZeroBounce...)
 * - EnrichmentProvider : enrichit un contact / une boite (FullEnrich, Dropcontact...)
 *
 * Le code metier ne lit plus directement les API keys via Deno.env.get.
 * A la place : resolveProvider(supabase, workspaceId, category) retourne
 * une instance ProviderHandle qui expose l'api_key resolue (Vault ou env fallback)
 * et permet d'invoquer les methodes du provider concret.
 */

export type ProviderCategory = 'outreach' | 'validator' | 'enricher' | 'source' | 'llm';

export interface WorkspaceProviderRow {
  id: string;
  workspace_id: string;
  category: ProviderCategory;
  provider_type: string;
  channel: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
}

/**
 * Resolved provider : credentials + config typed pour un workspace donne.
 */
export interface ResolvedProvider<TConfig extends Record<string, unknown> = Record<string, unknown>> {
  workspaceId: string;
  providerType: string;
  apiKey: string;
  credentials: Record<string, string>;
  config: TConfig;
}

/**
 * EmailValidator : valide un batch d'emails et retourne le verdict par email.
 * Implementations actuelles : Bouncer.
 */
export interface EmailValidator {
  readonly type: string;
  /** Mode de livraison des resultats : 'webhook' (async, callback) ou 'sync' (verif immediate au submit). */
  readonly deliveryMode: 'webhook' | 'sync';
  /**
   * Submit un batch a verifier. Retourne le batch_id du provider qu'on
   * pourra polling/webhook plus tard.
   */
  submitBatch(emails: string[], ctx: ResolvedProvider): Promise<{ providerBatchId: string }>;
  /**
   * Recupere les resultats d'un batch deja submitted.
   */
  fetchResults(providerBatchId: string, ctx: ResolvedProvider): Promise<EmailValidationResult[]>;
}

export type EmailVerdict = 'valid' | 'invalid' | 'risky' | 'disposable' | 'role' | 'unknown';

export interface EmailValidationResult {
  email: string;
  verdict: EmailVerdict;
  reason: string | null;
}

/**
 * EnrichmentProvider : enrichit un contact (email deduit, telephone, social, ...).
 * Implementations actuelles : FullEnrich.
 */
export interface EnrichmentProvider {
  readonly type: string;
  /**
   * Lance un enrichissement bulk. Retourne les jobs lances cote provider.
   */
  enrichContacts(input: EnrichmentInput, ctx: ResolvedProvider): Promise<EnrichmentBulkResult>;
}

export interface EnrichmentInput {
  contacts: Array<{
    firstName: string | null;
    lastName: string | null;
    companyName: string | null;
    linkedinUrl: string | null;
    companyDomain: string | null;
  }>;
  webhookUrl?: string | null;
  workspaceTag?: string | null;
}

export interface EnrichmentBulkResult {
  bulkId: string;
  total: number;
  meta?: Record<string, unknown>;
}

/**
 * LLMProvider : complétion texte pour les micro-tâches prospection (validation
 * de titres, variantes de noms, imports) + scoring. Les call-sites demandent un
 * TIER ('fast' = petit modèle pas cher, 'smart' = modèle capable), jamais un ID
 * de modèle : chaque adapter mappe tier → modèle.
 * Implementations : anthropic (défaut, batch), openai_compatible (sync only —
 * couvre OpenAI/Mistral/Groq/Ollama via base_url).
 */
export type LLMTier = 'fast' | 'smart';

export interface LLMRequest {
  tier: LLMTier;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /** Ajoute une instruction "réponds en JSON strict" (pas de response_format : compat maximale). */
  jsonMode?: boolean;
}

export interface LLMResponse {
  text: string;
  usage: { input_tokens: number; output_tokens: number };
}

export interface LLMBatchRequestItem {
  customId: string;
  request: LLMRequest;
}

export interface LLMBatchStatus {
  providerBatchId: string;
  /** 'ended' quand tous les items sont traités (succès ou erreur). */
  status: 'processing' | 'ended';
  counts: { processing: number; succeeded: number; errored: number };
}

export interface LLMBatchResultItem {
  customId: string;
  text: string | null;
  error: string | null;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  readonly type: string;
  /** false → le caller doit utiliser le fallback sync (boucle complete()). */
  readonly supportsBatch: boolean;
  complete(req: LLMRequest, ctx: ResolvedProvider): Promise<LLMResponse>;
  submitBatch?(items: LLMBatchRequestItem[], ctx: ResolvedProvider): Promise<{ providerBatchId: string }>;
  checkBatch?(providerBatchId: string, ctx: ResolvedProvider): Promise<LLMBatchStatus>;
  fetchBatchResults?(providerBatchId: string, ctx: ResolvedProvider): Promise<LLMBatchResultItem[]>;
}

/**
 * Ce que les helpers partagés reçoivent à la place d'une string anthropicKey :
 * l'adapter du provider LLM ACTIF + son contexte résolu (clé, config).
 */
export interface LLMHandle {
  provider: LLMProvider;
  context: ResolvedProvider;
}

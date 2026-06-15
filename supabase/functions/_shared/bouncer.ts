/**
 * Bouncer API client (https://docs.usebouncer.com)
 *
 * Endpoint principal : POST /v1.1/email/verify/batch?callback=URL
 * Body : Array<{email: string}>
 * Retour : {id: string, status: string}
 *
 * Webhook : Bouncer POST sur callback URL le payload {id, status, results: [{email, status, reason?}]}
 * (format exact a confirmer Task 2 Step 1)
 *
 * Rate limit : non documente publiquement, on respecte 1 req/sec par defaut.
 * Auth : header `x-api-key: <BOUNCER_API_KEY>`.
 */

import { z } from "npm:zod@3.24.1";

const BOUNCER_BASE_URL = "https://api.usebouncer.com/v1.1";

/**
 * Schéma de validation du callback webhook Bouncer.
 *
 * Bouncer renvoie `batchId` (cf docs.usebouncer.com/api-reference/batch) + `status`,
 * et selon les cas des `results` inline. On accepte aussi `id` par tolérance, et on
 * exige qu'au moins l'un des deux soit présent (aligné sur parseWebhookPayload).
 *
 * ⚠️ Ne PAS rendre `id`/`batchId` requis seul : le schéma d'origine exigeait `id`,
 * ce qui rejetait le vrai payload Bouncer (qui envoie `batchId`) en 400 → les jobs
 * restaient `pending` et bouncer_status n'était jamais écrit (bug #410).
 */
export const BouncerWebhookRequestSchema = z.object({
  batchId: z.string().optional(),
  id: z.string().optional(),
  status: z.string().optional(),
  results: z.array(z.object({
    email: z.string(),
    status: z.string(),
    reason: z.string().optional(),
  })).optional(),
}).passthrough().refine(
  (d) => typeof d.batchId === "string" || typeof d.id === "string",
  { message: "batchId ou id requis" },
);

export type BouncerStatus = "valid" | "invalid" | "risky" | "disposable" | "role" | "unknown";

export interface BouncerEmailResult {
  email: string;
  status: BouncerStatus;
  reason?: string;
  // Bouncer renvoie aussi : did_you_mean, role, disposable, accept_all, free, etc.
  // On parse seulement le minimum utile pour le gate.
}

export interface BouncerBatchSubmitResponse {
  job_id: string;          // mappe sur le champ "id" Bouncer
  status: string;
}

export interface BouncerWebhookPayload {
  id: string;
  status: string;          // "completed" attendu
  results?: BouncerEmailResult[];
}

export class BouncerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = "BouncerError";
  }
}

/**
 * Soumet un batch d'emails a Bouncer. Le callback recevra le resultat asynchrone.
 *
 * @param emails liste d'emails uniques (dedoublonner cote appelant)
 * @param callbackUrl URL absolue (incluant token de securisation en query param)
 * @param apiKey Bouncer API key (lue depuis env BOUNCER_API_KEY cote appelant)
 */
export async function submitBatch(
  emails: string[],
  callbackUrl: string,
  apiKey: string,
): Promise<BouncerBatchSubmitResponse> {
  if (emails.length === 0) {
    throw new BouncerError("Empty emails array", "bouncer.empty_input", 0);
  }
  if (emails.length > 250000) {
    // Limite Bouncer documentee (a confirmer)
    throw new BouncerError("Batch too large (>250k)", "bouncer.batch_too_large", 0);
  }

  const body = emails.map(email => ({ email }));
  const url = `${BOUNCER_BASE_URL}/email/verify/batch?callback=${encodeURIComponent(callbackUrl)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseBody = await res.json().catch(() => null);

  if (!res.ok) {
    throw new BouncerError(
      `Bouncer submit failed: HTTP ${res.status}`,
      "bouncer.submit_failed",
      res.status,
      responseBody,
    );
  }

  if (!responseBody || typeof responseBody !== "object") {
    throw new BouncerError("Bouncer returned invalid response", "bouncer.invalid_response", 200);
  }

  const body_ = responseBody as Record<string, unknown>;
  const jobId = (typeof body_.batchId === "string" ? body_.batchId : undefined)
             ?? (typeof body_.id === "string" ? body_.id : undefined);
  const status = body_.status;

  if (typeof jobId !== "string") {
    throw new BouncerError("Bouncer response missing batchId", "bouncer.no_job_id", 200, responseBody);
  }

  return { job_id: jobId, status: typeof status === "string" ? status : "unknown" };
}

/**
 * Parse le payload du webhook Bouncer. Tolerant aux variations de schema.
 */
export function parseWebhookPayload(raw: unknown): BouncerWebhookPayload {
  if (!raw || typeof raw !== "object") {
    throw new BouncerError("Invalid webhook payload", "bouncer.invalid_webhook", 400, raw);
  }
  const obj = raw as Record<string, unknown>;
  const id = (typeof obj.batchId === "string" ? obj.batchId : undefined)
          ?? (typeof obj.id === "string" ? obj.id : undefined);
  if (typeof id !== "string") {
    throw new BouncerError("Webhook missing batchId", "bouncer.webhook_no_id", 400, raw);
  }
  const status = typeof obj.status === "string" ? obj.status : "unknown";
  const results = Array.isArray(obj.results) ? obj.results.map(parseResult).filter(r => r !== null) as BouncerEmailResult[] : undefined;
  return { id, status, results };
}

function parseResult(raw: unknown): BouncerEmailResult | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const email = obj.email;
  const status = obj.status;
  if (typeof email !== "string" || typeof status !== "string") return null;
  return {
    email,
    status: normalizeStatus(status),
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
  };
}

/**
 * Telecharge les resultats d'un batch (utilise quand le webhook arrive sans inline results).
 */
export async function downloadResults(batchId: string, apiKey: string): Promise<BouncerEmailResult[]> {
  const url = `${BOUNCER_BASE_URL}/email/verify/batch/${batchId}/download`;
  const res = await fetch(url, {
    method: "GET",
    headers: { "x-api-key": apiKey, "Accept": "application/json" },
  });
  if (!res.ok) {
    throw new BouncerError(`Bouncer download failed: HTTP ${res.status}`, "bouncer.download_failed", res.status);
  }
  const body = await res.json().catch(() => null);
  if (!Array.isArray(body)) {
    throw new BouncerError("Bouncer download returned non-array", "bouncer.download_invalid", 200, body);
  }
  return body.map(parseResult).filter((r): r is BouncerEmailResult => r !== null);
}

/**
 * Normalise le status Bouncer vers notre enum BouncerStatus.
 * Bouncer peut utiliser des libelles legerement differents (ex: "deliverable",
 * "accept_all" pour catch-all). On les mappe sur notre enum stable.
 */
function normalizeStatus(raw: string): BouncerStatus {
  const s = raw.toLowerCase();
  if (s === "valid" || s === "deliverable") return "valid";
  if (s === "invalid" || s === "undeliverable") return "invalid";
  if (s === "risky" || s === "accept_all" || s === "catch_all" || s === "catch-all") return "risky";
  if (s === "disposable") return "disposable";
  if (s === "role") return "role";
  return "unknown";
}

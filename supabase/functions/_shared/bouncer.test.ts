import { assertEquals, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseWebhookPayload, BouncerError, BouncerWebhookRequestSchema } from "./bouncer.ts";

Deno.test("parseWebhookPayload: payload valid avec results", () => {
  const raw = {
    id: "abc123",
    status: "completed",
    results: [
      { email: "a@b.com", status: "valid" },
      { email: "c@d.com", status: "risky", reason: "catch_all" },
    ],
  };
  const parsed = parseWebhookPayload(raw);
  assertEquals(parsed.id, "abc123");
  assertEquals(parsed.status, "completed");
  assertEquals(parsed.results?.length, 2);
  assertEquals(parsed.results?.[0].status, "valid");
  assertEquals(parsed.results?.[1].status, "risky");
});

Deno.test("parseWebhookPayload: normalise deliverable -> valid", () => {
  const raw = { id: "x", status: "completed", results: [{ email: "a@b.com", status: "deliverable" }] };
  const parsed = parseWebhookPayload(raw);
  assertEquals(parsed.results?.[0].status, "valid");
});

Deno.test("parseWebhookPayload: normalise accept_all -> risky", () => {
  const raw = { id: "x", status: "completed", results: [{ email: "a@b.com", status: "accept_all" }] };
  const parsed = parseWebhookPayload(raw);
  assertEquals(parsed.results?.[0].status, "risky");
});

Deno.test("parseWebhookPayload: status inconnu -> unknown", () => {
  const raw = { id: "x", status: "completed", results: [{ email: "a@b.com", status: "weird_status" }] };
  const parsed = parseWebhookPayload(raw);
  assertEquals(parsed.results?.[0].status, "unknown");
});

Deno.test("parseWebhookPayload: missing id -> throws", () => {
  assertThrows(() => parseWebhookPayload({ status: "completed" }), BouncerError, "missing batchId");
});

Deno.test("parseWebhookPayload: pas un objet -> throws", () => {
  assertThrows(() => parseWebhookPayload("not an object"), BouncerError, "Invalid");
});

Deno.test("parseWebhookPayload: results entry sans email -> skip", () => {
  const raw = {
    id: "x",
    status: "completed",
    results: [
      { email: "a@b.com", status: "valid" },
      { status: "valid" }, // pas d'email
    ],
  };
  const parsed = parseWebhookPayload(raw);
  assertEquals(parsed.results?.length, 1);
});

// --- Regression #410 : le gate Zod exigeait `id` requis et rejetait le vrai
// payload Bouncer (`batchId`) en 400 -> jobs pending, bouncer_status jamais ecrit. ---

Deno.test("schema: accepte le vrai payload Bouncer (batchId + status, sans results)", () => {
  assertEquals(
    BouncerWebhookRequestSchema.safeParse({ batchId: "6a2028c8f9fba37e0786acb3", status: "completed" }).success,
    true,
  );
});

Deno.test("schema: accepte batchId + results inline", () => {
  assertEquals(
    BouncerWebhookRequestSchema.safeParse({
      batchId: "abc123",
      status: "completed",
      results: [{ email: "a@b.com", status: "deliverable", reason: "x" }],
    }).success,
    true,
  );
});

Deno.test("schema: accepte aussi `id` (tolerance)", () => {
  assertEquals(BouncerWebhookRequestSchema.safeParse({ id: "abc", status: "completed" }).success, true);
});

Deno.test("schema: rejette si ni batchId ni id", () => {
  assertEquals(BouncerWebhookRequestSchema.safeParse({ status: "completed" }).success, false);
});

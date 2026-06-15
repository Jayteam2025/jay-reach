import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldPushToSmartlead, type GateInput } from "./email-gate.ts";

function makeInput(overrides: Partial<GateInput> = {}): GateInput {
  return {
    email: "john.doe@acme.com",
    email_source: "deduced",
    email_validation_status: "deduced_high",
    deliverability_status: "valid",
    deliverability_reason: null,
    first_name: "John",
    last_name: "Doe",
    domain_pattern: {
      pattern: "first.last",
      confidence: 0.95,
      tier: "high",
      sample_count: 50,
      empirical_sends: 0,
      empirical_bounces: 0,
      downgraded_at: null,
    },
    ...overrides,
  };
}

Deno.test("gate: bouncer=valid -> allow", () => {
  const r = shouldPushToSmartlead(makeInput({ deliverability_status: "valid" }));
  assertEquals(r.allow, true);
  assertEquals(r.reason, "bouncer_valid");
});

Deno.test("gate: bouncer=invalid -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({ deliverability_status: "invalid", deliverability_reason: "no_mx" }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "bouncer_invalid");
});

Deno.test("gate: bouncer=disposable -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({ deliverability_status: "disposable" }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "bouncer_disposable");
});

Deno.test("gate: bouncer=role -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({ deliverability_status: "role" }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "bouncer_role");
});

Deno.test("gate: email role 'contact@' -> skip meme si bouncer valid", () => {
  const r = shouldPushToSmartlead(makeInput({ email: "contact@acme.com", deliverability_status: "valid" }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "role_local_part");
});

Deno.test("gate: nom suspect (1 char) -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({ first_name: "A", last_name: "Doe" }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "suspicious_name");
});

Deno.test("gate: bouncer non passe (null) -> skip pending", () => {
  const r = shouldPushToSmartlead(makeInput({ deliverability_status: null }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "pending_bouncer");
});

Deno.test("gate: pattern downgraded MAIS bouncer=valid -> allow (valid prime)", () => {
  // Une verification Bouncer individuelle 'valid' est plus forte que la
  // statistique globale du pattern. On ne refuse plus l'email.
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "valid",
    email_source: "deduced",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 50,
      empirical_sends: 0, empirical_bounces: 0,
      downgraded_at: "2026-05-13T10:00:00Z",
    },
  }));
  assertEquals(r.allow, true);
  assertEquals(r.reason, "bouncer_valid");
});

Deno.test("gate: pattern downgraded + bouncer=risky + deduced -> skip pattern_downgraded", () => {
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "risky",
    email_source: "deduced",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 50,
      empirical_sends: 0, empirical_bounces: 0,
      downgraded_at: "2026-05-13T10:00:00Z",
    },
  }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "pattern_downgraded");
});

Deno.test("gate: risky + pattern high+strong -> allow (deduced)", () => {
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "risky",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 50,
      empirical_sends: 0, empirical_bounces: 0, downgraded_at: null,
    },
  }));
  assertEquals(r.allow, true);
  assertEquals(r.reason, "deduced_risky_pattern_strong");
});

Deno.test("gate: risky + pattern low samples -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "risky",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 10,
      empirical_sends: 0, empirical_bounces: 0, downgraded_at: null,
    },
  }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "deduced_low_samples");
});

Deno.test("gate: risky + pas de pattern (deduced) -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "risky",
    domain_pattern: null,
  }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "deduced_no_pattern");
});

Deno.test("gate: risky + FE + pattern high -> allow (fullenrich)", () => {
  const r = shouldPushToSmartlead(makeInput({
    email_source: "fullenrich",
    deliverability_status: "risky",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 50,
      empirical_sends: 0, empirical_bounces: 0, downgraded_at: null,
    },
  }));
  assertEquals(r.allow, true);
  assertEquals(r.reason, "fullenrich_risky_pattern_high");
});

Deno.test("gate: risky + FE + sans pattern high -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({
    email_source: "fullenrich",
    deliverability_status: "risky",
    domain_pattern: null,
  }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "fullenrich_risky_no_pattern");
});

Deno.test("gate: empirical bounce rate eleve -> skip", () => {
  const r = shouldPushToSmartlead(makeInput({
    deliverability_status: "risky",
    domain_pattern: {
      pattern: "first.last", confidence: 0.95, tier: "high", sample_count: 50,
      empirical_sends: 20, empirical_bounces: 5, downgraded_at: null,
    },
  }));
  assertEquals(r.allow, false);
  assertEquals(r.reason, "empirical_high_bounce");
});

import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifyReoonResult,
  detectCatchAll,
  ReoonError,
  type ReoonVerifyResponse,
  verifyEmail,
} from "./reoon.ts";

type FetchResponse = { status: number; body: unknown };

function stubFetch(responses: FetchResponse[]) {
  const original = globalThis.fetch;
  let call = 0;
  const calls: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    calls.push(typeof input === "string" ? input : input.toString());
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve(new Response(JSON.stringify(r.body), { status: r.status }));
  }) as typeof fetch;
  return {
    restore: () => { globalThis.fetch = original; },
    getCalls: () => calls,
    getCallCount: () => call,
  };
}

const VALID_RESPONSE: ReoonVerifyResponse = {
  email: "marie.dupont@elis.com",
  domain: "elis.com",
  username: "marie.dupont",
  status: "valid",
  is_valid_syntax: true,
  mx_accepts_mail: true,
  is_catch_all: false,
  is_deliverable: true,
  is_disposable: false,
  is_free_email: false,
  is_role_account: false,
  is_spamtrap: false,
  is_safe_to_send: true,
  can_connect_smtp: true,
  is_disabled: false,
  has_inbox_full: false,
  overall_score: 95,
  mx_records: ["mx.elis.com"],
};

const INVALID_RESPONSE: ReoonVerifyResponse = {
  ...VALID_RESPONSE,
  status: "invalid",
  is_deliverable: false,
  is_safe_to_send: false,
  is_catch_all: false,
};

const CATCHALL_RESPONSE: ReoonVerifyResponse = {
  ...VALID_RESPONSE,
  status: "valid",
  is_catch_all: true,
  is_safe_to_send: false,
};

// ─── verifyEmail ────────────────────────────────────────────────────────────

Deno.test("verifyEmail: valid -> retourne payload complet", async () => {
  const stub = stubFetch([{ status: 200, body: VALID_RESPONSE }]);
  try {
    const r = await verifyEmail("key", "marie.dupont@elis.com");
    assertEquals(r.status, "valid");
    assertEquals(r.is_safe_to_send, true);
    assertEquals(stub.getCallCount(), 1);
    // Verifie qu'on appelle bien power mode par defaut
    const url = stub.getCalls()[0];
    assertEquals(url.includes("mode=power"), true);
  } finally {
    stub.restore();
  }
});

Deno.test("verifyEmail: mode quick", async () => {
  const stub = stubFetch([{ status: 200, body: VALID_RESPONSE }]);
  try {
    await verifyEmail("key", "x@y.com", "quick");
    const url = stub.getCalls()[0];
    assertEquals(url.includes("mode=quick"), true);
  } finally {
    stub.restore();
  }
});

Deno.test("verifyEmail: HTTP 401 -> ReoonError avec status", async () => {
  const stub = stubFetch([{ status: 401, body: { reason: "Invalid API key", status: "error" } }]);
  try {
    await assertRejects(
      () => verifyEmail("badkey", "x@y.com"),
      ReoonError,
      "Invalid API key",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("verifyEmail: status=error dans le body 200 -> ReoonError", async () => {
  const stub = stubFetch([{ status: 200, body: { status: "error", reason: "Daily quota exceeded" } }]);
  try {
    await assertRejects(
      () => verifyEmail("key", "x@y.com"),
      ReoonError,
      "Daily quota exceeded",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("verifyEmail: email invalide -> ReoonError immediate (pas de call)", async () => {
  const stub = stubFetch([]);
  try {
    await assertRejects(
      () => verifyEmail("key", "not-an-email"),
      ReoonError,
      "invalid email",
    );
    assertEquals(stub.getCallCount(), 0);
  } finally {
    stub.restore();
  }
});

// ─── detectCatchAll ─────────────────────────────────────────────────────────

Deno.test("detectCatchAll: status=catch_all -> isCatchAll=true", async () => {
  const stub = stubFetch([
    { status: 200, body: { ...CATCHALL_RESPONSE, status: "catch_all" } },
  ]);
  try {
    const r = await detectCatchAll("key", "catchall-domain.com");
    assertEquals(r.isCatchAll, true);
    // L'email envoye doit etre random (xqwzy-...)
    const url = stub.getCalls()[0];
    assertEquals(/xqwzy-fake-[a-z0-9-]+@catchall-domain\.com/.test(decodeURIComponent(url)), true);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: is_catch_all=true seul -> isCatchAll=true", async () => {
  const stub = stubFetch([{ status: 200, body: CATCHALL_RESPONSE }]);
  try {
    const r = await detectCatchAll("key", "x.com");
    assertEquals(r.isCatchAll, true);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: status=valid sur email random -> catch-all", async () => {
  // Si le serveur dit valid pour un email random, c'est catch-all
  const stub = stubFetch([{ status: 200, body: { ...VALID_RESPONSE, is_catch_all: null } }]);
  try {
    const r = await detectCatchAll("key", "x.com");
    assertEquals(r.isCatchAll, true);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: status=invalid -> NON catch-all", async () => {
  const stub = stubFetch([{ status: 200, body: INVALID_RESPONSE }]);
  try {
    const r = await detectCatchAll("key", "x.com");
    assertEquals(r.isCatchAll, false);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: status=unknown -> null (retry plus tard)", async () => {
  const stub = stubFetch([{ status: 200, body: { ...VALID_RESPONSE, status: "unknown", is_catch_all: null, is_safe_to_send: false } }]);
  try {
    const r = await detectCatchAll("key", "x.com");
    assertEquals(r.isCatchAll, null);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: erreur API -> null (retry plus tard, pas throw)", async () => {
  const stub = stubFetch([{ status: 500, body: { reason: "Server error", status: "error" } }]);
  try {
    const r = await detectCatchAll("key", "x.com");
    assertEquals(r.isCatchAll, null);
    assertEquals(r.raw, null);
  } finally {
    stub.restore();
  }
});

Deno.test("detectCatchAll: domaine invalide -> ReoonError", async () => {
  const stub = stubFetch([]);
  try {
    await assertRejects(
      () => detectCatchAll("key", "no-tld"),
      ReoonError,
      "invalid domain",
    );
  } finally {
    stub.restore();
  }
});

// ─── classifyReoonResult ────────────────────────────────────────────────────

Deno.test("classifyReoonResult: valid + safe_to_send -> valid", () => {
  assertEquals(classifyReoonResult(VALID_RESPONSE), "valid");
});

Deno.test("classifyReoonResult: catch_all", () => {
  assertEquals(classifyReoonResult(CATCHALL_RESPONSE), "catch_all");
  assertEquals(classifyReoonResult({ ...VALID_RESPONSE, status: "catch_all" }), "catch_all");
});

Deno.test("classifyReoonResult: invalid / disabled", () => {
  assertEquals(classifyReoonResult(INVALID_RESPONSE), "invalid");
  assertEquals(classifyReoonResult({ ...VALID_RESPONSE, is_disabled: true }), "invalid");
});

Deno.test("classifyReoonResult: unknown si rien ne matche", () => {
  assertEquals(
    classifyReoonResult({ ...VALID_RESPONSE, status: "unknown", is_safe_to_send: false, is_catch_all: null }),
    "unknown",
  );
});

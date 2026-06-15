import { assertEquals, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type FullEnrichJobResult,
  FullEnrichError,
  pollBulkEnrichment,
  searchContactsAtCompanyCascade,
  submitBulkEnrichment,
  FullenrichWebhookRequestSchema,
} from "./fullenrich.ts";

// Regression #410 : le schema webhook typait `cost: z.number()` alors que FullEnrich
// envoie `cost: { credits }` (objet) -> rejet 400 -> bulk jamais persiste, retries en boucle.
Deno.test("webhook schema: accepte le vrai payload FullEnrich (cost objet {credits})", () => {
  const real = { id: "abc", name: "x", status: "FINISHED", cost: { credits: 3 }, data: [] };
  assertEquals(FullenrichWebhookRequestSchema.safeParse(real).success, true);
});

Deno.test("webhook schema: exige `id`", () => {
  assertEquals(FullenrichWebhookRequestSchema.safeParse({ status: "FINISHED" }).success, false);
});

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

Deno.test("pollBulkEnrichment — 504 transient puis FINISHED : retry et succes", async () => {
  const stub = stubFetch([
    { status: 504, body: { message: "Gateway Timeout" } },
    { status: 200, body: { id: "job_1", name: "n", status: "FINISHED", data: [] } },
  ]);
  try {
    const res = await pollBulkEnrichment("key", "job_1", {
      maxWaitMs: 20_000,
      forceResultsAfterMs: 15_000,
    });
    assertEquals(res.status, "FINISHED");
    assertEquals(stub.getCallCount(), 2);
  } finally {
    stub.restore();
  }
});

Deno.test("pollBulkEnrichment — 502 / 503 / 429 sont transient : retry", async () => {
  for (const transientStatus of [502, 503, 429]) {
    const stub = stubFetch([
      { status: transientStatus, body: {} },
      { status: 200, body: { id: "j", name: "n", status: "FINISHED", data: [] } },
    ]);
    try {
      const res = await pollBulkEnrichment("key", "job", { maxWaitMs: 20_000 });
      assertEquals(res.status, "FINISHED", `status ${transientStatus} doit etre retry`);
      assertEquals(stub.getCallCount(), 2);
    } finally {
      stub.restore();
    }
  }
});

Deno.test("pollBulkEnrichment — 404 non-transient : throw immediat", async () => {
  const stub = stubFetch([
    { status: 404, body: { code: "not_found", message: "job not found" } },
  ]);
  try {
    await assertRejects(
      () => pollBulkEnrichment("key", "job", { maxWaitMs: 20_000 }),
      FullEnrichError,
      "not found",
    );
    assertEquals(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

Deno.test("pollBulkEnrichment — 401 non-transient : throw immediat", async () => {
  const stub = stubFetch([
    { status: 401, body: { code: "unauthorized", message: "bad key" } },
  ]);
  try {
    await assertRejects(
      () => pollBulkEnrichment("key", "job", { maxWaitMs: 20_000 }),
      FullEnrichError,
      "bad key",
    );
    assertEquals(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

Deno.test("pollBulkEnrichment — 504 en boucle : timeout global respecte", async () => {
  const stub = stubFetch([{ status: 504, body: {} }]);
  try {
    await assertRejects(
      () => pollBulkEnrichment("key", "job", { maxWaitMs: 3_000 }),
      FullEnrichError,
    );
  } finally {
    stub.restore();
  }
});

// =============================================================================
// searchContactsAtCompanyCascade
// =============================================================================

function person(first: string, last: string, title = "DRH") {
  return {
    first_name: first,
    last_name: last,
    employment: { current: { title } },
  };
}

Deno.test("cascade — stoppe au premier niveau qui retourne >= minContacts", async () => {
  const stub = stubFetch([
    { status: 200, body: { people: [person("Elsa", "Leger")], metadata: { total: 1, credits: 0.25 } } },
  ]);
  try {
    const res = await searchContactsAtCompanyCascade(
      "key",
      { companyNames: [{ value: "POINT.P" }] },
      [{ value: "Nanterre" }, { value: "Hauts-de-Seine" }, { value: "France" }],
    );
    assertEquals(res.people.length, 1);
    assertEquals(res.stoppedAtLevel, 0);
    assertEquals(res.stoppedAtValue, "Nanterre");
    assertEquals(res.creditsUsed, 0.25);
    assertEquals(stub.getCallCount(), 1); // un seul call, on ne descend pas
  } finally {
    stub.restore();
  }
});

Deno.test("cascade — descend jusqu'au pays si rien aux niveaux precis", async () => {
  const stub = stubFetch([
    { status: 200, body: { people: [], metadata: { total: 0, credits: 0 } } },
    { status: 200, body: { people: [], metadata: { total: 0, credits: 0 } } },
    { status: 200, body: { people: [], metadata: { total: 0, credits: 0 } } },
    { status: 200, body: { people: [person("Mustafa", "Tutal")], metadata: { total: 1, credits: 0.25 } } },
  ]);
  try {
    const res = await searchContactsAtCompanyCascade(
      "key",
      { companyNames: [{ value: "ELIS" }] },
      [
        { value: "Annecy" },
        { value: "Haute-Savoie" },
        { value: "Auvergne-Rhone-Alpes" },
        { value: "France" },
      ],
    );
    assertEquals(res.people.length, 1);
    assertEquals(res.stoppedAtLevel, 3);
    assertEquals(res.stoppedAtValue, "France");
    assertEquals(res.creditsUsed, 0.25);
    assertEquals(stub.getCallCount(), 4);
  } finally {
    stub.restore();
  }
});

Deno.test("cascade — rien trouve : stoppedAtLevel=-1 et people vide", async () => {
  const stub = stubFetch([
    { status: 200, body: { people: [], metadata: { total: 0, credits: 0 } } },
  ]);
  try {
    const res = await searchContactsAtCompanyCascade(
      "key",
      { companyNames: [{ value: "BIO3G" }] },
      [{ value: "Merdrignac" }, { value: "Bretagne" }, { value: "France" }],
    );
    assertEquals(res.people.length, 0);
    assertEquals(res.stoppedAtLevel, -1);
    assertEquals(res.stoppedAtValue, null);
    assertEquals(stub.getCallCount(), 3);
  } finally {
    stub.restore();
  }
});

Deno.test("cascade — minContacts=2 ne stoppe pas a 1 contact", async () => {
  const stub = stubFetch([
    { status: 200, body: { people: [person("A", "B")], metadata: { total: 1, credits: 0.25 } } },
    { status: 200, body: { people: [person("C", "D"), person("E", "F")], metadata: { total: 2, credits: 0.5 } } },
  ]);
  try {
    const res = await searchContactsAtCompanyCascade(
      "key",
      { companyNames: [{ value: "X" }] },
      [{ value: "Lyon" }, { value: "France" }],
      2,
    );
    assertEquals(res.people.length, 2);
    assertEquals(res.stoppedAtLevel, 1);
    assertEquals(res.stoppedAtValue, "France");
    assertEquals(res.creditsUsed, 0.75); // 0.25 + 0.5 cumules
    assertEquals(stub.getCallCount(), 2);
  } finally {
    stub.restore();
  }
});

Deno.test("cascade — geoCascade vide -> erreur", async () => {
  await assertRejects(
    () => searchContactsAtCompanyCascade("key", { companyNames: [{ value: "X" }] }, []),
    Error,
    "geoCascade cannot be empty",
  );
});

Deno.test("cascade — propage les FullEnrichError immediatement (ex: 402 credits epuises)", async () => {
  const stub = stubFetch([
    { status: 402, body: { code: "fullenrich.credits_exhausted", message: "Out of credits" } },
  ]);
  try {
    await assertRejects(
      () => searchContactsAtCompanyCascade(
        "key",
        { companyNames: [{ value: "X" }] },
        [{ value: "Lyon" }, { value: "France" }],
      ),
      FullEnrichError,
    );
    // Une seule tentative : la cascade s'arrete au premier echec
    assertEquals(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

// =============================================================================
// submitBulkEnrichment — webhook_url
// =============================================================================

Deno.test("submitBulk: webhookUrl ajoute dans le body POST", async () => {
  const stub = stubFetch([{ status: 200, body: { enrichment_id: "abc-123" } }]);
  const captured: { body: Record<string, unknown> | null } = { body: null };
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    captured.body = init?.body ? JSON.parse(init.body as string) : null;
    return origFetch(input, init);
  }) as typeof fetch;
  try {
    await submitBulkEnrichment(
      "key",
      "test-job",
      [{ first_name: "A", last_name: "B", company_name: "X", custom: { contact_key: "k1" } }],
      { webhookUrl: "https://example.com/webhook?token=secret" },
    );
    assertEquals(captured.body?.webhook_url, "https://example.com/webhook?token=secret");
    assertEquals(captured.body?.name, "test-job");
  } finally {
    stub.restore();
  }
});

Deno.test("submitBulk: pas de webhook_url si non fourni", async () => {
  const stub = stubFetch([{ status: 200, body: { enrichment_id: "abc" } }]);
  const captured: { body: Record<string, unknown> | null } = { body: null };
  const origFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    captured.body = init?.body ? JSON.parse(init.body as string) : null;
    return origFetch(input, init);
  }) as typeof fetch;
  try {
    await submitBulkEnrichment("key", "j", [{ first_name: "A", last_name: "B" }]);
    assertEquals(captured.body?.webhook_url, undefined);
  } finally {
    stub.restore();
  }
});

// =============================================================================
// pollBulkEnrichment — webhook check
// =============================================================================

const finishedJob: FullEnrichJobResult = {
  id: "job_abc",
  name: "test",
  status: "FINISHED",
  data: [],
};

Deno.test("poll: si checkWebhook retourne le payload, ZERO call HTTP", async () => {
  // Si le webhook DB a deja le payload, on doit retourner direct sans hit FullEnrich.
  const stub = stubFetch([]);
  try {
    let webhookCalls = 0;
    const result = await pollBulkEnrichment("key", "job_abc", {
      checkWebhook: () => {
        webhookCalls++;
        return Promise.resolve(finishedJob);
      },
    });
    assertEquals(result.status, "FINISHED");
    assertEquals(stub.getCallCount(), 0); // ZERO call HTTP FullEnrich
    assertEquals(webhookCalls, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("poll: webhook null -> fallback sur GET HTTP au 1er tick", async () => {
  // Si le webhook DB est vide, on doit quand meme hit FullEnrich (filet de
  // securite). Au 1er tick, lastHttpAt=0 donc le HTTP est autorise.
  const stub = stubFetch([
    { status: 200, body: finishedJob },
  ]);
  try {
    let webhookCalls = 0;
    const result = await pollBulkEnrichment("key", "job_abc", {
      checkWebhook: () => {
        webhookCalls++;
        return Promise.resolve(null);
      },
    });
    assertEquals(result.status, "FINISHED");
    assertEquals(stub.getCallCount(), 1); // 1 GET FullEnrich (fallback)
    assertEquals(webhookCalls, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("poll: sans checkWebhook -> comportement classique GET HTTP", async () => {
  const stub = stubFetch([{ status: 200, body: finishedJob }]);
  try {
    const result = await pollBulkEnrichment("key", "job_abc");
    assertEquals(result.status, "FINISHED");
    assertEquals(stub.getCallCount(), 1);
  } finally {
    stub.restore();
  }
});

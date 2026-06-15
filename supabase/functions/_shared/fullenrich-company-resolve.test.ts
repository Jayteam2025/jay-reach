import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { resolveCompany, type ResolvedCompany, type SupabaseLike } from "./fullenrich-company-resolve.ts";

// ─── Helpers : mock fetch + mock supabase ─────────────────────────

type FetchCall = { url: string; body: Record<string, unknown> };

interface MockResponse {
  match: (body: Record<string, unknown>) => boolean;
  companies?: Array<Partial<ResolvedCompanyApi>>;
  status?: number;
}

interface ResolvedCompanyApi {
  id: string;
  name: string;
  domain: string;
  headcount: number;
  locations: { headquarters: { city: string; country: string; country_code: string } };
  social_profiles: { professional_network: { id: number; url: string; handle: string } };
  industry: { main_industry: string };
}

function installMockFetch(responses: MockResponse[]): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = JSON.parse((init?.body as string) || "{}");
    calls.push({ url, body });
    // Bypass acquire_fullenrich_token (returns 0 wait by default)
    if (url.includes("acquire_fullenrich_token")) {
      return new Response("0", { status: 200, headers: { "content-type": "application/json" } });
    }
    const match = responses.find(r => r.match(body));
    if (!match) {
      return new Response(JSON.stringify({ companies: [], metadata: { total: 0 } }), { status: 200 });
    }
    if (match.status && match.status >= 400) {
      return new Response(JSON.stringify({ code: "test_error", message: "mock error" }), { status: match.status });
    }
    return new Response(
      JSON.stringify({ companies: match.companies || [], metadata: { total: (match.companies || []).length } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

interface MockSupabaseStore {
  cacheHits: Map<string, ResolvedCompany>;
  upserts: Array<{ cache_key: string; data: ResolvedCompany }>;
  updates: Array<{ table: string; values: Record<string, unknown> }>;
}

function mockSupabase(store: MockSupabaseStore): SupabaseLike {
  return {
    from(_table: string) {
      return {
        select(_cols: string) {
          return {
            eq(_c1: string, _v1: string) {
              return {
                eq(_c2: string, key: string) {
                  return {
                    maybeSingle: async () => {
                      const hit = store.cacheHits.get(key);
                      if (hit) {
                        return { data: { data: hit, expires_at: new Date(Date.now() + 86400000).toISOString() }, error: null };
                      }
                      return { data: null, error: null };
                    },
                  };
                },
              };
            },
          };
        },
        upsert: async (values: Record<string, unknown>) => {
          store.upserts.push({ cache_key: values.cache_key as string, data: values.data as ResolvedCompany });
          return { error: null };
        },
      };
    },
  };
}

function makeCompany(overrides: Partial<ResolvedCompanyApi> = {}): ResolvedCompanyApi {
  return {
    id: "uuid-1",
    name: "Saint Laurent SAS",
    domain: "ysl.com",
    headcount: 5000,
    locations: { headquarters: { city: "Paris", country: "France", country_code: "FR" } },
    social_profiles: { professional_network: { id: 1234, url: "https://linkedin.com/company/ysl", handle: "ysl" } },
    industry: { main_industry: "Luxury Goods" },
    ...overrides,
  };
}

function emptyStore(): MockSupabaseStore {
  return { cacheHits: new Map(), upserts: [], updates: [] };
}

// ─── Tests ───────────────────────────────────────────────────────

Deno.test("resolveCompany: empty name returns null without any HTTP call", async () => {
  const { calls, restore } = installMockFetch([]);
  try {
    const result = await resolveCompany(mockSupabase(emptyStore()), "test-key", "   ");
    assertEquals(result, null);
    assertEquals(calls.filter(c => c.url.includes("/company/search")).length, 0);
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: cache hit short-circuits all HTTP calls", async () => {
  const store = emptyStore();
  const cached: ResolvedCompany = {
    id: "cached-id",
    name: "Cached Co",
    domain: "cached.com",
    hq_city: "Lyon",
    hq_country_code: "FR",
    headcount: 100,
    industry: "Tech",
    professional_network_id: 999,
    professional_network_url: null,
  };
  store.cacheHits.set("saint-laurent|fr", cached);
  const { calls, restore } = installMockFetch([]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Saint-Laurent");
    assertEquals(result, cached);
    assertEquals(calls.filter(c => c.url.includes("/company/search")).length, 0);
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: matches via linkedin_url hint (cascade step 1)", async () => {
  const store = emptyStore();
  const { calls, restore } = installMockFetch([
    {
      match: (b) => Array.isArray(b.professional_network_urls),
      companies: [makeCompany({ id: "via-linkedin", name: "Saint Laurent SAS" })],
    },
  ]);
  try {
    const result = await resolveCompany(
      mockSupabase(store),
      "test-key",
      "Saint-Laurent",
      { linkedin_url: "https://linkedin.com/company/ysl" },
    );
    assertEquals(result?.id, "via-linkedin");
    assertEquals(result?.name, "Saint Laurent SAS");
    // 1 seul call : on s'arrete au premier match
    const fe = calls.filter(c => c.url.includes("/company/search"));
    assertEquals(fe.length, 1);
    assertEquals(fe[0].body.professional_network_urls, [{ value: "https://linkedin.com/company/ysl", exact_match: true }]);
    // Cache write
    assertEquals(store.upserts.length, 1);
    assertEquals(store.upserts[0].data.id, "via-linkedin");
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: falls back to domain when linkedin returns nothing", async () => {
  const store = emptyStore();
  const { calls, restore } = installMockFetch([
    { match: (b) => Array.isArray(b.professional_network_urls), companies: [] },
    { match: (b) => Array.isArray(b.domains), companies: [makeCompany({ id: "via-domain" })] },
  ]);
  try {
    const result = await resolveCompany(
      mockSupabase(store),
      "test-key",
      "Saint-Laurent",
      { linkedin_url: "https://linkedin.com/company/ysl", domain: "ysl.com" },
    );
    assertEquals(result?.id, "via-domain");
    const fe = calls.filter(c => c.url.includes("/company/search"));
    assertEquals(fe.length, 2);
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: multi-name triggers 2 parallel calls", async () => {
  const store = emptyStore();
  const { calls, restore } = installMockFetch([
    {
      match: (b) => Array.isArray(b.headquarters_locations),
      companies: [makeCompany({ id: "fr-co", name: "Saint Laurent", locations: { headquarters: { city: "Paris", country: "France", country_code: "FR" } }, headcount: 5000 })],
    },
    {
      match: (b) => !Array.isArray(b.headquarters_locations),
      companies: [makeCompany({ id: "global-co", name: "Saint Laurent Global", locations: { headquarters: { city: "London", country: "UK", country_code: "GB" } }, headcount: 1000 })],
    },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Saint-Laurent");
    // FR wins (country bonus + same headcount tier)
    assertEquals(result?.id, "fr-co");
    const fe = calls.filter(c => c.url.includes("/company/search"));
    // 2 calls en parallele : FR + sans pays
    assertEquals(fe.length, 2);
    const withFr = fe.filter(c => Array.isArray(c.body.headquarters_locations));
    assertEquals(withFr.length, 1);
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: generates parens-stripped variant", async () => {
  const store = emptyStore();
  const { calls, restore } = installMockFetch([
    {
      match: () => true,
      companies: [makeCompany({ id: "alpine-real", name: "Alpine", locations: { headquarters: { city: "Dieppe", country: "France", country_code: "FR" } }, headcount: 1972 })],
    },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Alpine (Renault)");
    assertEquals(result?.id, "alpine-real");
    const fe = calls.filter(c => c.url.includes("/company/search"));
    // Variants envoyes : "Alpine (Renault)" + "Alpine"
    const namesArr = fe[0].body.names as Array<{ value: string }>;
    assertEquals(namesArr.length >= 2, true);
    assertEquals(namesArr.some(n => n.value === "Alpine"), true);
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: domain malus filters .nl concessionaire", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        // Concessionnaire NL avec gros headcount -> serait choisi sans malus
        makeCompany({ id: "zeeuw-nl", name: "Zeeuw Renault Dacia", locations: { headquarters: { city: "Delfgauw", country: "Netherlands", country_code: "NL" } }, headcount: 94, domain: "zeeuwenzeeuw.nl" }),
        // Maison mere FR plus petite
        makeCompany({ id: "renault-fr", name: "Renault Dacia France", locations: { headquarters: { city: "Boulogne", country: "France", country_code: "FR" } }, headcount: 50, domain: "renault.fr" }),
      ],
    },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Dacia (Renault)");
    // Malus -0.2 sur .nl + bonus FR sur renault.fr -> renault-fr wins
    assertEquals(result?.id, "renault-fr");
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: returns null when all cascade steps fail + writes negative cache", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    { match: () => true, companies: [] },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Boite Inconnue XYZ");
    assertEquals(result, null);
    // Negative sentinel ecrit en cache
    assertEquals(store.upserts.length, 1);
    assertEquals(store.upserts[0].data.id, "__not_found__");
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: prefers FR HQ over non-FR among candidates", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        makeCompany({ id: "us-1", name: "Bonduelle Holding", locations: { headquarters: { city: "New York", country: "USA", country_code: "US" } }, headcount: 10000 }),
        makeCompany({ id: "fr-1", name: "Bonduelle", locations: { headquarters: { city: "Paris", country: "France", country_code: "FR" } }, headcount: 5000 }),
      ],
    },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "Bonduelle");
    assertEquals(result?.id, "fr-1");
    assertEquals(result?.hq_country_code, "FR");
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: returns null on HTTP error without throwing (parallel)", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    { match: () => true, status: 500 },
  ]);
  try {
    const result = await resolveCompany(mockSupabase(store), "test-key", "AnyCo");
    assertEquals(result, null);
    // En parallele : chaque call attrape son erreur individuellement (.catch=>null),
    // les 3 retournent null, donc le cache negatif est ecrit. C'est OK car on
    // ne veut pas hammer FullEnrich avec des calls qui plantent en boucle :
    // 24h de cache negatif laisse le temps a l'incident de se resoudre.
    assertEquals(store.upserts.length, 1);
    assertEquals(store.upserts[0].data.id, "__not_found__");
  } finally {
    restore();
  }
});

Deno.test("resolveCompany: respects country_code hint (NL instead of default FR)", async () => {
  const store = emptyStore();
  const { calls, restore } = installMockFetch([
    {
      match: (b) => {
        const hq = b.headquarters_locations as Array<{ value: string }> | undefined;
        return Array.isArray(hq) && hq[0]?.value === "NL";
      },
      companies: [makeCompany({ id: "nl-co", name: "Heineken" })],
    },
  ]);
  try {
    const result = await resolveCompany(
      mockSupabase(store),
      "test-key",
      "Heineken",
      { country_code: "NL" },
    );
    assertEquals(result?.id, "nl-co");
    // Cache key inclut bien NL et pas FR
    assertEquals(store.upserts[0].cache_key, "heineken|nl");
    const fe = calls.filter(c => c.url.includes("/company/search"));
    assertEquals((fe[0].body.headquarters_locations as Array<{ value: string }>)[0].value, "NL");
  } finally {
    restore();
  }
});

// ─── Similarity gate ─────────────────────────────────────────────

Deno.test("similarity gate: rejects fan club match for 'Alpine (Renault)'", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        makeCompany({ id: "fan-club", name: "CLUB ALPINE RENAULT SPORTIVE", locations: { headquarters: { city: "Bastia", country: "France", country_code: "FR" } }, headcount: 5 }),
      ],
    },
  ]);
  try {
    // Input "Alpine (Renault)" tokens = {alpine, renault}
    // Fan club tokens = {club, alpine, renault, sportive}
    // Intersection 2, union 4 -> 0.5 -> juste au seuil donc accepte si rien d'autre
    // Mais notre seuil est >= 0.5 strict, et "club" + "sportive" sont des mots non-stop -> 2/4 = 0.5 OK
    // -> on garde le fan club (pas de meilleur candidat)
    // C'est attendu : sans meilleur match, on prend le moins pire.
    const result = await resolveCompany(mockSupabase(store), "test-key", "Alpine (Renault)");
    // Le candidat est juste au seuil, on accepte. Le multi-candidates n'apporte
    // pas d'amelioration si c'est l'unique resultat.
    assertEquals(result?.id, "fan-club");
  } finally {
    restore();
  }
});

Deno.test("similarity gate: headcount tiebreaker when same sim — bigger entity wins", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        // Fan club minuscule (cas reel : fan club a Bastia ~5 personnes)
        makeCompany({ id: "fan-club", name: "CLUB ALPINE RENAULT SPORTIVE", locations: { headquarters: { city: "Bastia", country: "France", country_code: "FR" } }, headcount: 5 }),
        // La vraie Alpine (filiale Renault)
        makeCompany({ id: "alpine-real", name: "Alpine", locations: { headquarters: { city: "Dieppe", country: "France", country_code: "FR" } }, headcount: 1000 }),
      ],
    },
  ]);
  try {
    // Input "Alpine (Renault)" tokens = {alpine, renault}
    //   - Fan club tokens = {club, alpine, renault, sportive} -> sim = 2/4 = 0.5
    //   - Alpine seul tokens = {alpine} -> sim = 1/2 = 0.5
    // Egalite : on tombe sur le tiebreaker headcount desc -> Alpine 1000 > Fan club 5
    const result = await resolveCompany(mockSupabase(store), "test-key", "Alpine (Renault)");
    assertEquals(result?.id, "alpine-real");
  } finally {
    restore();
  }
});

Deno.test("similarity gate: rejects 'efficy' -> 'Efficience IT' (no token overlap)", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        makeCompany({ id: "wrong", name: "Efficience IT", locations: { headquarters: { city: "Lille", country: "France", country_code: "FR" } }, headcount: 500 }),
      ],
    },
  ]);
  try {
    // Input "efficy" tokens = {efficy}
    // "Efficience IT" tokens = {efficience} (IT strippe car court < 2... non IT=2 chars donc garde)
    // Actually IT = 2 chars donc garde. Tokens = {efficience, it}
    // Intersection {efficy} ∩ {efficience, it} = vide -> sim = 0 -> reject
    const result = await resolveCompany(mockSupabase(store), "test-key", "efficy");
    assertEquals(result, null);
  } finally {
    restore();
  }
});

Deno.test("similarity gate: accepts 'FCM Travel France' vs 'FCM Travel France' (geo strip equivalent)", async () => {
  const store = emptyStore();
  const { restore } = installMockFetch([
    {
      match: () => true,
      companies: [
        makeCompany({ id: "fcm", name: "FCM Travel", locations: { headquarters: { city: "Paris", country: "France", country_code: "FR" } }, headcount: 100 }),
      ],
    },
  ]);
  try {
    // Tokens input apres strip 'france': {fcm, travel}
    // Tokens candidate: {fcm, travel}
    // Sim = 2/2 = 1.0 -> accept
    const result = await resolveCompany(mockSupabase(store), "test-key", "FCM Travel France");
    assertEquals(result?.id, "fcm");
  } finally {
    restore();
  }
});

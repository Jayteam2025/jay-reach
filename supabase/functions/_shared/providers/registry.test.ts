import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { resolveApiKey } from "./registry.ts";

function withEnv(name: string, value: string | null, fn: () => void) {
  const prev = Deno.env.get(name);
  if (value === null) Deno.env.delete(name); else Deno.env.set(name, value);
  try { fn(); } finally {
    if (prev === undefined) Deno.env.delete(name); else Deno.env.set(name, prev);
  }
}

Deno.test("resolveApiKey — credential prioritaire sur env", () => {
  withEnv("FOO_KEY", "env-value", () => {
    assertEquals(resolveApiKey({ credentialSecret: "cred-value", fallbackEnvName: "FOO_KEY" }), "cred-value");
  });
});

Deno.test("resolveApiKey — fallback env si pas de credential", () => {
  withEnv("FOO_KEY", "env-value", () => {
    assertEquals(resolveApiKey({ credentialSecret: null, fallbackEnvName: "FOO_KEY" }), "env-value");
  });
});

Deno.test("resolveApiKey — null si rien", () => {
  withEnv("FOO_KEY", null, () => {
    assertEquals(resolveApiKey({ credentialSecret: null, fallbackEnvName: "FOO_KEY" }), null);
    assertEquals(resolveApiKey({ credentialSecret: "   ", fallbackEnvName: null }), null);
  });
});

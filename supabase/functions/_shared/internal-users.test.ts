import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isInternalEmail } from "./internal-users.ts";

Deno.test("isInternalEmail - allowlist exacte", () => {
  assertEquals(isInternalEmail("removed@example.invalid"), true);
  assertEquals(isInternalEmail("removed@example.invalid"), true);
});

Deno.test("isInternalEmail - domaine jay-assistant.fr", () => {
  assertEquals(isInternalEmail("jay@jay-assistant.fr"), true);
  assertEquals(isInternalEmail("hey@jay-assistant.fr"), true);
  assertEquals(isInternalEmail("anyone@jay-assistant.fr"), true);
});

Deno.test("isInternalEmail - case insensitive", () => {
  assertEquals(isInternalEmail("RENARTJEANBAPTISTE@gmail.com"), true);
  assertEquals(isInternalEmail("JAY@JAY-ASSISTANT.FR"), true);
});

Deno.test("isInternalEmail - emails non admin", () => {
  assertEquals(isInternalEmail("user@gmail.com"), false);
  assertEquals(isInternalEmail("client@acme.com"), false);
  assertEquals(isInternalEmail("test@jay-assistant.com"), false); // wrong TLD
});

Deno.test("isInternalEmail - null/undefined", () => {
  assertEquals(isInternalEmail(null), false);
  assertEquals(isInternalEmail(undefined), false);
  assertEquals(isInternalEmail(""), false);
});

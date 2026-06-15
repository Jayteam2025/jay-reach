import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { checkFeatureAccess, requireFeatureAccess } from "./subscription-access.ts";

Deno.test("checkFeatureAccess autorise toujours en OSS", async () => {
  const res = await checkFeatureAccess("any-user", "ocr");
  assertEquals(res.allowed, true);
});

Deno.test("requireFeatureAccess ne jette jamais en OSS", async () => {
  await requireFeatureAccess("any-user", "meeting-brief"); // ne doit pas throw
});

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { isInvalidLinkedinUrl, detectDoNotOutreachReasons } from "./linkedin-validator.ts";

// ─── isInvalidLinkedinUrl ──────────────────────────────────

Deno.test("isInvalidLinkedinUrl: null/undefined → invalid", () => {
  assertEquals(isInvalidLinkedinUrl(null), true);
  assertEquals(isInvalidLinkedinUrl(undefined), true);
  assertEquals(isInvalidLinkedinUrl(""), true);
  assertEquals(isInvalidLinkedinUrl("   "), true);
});

Deno.test("isInvalidLinkedinUrl: valid profile URL → valid", () => {
  assertEquals(isInvalidLinkedinUrl("https://www.linkedin.com/in/jean-hayau-650284156/"), false);
  assertEquals(isInvalidLinkedinUrl("https://linkedin.com/in/someone"), false);
  assertEquals(isInvalidLinkedinUrl("https://fr.linkedin.com/in/sarah-prouvost-7b006b75"), false);
});

Deno.test("isInvalidLinkedinUrl: LinkedIn search URL → invalid", () => {
  assertEquals(
    isInvalidLinkedinUrl("https://www.linkedin.com/search/results/people/?keywords=maxime%20godart"),
    true
  );
  assertEquals(isInvalidLinkedinUrl("https://linkedin.com/search?q=foo"), true);
});

Deno.test("isInvalidLinkedinUrl: placeholder text → invalid", () => {
  assertEquals(isInvalidLinkedinUrl("À rechercher"), true);
  assertEquals(isInvalidLinkedinUrl("a rechercher"), true);
  assertEquals(isInvalidLinkedinUrl("Non trouvé sur LinkedIn"), true);
  assertEquals(isInvalidLinkedinUrl("Non trouvé"), true);
  assertEquals(isInvalidLinkedinUrl("TBD"), true);
  assertEquals(isInvalidLinkedinUrl("N/A"), true);
  assertEquals(isInvalidLinkedinUrl("Aucun"), true);
  assertEquals(isInvalidLinkedinUrl("pas de linkedin"), true);
});

Deno.test("isInvalidLinkedinUrl: non-HTTP string → invalid", () => {
  assertEquals(isInvalidLinkedinUrl("linkedin.com/in/foo"), true);
  assertEquals(isInvalidLinkedinUrl("www.linkedin.com/in/foo"), true);
});

Deno.test("isInvalidLinkedinUrl: HTTP URL but not LinkedIn → invalid", () => {
  assertEquals(isInvalidLinkedinUrl("https://example.com"), true);
  assertEquals(isInvalidLinkedinUrl("https://twitter.com/someone"), true);
});

// ─── detectDoNotOutreachReasons ────────────────────────────

Deno.test("detectDoNotOutreachReasons: null/empty → null", () => {
  assertEquals(detectDoNotOutreachReasons(null), null);
  assertEquals(detectDoNotOutreachReasons(undefined), null);
  assertEquals(detectDoNotOutreachReasons(""), null);
});

Deno.test("detectDoNotOutreachReasons: 'Invitation LinkedIn envoyée' → linkedin_invitation_sent", () => {
  assertEquals(detectDoNotOutreachReasons("Invitation LinkedIn envoyée"), ["linkedin_invitation_sent"]);
  assertEquals(detectDoNotOutreachReasons("invitation envoyée"), ["linkedin_invitation_sent"]);
  assertEquals(detectDoNotOutreachReasons("invité sur LinkedIn"), ["linkedin_invitation_sent"]);
  assertEquals(detectDoNotOutreachReasons("Connexion demandée"), ["linkedin_invitation_sent"]);
});

Deno.test("detectDoNotOutreachReasons: 'En contact' → active_conversation", () => {
  assertEquals(detectDoNotOutreachReasons("En contact"), ["active_conversation"]);
  assertEquals(detectDoNotOutreachReasons("En discussion"), ["active_conversation"]);
  assertEquals(detectDoNotOutreachReasons("en échange"), ["active_conversation"]);
});

Deno.test("detectDoNotOutreachReasons: 'Déjà dans le réseau' → already_connected", () => {
  assertEquals(detectDoNotOutreachReasons("Déjà dans le réseau (1er degré)"), ["already_connected"]);
  assertEquals(detectDoNotOutreachReasons("1er degré"), ["already_connected"]);
  assertEquals(detectDoNotOutreachReasons("Connecté"), ["already_connected"]);
});

Deno.test("detectDoNotOutreachReasons: 'Message envoyé' → outreach_sent", () => {
  assertEquals(detectDoNotOutreachReasons("Message envoyé"), ["outreach_sent"]);
  assertEquals(detectDoNotOutreachReasons("Relancé hier"), ["outreach_sent"]);
});

Deno.test("detectDoNotOutreachReasons: 'À prospecter' → null (OK pour outreach)", () => {
  assertEquals(detectDoNotOutreachReasons("À prospecter"), null);
  assertEquals(detectDoNotOutreachReasons("Nouveau"), null);
  assertEquals(detectDoNotOutreachReasons(""), null);
});

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reconstructNameFromEmail } from "./name-reconstruction.ts";

Deno.test("backfill : Marie W. + marie.wauquier@yoplait.fr -> Marie Wauquier", () => {
  const r = reconstructNameFromEmail("Marie", "W.", "marie.wauquier@yoplait.fr");
  assertEquals(r.firstName, "Marie");
  assertEquals(r.lastName, "Wauquier");
  assertEquals(r.changed, true);
});

Deno.test("backfill : LAURENT F. + laurent.foulon@rexel.com -> Laurent Foulon", () => {
  const r = reconstructNameFromEmail("LAURENT", "F.", "laurent.foulon@rexel.com");
  assertEquals(r.firstName, "Laurent");
  assertEquals(r.lastName, "Foulon");
  assertEquals(r.changed, true);
});

Deno.test("backfill : initiale ne matche pas -> pas de backfill (safety)", () => {
  // Romain C. + romain.lignelet -> C != L, on touche pas
  const r = reconstructNameFromEmail("Romain", "C.", "romain.lignelet@ffr.fr");
  assertEquals(r.lastName, "C."); // inchange
  assertEquals(r.changed, false);
});

Deno.test("backfill : prenom ne matche pas l'email -> pas de backfill", () => {
  // Email c'est jean.dupont mais scraper dit Marie -> ne touche pas
  const r = reconstructNameFromEmail("Marie", "D.", "jean.dupont@acme.com");
  assertEquals(r.lastName, "D.");
  assertEquals(r.changed, false);
});

Deno.test("backfill : email mono-token (j.dupont) -> pas de backfill", () => {
  // Format j.dupont au lieu de jean.dupont -> on ne devine pas
  const r = reconstructNameFromEmail("Jean", "D.", "j.dupont@acme.com");
  assertEquals(r.lastName, "D.");
  assertEquals(r.changed, false);
});

Deno.test("ALL CAPS : PHILIPPE -> Philippe", () => {
  const r = reconstructNameFromEmail("PHILIPPE", "CHEVALIER", "philippe.chevalier@elis.com");
  assertEquals(r.firstName, "Philippe");
  assertEquals(r.lastName, "Chevalier");
  assertEquals(r.changed, true);
});

Deno.test("ALL CAPS : preserve composes (LE BELGUET -> Le Belguet)", () => {
  const r = reconstructNameFromEmail("LOIC", "LE BELGUET", "loic.lebelguet@bio3g.com");
  assertEquals(r.firstName, "Loic");
  assertEquals(r.lastName, "Le Belguet");
  assertEquals(r.changed, true);
});

Deno.test("ALL CAPS : preserve apostrophes (D'INDIA -> D'India)", () => {
  const r = reconstructNameFromEmail("THOMAS", "D'INDIA", null);
  assertEquals(r.firstName, "Thomas");
  assertEquals(r.lastName, "D'India");
  assertEquals(r.changed, true);
});

Deno.test("nom deja correct -> rien a changer", () => {
  const r = reconstructNameFromEmail("Jean", "Dupont", "jean.dupont@acme.com");
  assertEquals(r.firstName, "Jean");
  assertEquals(r.lastName, "Dupont");
  assertEquals(r.changed, false);
});

Deno.test("backfill : pas d'email -> pas de backfill mais ALL CAPS quand meme", () => {
  const r = reconstructNameFromEmail("MARIE", "W.", null);
  assertEquals(r.firstName, "Marie"); // ALL CAPS reduit
  assertEquals(r.lastName, "W."); // pas d'email donc pas de backfill
  assertEquals(r.changed, true);
});

// supabase/functions/_shared/crm-detection/domain-resolver.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isValidDomain, extractDomain, extractFromEnrichmentJson, pickBestDomain } from "./domain-resolver.ts";

Deno.test("isValidDomain accepte abb.com", () => {
  assertEquals(isValidDomain("abb.com"), true);
});

Deno.test("isValidDomain accepte sous-domaine corp.example.fr", () => {
  assertEquals(isValidDomain("corp.example.fr"), true);
});

Deno.test("isValidDomain refuse linkedin.com", () => {
  assertEquals(isValidDomain("linkedin.com"), false);
});

Deno.test("isValidDomain refuse sous-domaine de blacklist", () => {
  assertEquals(isValidDomain("subsidiary.linkedin.com"), false);
});

Deno.test("isValidDomain refuse societe.com (annuaire)", () => {
  assertEquals(isValidDomain("societe.com"), false);
});

Deno.test("isValidDomain refuse format invalide", () => {
  assertEquals(isValidDomain("not a domain"), false);
  assertEquals(isValidDomain("http://example.com"), false);
  assertEquals(isValidDomain("example"), false);
});

Deno.test("extractDomain depuis URL https complète", () => {
  assertEquals(extractDomain("https://www.abb.com/about"), "abb.com");
});

Deno.test("extractDomain strip www", () => {
  assertEquals(extractDomain("https://www.example.fr"), "example.fr");
});

Deno.test("extractDomain accepte juste le domaine", () => {
  assertEquals(extractDomain("abb.com"), "abb.com");
});

Deno.test("extractFromEnrichmentJson trouve company.website", () => {
  const data = { company: { website: "https://manutan.fr/about" } };
  assertEquals(extractFromEnrichmentJson(data), "manutan.fr");
});

Deno.test("extractFromEnrichmentJson trouve organization.domain", () => {
  const data = { organization: { domain: "abb.com" } };
  assertEquals(extractFromEnrichmentJson(data), "abb.com");
});

Deno.test("extractFromEnrichmentJson rejette domaine blacklisté", () => {
  const data = { company: { website: "https://linkedin.com/company/abb" } };
  assertEquals(extractFromEnrichmentJson(data), null);
});

Deno.test("extractFromEnrichmentJson retourne null si rien", () => {
  assertEquals(extractFromEnrichmentJson({ contact: { email: "x@x.com" } }), null);
});

// --- pickBestDomain : déterminisme + bon choix d'entité (incident PPG) ---

Deno.test("PPG : domaine corporate préféré au microsite catalogue", () => {
  assertEquals(pickBestDomain("PPG", ["ppgrefinish-catalogue.fr", "ppgintl.com"]), "ppgintl.com");
});

Deno.test("PPG : racine corporate préférée si présente", () => {
  assertEquals(pickBestDomain("PPG", ["ppgrefinish-catalogue.fr", "ppgintl.com", "ppg.com"]), "ppg.com");
});

Deno.test("Déterministe quel que soit l'ordre d'entrée", () => {
  const a = pickBestDomain("PPG", ["ppgintl.com", "ppgrefinish-catalogue.fr", "ppg.com"]);
  const b = pickBestDomain("PPG", ["ppg.com", "ppgintl.com", "ppgrefinish-catalogue.fr"]);
  const c = pickBestDomain("PPG", ["ppgrefinish-catalogue.fr", "ppg.com", "ppgintl.com"]);
  assertEquals(a, "ppg.com");
  assertEquals(a, b);
  assertEquals(b, c);
});

Deno.test("Section/microsite pénalisée (shop, jobs, boutique)", () => {
  assertEquals(pickBestDomain("Acme", ["shop.acme.com", "acme.com"]), "acme.com");
  assertEquals(pickBestDomain("Acme", ["acme-boutique.fr", "acme.fr"]), "acme.fr");
  assertEquals(pickBestDomain("Acme", ["jobs.acme.com", "acme.com"]), "acme.com");
});

Deno.test("'group' n'est PAS une section pénalisée (corporate légitime)", () => {
  // Si seul le domaine -group existe, il doit être retenu.
  assertEquals(pickBestDomain("Extia", ["extia-group.com"]), "extia-group.com");
});

Deno.test("Détection légitime conservée (ATTILA .fr, Hexanet .fr)", () => {
  assertEquals(pickBestDomain("ATTILA", ["attila.fr"]), "attila.fr");
  assertEquals(pickBestDomain("Hexanet", ["hexanet.fr", "hexanet-telecom.com"]), "hexanet.fr");
});

Deno.test("Acronyme court : racine préférée à la variante -group", () => {
  assertEquals(pickBestDomain("ABB", ["abb-group.com", "abb.com"]), "abb.com");
});

Deno.test("Aucun candidat ne matche le nom -> null", () => {
  assertEquals(pickBestDomain("Zyxwvu", ["randomsite.com", "autretruc.fr"]), null);
});

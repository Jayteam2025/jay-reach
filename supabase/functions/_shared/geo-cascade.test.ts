import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildGeoCascade,
  postalToDepartment,
  postalToDepartmentCode,
  postalToRegion,
  stripGeoSuffix,
  titleCase,
} from "./geo-cascade.ts";

Deno.test("postalToDepartmentCode: metropole standard", () => {
  assertEquals(postalToDepartmentCode("75001"), "75");
  assertEquals(postalToDepartmentCode("59100"), "59");
  assertEquals(postalToDepartmentCode("13008"), "13");
  assertEquals(postalToDepartmentCode("92000"), "92");
});

Deno.test("postalToDepartmentCode: DROM", () => {
  assertEquals(postalToDepartmentCode("97110"), "971");
  assertEquals(postalToDepartmentCode("97200"), "972");
  assertEquals(postalToDepartmentCode("97300"), "973");
  assertEquals(postalToDepartmentCode("97400"), "974");
  assertEquals(postalToDepartmentCode("97600"), "976");
});

Deno.test("postalToDepartmentCode: Corse", () => {
  assertEquals(postalToDepartmentCode("20000"), "2A"); // Ajaccio
  assertEquals(postalToDepartmentCode("20100"), "2A");
  assertEquals(postalToDepartmentCode("20200"), "2B"); // Bastia
  assertEquals(postalToDepartmentCode("20290"), "2B");
});

Deno.test("postalToDepartmentCode: input invalide", () => {
  assertEquals(postalToDepartmentCode(""), null);
  assertEquals(postalToDepartmentCode(null), null);
  assertEquals(postalToDepartmentCode(undefined), null);
  assertEquals(postalToDepartmentCode("1234"), null);
  assertEquals(postalToDepartmentCode("ABCDE"), null);
  assertEquals(postalToDepartmentCode("123456"), null);
});

Deno.test("postalToDepartmentCode: trim espaces", () => {
  assertEquals(postalToDepartmentCode("  75001 "), "75");
  assertEquals(postalToDepartmentCode("75 001"), "75");
});

Deno.test("postalToDepartment: noms FR", () => {
  assertEquals(postalToDepartment("75001"), "Paris");
  assertEquals(postalToDepartment("59100"), "Nord");
  assertEquals(postalToDepartment("92000"), "Hauts-de-Seine");
  assertEquals(postalToDepartment("69001"), "Rhone");
  assertEquals(postalToDepartment("13008"), "Bouches-du-Rhone");
  assertEquals(postalToDepartment("22000"), "Cotes-d'Armor");
  assertEquals(postalToDepartment("97110"), "Guadeloupe");
});

Deno.test("postalToRegion: regions admin", () => {
  assertEquals(postalToRegion("75001"), "Ile-de-France");
  assertEquals(postalToRegion("59100"), "Hauts-de-France");
  assertEquals(postalToRegion("92000"), "Ile-de-France");
  assertEquals(postalToRegion("69001"), "Auvergne-Rhone-Alpes");
  assertEquals(postalToRegion("33000"), "Nouvelle-Aquitaine");
  assertEquals(postalToRegion("22000"), "Bretagne");
  assertEquals(postalToRegion("20100"), "Corse");
  assertEquals(postalToRegion("13008"), "Provence-Alpes-Cote d'Azur");
  assertEquals(postalToRegion("97110"), "Guadeloupe");
});

Deno.test("postalToRegion: invalide -> null", () => {
  assertEquals(postalToRegion(null), null);
  assertEquals(postalToRegion(""), null);
  assertEquals(postalToRegion("00000"), null);
});

Deno.test("titleCase: villes", () => {
  assertEquals(titleCase("PARIS"), "Paris");
  assertEquals(titleCase("MERDRIGNAC"), "Merdrignac");
  assertEquals(titleCase("aix-en-provence"), "Aix-En-Provence");
  assertEquals(titleCase("saint-malo"), "Saint-Malo");
  assertEquals(titleCase("Le Havre"), "Le Havre");
  assertEquals(titleCase(""), null);
  assertEquals(titleCase(null), null);
});

Deno.test("buildGeoCascade: ville + postal complet", () => {
  const cascade = buildGeoCascade({ city: "NANTERRE", postalCode: "92000" });
  assertEquals(cascade, [
    { value: "Nanterre" },
    { value: "Hauts-de-Seine" },
    { value: "Ile-de-France" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: postal seul (pas de ville)", () => {
  const cascade = buildGeoCascade({ postalCode: "59100" });
  assertEquals(cascade, [
    { value: "Nord" },
    { value: "Hauts-de-France" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: ville seule (pas de postal)", () => {
  const cascade = buildGeoCascade({ city: "Lyon" });
  assertEquals(cascade, [
    { value: "Lyon" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: rien -> France seule", () => {
  assertEquals(buildGeoCascade({}), [{ value: "France" }]);
  assertEquals(buildGeoCascade({ city: null, postalCode: null }), [{ value: "France" }]);
});

Deno.test("buildGeoCascade: postal invalide ignore", () => {
  const cascade = buildGeoCascade({ city: "Roubaix", postalCode: "ABCDE" });
  assertEquals(cascade, [
    { value: "Roubaix" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: pas de duplicates si la ville matche un dept", () => {
  // Cas hypothetique : ville = "Paris", postal = "75001" -> dept = "Paris"
  // On ne doit pas avoir 2 fois "Paris" dans la cascade
  const cascade = buildGeoCascade({ city: "Paris", postalCode: "75001" });
  assertEquals(cascade, [
    { value: "Paris" },
    { value: "Ile-de-France" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: case-insensitive dedup", () => {
  // city "PARIS" titlecased -> "Paris", dept "Paris" -> dedup
  const cascade = buildGeoCascade({ city: "PARIS", postalCode: "75008" });
  assertEquals(cascade, [
    { value: "Paris" },
    { value: "Ile-de-France" },
    { value: "France" },
  ]);
});

Deno.test("buildGeoCascade: DROM", () => {
  const cascade = buildGeoCascade({ city: "Pointe-a-Pitre", postalCode: "97110" });
  assertEquals(cascade, [
    { value: "Pointe-A-Pitre" },
    { value: "Guadeloupe" }, // Guadeloupe est a la fois dept et region
    { value: "France" },
  ]);
});

Deno.test("stripGeoSuffix: regions multi-mots", () => {
  assertEquals(stripGeoSuffix("IDEA Nouvelle Aquitaine"), "IDEA");
  assertEquals(stripGeoSuffix("IDEA Nouvelle-Aquitaine"), "IDEA");
  assertEquals(stripGeoSuffix("Auchan Hauts-de-France"), "Auchan");
  assertEquals(stripGeoSuffix("Banque Pays de la Loire"), "Banque");
  assertEquals(stripGeoSuffix("Logistique Auvergne-Rhône-Alpes"), "Logistique");
  assertEquals(stripGeoSuffix("Logistique Auvergne Rhone Alpes"), "Logistique");
  assertEquals(stripGeoSuffix("Conseil Île-de-France"), "Conseil");
  assertEquals(stripGeoSuffix("Conseil Ile-de-France"), "Conseil");
});

Deno.test("stripGeoSuffix: separateurs varies", () => {
  assertEquals(stripGeoSuffix("Auchan - Hauts-de-France"), "Auchan");
  assertEquals(stripGeoSuffix("Auchan, Hauts-de-France"), "Auchan");
  assertEquals(stripGeoSuffix("ENTREPRISE - PACA"), "ENTREPRISE");
});

Deno.test("stripGeoSuffix: regions un mot non ambigues", () => {
  assertEquals(stripGeoSuffix("Mistral Bretagne"), "Mistral");
  assertEquals(stripGeoSuffix("Conseil Normandie"), "Conseil");
  assertEquals(stripGeoSuffix("Tech Occitanie"), "Tech");
  assertEquals(stripGeoSuffix("Solutions Corse"), "Solutions");
});

Deno.test("stripGeoSuffix: pas de suffixe -> null", () => {
  assertEquals(stripGeoSuffix("IDEA"), null);
  assertEquals(stripGeoSuffix("Manutan"), null);
  assertEquals(stripGeoSuffix("ABB"), null);
});

Deno.test("stripGeoSuffix: ne strip pas si resultat trop court", () => {
  assertEquals(stripGeoSuffix("Bretagne"), null);
  assertEquals(stripGeoSuffix("PACA"), null);
});

Deno.test("stripGeoSuffix: pas a l interieur du nom", () => {
  // "IDF" milieu de nom -> pas strip
  assertEquals(stripGeoSuffix("IDF Conseil"), null);
  // "Bretagne" debut de nom -> pas strip
  assertEquals(stripGeoSuffix("Bretagne Telecom"), null);
});

Deno.test("stripGeoSuffix: gere null/undefined/empty", () => {
  assertEquals(stripGeoSuffix(null), null);
  assertEquals(stripGeoSuffix(undefined), null);
  assertEquals(stripGeoSuffix(""), null);
  assertEquals(stripGeoSuffix("   "), null);
});

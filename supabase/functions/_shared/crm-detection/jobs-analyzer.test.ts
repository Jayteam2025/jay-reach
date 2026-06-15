// supabase/functions/_shared/crm-detection/jobs-analyzer.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { findCrmsInText, isLikelyEsnConsulting } from "./jobs-analyzer.ts";

Deno.test("Match strict Salesforce", () => {
  assertEquals(
    findCrmsInText("Expérience Salesforce requise pour ce poste"),
    ["Salesforce"]
  );
});

Deno.test("Match Pardot → Salesforce", () => {
  assertEquals(
    findCrmsInText("Vous maîtrisez Pardot et les campagnes email"),
    ["Salesforce"]
  );
});

Deno.test("Pas de match sur 'force de vente' (faux positif)", () => {
  assertEquals(
    findCrmsInText("Animer la force de vente régionale"),
    []
  );
});

Deno.test("Multi-match dans une même offre", () => {
  const matches = findCrmsInText("Connaissance HubSpot ou Salesforce appréciée");
  assertEquals(matches.includes("HubSpot"), true);
  assertEquals(matches.includes("Salesforce"), true);
});

Deno.test("Pipedrive case insensitive", () => {
  assertEquals(findCrmsInText("PIPEDRIVE expert recherché"), ["Pipedrive"]);
});

Deno.test("Microsoft Dynamics variantes", () => {
  assertEquals(findCrmsInText("Maîtrise Dynamics 365"), ["Microsoft Dynamics"]);
  assertEquals(findCrmsInText("Expérience D365 souhaitée"), ["Microsoft Dynamics"]);
});

Deno.test("Heuristique ESN: 3+ titres avec même CRM → considéré comme métier", () => {
  const jobs = [
    { source: "ft", job_url: "u1", job_title: "Consultant Salesforce H/F", matched_crms: ["Salesforce"] },
    { source: "ft", job_url: "u2", job_title: "Développeur Salesforce", matched_crms: ["Salesforce"] },
    { source: "adzuna", job_url: "u3", job_title: "Architecte Salesforce", matched_crms: ["Salesforce"] },
  ];
  assertEquals(isLikelyEsnConsulting(jobs, "Salesforce"), true);
});

Deno.test("Pas de match sur 'close' verbe commercial (faux positif)", () => {
  assertEquals(findCrmsInText("Vous savez close des deals au quotidien"), []);
});

Deno.test("Match Close uniquement avec contexte produit", () => {
  assertEquals(findCrmsInText("Maîtrise de Close.com appréciée"), ["Close"]);
  assertEquals(findCrmsInText("Expérience Close CRM requise"), ["Close"]);
});

Deno.test("Pas de match sur 'team leader' intitulé de poste (faux positif)", () => {
  assertEquals(findCrmsInText("Recherche un team leader pour animer l'équipe"), []);
});

Deno.test("Match Teamleader uniquement avec contexte produit", () => {
  assertEquals(findCrmsInText("Vous utilisez Teamleader Focus au quotidien"), ["Teamleader"]);
});

Deno.test("Heuristique ESN: 2 titres avec CRM → pas ESN", () => {
  const jobs = [
    { source: "ft", job_url: "u1", job_title: "Consultant Salesforce", matched_crms: ["Salesforce"] },
    { source: "ft", job_url: "u2", job_title: "Responsable RH", matched_crms: ["Salesforce"] },
  ];
  assertEquals(isLikelyEsnConsulting(jobs, "Salesforce"), false);
});

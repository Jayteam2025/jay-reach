// supabase/functions/_shared/crm-detection/confidence.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { aggregateConfidence } from "./confidence.ts";

Deno.test("HIGH: BuiltWith trouve un CRM, pas de jobs", () => {
  const result = aggregateConfidence({
    builtwith: { found: "Salesforce", category: "CRM", raw_detections: ["Salesforce Pardot"] },
    jobs: [],
  });
  assertEquals(result.crm_name, "Salesforce");
  assertEquals(result.confidence, "high");
});

Deno.test("HIGH: BuiltWith + jobs s'accordent", () => {
  const result = aggregateConfidence({
    builtwith: { found: "Salesforce", category: "CRM", raw_detections: [] },
    jobs: [
      { source: "ft", job_url: "u", job_title: "DC", matched_crms: ["Salesforce"] },
    ],
  });
  assertEquals(result.confidence, "high");
});

Deno.test("HIGH: 2+ jobs même CRM, BuiltWith vide", () => {
  const result = aggregateConfidence({
    builtwith: null,
    jobs: [
      { source: "ft", job_url: "u1", job_title: "RH", matched_crms: ["HubSpot"] },
      { source: "adzuna", job_url: "u2", job_title: "DC", matched_crms: ["HubSpot"] },
    ],
  });
  assertEquals(result.crm_name, "HubSpot");
  assertEquals(result.confidence, "high");
});

Deno.test("MEDIUM: 1 seul job mentionne un CRM", () => {
  const result = aggregateConfidence({
    builtwith: null,
    jobs: [
      { source: "ft", job_url: "u", job_title: "RH", matched_crms: ["Pipedrive"] },
    ],
  });
  assertEquals(result.crm_name, "Pipedrive");
  assertEquals(result.confidence, "medium");
});

Deno.test("MEDIUM: conflit BuiltWith vs jobs", () => {
  const result = aggregateConfidence({
    builtwith: { found: "Salesforce", category: "CRM", raw_detections: [] },
    jobs: [
      { source: "ft", job_url: "u", job_title: "DC", matched_crms: ["HubSpot"] },
      { source: "ft", job_url: "u2", job_title: "DC", matched_crms: ["HubSpot"] },
    ],
  });
  assertEquals(result.crm_name, "Salesforce");
  assertEquals(result.confidence, "medium");
  assertEquals(result.signals.conflict, { builtwith: "Salesforce", jobs: "HubSpot" });
});

Deno.test("LOW: jobs avec plusieurs CRMs différents, BuiltWith vide", () => {
  const result = aggregateConfidence({
    builtwith: null,
    jobs: [
      { source: "ft", job_url: "u1", job_title: "RH", matched_crms: ["HubSpot"] },
      { source: "ft", job_url: "u2", job_title: "DC", matched_crms: ["Salesforce"] },
      { source: "adzuna", job_url: "u3", job_title: "RH", matched_crms: ["HubSpot"] },
      { source: "adzuna", job_url: "u4", job_title: "DC", matched_crms: ["Pipedrive"] },
    ],
  });
  assertEquals(result.crm_name, "HubSpot");
  assertEquals(result.confidence, "low");
});

Deno.test("NONE: aucun signal", () => {
  const result = aggregateConfidence({ builtwith: null, jobs: [] });
  assertEquals(result.crm_name, null);
  assertEquals(result.confidence, "none");
});

Deno.test("NONE: BuiltWith trouvé rien + jobs vides", () => {
  const result = aggregateConfidence({
    builtwith: { found: null, category: null, raw_detections: ["Google Analytics"] },
    jobs: [],
  });
  assertEquals(result.crm_name, null);
  assertEquals(result.confidence, "none");
});

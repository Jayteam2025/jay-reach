// supabase/functions/_shared/crm-detection/web-search-crm.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { matchCrmInResults } from "./web-search-crm.ts";

// Régression incident Linkt (03/06/2026) : la recherche `"Linkt" Salesforce`
// remontait https://linktr.ee/TPATrailblazers (Linktree, communauté Salesforce
// "Trailblazers") et l'attribuait à l'entreprise "Linkt" par collision de
// sous-chaîne de host ("linktr.ee".includes("linkt") === true).
Deno.test("Linkt : linktr.ee (Linktree) n'est pas attribué à l'entreprise Linkt", () => {
  const r = matchCrmInResults("Linkt", "linkt.fr", "Salesforce", "Salesforce", [
    { url: "https://linktr.ee/TPATrailblazers", title: "TPA Trailblazers — communauté admin Salesforce" },
  ]);
  assertEquals(r, null);
});

Deno.test("Agrégateur de liens ignoré même sans domaine résolu", () => {
  const r = matchCrmInResults("Linkt", null, "Salesforce", "Salesforce", [
    { url: "https://linktr.ee/TPATrailblazers", title: "Salesforce admin talent community" },
  ]);
  assertEquals(r, null);
});

Deno.test("Customer story éditeur reste un signal customer_story", () => {
  const r = matchCrmInResults("Acme", "acme.com", "Salesforce", "Salesforce", [
    { url: "https://www.salesforce.com/customer-stories/acme/", title: "Acme + Salesforce" },
  ]);
  assertEquals(r?.crm, "Salesforce");
  assertEquals(r?.source, "customer_story");
});

Deno.test("Offre d'emploi sur le domaine de la boîte = source jobs (pas customer_story)", () => {
  const r = matchCrmInResults("Acme", "acme.com", "Salesforce", "Salesforce", [
    { url: "https://careers.acme.com/jobs/admin-salesforce", title: "Administrateur Salesforce H/F" },
  ]);
  assertEquals(r?.crm, "Salesforce");
  assertEquals(r?.source, "jobs");
});

Deno.test("Offre sur job board + titre cite la boîte = source jobs", () => {
  const r = matchCrmInResults("Acme", "acme.com", "Salesforce", "Salesforce", [
    {
      url: "https://www.welcometothejungle.com/fr/companies/acme/jobs/salesforce-admin",
      title: "Acme recrute un Admin Salesforce",
    },
  ]);
  assertEquals(r?.source, "jobs");
});

Deno.test("Collision de sous-chaîne dans le titre rejetée (mot entier requis)", () => {
  // "Linkt" ne doit pas matcher "Linktree" dans un titre de job board.
  const r = matchCrmInResults("Linkt", "linkt.fr", "Salesforce", "Salesforce", [
    {
      url: "https://www.welcometothejungle.com/fr/articles/linktree-jobs",
      title: "Linktree recrute un Admin Salesforce",
    },
  ]);
  assertEquals(r, null);
});

Deno.test("Sous-domaine du domaine résolu accepté", () => {
  const r = matchCrmInResults("Acme", "acme.com", "HubSpot", "HubSpot", [
    { url: "https://jobs.acme.com/offre/consultant-hubspot", title: "Consultant HubSpot" },
  ]);
  assertEquals(r?.crm, "HubSpot");
  assertEquals(r?.source, "jobs");
});

Deno.test("Domaine ressemblant mais distinct rejeté (pas de faux suffixe)", () => {
  // "notacme.com" ne doit pas matcher le domaine résolu "acme.com".
  const r = matchCrmInResults("Acme", "acme.com", "Salesforce", "Salesforce", [
    { url: "https://careers.notacme.com/jobs/admin-salesforce", title: "Admin Salesforce" },
  ]);
  assertEquals(r, null);
});

// --- Round 2 : la case study doit porter sur LA boîte (audit mono-signal) ---

Deno.test("Case study éditeur non liée à la boîte rejetée (Diplomeo -> Planet42)", () => {
  const r = matchCrmInResults("Diplomeo", "diplomeo.com", "Pipedrive", "Pipedrive", [
    { url: "https://www.pipedrive.com/fr/case-studies/planet42-case-study", title: "Planet42 case study" },
  ]);
  assertEquals(r, null);
});

Deno.test("Case study sur sous-chaîne du nom rejetée (Elis -> Azelis)", () => {
  const r = matchCrmInResults("Elis", "fr.elis.com", "Microsoft Dynamics", "Microsoft Dynamics 365", [
    { url: "https://www.microsoft.com/en/customers/story/1600620206465471765-azelis-chemicals-dynamics-365", title: "Azelis Chemicals" },
  ]);
  assertEquals(r, null);
});

Deno.test("Case study portant sur la boîte conservée (token dans l'URL)", () => {
  const r = matchCrmInResults("Acme", "acme.com", "Salesforce", "Salesforce", [
    { url: "https://www.salesforce.com/fr/customer-stories/acme-group/", title: "Acme Group" },
  ]);
  assertEquals(r?.crm, "Salesforce");
  assertEquals(r?.source, "customer_story");
});

// --- Round 2 : identification stricte du CRM (homonymes / produits) ---

Deno.test("Microsoft 365 (Office) n'est pas Microsoft Dynamics 365 (CRM)", () => {
  const r = matchCrmInResults("Extia", "extia.fr", "Microsoft Dynamics", "Microsoft Dynamics 365", [
    { url: "https://www.extia.fr/jobs/expert-microsoft-365-h-f", title: "Expert Microsoft 365 H/F" },
  ]);
  assertEquals(r, null);
});

Deno.test("Vrai Microsoft Dynamics conservé", () => {
  const r = matchCrmInResults("Saur", "saur.com", "Microsoft Dynamics", "Microsoft Dynamics 365", [
    { url: "https://jobs.saur.com/jobs/applicatiebeheer-microsoft-dynamics", title: "Applicatiebeheer Microsoft Dynamics" },
  ]);
  assertEquals(r?.crm, "Microsoft Dynamics");
  assertEquals(r?.source, "jobs");
});

Deno.test("'teamleader' intitulé de poste n'est pas le CRM Teamleader", () => {
  const r = matchCrmInResults("Lyreco", "lyreco.com", "Teamleader", "Teamleader", [
    { url: "https://www.lyreco.com/jobs/teamleader-warenausgang", title: "Teamleader Warenausgang" },
  ]);
  assertEquals(r, null);
});

Deno.test("Teamleader avec contexte produit conservé", () => {
  const r = matchCrmInResults("Acme", "acme.com", "Teamleader", "Teamleader", [
    { url: "https://www.acme.com/jobs/admin-teamleader-crm", title: "Admin Teamleader CRM" },
  ]);
  assertEquals(r?.crm, "Teamleader");
  assertEquals(r?.source, "jobs");
});

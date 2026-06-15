import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ApifyLinkedInProfileScraper } from "./apify-linkedin-profile.ts";

function mockFetch(response: unknown, ok = true) {
  globalThis.fetch = async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => response,
    text: async () => JSON.stringify(response),
  } as Response);
}

Deno.test("scrapeByUrl — parse payload complet", async () => {
  mockFetch([
    {
      fullName: "Paul Lelong",
      firstName: "Paul",
      lastName: "Lelong",
      headline: "CEO chez Hodefi",
      about: "Passionné par l'immobilier financier.",
      experiences: [
        { title: "CEO", companyName: "Hodefi", startDate: "2020", description: "Direction générale" },
        { title: "Consultant", companyName: "PrevCo", startDate: "2015", endDate: "2019" },
      ],
      educations: [{ schoolName: "HEC Paris", degreeName: "MBA", startDate: "2013", endDate: "2015" }],
      skills: ["Leadership", "Finance"],
      profilePicture: "https://media.licdn.com/pic.jpg",
      addressWithCountry: "Paris, France",
      connectionsCount: 500,
      followerCount: 1200,
      linkedinUrl: "https://www.linkedin.com/in/paul-lelong/",
    },
  ]);
  const scraper = new ApifyLinkedInProfileScraper("test-token");
  const data = await scraper.scrapeByUrl("https://www.linkedin.com/in/paul-lelong/");
  assertExists(data);
  assertEquals(data.headline, "CEO chez Hodefi");
  assertEquals(data.about, "Passionné par l'immobilier financier.");
  assertEquals(data.currentPosition?.company, "Hodefi");
  assertEquals(data.currentPosition?.title, "CEO");
  assertEquals(data.previousPositions?.length, 1);
  assertEquals(data.previousPositions?.[0].company, "PrevCo");
  assertEquals(data.education?.[0].school, "HEC Paris");
  assertEquals(data.skills?.length, 2);
  assertEquals(data.location, "Paris, France");
  assertEquals(data.connectionsCount, 500);
  assertEquals(data._enrichmentMode, "apify");
});

Deno.test("scrapeByUrl — payload vide retourne null", async () => {
  mockFetch([]);
  const scraper = new ApifyLinkedInProfileScraper("test-token");
  const data = await scraper.scrapeByUrl("https://www.linkedin.com/in/nope/");
  assertEquals(data, null);
});

Deno.test("scrapeByUrl — erreur HTTP retourne null", async () => {
  mockFetch({ error: "rate" }, false);
  const scraper = new ApifyLinkedInProfileScraper("test-token");
  const data = await scraper.scrapeByUrl("https://www.linkedin.com/in/foo/");
  assertEquals(data, null);
});

Deno.test("scrapeByUrl — skills en array d'objets {name} normalisés", async () => {
  mockFetch([
    {
      fullName: "Jane",
      experiences: [],
      skills: [{ name: "Sales" }, { name: "Leadership" }],
    },
  ]);
  const scraper = new ApifyLinkedInProfileScraper("test-token");
  const data = await scraper.scrapeByUrl("https://www.linkedin.com/in/jane/");
  assertEquals(data?.skills, ["Sales", "Leadership"]);
});

Deno.test("scrapeByUrl — tronque about à 2000 chars", async () => {
  const long = "a".repeat(3000);
  mockFetch([{ fullName: "X", about: long, experiences: [] }]);
  const scraper = new ApifyLinkedInProfileScraper("test-token");
  const data = await scraper.scrapeByUrl("https://www.linkedin.com/in/x/");
  assertEquals(data?.about?.length, 2000);
});

Deno.test("estimateCostUSD — retourne 0.01", () => {
  assertEquals(ApifyLinkedInProfileScraper.estimateCostUSD(), 0.01);
});

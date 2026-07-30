import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseCampaignAnalytics, parseSequenceSteps } from "./smartlead.ts";

// ---------------------------------------------------------------------------
// parseCampaignAnalytics : clés variables selon versions de l'API Smartlead
// ---------------------------------------------------------------------------

Deno.test("parseCampaignAnalytics: fallback sent_count -> sent -> total_sent", () => {
  assertEquals(parseCampaignAnalytics({ sent_count: 10 }).sent, 10);
  assertEquals(parseCampaignAnalytics({ sent: 20 }).sent, 20);
  assertEquals(parseCampaignAnalytics({ total_sent: 30 }).sent, 30);
  assertEquals(parseCampaignAnalytics({}).sent, 0);
});

Deno.test("parseCampaignAnalytics: priorité sent_count et 0 respecté (nullish)", () => {
  // sent_count prioritaire sur sent
  assertEquals(parseCampaignAnalytics({ sent_count: 5, sent: 99 }).sent, 5);
  // 0 est une valeur valide (?? ne tombe que sur null/undefined)
  const a = parseCampaignAnalytics({ sent_count: 0, sent: 99 });
  assertEquals(a.sent, 0);
  assertEquals(a.open_rate, null);
  assertEquals(a.reply_rate, null);
});

Deno.test("parseCampaignAnalytics: fallback opened et replied", () => {
  assertEquals(parseCampaignAnalytics({ unique_open_count: 4 }).opened, 4);
  assertEquals(parseCampaignAnalytics({ open_count: 5 }).opened, 5);
  assertEquals(parseCampaignAnalytics({ opened: 6 }).opened, 6);
  assertEquals(parseCampaignAnalytics({ reply_count: 7 }).replied, 7);
  assertEquals(parseCampaignAnalytics({ replied: 8 }).replied, 8);
});

Deno.test("parseCampaignAnalytics: taux calculés et arrondis à 0,1", () => {
  const a = parseCampaignAnalytics({ sent_count: 200, unique_open_count: 50, reply_count: 20, bounce_count: 2 });
  assertEquals(a.sent, 200);
  assertEquals(a.opened, 50);
  assertEquals(a.replied, 20);
  assertEquals(a.bounced, 2);
  assertEquals(a.open_rate, 25); // 50/200 = 25.0 %
  assertEquals(a.reply_rate, 10); // 20/200 = 10.0 %
});

Deno.test("parseCampaignAnalytics: valeurs non numériques -> 0", () => {
  const a = parseCampaignAnalytics({ sent_count: "abc", opened: null, replied: undefined });
  assertEquals(a.sent, 0);
  assertEquals(a.opened, 0);
  assertEquals(a.replied, 0);
  assertEquals(a.open_rate, null);
});

// ---------------------------------------------------------------------------
// parseSequenceSteps : délai snake_case / camelCase, subject fallback
// ---------------------------------------------------------------------------

Deno.test("parseSequenceSteps: entrée non-array -> []", () => {
  assertEquals(parseSequenceSteps(null), []);
  assertEquals(parseSequenceSteps(undefined), []);
  assertEquals(parseSequenceSteps({}), []);
  assertEquals(parseSequenceSteps("nope"), []);
});

Deno.test("parseSequenceSteps: délai delay_in_days (snake_case)", () => {
  const steps = parseSequenceSteps([
    { seq_number: 1, seq_delay_details: { delay_in_days: 3 }, subject: "Hello" },
  ]);
  assertEquals(steps.length, 1);
  assertEquals(steps[0], { seq_number: 1, delay_days: 3, subject: "Hello" });
});

Deno.test("parseSequenceSteps: délai delayInDays (camelCase) en fallback", () => {
  const steps = parseSequenceSteps([
    { seq_number: 2, seq_delay_details: { delayInDays: 5 } },
  ]);
  assertEquals(steps[0].delay_days, 5);
  assertEquals(steps[0].seq_number, 2);
});

Deno.test("parseSequenceSteps: subject fallback sur sequence_variants puis chaîne vide", () => {
  const [fromVariant] = parseSequenceSteps([
    { seq_number: 1, sequence_variants: [{ subject: "Variante" }] },
  ]);
  assertEquals(fromVariant.subject, "Variante");

  const [empty] = parseSequenceSteps([{ seq_number: 1 }]);
  assertEquals(empty.subject, "");
  assertEquals(empty.delay_days, 0);
});

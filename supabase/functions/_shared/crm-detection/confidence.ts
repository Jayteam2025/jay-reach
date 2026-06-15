// Agregation multi-source des signaux pour decider du CRM final + confidence.
//
// Strategie : pondere par source (les signaux DNS/CNAME sont les plus fiables,
// le texte/jobs sont moyens, MX est faible). On compte le score par CRM, on
// prend le plus haut. Confidence depend du score ET du nombre de sources
// distinctes.

import type {
  Confidence,
  DetectionResult,
  DetectionSignal,
  DomainResult,
  JobsAnalysisResult,
  SignalSource,
} from "./types.ts";

const SOURCE_WEIGHT: Record<SignalSource, number> = {
  dns_spf: 3,         // include SPF = quasi impossible a faker
  subdomain_cname: 3, // CNAME custom = configuration explicite
  customer_story: 3,  // case study publique = boite est cliente
  html: 2,            // tracker/form integre = signal moyen-fort
  text: 2,            // mention dans legales = signal moyen
  jobs: 2,            // annonce mentionnant le CRM = signal moyen
  linkedin: 2,        // employe(s) mentionnent CRM dans skills/title — score boost via weight_multiplier
  dns_mx: 1,          // MX vers CRM = faible (beaucoup utilisent Zoho Mail sans CRM Zoho)
};

type AggregateInput = {
  signals: DetectionSignal[];
  marketing_tools: { tool: string; category: string }[];
  domain: string | null;
  domain_source: string | null;
};

export function aggregateMultiSource(input: AggregateInput): DetectionResult {
  const { signals, marketing_tools, domain, domain_source } = input;

  // Compte score + sources par CRM. weight_multiplier permet a un signal
  // (ex: linkedin avec N employes) de booster son score au-dela du SOURCE_WEIGHT
  // de base, sans saturer (cap implicite a x3 cote producteur).
  const byCrm: Record<string, { sources: Set<SignalSource>; total_score: number; evidences: string[] }> = {};
  for (const s of signals) {
    const key = String(s.crm);
    if (!byCrm[key]) byCrm[key] = { sources: new Set(), total_score: 0, evidences: [] };
    if (!byCrm[key].sources.has(s.source)) {
      byCrm[key].sources.add(s.source);
      const baseWeight = SOURCE_WEIGHT[s.source];
      const multiplier = s.weight_multiplier ?? 1;
      byCrm[key].total_score += baseWeight * multiplier;
    }
    byCrm[key].evidences.push(`${s.source}: ${s.evidence}`);
  }

  // Trie par score, prends le top
  const ranking = Object.entries(byCrm)
    .map(([crm, data]) => ({ crm, score: data.total_score, sources: [...data.sources] }))
    .sort((a, b) => b.score - a.score);

  if (ranking.length === 0) {
    return {
      crm_name: null,
      confidence: "none",
      signals: {
        matched: [],
        by_crm: {},
        marketing_tools,
        conflict: null,
        domain,
        domain_source,
      },
    };
  }

  const top = ranking[0];
  const conflict = ranking.length > 1 && ranking[1].score >= top.score - 1
    ? { winner: top.crm, runners_up: ranking.slice(1, 4).map((r) => r.crm) }
    : null;

  // Confidence rule
  let confidence: Confidence;
  const numSources = top.sources.length;
  if (top.score >= 5 || (numSources >= 2 && top.score >= 4)) {
    confidence = "high";
  } else if (top.score >= 3) {
    confidence = "medium";
  } else if (top.score >= 1) {
    confidence = "low";
  } else {
    confidence = "none";
  }

  return {
    crm_name: top.crm,
    confidence,
    signals: {
      matched: signals,
      by_crm: Object.fromEntries(
        ranking.map((r) => [r.crm, { sources: r.sources, total_score: r.score }]),
      ),
      marketing_tools,
      conflict,
      domain,
      domain_source,
    },
  };
}

/**
 * Wrapper compatible avec l'ancienne API (pour les tests existants).
 * Convertit les anciens inputs (builtwith + jobs) en signaux genereriques.
 */
export function aggregateConfidence(input: {
  builtwith: { found: string | null; category: string | null; raw_detections: string[] } | null;
  jobs: JobsAnalysisResult;
}): { crm_name: string | null; confidence: Confidence; signals: { builtwith: typeof input.builtwith; jobs: typeof input.jobs; conflict: unknown } } {
  // Cette signature est conservee pour ne pas casser les tests historiques.
  // Le nouveau code utilise aggregateMultiSource() directement.
  const signals: DetectionSignal[] = [];
  if (input.builtwith?.found) {
    signals.push({ crm: input.builtwith.found, source: "html", evidence: `BuiltWith: ${input.builtwith.found}` });
  }
  for (const job of input.jobs) {
    for (const crm of job.matched_crms) {
      signals.push({ crm, source: "jobs", evidence: `${job.source}: ${job.job_title}` });
    }
  }
  const result = aggregateMultiSource({ signals, marketing_tools: [], domain: null, domain_source: null });
  return {
    crm_name: result.crm_name,
    confidence: result.confidence,
    signals: {
      builtwith: input.builtwith,
      jobs: input.jobs,
      conflict: result.signals.conflict,
    },
  };
}

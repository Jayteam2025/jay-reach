/**
 * Estimation grossière du coût d'enrichissement avant de committer un import.
 *
 * Pipeline actuel : FullEnrich uniquement (Dropcontact retiré). 1 crédit par
 * boîte sans email, sans téléphone car la mémoire feedback_fullenrich_no_phones
 * exclut l'enrichissement phone (crédits cramés).
 *
 * Memoire : prospection-fullenrich-concurrency-limit (max 5 workers).
 */

import { isInvalidLinkedinUrl } from "./linkedin-validator";

export interface PreviewRowForCost {
  raison_sociale: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  linkedin_url?: string | null;
}

export interface ImportCostEstimate {
  total_rows: number;
  rows_needing_enrichment: number;
  rows_needing_linkedin_search: number;
  estimated_fullenrich_calls: number;
}

export function estimateImportCost(rows: PreviewRowForCost[]): ImportCostEstimate {
  let needingEnrichment = 0;
  let needingLinkedin = 0;

  for (const row of rows) {
    const hasEmail = !!row.contact_email && row.contact_email.includes("@");
    if (!hasEmail) needingEnrichment += 1;
    if (isInvalidLinkedinUrl(row.linkedin_url)) needingLinkedin += 1;
  }

  return {
    total_rows: rows.length,
    rows_needing_enrichment: needingEnrichment,
    rows_needing_linkedin_search: needingLinkedin,
    // FullEnrich : 1 credit par boite sans email
    estimated_fullenrich_calls: needingEnrichment,
  };
}

export function formatCostEstimate(estimate: ImportCostEstimate): string {
  if (estimate.rows_needing_enrichment === 0) {
    return "Aucun enrichissement nécessaire (emails déjà présents).";
  }
  const n = estimate.estimated_fullenrich_calls;
  return `~${n} crédit${n > 1 ? "s" : ""} FullEnrich pour enrichir les emails manquants.`;
}

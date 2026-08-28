/**
 * Handler de la file `signals.qualify` : résout l'entreprise d'un signal
 * (SIREN / NAF) via l'annuaire légal — code moteur repris du legacy (INSEE).
 */
import { resolveCompanyNaf, type CompanyNafResolution } from '@jay-reach/providers/enrichment';

export interface QualifyJob {
  readonly organizationId: string;
  readonly companyName: string;
  /**
   * Signal à l'origine de la qualification. Sans lui, le compte résolu ne peut
   * être rattaché à rien : le pré-filtre des cabinets par code NAF et le filtre
   * d'opposition au démarchage lisent tous deux le compte À TRAVERS le signal.
   */
  readonly signalId: string;
}

export async function runQualify(job: QualifyJob): Promise<CompanyNafResolution | null> {
  return resolveCompanyNaf(job.companyName);
}

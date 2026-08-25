/**
 * Handler de la file `signals.qualify` : résout l'entreprise d'un signal
 * (SIREN / NAF) via l'annuaire légal — code moteur repris du legacy (INSEE).
 */
import { resolveCompanyNaf, type CompanyNafResolution } from '@jay-reach/providers/enrichment';

export interface QualifyJob {
  readonly organizationId: string;
  readonly companyName: string;
}

export async function runQualify(job: QualifyJob): Promise<CompanyNafResolution | null> {
  return resolveCompanyNaf(job.companyName);
}

/**
 * Handler de la file `signals.qualify` : résout l'entreprise d'un signal
 * (SIREN / NAF) via l'annuaire légal — code moteur repris du legacy (INSEE).
 */
import { resolveCompanyNaf, type CompanyNafResolution } from '@jay-reach/providers/enrichment';
import { estSignalDePersonne } from '@jay-reach/core';

export interface QualifyJob {
  readonly organizationId: string;
  readonly companyName: string;
  /**
   * Signal à l'origine de la qualification. Sans lui, le compte résolu ne peut
   * être rattaché à rien : le pré-filtre des cabinets par code NAF et le filtre
   * d'opposition au démarchage lisent tous deux le compte À TRAVERS le signal.
   */
  readonly signalId: string;
  /**
   * Nature du signal. `post_engagement` décrit une PERSONNE, pas une
   * entreprise : il n'y a rien à résoudre auprès de l'annuaire légal.
   *
   * DÉFENSE EN PROFONDEUR DÉLIBÉRÉE, ET NON PROUVÉE : au 07/10/2026 aucun producteur ne pose
   * `kind`. Le seul producteur de `signals.qualify` (`traiterDiscover`) ne voit jamais une source
   * LinkedIn (le producteur l'exclut, et `runDiscover` lève pour `linkedin*`), et un engageur ne
   * passe pas par la qualification : `enregistrerEngageur` crée le signal en `new` et le scoring le
   * prend. Les gardes de `runQualify` et de `traitements.ts` existent pour le jour où un engageur
   * emprunterait cette file ; ce n'est pas du code mort, et ce n'est pas du code prouvé.
   */
  readonly kind?: string;
}

export async function runQualify(job: QualifyJob): Promise<CompanyNafResolution | null> {
  if (estSignalDePersonne(job.kind ?? '')) return null;
  return resolveCompanyNaf(job.companyName);
}

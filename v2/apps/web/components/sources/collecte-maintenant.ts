import type { CampaignStatus } from '@jay-reach/core';

export interface EtatCollecteMaintenant {
  /** Le bouton « Collecter maintenant » est-il utilisable ? */
  actif: boolean;
  /** Le bandeau « cette campagne est un brouillon » s'affiche-t-il ? */
  bandeauBrouillon: boolean;
  /** Clé (sous `campagne.sources.drawer`) de la ligne d'aide sous le bouton, `null` quand il marche. */
  cleAide: 'collectNowDraft' | 'collectNowUnsaved' | 'collectNowInactive' | 'collectNowPaused' | null;
}

/**
 * Règle du worker (R72, `enqueueRequestedRuns`) : une demande de passage sur une source sans
 * campagne `active` est consommée sans rien collecter. Le bouton ne promet que ce que le worker
 * fera, et dit pourquoi quand il est grisé — jamais un bouton muet. Le brouillon l'emporte : une
 * seule explication à la fois.
 */
export function etatCollecteMaintenant(
  statut: CampaignStatus,
  /** `null` : source pas encore enregistrée. `active` : l'interrupteur de la source (`lancerPassage` exige `is_active`). */
  source: { active: boolean } | null,
): EtatCollecteMaintenant {
  if (statut === 'draft') return { actif: false, bandeauBrouillon: true, cleAide: 'collectNowDraft' };
  if (statut !== 'active') return { actif: false, bandeauBrouillon: false, cleAide: 'collectNowInactive' };
  if (!source) return { actif: false, bandeauBrouillon: false, cleAide: 'collectNowUnsaved' };
  if (!source.active) return { actif: false, bandeauBrouillon: false, cleAide: 'collectNowPaused' };
  return { actif: true, bandeauBrouillon: false, cleAide: null };
}

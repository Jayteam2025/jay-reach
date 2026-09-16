/**
 * Tuile de logo pour l'icône d'une source, à partir de son `providerId` — pas
 * d'inventaire exhaustif, juste les marques déjà connues du kit (`TuileLogo`).
 *
 * Fonction partagée entre la vue d'ensemble de campagne, la page « Aujourd'hui »
 * et le diagramme de séquence (tour de correction 4, R70) : les trois avaient
 * chacun leur copie, et celle du diagramme de séquence comparait à
 * `'france_travail'` (vocabulaire d'affichage de l'assistant, avec underscore)
 * au lieu de `'francetravail'` — la valeur RÉELLE de `source_providers.provider_id`
 * (voir `PROVIDER_ID_REEL` dans `packages/core/src/fonctions/sources.ts`) —,
 * ce qui aurait fait retomber toute source France Travail sur le logo par
 * défaut au lieu du sien.
 *
 * `providerId` est `string | null` : depuis la tâche 11, `creerSource` n'écrit
 * plus jamais `sources.provider_id` (le fournisseur réel vit dans
 * `source_providers`/`config.sourceType`) — `null` signifie qu'aucun des deux
 * repères de fournisseur n'a de valeur, jamais une source LinkedIn.
 */
export function marqueSource(providerId: string | null): 'linkedin' | 'adzuna' | 'francetravail' | 'lettre' {
  if (!providerId) return 'lettre';
  if (providerId.includes('linkedin')) return 'linkedin';
  if (providerId.includes('adzuna')) return 'adzuna';
  if (providerId.includes('francetravail')) return 'francetravail';
  return 'lettre';
}

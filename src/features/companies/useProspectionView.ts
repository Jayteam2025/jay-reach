import { useMemo, useState } from 'react';
import { useProspectSignals, type AcquisitionMethodFilter } from '@/hooks/useProspectSignals';
import { useEnrichedCompanies } from '@/hooks/useEnrichedCompanies';
import { useAllCompaniesProgress } from '@/hooks/useProspectActions';
import { matchesProspectQuery } from '@/components/prospection/ProspectSearchBar';
import { useLastEnrichmentRunCompanyIds } from '@/hooks/useLastEnrichmentRun';

export type ViewState = 'raw' | 'scored' | 'enriched' | 'archived';

/**
 * Résout la vue affichée. La vue « archived » est honorée DÈS QUE l'user la
 * demande (manualView==='archived'), indépendamment de canToggle — sinon, une
 * fois tout enrichi/archivé (scoredSignals=0 → canToggle=false), l'onglet
 * Archivés deviendrait inatteignable. Pour scored↔enriched, canToggle garde son
 * rôle (toggle manuel seulement quand les deux vues ont du contenu).
 */
export function resolveViewState(
  manualView: 'scored' | 'enriched' | 'archived' | null,
  canToggle: boolean,
  autoViewState: ViewState,
): ViewState {
  if (manualView === 'archived') return 'archived';
  return canToggle && manualView ? manualView : autoViewState;
}

const SCORED_BANNER_DISMISSED_KEY = 'prospection-scored-banner-dismissed';

/**
 * Hook de vue de la liste Prospection (Jay Reach 1.5.5).
 *
 * Centralise :
 * - le state des filtres / onglets / recherche (acquisitionFilter, manualView, searchQuery)
 * - la recuperation des donnees (signals, companies, progress) — plus aucun fetch
 *   direct dans le composant
 * - toutes les derivations de vue (viewState auto/manuel, listes filtrees, banniere
 *   nouveaux scores)
 *
 * Extrait de ProspectionEntreprises.tsx, comportement identique.
 */
export function useProspectionView() {
  // Override manuel du viewState quand les deux vues (scored + enriched) ont
  // du contenu. null = comportement automatique (legacy : privilegie enriched).
  const [manualView, setManualView] = useState<'scored' | 'enriched' | 'archived' | null>(null);
  // Sous-onglet filtrant les entreprises par origine : scrap ou import fichier.
  const [acquisitionFilter, setAcquisitionFilter] = useState<AcquisitionMethodFilter>('scrape');
  const [searchQuery, setSearchQuery] = useState('');
  // Vue Enrichies : filtre run (toutes vs dernier run) + sens du tri par progression.
  const [runFilter, setRunFilter] = useState<'all' | 'last'>('all');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const { data: signals = [], isLoading: signalsLoading } = useProspectSignals({
    acquisition_method: acquisitionFilter,
  });
  const { data: companies = [], isLoading: companiesLoading } = useEnrichedCompanies();
  const { data: progressMap = {} } = useAllCompaniesProgress();
  const { data: lastRunIds } = useLastEnrichmentRunCompanyIds();

  // Determine view state
  const jobSignals = useMemo(() =>
    signals.filter(s => s.signal_type === 'job_posting' && s.status !== 'dismissed'),
    [signals]
  );

  // Signals scorés mais pas encore enrichis (status='raw'). Les matched
  // deviennent des entreprises dans la vue Enrichies et doivent disparaitre
  // du backlog Scorées.
  const scoredSignals = useMemo(() =>
    jobSignals
      .filter(s => s.status === 'raw')
      .filter(s => (s.extracted_data)?.ai_score !== null && (s.extracted_data)?.ai_score !== undefined)
      .sort((a, b) => {
        const scoreA = (a.extracted_data)?.ai_score as number || 0;
        const scoreB = (b.extracted_data)?.ai_score as number || 0;
        return scoreB - scoreA;
      }),
    [jobSignals]
  );

  const autoViewState: ViewState = companies.length > 0
    ? 'enriched'
    : scoredSignals.length > 0
      ? 'scored'
      : 'raw';

  const canToggle = scoredSignals.length > 0 && companies.length > 0;
  const viewState: ViewState = resolveViewState(manualView, canToggle, autoViewState);

  // Bannière "nouveaux signaux scorés" : signaux scorés des dernières 48h.
  // Affichée seulement quand on est sur la vue Enrichies (sinon redondant
  // avec le toggle déjà visible) et que le toggle Scorées/Enrichies coexiste.
  const recentScoredCount = useMemo(() => {
    const cutoff = Date.now() - 48 * 60 * 60 * 1000;
    return scoredSignals.filter((s) => {
      const ts = new Date(s.created_at || s.detected_at || 0).getTime();
      return ts >= cutoff;
    }).length;
  }, [scoredSignals]);

  const [dismissedAtMs, setDismissedAtMs] = useState<number>(() => {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(SCORED_BANNER_DISMISSED_KEY) : null;
    return raw ? Number(raw) || 0 : 0;
  });

  // Cache la bannière si l'user l'a dismissée dans les 24h.
  const bannerDismissed = Date.now() - dismissedAtMs < 24 * 60 * 60 * 1000;

  const showScoredBanner =
    canToggle &&
    viewState === 'enriched' &&
    recentScoredCount > 0 &&
    !bannerDismissed;

  function dismissBanner() {
    const now = Date.now();
    setDismissedAtMs(now);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SCORED_BANNER_DISMISSED_KEY, String(now));
    }
  }

  // Filtre client-side via la SearchBar. Suffisant tant que <500 lignes (cap actuel).
  const filteredScoredSignals = useMemo(() => {
    if (!searchQuery.trim()) return scoredSignals;
    return scoredSignals.filter((s) => {
      const data = s.extracted_data;
      return matchesProspectQuery(searchQuery, [
        s.company_name,
        (data?.company_name as string) || null,
        (data?.contact_first_name as string) || null,
        (data?.contact_last_name as string) || null,
        (data?.contact_full as string) || null,
        (data?.city as string) || null,
        (data?.location as string) || null,
        (data?.sector as string) || null,
        (data?.job_title as string) || null,
      ]);
    });
  }, [scoredSignals, searchQuery]);

  // Set de company_name (normalisé) qui ont au moins un signal correspondant
  // au filtre acquisition_method actif. Toujours filtre puisque "Toutes"
  // a ete retire (separation stricte Scrapees vs Importees).
  const filteredCompanyNames = useMemo(() => {
    const names = new Set<string>();
    for (const s of signals) {
      if (s.company_name) names.add(s.company_name.toLowerCase().trim());
    }
    return names;
  }, [signals]);

  // Base = entreprises de la source active (Scrapees/Importees). Sert aux
  // compteurs des filtres run ET de point de depart a filteredCompanies (DRY).
  const enrichedBase = useMemo(
    () => companies.filter((c) =>
      filteredCompanyNames.has((c.company_name || '').toLowerCase().trim())
    ),
    [companies, filteredCompanyNames],
  );

  const lastRunCount = useMemo(
    () => (lastRunIds ? enrichedBase.filter((c) => lastRunIds.has(c.company_group_id)).length : 0),
    [enrichedBase, lastRunIds],
  );

  const filteredCompanies = useMemo(() => {
    let result = enrichedBase;
    // Filtre "Dernier run" : ne garde que les entreprises du dernier job
    // d'enrichissement (filtre d'affichage dynamique, non destructif).
    if (runFilter === 'last' && lastRunIds) {
      result = result.filter((c) => lastRunIds.has(c.company_group_id));
    }
    // Filtre par recherche texte
    if (searchQuery.trim()) {
      result = result.filter((c) => {
        const profileFields = c.profiles.flatMap((p) => [
          p.first_name,
          p.last_name,
          p.company_city,
          p.company_sector,
          p.job_title,
        ]);
        return matchesProspectQuery(searchQuery, [c.company_name, ...profileFields]);
      });
    }
    // Tri par progression. 100% toujours relegue en bas (tout est fait). Parmi
    // le reste, sens controle par sortDir (desc = plus avancees d'abord, defaut).
    return [...result].sort((a, b) => {
      const pa = progressMap[a.company_group_id]?.percent ?? 0;
      const pb = progressMap[b.company_group_id]?.percent ?? 0;
      const aDone = pa === 100;
      const bDone = pb === 100;
      if (aDone !== bDone) return aDone ? 1 : -1;
      return sortDir === 'desc' ? pb - pa : pa - pb;
    });
  }, [enrichedBase, runFilter, lastRunIds, searchQuery, progressMap, sortDir]);

  return {
    // donnees brutes utiles au composant (selection, actions)
    companies,
    scoredSignals,
    jobSignals,
    isLoading: signalsLoading || companiesLoading,
    // filtres / onglets / recherche
    acquisitionFilter,
    setAcquisitionFilter,
    searchQuery,
    setSearchQuery,
    manualView,
    setManualView,
    // derivations de vue
    viewState,
    canToggle,
    filteredScoredSignals,
    filteredCompanies,
    // vue Enrichies : filtre run + tri avancement
    runFilter,
    setRunFilter,
    sortDir,
    setSortDir,
    enrichedBaseCount: enrichedBase.length,
    lastRunCount,
    // banniere
    recentScoredCount,
    showScoredBanner,
    dismissBanner,
  };
}

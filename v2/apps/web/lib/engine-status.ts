import type { SupabaseClient } from '@supabase/supabase-js';

const INACTIF_APRES_MS = 5 * 60_000;

export type EtatMoteur = {
  moteur: { actif: boolean; dernierTour: string | null; version: string; erreur: string | null } | null;
  plafonds: Array<{ providerId: string; utilise: number; plafond: number }>;
  campagnes: Array<{ id: string; nom: string; entrees: number; plafond: number | null }>;
};

type LigneStatut = { last_tick_at: string | null; version: string | null; last_error: string | null };
type LigneUsage = { provider_id: string; used: number; daily_cap: number };
type LigneCredentialPublic = { provider_id: string; config: Record<string, unknown> | null };
type LigneCampagne = { id: string; name: string; daily_cap: number | null };

/** Lit un plafond réglé dans la config non secrète d'un fournisseur (`daily_cap`, saisi en texte). Absent ou non numérique → aucun réglage. Zéro compte comme un réglage (pause voulue). */
function plafondConfigure(config: Record<string, unknown> | null): number | null {
  const brut = config?.['daily_cap'];
  if (brut === undefined || brut === null || brut === '') return null;
  const valeur = Number(brut as string | number);
  return Number.isFinite(valeur) ? valeur : null;
}

export async function chargerEtatMoteur(supabase: SupabaseClient, orgId: string): Promise<EtatMoteur> {
  const debutJourUtc = new Date();
  debutJourUtc.setUTCHours(0, 0, 0, 0);
  const aujourdHui = debutJourUtc.toISOString().slice(0, 10);

  const [statut, usages, credentialsPublic, campagnes] = await Promise.all([
    // engine_status n'a pas de colonne organization_id (une seule instance de
    // moteur pour toute la base) : pas de filtre par organisation ici.
    supabase.from('engine_status').select('last_tick_at,version,last_error').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('provider_daily_usage').select('provider_id,used,daily_cap').eq('organization_id', orgId).eq('usage_date', aujourdHui),
    supabase.from('credentials_public').select('provider_id,config').eq('organization_id', orgId),
    supabase.from('campaigns').select('id,name,daily_cap').eq('organization_id', orgId).eq('status', 'active'),
  ]);

  const statutData = statut.data as LigneStatut | null;
  const dernier = statutData?.last_tick_at ?? null;
  const moteur = statutData
    ? {
        actif: dernier !== null && Date.now() - new Date(dernier).getTime() < INACTIF_APRES_MS,
        dernierTour: dernier,
        version: statutData.version ?? 'inconnu',
        erreur: statutData.last_error ?? null,
      }
    : null;

  const usagesData = (usages.data as LigneUsage[] | null) ?? [];
  const usageParProvider = new Map(usagesData.map((u) => [u.provider_id, u.used]));

  // Un poste mis en pause (plafond réglé à zéro) n'a aucune ligne d'usage du
  // jour : sans lire aussi le réglage, il disparaissait purement et
  // simplement du bloc au lieu de s'afficher « en pause » (I4).
  const plafondsConfigures = new Map<string, number>();
  for (const c of (credentialsPublic.data as LigneCredentialPublic[] | null) ?? []) {
    const plafond = plafondConfigure(c.config);
    if (plafond !== null) plafondsConfigures.set(c.provider_id, plafond);
  }

  const plafonds: EtatMoteur['plafonds'] = [];
  for (const [providerId, plafond] of plafondsConfigures) {
    plafonds.push({ providerId, utilise: usageParProvider.get(providerId) ?? 0, plafond });
  }
  // Fournisseurs sans réglage explicite : repli sur ce que la consommation du
  // jour a enregistré (le plafond appliqué était alors celui de l'environnement).
  for (const u of usagesData) {
    if (!plafondsConfigures.has(u.provider_id)) {
      plafonds.push({ providerId: u.provider_id, utilise: u.used, plafond: u.daily_cap });
    }
  }
  plafonds.sort((a, b) => a.providerId.localeCompare(b.providerId));

  const campagnesData = (campagnes.data as LigneCampagne[] | null) ?? [];
  // Un `select('campaign_id')` sur toutes les inscriptions du jour se heurtait
  // à la limite PostgREST de 1000 lignes : au-delà, les compteurs se
  // tronquaient en silence. Un comptage par campagne active n'a pas ce
  // plafond.
  const entreesParCampagne = await Promise.all(
    campagnesData.map((c) =>
      supabase
        .from('enrollments')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', c.id)
        .gte('started_at', debutJourUtc.toISOString()),
    ),
  );

  return {
    moteur,
    plafonds,
    campagnes: campagnesData.map((c, i) => ({
      id: c.id,
      nom: c.name,
      entrees: entreesParCampagne[i]?.count ?? 0,
      plafond: c.daily_cap,
    })),
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';

const INACTIF_APRES_MS = 5 * 60_000;

export type EtatMoteur = {
  moteur: { actif: boolean; dernierTour: string | null; version: string; erreur: string | null } | null;
  plafonds: Array<{ providerId: string; utilise: number; plafond: number }>;
  campagnes: Array<{ id: string; nom: string; entrees: number; plafond: number | null }>;
};

type LigneStatut = { last_tick_at: string | null; version: string | null; last_error: string | null };
type LigneUsage = { provider_id: string; used: number; daily_cap: number };
type LigneCampagne = { id: string; name: string; daily_cap: number | null };
type LigneEnrollment = { campaign_id: string };

export async function chargerEtatMoteur(supabase: SupabaseClient): Promise<EtatMoteur> {
  const debutJourUtc = new Date();
  debutJourUtc.setUTCHours(0, 0, 0, 0);
  const aujourdHui = debutJourUtc.toISOString().slice(0, 10);

  const [statut, usages, campagnes, entrees] = await Promise.all([
    supabase.from('engine_status').select('last_tick_at,version,last_error').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('provider_daily_usage').select('provider_id,used,daily_cap').eq('usage_date', aujourdHui),
    supabase.from('campaigns').select('id,name,daily_cap').eq('status', 'active'),
    supabase.from('enrollments').select('campaign_id').gte('started_at', debutJourUtc.toISOString()),
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

  const parCampagne = new Map<string, number>();
  for (const e of (entrees.data as LigneEnrollment[] | null) ?? []) parCampagne.set(e.campaign_id, (parCampagne.get(e.campaign_id) ?? 0) + 1);

  return {
    moteur,
    plafonds: ((usages.data as LigneUsage[] | null) ?? []).map((u) => ({ providerId: u.provider_id, utilise: u.used, plafond: u.daily_cap })),
    campagnes: ((campagnes.data as LigneCampagne[] | null) ?? []).map((c) => ({ id: c.id, nom: c.name, entrees: parCampagne.get(c.id) ?? 0, plafond: c.daily_cap })),
  };
}

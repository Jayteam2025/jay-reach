import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logger } from "@/lib/logger";
import { canAccessFeature, canAccessCRMIntegration, getVoiceLimits } from "@/utils/subscriptionAccess";

export function useSubscriptionAccess() {
  const { data: profile } = useQuery({
    queryKey: ["user-subscription-access"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Récupérer le profil (sans trial_started_at/trial_used - colonnes supprimées en OSS)
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, role, current_plan, created_at")
        .eq("id", user.id)
        .single();

      if (profileError) {
        logger.error("[SUBSCRIPTION] Error fetching profile", profileError);
        throw profileError;
      }

      return profile;
    },
  });

  // Déterminer le plan actuel
  const getCurrentPlan = () => {
    if (!profile) return "Free";

    // Admin a tous les droits
    if (profile.role === "admin") return "Admin";

    // En OSS, current_plan est neutre (valeur 'oss' ou équivalent)
    // Tous les utilisateurs ont accès complet
    return "Free";
  };

  const currentPlan = getCurrentPlan();

  return {
    currentPlan,
    profile,
    // Fonctions d'accès
    canAccessFeature: (feature: string) => canAccessFeature(currentPlan, feature as any),
    canAccessCRM: (_crmType: string) => canAccessCRMIntegration(currentPlan, _crmType),
    hasAccess: (_feature: string) => true, // OSS: always allow
    getVoiceLimits: () => getVoiceLimits(currentPlan),
    // Vérifications spécifiques
    canUseUnlimitedVoice: () => true, // OSS: always allow
    canConnectMultipleCRMs: () => true, // OSS: always allow
    isInTrialPeriod: () => false, // OSS: no trial period
    isAdmin: () => profile?.role === "admin", // Based on profiles.role
  };
}

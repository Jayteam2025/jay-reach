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

      // Récupérer le profil
      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id, email, role, current_plan, created_at, trial_started_at, trial_used")
        .eq("id", user.id)
        .single();

      if (profileError) {
        logger.error("[SUBSCRIPTION] Error fetching profile", profileError);
        throw profileError;
      }


      // Pour cette structure, current_plan contient déjà le nom du plan
      const data = {
        ...profile,
        plans: profile.current_plan ? { name: profile.current_plan } : null
      };

      return data;
    },
  });

  // Déterminer le plan actuel
  const getCurrentPlan = () => {
    if (!profile) return "Free";

    // Admin a tous les droits
    if (profile.role === "admin") return "Admin";

    // Vérifier la période d'essai (7 jours affichés, 15 jours réels)
    const createdAt = new Date(profile.created_at);
    const now = new Date();
    const daysSinceCreation = Math.floor((now.getTime() - createdAt.getTime()) / (1000 * 60 * 60 * 24));
    const isInTrialPeriod = daysSinceCreation <= 15;

    // Si current_plan est explicitement 'trial' -> Trial Business
    if (profile.current_plan === 'trial') {
      return "Trial Business";
    }

    // Si abonnement payant actif
    if (profile.current_plan) {
      return profile.current_plan;
    }

    // Par défaut, Free après la période d'essai
    return "Free";
  };

  const currentPlan = getCurrentPlan();

  return {
    currentPlan,
    profile,
    // Fonctions d'accès
    canAccessFeature: (feature: string) => canAccessFeature(currentPlan, feature),
    canAccessCRM: (crmType: string) => canAccessCRMIntegration(currentPlan, crmType),
    hasAccess: (feature: string) => canAccessCRMIntegration(currentPlan, feature),
    getVoiceLimits: () => getVoiceLimits(currentPlan),
    // Vérifications spécifiques
    canUseUnlimitedVoice: () => canAccessFeature(currentPlan, "vocal-illimite"),
    canConnectMultipleCRMs: () => canAccessFeature(currentPlan, "multi-crm"),
    isInTrialPeriod: () => currentPlan.includes("Trial"),
    isAdmin: () => currentPlan === "Admin",
  };
}

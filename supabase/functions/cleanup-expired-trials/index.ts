import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseKey);

serve(async (req) => {
  try {
    console.log("🧹 Nettoyage des essais expirés...");

    const now = new Date().toISOString();

    // 1. Trouver les profils avec des essais expirés (plus de 15 jours)
    const { data: expiredTrials, error: trialError } = await supabase
      .from("profiles")
      .select("id, trial_started_at, current_plan")
      .eq("current_plan", "trial")
      .not("trial_started_at", "is", null);

    if (trialError) {
      console.error("Erreur lors de la récupération des essais:", trialError);
      throw trialError;
    }

    console.log(`📊 Trouvé ${expiredTrials?.length || 0} essai(s) actif(s)`);

    const expiredProfiles = [];
    if (expiredTrials) {
      for (const profile of expiredTrials) {
        const trialStart = new Date(profile.trial_started_at);
        const daysSinceStart = Math.floor((Date.now() - trialStart.getTime()) / (1000 * 60 * 60 * 24));
        
        if (daysSinceStart > 15) {
          expiredProfiles.push(profile.id);
          console.log(`⏰ Essai expiré pour le profil ${profile.id} (${daysSinceStart} jours)`);
        }
      }
    }

    console.log(`🔄 ${expiredProfiles.length} essai(s) expiré(s) à nettoyer`);

    if (expiredProfiles.length > 0) {
      // 2. Remettre les profils expirés en plan "free"
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ current_plan: "free" })
        .in("id", expiredProfiles);

      if (updateError) {
        console.error("Erreur lors de la mise à jour des profils:", updateError);
        throw updateError;
      }

      // 3. Marquer les subscriptions correspondantes comme "expired"
      const { error: subscriptionError } = await supabase
        .from("subscriptions")
        .update({ 
          status: "expired",
          updated_at: now
        })
        .in("user_id", expiredProfiles)
        .eq("status", "active");

      if (subscriptionError) {
        console.warn("Erreur lors de la mise à jour des subscriptions:", subscriptionError);
        // Ne pas faire échouer le processus
      }

      console.log(`✅ ${expiredProfiles.length} essai(s) expiré(s) nettoyé(s)`);
    }

    // 4. Statistiques de nettoyage
    const { count: activeTrials } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("current_plan", "trial");

    const { count: freeUsers } = await supabase
      .from("profiles")
      .select("*", { count: "exact", head: true })
      .eq("current_plan", "free");

    return new Response(
      JSON.stringify({
        success: true,
        message: "Nettoyage des essais expirés terminé",
        statistics: {
          expiredTrialsProcessed: expiredProfiles.length,
          remainingActiveTrials: activeTrials || 0,
          totalFreeUsers: freeUsers || 0
        }
      }),
      { 
        headers: { "Content-Type": "application/json" },
        status: 200
      }
    );

  } catch (error) {
    console.error("❌ Erreur lors du nettoyage:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      }),
      { 
        headers: { "Content-Type": "application/json" },
        status: 500
      }
    );
  }
});

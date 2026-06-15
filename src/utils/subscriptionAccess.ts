// Logique de restriction d'accès selon le plan d'abonnement
// Mis à jour pour le sprint Autonomie & Viralité (janvier 2026)

export const ENABLE_SUBSCRIPTION_RESTRICTIONS = true;

// Types pour les fonctionnalités
export type PlanFeature =
  | "ocr"
  | "email-generation"
  | "analytics-dashboard"
  | "teams"
  | "priority-support"
  | "onboarding-formation"
  | "hide-badge"
  | "structured-fields"
  | "multi-crm"
  | "meeting-brief";

// Configuration des plans selon la matrice de features
interface PlanConfig {
  monthlyQuota: number | null; // null = illimité
  dailyLimit: number | null;   // null = pas de limite
  crmLimit: number | null;     // null = illimité
  features: PlanFeature[];
}

const PLAN_CONFIGS: Record<string, PlanConfig> = {
  // Admin a tous les droits
  Admin: {
    monthlyQuota: null,
    dailyLimit: null,
    crmLimit: null,
    features: ["ocr", "email-generation", "analytics-dashboard", "teams", "priority-support", "onboarding-formation", "hide-badge", "structured-fields", "multi-crm", "meeting-brief"],
  },

  Trial: {
    monthlyQuota: null,
    dailyLimit: null,
    crmLimit: null,
    features: ["ocr", "email-generation", "analytics-dashboard", "teams", "priority-support", "hide-badge", "structured-fields", "multi-crm"],
  },

  // Free: 30/mois, 5/jour, 1 CRM, OCR inclus
  Free: {
    monthlyQuota: 30,
    dailyLimit: 5,
    crmLimit: 1,
    features: ["ocr"],
  },

  // Pro: 100/mois, pas de limite quotidienne, 1 CRM, OCR + Email + Support prioritaire
  Pro: {
    monthlyQuota: 100,
    dailyLimit: null,
    crmLimit: 1,
    features: ["ocr", "email-generation", "priority-support", "hide-badge"],
  },

  // Business: Illimité, Multi-CRM, toutes les features sauf onboarding dédié
  Business: {
    monthlyQuota: null,
    dailyLimit: null,
    crmLimit: null,
    features: ["ocr", "email-generation", "analytics-dashboard", "teams", "priority-support", "hide-badge", "structured-fields", "multi-crm", "meeting-brief"],
  },

  // Entreprise: Tout + Onboarding personnalisé + Support dédié
  Entreprise: {
    monthlyQuota: null,
    dailyLimit: null,
    crmLimit: null,
    features: ["ocr", "email-generation", "analytics-dashboard", "teams", "priority-support", "onboarding-formation", "hide-badge", "structured-fields", "multi-crm", "meeting-brief"],
  },
};

// Normaliser le nom du plan
function normalizePlanName(plan: string): string {
  if (!plan) return "Free";

  const lowerPlan = plan.toLowerCase();

  if (lowerPlan === "trial") {
    return "Trial";
  }

  // Capitaliser la première lettre
  return plan.charAt(0).toUpperCase() + plan.slice(1).toLowerCase();
}

// Obtenir la configuration d'un plan
export function getPlanConfig(plan: string): PlanConfig {
  const normalizedPlan = normalizePlanName(plan);
  return PLAN_CONFIGS[normalizedPlan] || PLAN_CONFIGS.Free;
}

// Vérifier l'accès à une feature
export function canAccessFeature(plan: string, feature: PlanFeature): boolean {
  if (!ENABLE_SUBSCRIPTION_RESTRICTIONS) return true;

  const config = getPlanConfig(plan);

  // Admin a accès à tout
  if (normalizePlanName(plan) === "Admin") return true;

  return config.features.includes(feature);
}

// Vérifier l'accès aux intégrations CRM
export function canAccessCRMIntegration(plan: string, _crmType: string): boolean {
  if (!ENABLE_SUBSCRIPTION_RESTRICTIONS) return true;

  const config = getPlanConfig(plan);

  // Si multi-CRM autorisé ou CRM illimité
  if (config.crmLimit === null || config.features.includes("multi-crm")) {
    return true;
  }

  // Pour les plans avec limite CRM, on autorise l'accès (la limite est gérée ailleurs)
  return true;
}

// Obtenir les limites de vocaux
export function getVoiceLimits(plan: string): {
  daily: number | null;
  monthly: number | null;
  unlimited: boolean;
} {
  const config = getPlanConfig(plan);

  return {
    daily: config.dailyLimit,
    monthly: config.monthlyQuota,
    unlimited: config.monthlyQuota === null,
  };
}

// Obtenir la limite de connexions CRM
export function getCRMLimit(plan: string): number | null {
  const config = getPlanConfig(plan);
  return config.crmLimit;
}

// Vérifications spécifiques par feature
export function canUseOCR(plan: string): boolean {
  return canAccessFeature(plan, "ocr");
}

export function canUseEmailGeneration(plan: string): boolean {
  return canAccessFeature(plan, "email-generation");
}

export function canUseAnalyticsDashboard(plan: string): boolean {
  return canAccessFeature(plan, "analytics-dashboard");
}

export function canUseTeams(plan: string): boolean {
  return canAccessFeature(plan, "teams");
}

export function canHideBadge(plan: string): boolean {
  return canAccessFeature(plan, "hide-badge");
}

export function hasPrioritySupport(plan: string): boolean {
  return canAccessFeature(plan, "priority-support");
}

// Export pour les tests
export { PLAN_CONFIGS, normalizePlanName };

import { CheckCircle2, Sparkles, AlertCircle, HelpCircle, XCircle, ShieldAlert } from "lucide-react";

/**
 * Badge sur les emails de prospects pour indiquer leur niveau de fiabilite.
 *
 * Priorite (verdict de delivrabilite (Bouncer ou Reoon) trumpe email_validation_status) :
 *   1. deliverability_status=invalid       -> Rouge "Invalide"
 *   2. deliverability_status=risky/disposable/role -> Orange "Risque"
 *   3. deliverability_status=valid         -> Vert "Verifie"
 *   4. fallback email_validation_status : verified / deduced_high / deduced_unverified / unverified
 */

const DELIVERABILITY_CONFIG = {
  valid: {
    icon: CheckCircle2,
    label: "Vérifié",
    description: "Email confirmé valide par vérification SMTP (RCPT TO accepté)",
    classes: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  },
  invalid: {
    icon: XCircle,
    label: "Invalide",
    description: "Vérification : email rejeté (n'existe pas chez le destinataire)",
    classes: "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400",
  },
  risky: {
    icon: ShieldAlert,
    label: "Catch-all",
    description: "Vérification : domaine accepte tout, impossible de vérifier sans envoyer",
    classes: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  },
  disposable: {
    icon: ShieldAlert,
    label: "Jetable",
    description: "Vérification : email jetable / temporaire",
    classes: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  },
  role: {
    icon: ShieldAlert,
    label: "Role",
    description: "Vérification : email générique (contact@, info@, etc.)",
    classes: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  },
  unknown: {
    icon: HelpCircle,
    label: "Indéterminé",
    description: "Vérification : statut indéterminé",
    classes: "bg-foreground/5 text-gray-600 dark:text-white/50",
  },
} as const;

const STATUS_CONFIG = {
  verified: {
    icon: CheckCircle2,
    label: "Vérifié",
    description: "Email confirmé valide par vérification SMTP",
    classes: "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400",
  },
  deduced_high: {
    icon: Sparkles,
    label: "Déduit fiable",
    description: "Email déduit du pattern domaine (>= 85% de confiance)",
    classes: "bg-sky-100 dark:bg-sky-900/30 text-sky-700 dark:text-sky-400",
  },
  deduced_unverified: {
    icon: AlertCircle,
    label: "Non vérifié",
    description: "Email déduit, vérification SMTP indisponible (catch-all ou cap quota)",
    classes: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  },
  unverified: {
    icon: HelpCircle,
    label: "Non vérifié",
    description: "Statut par défaut, aucune vérification effectuée",
    classes: "bg-foreground/5 text-gray-600 dark:text-white/50",
  },
} as const;

type DeliverabilityStatus = keyof typeof DELIVERABILITY_CONFIG;
type EmailStatus = keyof typeof STATUS_CONFIG;

function isKnownDeliverability(s: string | null | undefined): s is DeliverabilityStatus {
  return !!s && s in DELIVERABILITY_CONFIG;
}

function isKnownStatus(s: string | null | undefined): s is EmailStatus {
  return !!s && s in STATUS_CONFIG;
}

interface EmailStatusBadgeProps {
  status: string | null | undefined;
  /** Verdict de délivrabilité (prioritaire sur status si fourni). */
  deliverabilityStatus?: string | null;
  /** Mode "icon" affiche juste l'icone colorée (compact, pour les listes). */
  variant?: "icon" | "full";
  className?: string;
}

export function EmailStatusBadge({ status, deliverabilityStatus, variant = "full", className }: EmailStatusBadgeProps) {
  // Verdict de delivrabilite prioritaire si fourni
  const cfg = isKnownDeliverability(deliverabilityStatus)
    ? DELIVERABILITY_CONFIG[deliverabilityStatus]
    : isKnownStatus(status)
      ? STATUS_CONFIG[status]
      : STATUS_CONFIG.unverified;
  const Icon = cfg.icon;

  if (variant === "icon") {
    return (
      <span
        className={`inline-flex items-center justify-center rounded ${cfg.classes} ${className ?? ""}`}
        title={`${cfg.label} — ${cfg.description}`}
      >
        <Icon className="w-3.5 h-3.5 p-0.5" />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${cfg.classes} ${className ?? ""}`}
      title={cfg.description}
    >
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  );
}

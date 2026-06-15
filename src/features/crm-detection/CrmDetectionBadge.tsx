import { Database, DatabaseZap, Loader2, AlertCircle, RotateCw, Search } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CrmDetection } from "./useCrmDetection";

type Props = {
  detection: CrmDetection | null;
  onRedetect: () => void;
  isRedetecting: boolean;
};

const VARIANT_CLASS = {
  high: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-emerald-500/25",
  medium: "bg-amber-500/10 text-amber-700 dark:text-amber-400 ring-amber-500/25",
  low: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 ring-yellow-500/25",
  none: "bg-muted text-muted-foreground ring-border",
  pending: "bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-blue-500/25",
  failed: "bg-destructive/10 text-destructive ring-destructive/30",
  idle: "bg-muted/60 text-muted-foreground ring-border",
} as const;

const CONFIDENCE_LABEL = {
  high: "haute confiance",
  medium: "confiance moyenne",
  low: "confiance faible",
} as const;

export function CrmDetectionBadge({ detection, onRedetect, isRedetecting }: Props) {
  type Variant = keyof typeof VARIANT_CLASS;
  let variant: Variant = "idle";
  let label = "CRM non détecté";
  let Icon: typeof Database = Search;
  let iconClass = "opacity-60";

  if (!detection) {
    variant = "idle";
    label = "CRM non détecté";
    Icon = Search;
    iconClass = "opacity-60";
  } else if (detection.detection_status === "pending") {
    variant = "pending";
    label = "Détection en cours…";
    Icon = Loader2;
    iconClass = "animate-spin";
  } else if (detection.detection_status === "failed") {
    variant = "failed";
    label = "Détection échouée";
    Icon = AlertCircle;
    iconClass = "";
  } else if (detection.crm_confidence === "none" || !detection.crm_name) {
    variant = "none";
    label = "CRM non identifié";
    Icon = DatabaseZap;
    iconClass = "opacity-40";
  } else {
    variant = detection.crm_confidence;
    label = detection.crm_name;
    Icon = Database;
    iconClass = "";
  }

  const showConfidenceLabel =
    detection?.detection_status === "completed" &&
    (detection.crm_confidence === "high" ||
      detection.crm_confidence === "medium" ||
      detection.crm_confidence === "low");

  return (
    <TooltipProvider delayDuration={150}>
      <div className="flex items-center gap-2 group">
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium ring-1 transition-colors",
                VARIANT_CLASS[variant]
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", iconClass)} />
              <span>{label}</span>
              {showConfidenceLabel && detection && (
                <span className="opacity-60 ml-1">
                  · {CONFIDENCE_LABEL[detection.crm_confidence as keyof typeof CONFIDENCE_LABEL]}
                </span>
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs space-y-1.5 text-xs">
            <CrmTooltipContent detection={detection} />
          </TooltipContent>
        </Tooltip>

        {(!detection || detection.detection_status !== "pending") && (
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "h-6 w-6 transition-opacity",
              detection ? "opacity-0 group-hover:opacity-100" : "opacity-100"
            )}
            onClick={onRedetect}
            disabled={isRedetecting}
            title={detection ? "Re-détecter le CRM" : "Lancer la détection"}
          >
            <RotateCw className={cn("h-3 w-3", isRedetecting && "animate-spin")} />
          </Button>
        )}
      </div>
    </TooltipProvider>
  );
}

function CrmTooltipContent({ detection }: { detection: CrmDetection | null }) {
  if (!detection) {
    return <p>Aucune détection lancée. Cliquez l'icône pour analyser le CRM via BuiltWith et les offres d'emploi.</p>;
  }
  if (detection.detection_status === "pending") {
    return <p>Analyse de BuiltWith et des offres d'emploi en cours…</p>;
  }
  if (detection.detection_status === "failed") {
    return <p>La détection a échoué : {detection.error ?? "raison inconnue"}.</p>;
  }
  if (!detection.crm_name) {
    return <p>Aucun CRM détecté via BuiltWith ni via les offres d'emploi.</p>;
  }
  const signals = detection.crm_signals as {
    builtwith?: { found?: string; category?: string } | null;
    jobs?: unknown[];
    conflict?: unknown;
  };
  const lines: string[] = [];
  if (signals?.builtwith?.found) {
    lines.push(`BuiltWith : ${signals.builtwith.found} (${signals.builtwith.category ?? "—"})`);
  }
  const jobsCount = Array.isArray(signals?.jobs) ? signals.jobs.length : 0;
  if (jobsCount > 0) {
    lines.push(
      `${jobsCount} offre${jobsCount > 1 ? "s" : ""} d'emploi mentionne${jobsCount > 1 ? "nt" : ""} ${detection.crm_name}`
    );
  }
  return (
    <div className="space-y-1">
      <div className="font-medium">Détection : {detection.crm_name}</div>
      {lines.map((line, i) => (
        <div key={i} className="opacity-80">• {line}</div>
      ))}
      {Boolean(signals?.conflict) && (
        <div className="text-amber-600 dark:text-amber-400 mt-1">
          Signal contradictoire entre BuiltWith et les offres
        </div>
      )}
      {detection.detected_at && (
        <div className="opacity-50 mt-1">
          Détecté le {new Date(detection.detected_at).toLocaleDateString("fr-FR")}
        </div>
      )}
    </div>
  );
}

// Types partages entre les modules de detection CRM.
import type { CrmName } from "./signatures.ts";

export type DomainResult = {
  domain: string;        // "abb.com" (sans protocole, sans path)
  source: "fullenrich" | "brave" | "manual";
} | null;

export type Confidence = "high" | "medium" | "low" | "none";

export type SignalSource =
  | "dns_spf"          // include:_spf.crm.com dans le SPF
  | "dns_mx"           // MX record vers le CRM
  | "subdomain_cname"  // crm.boite.com -> *.crmprovider.com
  | "html"             // tracker/form/script dans HTML
  | "text"             // mention dans page legale/privacy
  | "customer_story"   // case study publie par l'editeur sur la boite
  | "jobs"             // mention dans annonces d'emploi
  | "linkedin";        // skills/title des employes (data FullEnrich existante)

export type DetectionSignal = {
  crm: CrmName | string; // string pour les jobs analyzer qui peut renvoyer des libelles libres
  source: SignalSource;
  evidence: string;
  weight_multiplier?: number; // pour booster un signal selon la quantite (ex: N employes)
};

export type DetectionResult = {
  crm_name: string | null;
  confidence: Confidence;
  signals: {
    matched: DetectionSignal[];
    by_crm: Record<string, { sources: SignalSource[]; total_score: number }>;
    marketing_tools: { tool: string; category: string }[];
    conflict: { winner: string; runners_up: string[] } | null;
    domain: string | null;
    domain_source: string | null;
  };
};

// Conserve les types historiques pour eviter de casser les imports existants
export type CompanyMetadata = {
  group_id: string;
  name: string;
  siren?: string;
  city?: string;
  existing_domain?: string;
  workspace_id?: string;
};

export type BuiltWithResult = {
  found: string | null;
  category: string | null;
  raw_detections: string[];
} | null;

export type JobMatch = {
  source: string;
  job_url: string;
  job_title: string;
  matched_crms: string[];
};

export type JobsAnalysisResult = JobMatch[];

export type { CrmName };

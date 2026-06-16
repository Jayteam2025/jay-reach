// Renderer déterministe des messages prospection.
// Source de vérité : table `prospect_message_templates` (DB).
// Mirror : keep in sync with src/lib/prospect-template-renderer.ts

export type TargetCategory = "hr" | "director" | "field_sales";

export interface ProspectProfileForRender {
  id: string;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  company_name: string;
  company_sector: string | null;
  target_category?: TargetCategory;
  persona_id?: string | null;
}

export interface SignalForRender {
  raw_content: string | null;
  extracted_data: Record<string, unknown> | null;
}

export interface EnrichmentForRender {
  linkedin?: {
    headline?: string;
    about?: string;
    current_title?: string;
    current_company?: string;
  } | null;
  company_news?: string | null;
  company_address?: string | null;
}

export interface BrandForRender {
  signature?: string | null;
  brand_name?: string | null;
}

export interface RenderContext {
  profile: ProspectProfileForRender;
  signal: SignalForRender | null;
  enrichment: EnrichmentForRender;
  brand?: BrandForRender | null;
  /** Étiquette du persona (e.g. 'Directeur Commercial') pour fallback job_title. */
  personaLabel?: string | null;
}

export interface RenderResult {
  subject: string | null;
  body: string;
  icebreaker: string;
}

export interface MessageTemplate {
  target_category?: TargetCategory;
  persona_id?: string | null;
  channel: string;
  subject: string | null;
  body: string;
  icebreaker_template: string;
}

export const BLANK = Symbol("BLANK");
export type Line = string | typeof BLANK;

// Conserve pour backward compat (tests legacy). Pas utilise par renderTemplate.
export function formatBody(lines: Line[]): string {
  const joined = lines
    .map((l) => (l === BLANK ? "" : l.trim()))
    .join("\n");
  return joined
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function normalizeJobTitle(raw: string, companyName?: string): string {
  let s = raw;
  s = s.replace(/\([^)]*\)/g, "");
  s = s.replace(/\b(JR|REF|RH)\d+\b/gi, "");
  s = s.replace(/\bB\s*to\s*B\b/gi, "");
  s = s.replace(/\bB2B\b/gi, "");
  s = s.replace(/\b[hfm]\s*[\/.\-]\s*[hfm]\b/gi, "");
  // Type de contrat / temps de travail : bruit ("technicien de maintenance CDI"),
  // ton automatique dans les messages.
  s = s.replace(/\b(cdi|cdd|cdii|stage|stagiaire|alternance|alternant|apprenti|apprentissage|int[ée]rim|freelance|temps\s+(?:plein|partiel)|mi-temps)\b/gi, "");
  if (companyName && companyName.trim()) {
    const escaped = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    s = s.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "");
  }
  const slashIdx = s.indexOf(" / ");
  if (slashIdx > 0) s = s.slice(0, slashIdx);
  s = s.replace(/\s+[-–—]\s+/g, " ");
  s = s.replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, "");
  s = s.replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

export function normalizeCompanyName(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed.includes(" ") &&
    trimmed.length > 3 &&
    trimmed === trimmed.toUpperCase() &&
    /^[A-ZÀ-Ý]+$/.test(trimmed)
  ) {
    return trimmed[0] + trimmed.slice(1).toLowerCase();
  }
  return trimmed;
}

export function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

export function pickVariant<T>(variants: T[], seed: string): T {
  if (variants.length === 0) throw new Error("pickVariant: empty variants");
  const idx = fnv1a(seed) % variants.length;
  return variants[idx];
}

function extractJobTitle(ctx: RenderContext, fallback: string): string {
  const raw = ctx.signal?.extracted_data?.job_title as string | undefined;
  if (!raw || !raw.trim()) return fallback;
  return normalizeJobTitle(raw);
}

export interface SubstituteVars {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  salutation?: string;
  brandSignature?: string;
  brandName?: string;
}

export function substitute(tpl: string, vars: SubstituteVars): string {
  return tpl
    .replace(/\{first_name\}/g, vars.firstName)
    .replace(/\{last_name\}/g, vars.lastName)
    .replace(/\{company\}/g, vars.company)
    .replace(/\{job_title\}/g, vars.jobTitle)
    .replace(/\{salutation\}/g, vars.salutation ?? "")
    .replace(/\{brand_signature\}/g, vars.brandSignature ?? "")
    .replace(/\{brand_name\}/g, vars.brandName ?? "");
}

function normalizeBody(s: string): string {
  return s
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function renderTemplate(
  template: MessageTemplate,
  ctx: RenderContext,
): RenderResult {
  const firstName = ctx.profile.first_name?.trim() ?? "";
  const lastName = ctx.profile.last_name?.trim() ?? "";
  const company = normalizeCompanyName(ctx.profile.company_name);
  const jobTitle = extractJobTitle(
    ctx,
    ctx.personaLabel || "",
  );

  const salutation = firstName
    ? `Bonjour ${firstName},`
    : `Bonjour Madame/Monsieur ${lastName},`;

  const baseVars: SubstituteVars = {
    firstName,
    lastName,
    company,
    jobTitle,
    salutation,
    brandSignature: ctx.brand?.signature ?? "",
    brandName: ctx.brand?.brand_name ?? "",
  };

  const subject = template.subject
    ? substitute(template.subject, baseVars)
    : null;

  const body = normalizeBody(substitute(template.body, baseVars));

  const icebreaker = substitute(template.icebreaker_template, baseVars);

  return { subject, body, icebreaker };
}

// Wrapper qui prend le template charge en amont. L'appelant doit passer
// le template correspondant a (ctx.profile.persona_id, channel).
// Retourne null si le template est manquant ou ne correspond pas au persona.
export function renderDeterministic(
  ctx: RenderContext,
  channel: string,
  template: MessageTemplate | null | undefined,
): RenderResult | null {
  if (!template) return null;
  if (template.channel !== channel) return null;
  // Match strict par persona_id (modele Jay Reach uniquement).
  const matchesPersona =
    template.persona_id && ctx.profile.persona_id &&
    template.persona_id === ctx.profile.persona_id;
  if (!matchesPersona) return null;
  return renderTemplate(template, ctx);
}

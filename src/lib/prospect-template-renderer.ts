// Renderer client-side pour la preview de templates dans l'UI Config.
// Mirror : keep in sync with supabase/functions/_shared/prospect-renderer.ts

export type TargetCategory = 'hr' | 'director' | 'field_sales';

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

export interface RenderContext {
  profile: ProspectProfileForRender;
  signal: SignalForRender | null;
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

export function normalizeJobTitle(raw: string, companyName?: string): string {
  let s = raw;
  s = s.replace(/\([^)]*\)/g, '');
  s = s.replace(/\b(JR|REF|RH)\d+\b/gi, '');
  s = s.replace(/\bB\s*to\s*B\b/gi, '');
  s = s.replace(/\bB2B\b/gi, '');
  s = s.replace(/\b[hfm]\s*[/.-]\s*[hfm]\b/gi, '');
  // Type de contrat / temps de travail : bruit ("technicien de maintenance CDI"),
  // donne un ton automatique dans les messages.
  s = s.replace(/\b(cdi|cdd|cdii|stage|stagiaire|alternance|alternant|apprenti|apprentissage|int[ée]rim|freelance|temps\s+(?:plein|partiel)|mi-temps)\b/gi, '');
  if (companyName && companyName.trim()) {
    const escaped = companyName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  const slashIdx = s.indexOf(' / ');
  if (slashIdx > 0) s = s.slice(0, slashIdx);
  s = s.replace(/\s+[-–—]\s+/g, ' ');
  s = s.replace(/^\s*[-–—]\s*|\s*[-–—]\s*$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.toLowerCase();
}

export function normalizeCompanyName(raw: string): string {
  const trimmed = raw.trim();
  if (
    !trimmed.includes(' ') &&
    trimmed.length > 3 &&
    trimmed === trimmed.toUpperCase() &&
    /^[A-ZÀ-Ý]+$/.test(trimmed)
  ) {
    return trimmed[0] + trimmed.slice(1).toLowerCase();
  }
  return trimmed;
}

function extractJobTitle(ctx: RenderContext, fallback: string): string {
  const raw = ctx.signal?.extracted_data?.job_title as string | undefined;
  if (!raw || !raw.trim()) return fallback;
  return normalizeJobTitle(raw);
}

interface SubstituteVars {
  firstName: string;
  lastName: string;
  company: string;
  jobTitle: string;
  salutation?: string;
}

function substitute(tpl: string, vars: SubstituteVars): string {
  return tpl
    .replace(/\{first_name\}/g, vars.firstName)
    .replace(/\{last_name\}/g, vars.lastName)
    .replace(/\{company\}/g, vars.company)
    .replace(/\{job_title\}/g, vars.jobTitle)
    .replace(/\{salutation\}/g, vars.salutation ?? '');
}

function normalizeBody(s: string): string {
  return s
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function renderTemplate(
  template: MessageTemplate,
  ctx: RenderContext,
): RenderResult {
  const firstName = ctx.profile.first_name?.trim() ?? '';
  const lastName = ctx.profile.last_name?.trim() ?? '';
  const company = normalizeCompanyName(ctx.profile.company_name);
  const jobTitle = extractJobTitle(ctx, ctx.personaLabel || '');

  const salutation = firstName
    ? `Bonjour ${firstName},`
    : `Bonjour Madame/Monsieur ${lastName},`;

  const baseVars: SubstituteVars = { firstName, lastName, company, jobTitle, salutation };

  const subject = template.subject ? substitute(template.subject, baseVars) : null;
  const body = normalizeBody(substitute(template.body, baseVars));
  const icebreaker = substitute(template.icebreaker_template, baseVars);

  return { subject, body, icebreaker };
}

// Profil demo fixe pour la preview UI
export const DEMO_CONTEXTS: Record<TargetCategory, RenderContext> = {
  field_sales: {
    profile: {
      id: 'demo-field-sales-issam',
      first_name: 'Issam',
      last_name: 'Amrane',
      job_title: null,
      company_name: 'Rexel',
      company_sector: 'Distribution',
      target_category: 'field_sales',
    },
    signal: {
      raw_content:
        'Rexel recrute un technico-commercial itinérant industrie f/h en Île-de-France',
      extracted_data: { job_title: 'Technico-commercial itinérant industrie f/h' },
    },
  },
  hr: {
    profile: {
      id: 'demo-hr-marie',
      first_name: 'Marie Laure',
      last_name: 'Jaouen',
      job_title: 'Responsable RH',
      company_name: 'Rexel',
      company_sector: 'Distribution',
      target_category: 'hr',
    },
    signal: {
      raw_content: null,
      extracted_data: { job_title: 'Technico-commercial itinérant industrie f/h' },
    },
  },
  director: {
    profile: {
      id: 'demo-director-franck',
      first_name: 'Franck',
      last_name: 'Guymar',
      job_title: 'Directeur Commercial',
      company_name: 'Rexel',
      company_sector: 'Distribution',
      target_category: 'director',
    },
    signal: {
      raw_content: null,
      extracted_data: { job_title: 'Technico-commercial itinérant industrie f/h' },
    },
  },
};

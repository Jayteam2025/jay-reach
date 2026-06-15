// ============================================================================
// LinkedInData — vendoré from meeting-prep-types (coupling severed)
// ============================================================================
// Type used by apify-linkedin-profile scraper. Moved here to break assistant
// dependency for prospection-standalone build.

export interface LinkedInPost {
  title?: string;
  snippet?: string;
  link?: string;
  date?: string;
}

export interface LinkedInActivity {
  title?: string;
  snippet?: string;
  link?: string;
  date?: string;
}

export interface LinkedInData {
  profileUrl?: string;
  headline?: string;
  about?: string;
  /** Email returned by Apify actor in "with email" mode (SMTP-validated). Optional. */
  email?: string;
  currentPosition?: {
    title: string;
    company: string;
    since?: string;
    description?: string;
  };
  previousPositions?: Array<{
    title: string;
    company: string;
    years?: string;
    description?: string;
  }>;
  education?: Array<{ school: string; degree?: string; years?: string }>;
  skills?: string[];
  photoUrl?: string;
  location?: string;
  connectionsCount?: number;
  followerCount?: number;
  posts?: LinkedInPost[];
  activities?: LinkedInActivity[];
  /** Enrichment mode used for this profile (debug/analytics) */
  _enrichmentMode?: "apify" | "legacy_brave";
  /** true if all candidates were rejected by HomonymScorer */
  verificationFailed?: boolean;
}

const APIFY_API = "https://api.apify.com/v2";
// Default: harvestapi (0.004$/profile, same provider as posts+search, $29 budget-friendly).
// Alternative: dev_fusion~LinkedIn-Profile-Scraper (0.01$/profile).
const ACTOR_ID = Deno.env.get("APIFY_PROFILE_ACTOR_ID") || "harvestapi~linkedin-profile-scraper";
const TIMEOUT_MS = 60_000;

interface HarvestDateObj {
  month?: string;
  year?: number;
  text?: string;
}

interface HarvestExperience {
  position?: string;         // harvestapi
  companyName?: string;
  description?: string;
  location?: string;
  employmentType?: string;
  workplaceType?: string;
  startDate?: HarvestDateObj | string;
  endDate?: HarvestDateObj | string;
  duration?: string;
  // Legacy (dev_fusion) fallbacks
  title?: string;
  jobStartedOn?: string;
  jobEndedOn?: string;
  jobDescription?: string | null;
  jobLocation?: string;
}

interface HarvestEducation {
  schoolName?: string;       // harvestapi
  degree?: string;
  fieldOfStudy?: string | null;
  startDate?: HarvestDateObj | string;
  endDate?: HarvestDateObj | string;
  period?: string | { startedOn?: { year?: number; month?: number }; endedOn?: { year?: number; month?: number } };
  // Legacy (dev_fusion) fallbacks
  title?: string;
  subtitle?: string;
  degreeName?: string;
}

interface HarvestSkill {
  name?: string;             // harvestapi
  title?: string;            // dev_fusion
}

interface HarvestLocation {
  linkedinText?: string;
  countryCode?: string;
  parsed?: {
    text?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

interface HarvestCurrentPositionEntry {
  companyName?: string;
}

interface ApifyPayload {
  // harvestapi fields
  firstName?: string;
  lastName?: string;
  fullName?: string;
  headline?: string;
  about?: string | null;
  photo?: string;                            // harvestapi
  location?: HarvestLocation | string;
  currentPosition?: HarvestCurrentPositionEntry[] | string;
  experience?: HarvestExperience[];          // harvestapi (singular)
  experiences?: HarvestExperience[];         // dev_fusion (plural)
  education?: HarvestEducation[];            // harvestapi (singular)
  educations?: HarvestEducation[];           // dev_fusion (plural)
  skills?: string[] | HarvestSkill[];
  connectionsCount?: number;
  followerCount?: number;
  connections?: number;
  followers?: number;
  linkedinUrl?: string;
  publicIdentifier?: string;
  // Legacy (dev_fusion)
  jobTitle?: string;
  companyName?: string;
  jobStartedOn?: string;
  jobLocation?: string;
  profilePicture?: string;
  profilePic?: string;
  profilePicHighQuality?: string;
  addressWithCountry?: string;
  addressWithoutCountry?: string;
  city?: string;
  linkedinPublicUrl?: string;
  // Email fields possibles (selon le mode "with email" des differents actors)
  email?: string;
  emailAddress?: string;
  emails?: string[] | { email?: string; address?: string }[];
}

export class ApifyLinkedInProfileScraper {
  private token: string;
  private withEmail: boolean;

  constructor(token: string, options: { withEmail?: boolean } = {}) {
    this.token = token;
    this.withEmail = options.withEmail ?? false;
  }

  async scrapeByUrl(url: string): Promise<LinkedInData | null> {
    const results = await this.scrapeByUrls([url]);
    return results[0] ?? null;
  }

  /**
   * Batch scrape — un seul appel Apify pour N URLs.
   * Retourne un tableau aligné avec les URLs en entrée (null pour les URLs sans résultat).
   */
  async scrapeByUrls(urls: string[]): Promise<(LinkedInData | null)[]> {
    if (urls.length === 0) return [];
    const cleanUrls = urls.map((u) => this.cleanLinkedInUrl(u));
    try {
      const endpoint = `${APIFY_API}/acts/${ACTOR_ID}/run-sync-get-dataset-items`;
      const params = new URLSearchParams({ token: this.token, timeout: "120", format: "json" });

      const isHarvest = ACTOR_ID.startsWith("harvestapi");
      const harvestMode = this.withEmail
        ? "Profile details + email search ($10 per 1k)"
        : "Profile details no email ($4 per 1k)";
      const inputBody = isHarvest
        ? { queries: cleanUrls, profileScraperMode: harvestMode }
        : { profileUrls: cleanUrls };

      const response = await fetch(`${endpoint}?${params}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputBody),
        signal: AbortSignal.timeout(TIMEOUT_MS * 2),
      });

      if (!response.ok) {
        console.warn(`[apify-profile] HTTP ${response.status} for ${cleanUrls.length} URLs`);
        return cleanUrls.map(() => null);
      }

      const items = await response.json() as ApifyPayload[];
      if (!Array.isArray(items)) return cleanUrls.map(() => null);

      // Fast path: 1 URL in, 1 item out → pas besoin de matcher
      if (cleanUrls.length === 1 && items.length === 1) {
        const normalized = this.normalize(items[0], cleanUrls[0]);
        console.log(
          `[apify-profile] ${cleanUrls[0]} → ${this.fullName(items[0])} · ${normalized.currentPosition?.company ?? "no-company"}`,
        );
        return [normalized];
      }

      // Match chaque URL à son payload par URL normalisee OU par slug
      // publicIdentifier. Necessaire car harvestapi retourne des variantes
      // (scheme, trailing slash, locale) qui cassaient le match exact.
      const byUrl = new Map<string, ApifyPayload>();
      const bySlug = new Map<string, ApifyPayload>();
      for (const item of items) {
        const rawUrl = item.linkedinUrl || item.linkedinPublicUrl || "";
        const key = this.cleanLinkedInUrl(rawUrl);
        if (key) byUrl.set(key, item);
        const slug = (typeof item.publicIdentifier === "string"
          ? item.publicIdentifier.toLowerCase()
          : null) || this.publicIdOf(rawUrl);
        if (slug) bySlug.set(slug, item);
      }

      const results = cleanUrls.map((url, idx) => {
        let payload = byUrl.get(url);
        if (!payload) {
          const slug = this.publicIdOf(urls[idx]);
          if (slug) payload = bySlug.get(slug);
        }
        if (!payload) return null;
        const normalized = this.normalize(payload, url);
        const expCount = (payload.experience ?? payload.experiences ?? []).length;
        console.log(
          `[apify-profile] ${url} → ${this.fullName(payload)} · ${normalized.currentPosition?.company ?? "no-company"} · exp=${expCount}`,
        );
        return normalized;
      });
      console.log(`[apify-profile] batch: ${urls.length} URLs requested, ${items.length} results, ${results.filter((r) => r).length} matched`);
      return results;
    } catch (error) {
      console.error(`[apify-profile] Batch exception:`, error instanceof Error ? error.message : String(error));
      return cleanUrls.map(() => null);
    }
  }

  private fullName(p: ApifyPayload): string {
    if (p.fullName) return p.fullName;
    const name = [p.firstName, p.lastName].filter(Boolean).join(" ").trim();
    return name || "?";
  }

  private cleanLinkedInUrl(url: string): string {
    // Normalise pour matching robuste : lowercase, strip scheme+www,
    // strip query, strip locale suffix, strip trailing slash.
    const noQuery = url.split("?")[0].split("#")[0];
    const withoutLocale = noQuery.replace(/\/(en|fr|de|es|it|nl|pt|ja|ko|zh)\/?$/, "/");
    return withoutLocale
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
  }

  /** Extrait le publicIdentifier (slug) d'une URL LinkedIn, utilise comme cle
   *  de match alternatif quand les URLs ne matchent pas exactement. */
  private publicIdOf(url: string): string | null {
    const m = url.match(/\/in\/([^/?#]+)/i);
    return m ? m[1].toLowerCase() : null;
  }

  private formatDateObj(d?: HarvestDateObj | string): string | undefined {
    if (!d) return undefined;
    if (typeof d === "string") return d;
    if (d.text) return d.text;
    if (d.year) return d.month ? `${d.month} ${d.year}` : String(d.year);
    return undefined;
  }

  private normalize(payload: ApifyPayload, sourceUrl: string): LinkedInData {
    const result: LinkedInData = {
      _enrichmentMode: "apify",
      profileUrl: payload.linkedinUrl || payload.linkedinPublicUrl || sourceUrl,
    };

    if (payload.headline) result.headline = payload.headline;

    // Email (mode "with email" uniquement) — accepte string simple, array de
    // strings, ou array d'objets { email } / { address } selon le provider.
    const extractedEmail = (() => {
      if (typeof payload.email === "string" && payload.email.includes("@")) {
        return payload.email.trim();
      }
      if (typeof payload.emailAddress === "string" && payload.emailAddress.includes("@")) {
        return payload.emailAddress.trim();
      }
      if (Array.isArray(payload.emails) && payload.emails.length > 0) {
        const first = payload.emails[0];
        if (typeof first === "string" && first.includes("@")) return first.trim();
        if (first && typeof first === "object") {
          const obj = first as { email?: string; address?: string };
          if (obj.email && obj.email.includes("@")) return obj.email.trim();
          if (obj.address && obj.address.includes("@")) return obj.address.trim();
        }
      }
      return null;
    })();
    if (extractedEmail) result.email = extractedEmail;

    if (payload.about) {
      result.about = payload.about.length > 2000
        ? payload.about.substring(0, 2000)
        : payload.about;
    }

    // Experience — harvestapi uses `experience`, dev_fusion uses `experiences`
    const exps = payload.experience ?? payload.experiences ?? [];

    // Current position — harvestapi has currentPosition[] with just companyName, title is in experience[0].position
    let currentCompany = "";
    if (Array.isArray(payload.currentPosition) && payload.currentPosition.length > 0) {
      currentCompany = payload.currentPosition[0].companyName || "";
    } else if (typeof payload.currentPosition === "string") {
      currentCompany = payload.currentPosition;
    }

    if (exps.length > 0) {
      const first = exps[0];
      const title = first.position || first.title || payload.jobTitle || "";
      const company = first.companyName || currentCompany || payload.companyName || "";
      result.currentPosition = { title, company };
      const startedOn = this.formatDateObj(first.startDate) || first.jobStartedOn;
      if (startedOn) result.currentPosition.since = startedOn;
      const desc = first.description || first.jobDescription;
      if (desc) {
        result.currentPosition.description = desc.length > 500
          ? desc.substring(0, 500)
          : desc;
      }
    } else if (currentCompany || payload.jobTitle || payload.companyName) {
      result.currentPosition = {
        title: payload.jobTitle || "",
        company: currentCompany || payload.companyName || "",
      };
      if (payload.jobStartedOn) result.currentPosition.since = payload.jobStartedOn;
    }

    // Previous positions
    if (exps.length > 1) {
      result.previousPositions = exps.slice(1).map((exp) => {
        const desc = exp.description || exp.jobDescription;
        const start = this.formatDateObj(exp.startDate) || exp.jobStartedOn;
        const end = this.formatDateObj(exp.endDate) || exp.jobEndedOn;
        return {
          title: exp.position || exp.title || "",
          company: exp.companyName || "",
          years: this.formatYears(start, end),
          description: desc
            ? desc.length > 300 ? desc.substring(0, 300) : desc
            : undefined,
        };
      });
    }

    // Education — harvestapi uses `education`, dev_fusion uses `educations`
    const edus = payload.education ?? payload.educations ?? [];
    if (edus.length > 0) {
      result.education = edus.map((edu) => {
        const school = edu.schoolName || edu.title || "";
        const degreeBase = edu.degree || edu.degreeName || edu.subtitle;
        const degree = degreeBase && edu.fieldOfStudy
          ? `${degreeBase} · ${edu.fieldOfStudy}`
          : degreeBase || edu.fieldOfStudy || undefined;
        let years: string | undefined;
        if (typeof edu.period === "string") {
          years = edu.period;
        } else if (edu.period && typeof edu.period === "object") {
          const startYear = edu.period.startedOn?.year;
          const endYear = edu.period.endedOn?.year;
          if (startYear && endYear) years = `${startYear} — ${endYear}`;
          else if (startYear) years = String(startYear);
          else if (endYear) years = String(endYear);
        } else {
          const start = this.formatDateObj(edu.startDate);
          const end = this.formatDateObj(edu.endDate);
          years = this.formatYears(start, end);
        }
        return { school, degree, years };
      });
    }

    // Skills
    if (payload.skills && payload.skills.length > 0) {
      const raw = payload.skills;
      const normalized = (raw as Array<string | HarvestSkill>).map((skill) => {
        if (typeof skill === "string") return skill;
        return skill.name || skill.title || "";
      }).filter(Boolean);
      result.skills = normalized.slice(0, 15);
    }

    // Photo — harvestapi uses `photo`
    const photo = payload.photo || payload.profilePicHighQuality || payload.profilePic || payload.profilePicture;
    if (photo) result.photoUrl = photo;

    // Location — harvestapi uses object, dev_fusion uses strings
    let loc: string | undefined;
    if (typeof payload.location === "string") {
      loc = payload.location;
    } else if (payload.location && typeof payload.location === "object") {
      loc = payload.location.parsed?.text || payload.location.linkedinText;
    }
    loc = loc || payload.addressWithCountry || payload.addressWithoutCountry || payload.city || undefined;
    if (!loc) {
      const expLoc = exps[0]?.location || exps[0]?.jobLocation || payload.jobLocation;
      if (expLoc) loc = expLoc;
    }
    if (loc) result.location = loc;

    // Counts
    const connections = payload.connectionsCount ?? payload.connections;
    const followers = payload.followerCount ?? payload.followers;
    if (typeof connections === "number") result.connectionsCount = connections;
    if (typeof followers === "number") result.followerCount = followers;

    return result;
  }

  private formatYears(start?: string, end?: string): string | undefined {
    if (!start && !end) return undefined;
    if (start && end) return `${start} — ${end}`;
    return start || end;
  }

  static estimateCostUSD(): number {
    // harvestapi default: $0.004. dev_fusion: $0.01. Conservative ceiling for budget tracking.
    return 0.01;
  }
}

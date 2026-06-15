// Resolution DNS via DoH (DNS over HTTPS) — fonctionne en edge runtime sans
// permissions speciales. Cloudflare 1.1.1.1 par defaut, Google fallback.
//
// On collecte : TXT (pour SPF), MX, et CNAMEs des sous-domaines proches du
// CRM (crm.boite.com, app.boite.com, etc.). Tout ce qu'on trouve passe par
// les patterns de signatures.ts.

import {
  DNS_SPF_PATTERNS,
  DNS_MX_PATTERNS,
  SUBDOMAIN_CNAME_PATTERNS,
  SUBDOMAINS_TO_PROBE,
  matchAllPatterns,
  matchNonCrm,
  type CrmName,
} from "./signatures.ts";

const DOH_ENDPOINT = "https://cloudflare-dns.com/dns-query";

type DoHAnswer = { name: string; type: number; TTL?: number; data: string };
type DoHResponse = { Status: number; Answer?: DoHAnswer[]; Authority?: DoHAnswer[] };

const TYPE_TXT = 16;
const TYPE_MX = 15;
const TYPE_CNAME = 5;

async function dohQuery(name: string, type: number): Promise<string[]> {
  const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=${type}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as DoHResponse;
    if (data.Status !== 0 || !data.Answer) return [];
    return data.Answer.filter((a) => a.type === type).map((a) => a.data);
  } catch {
    return [];
  }
}

export type DnsScanResult = {
  spf_includes: string[];          // tous les include:xxx trouves
  mx_records: string[];             // exchanges MX
  subdomain_cnames: { sub: string; cname: string }[];
  matched_crms: { crm: CrmName; source: "dns_spf" | "dns_mx" | "subdomain_cname"; evidence: string }[];
  marketing_tools: { tool: string; category: string }[];
};

/**
 * Scanne le DNS d'un domaine pour identifier les CRMs (et outils marketing).
 * En parallele : TXT du domaine + MX + CNAMEs des sous-domaines courants.
 */
export async function scanDnsForCrm(domain: string): Promise<DnsScanResult> {
  const result: DnsScanResult = {
    spf_includes: [],
    mx_records: [],
    subdomain_cnames: [],
    matched_crms: [],
    marketing_tools: [],
  };

  // 1. TXT records (SPF)
  const [txtRecords, mxRecords, ...subCnameResults] = await Promise.all([
    dohQuery(domain, TYPE_TXT),
    dohQuery(domain, TYPE_MX),
    ...SUBDOMAINS_TO_PROBE.map((sub) =>
      dohQuery(`${sub}.${domain}`, TYPE_CNAME).then((cnames) => ({ sub, cnames })),
    ),
  ]);

  // SPF parsing
  const spfText = txtRecords
    .map((r) => r.replace(/^"|"$/g, ""))
    .filter((r) => /^v=spf1/i.test(r))
    .join(" ");
  if (spfText) {
    // Match SPF patterns directement sur le SPF complet (capture les variants)
    const spfMatches = matchAllPatterns(DNS_SPF_PATTERNS, spfText);
    for (const m of spfMatches) {
      result.matched_crms.push({ crm: m.crm, source: "dns_spf", evidence: m.pattern });
    }
    // Extraction includes pour debug et detection non-CRM
    const includes = [...spfText.matchAll(/include:([^\s]+)/gi)].map((m) => m[1].toLowerCase());
    result.spf_includes = includes;
  }

  // Aussi, scanner *tous* les TXT records (pas seulement SPF) pour les codes verification
  // Brevo/Mailchimp/etc. (`brevo-code:`, `mandrill_verify`, ...)
  const allTxt = txtRecords.join(" ").toLowerCase();
  result.marketing_tools.push(...matchNonCrm(allTxt));
  const nonCrmCrmMatches = matchAllPatterns(DNS_SPF_PATTERNS, allTxt);
  // Note : pas de re-push si deja matche via SPF — dedupe en sortie

  // MX
  const mxExchanges = mxRecords
    .map((r) => r.split(/\s+/).pop() ?? r)
    .map((e) => e.replace(/\.$/, "").toLowerCase());
  result.mx_records = mxExchanges;
  for (const exchange of mxExchanges) {
    const matches = matchAllPatterns(DNS_MX_PATTERNS, exchange);
    for (const m of matches) {
      result.matched_crms.push({ crm: m.crm, source: "dns_mx", evidence: exchange });
    }
  }

  // Sub-domain CNAMEs
  for (const { sub, cnames } of subCnameResults as { sub: string; cnames: string[] }[]) {
    for (const cname of cnames) {
      const cleaned = cname.replace(/\.$/, "").toLowerCase();
      result.subdomain_cnames.push({ sub, cname: cleaned });
      const matches = matchAllPatterns(SUBDOMAIN_CNAME_PATTERNS, cleaned);
      for (const m of matches) {
        result.matched_crms.push({ crm: m.crm, source: "subdomain_cname", evidence: `${sub}.${domain} -> ${cleaned}` });
      }
    }
  }

  // Dedupe matched_crms par (crm, source)
  const seen = new Set<string>();
  result.matched_crms = result.matched_crms.filter((m) => {
    const k = `${m.crm}|${m.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return result;
}

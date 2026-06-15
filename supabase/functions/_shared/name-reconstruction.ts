/**
 * Reconstruction de noms a partir de l'email quand le scraper LinkedIn a
 * stocke un nom anonymise ("Marie W.") ou en MAJUSCULES ("LAURENT").
 *
 * Le gate (email-gate.ts:isSuspiciousName) refuse les noms anonymises pour
 * eviter d'envoyer "Bonjour Marie W.,". Ce helper sauve le cas quand l'email
 * contient deja le nom complet (typique FullEnrich qui devine puis verifie).
 *
 * Conditions safety pour le backfill :
 *  - Email format `prenom.nom@domaine`
 *  - Le prenom dans l'email matche EXACTEMENT le first_name scrape (lowercase)
 *  - L'initiale du last_name anonymise matche celle du nom dans l'email
 *    (evite de melanger 2 personnes si le scraper a confondu)
 */

function isSuspiciousLastName(name: string): boolean {
  const t = name.trim();
  if (t.length < 2) return true;
  if (/\.$/.test(t)) return true;
  if (/^[A-Z]\.?$/.test(t)) return true;
  return false;
}

function isAllCaps(name: string): boolean {
  const t = name.trim();
  if (t.length < 2) return false;
  if (!/[A-ZÀ-Ý]/.test(t)) return false;
  return t === t.toUpperCase() && !/[a-zà-ÿ]/.test(t);
}

function capitalize(s: string): string {
  return s.trim().split(/(\s+|-|')/).map(p => {
    if (/^[\s\-']+$/.test(p) || p.length === 0) return p;
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }).join("");
}

export type ReconstructResult = {
  firstName: string;
  lastName: string;
  changed: boolean;
};

export function reconstructNameFromEmail(
  firstName: string,
  lastName: string,
  email: string | null,
): ReconstructResult {
  let fn = firstName;
  let ln = lastName;

  // 1. Backfill last_name anonymise depuis email si format prenom.nom@
  if (email && isSuspiciousLastName(ln)) {
    const local = email.split("@")[0]?.toLowerCase().trim() ?? "";
    if (local.includes(".")) {
      const parts = local.split(".").filter(Boolean);
      if (parts.length === 2) {
        const [emailFirst, emailLast] = parts;
        const fnLower = fn.toLowerCase().replace(/\s+/g, "");
        // Le prenom doit matcher exactement la 1ere partie de l'email
        if (fnLower && emailFirst === fnLower && emailLast.length >= 2) {
          // L'initiale du nom anonymise doit matcher celle du nom dans l'email
          const lnFirstChar = ln.replace(/\.$/, "").trim().charAt(0).toLowerCase();
          if (!lnFirstChar || lnFirstChar === emailLast.charAt(0).toLowerCase()) {
            ln = capitalize(emailLast);
          }
        }
      }
    }
  }

  // 2. Normalisation ALL CAPS -> Capitalize (cosmetique pour Hello {prenom})
  if (isAllCaps(fn)) fn = capitalize(fn);
  if (isAllCaps(ln)) ln = capitalize(ln);

  return {
    firstName: fn,
    lastName: ln,
    changed: fn !== firstName || ln !== lastName,
  };
}

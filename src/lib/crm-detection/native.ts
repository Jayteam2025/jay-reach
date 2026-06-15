// Liste des CRMs nativement integres dans Jay (connecteurs OAuth + actions disponibles).
// Si la detection auto identifie un de ces CRMs, on highlight la fiche dans la sidebar
// — c'est un prospect a tres fort potentiel de conversion (zero friction onboarding).

const JAY_NATIVE_CRMS_NORMALIZED = new Set([
  "salesforce",
  "hubspot",
  "pipedrive",
  "zoho",
  "microsoft dynamics",
  "dynamics",
  "odoo",
  "teamleader",
  "jardipro",
]);

/**
 * Verifie si le CRM detecte est integre nativement dans Jay.
 * Comparaison case-insensitive et tolere les variantes ("Microsoft Dynamics 365",
 * "Dynamics", "Salesforce.com", etc.).
 */
export function isJayNativeCrm(crmName: string | null | undefined): boolean {
  if (!crmName) return false;
  const norm = crmName.toLowerCase().trim();
  if (JAY_NATIVE_CRMS_NORMALIZED.has(norm)) return true;
  // Tolerance : "Salesforce.com", "Microsoft Dynamics 365", "Zoho CRM"
  for (const native of JAY_NATIVE_CRMS_NORMALIZED) {
    if (norm.includes(native)) return true;
  }
  return false;
}

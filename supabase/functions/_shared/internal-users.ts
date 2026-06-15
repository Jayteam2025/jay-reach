// Server-side equivalent of src/lib/analytics/internal-users.ts
// Same INTERNAL_EMAILS list — keep in sync if updated.
// Used by email-recognition cron to gate Mistral cost during rollout
// (admin-only phase).

// Configure internal emails and domains for your deployment.
// These are typically admin/team emails that may have special privileges.
const INTERNAL_EMAILS = new Set<string>([
  // Add your internal team emails here
]);

const INTERNAL_DOMAINS = [
  // Add your internal company domains here (e.g., "company.com")
];

export function isInternalEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  if (INTERNAL_EMAILS.has(lower)) return true;
  return INTERNAL_DOMAINS.some((d) => lower.endsWith("@" + d));
}

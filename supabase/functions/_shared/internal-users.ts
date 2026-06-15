// Server-side equivalent of src/lib/analytics/internal-users.ts
// Same INTERNAL_EMAILS list — keep in sync if updated.
// Used by email-recognition cron to gate Mistral cost during rollout
// (admin-only phase).

const INTERNAL_EMAILS = new Set<string>([
  "removed@example.invalid",
  "removed@example.invalid",
]);

const INTERNAL_DOMAINS = ["jay-assistant.fr"];

export function isInternalEmail(email?: string | null): boolean {
  if (!email) return false;
  const lower = email.toLowerCase().trim();
  if (INTERNAL_EMAILS.has(lower)) return true;
  return INTERNAL_DOMAINS.some((d) => lower.endsWith("@" + d));
}

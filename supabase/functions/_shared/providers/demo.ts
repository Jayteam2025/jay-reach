/**
 * Mode demo : stubs (Jay Reach 1.4.3).
 *
 * Quand un workspace a un provider_type='demo' configure, les call sites
 * basculent sur ces stubs au lieu d'appeler les vraies APIs externes.
 *
 * Pourquoi : un nouveau user OSS peut explorer l'app sans clefs API ; les
 * demos commerciales tournent sans cramer des credits Bouncer/FullEnrich.
 */

import type { EmailVerdict } from './types.ts';

/**
 * Genere des verdicts fake mais credibles pour un batch d'emails.
 * Distribution realiste : ~70% valid, 15% risky, 10% invalid, 5% role.
 */
export function fakeBouncerVerdicts(emails: string[]): Array<{
  email: string;
  verdict: EmailVerdict;
  reason: string | null;
}> {
  return emails.map((email) => {
    const hash = simpleHash(email);
    const r = hash % 100;
    if (r < 70) return { email, verdict: 'valid' as const, reason: null };
    if (r < 85) return { email, verdict: 'risky' as const, reason: 'catch_all (demo)' };
    if (r < 95) return { email, verdict: 'invalid' as const, reason: 'mailbox_full (demo)' };
    return { email, verdict: 'role' as const, reason: 'role_address (demo)' };
  });
}

/**
 * Genere un fake bulk_id et retourne immediatement. Le call site qui
 * fait l'enrichissement n'attend pas de webhook reel.
 */
export function fakeEnrichmentBulkId(): string {
  return `demo-bulk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Hash deterministe pour generer des verdicts stables par email.
 */
function simpleHash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Helper utilise par les call sites pour bloquer net une action destructive
 * en mode demo et retourner une reponse coherente.
 */
export function demoActionBlocked(action: string): { ok: false; demo: true; action: string; message: string } {
  return {
    ok: false,
    demo: true,
    action,
    message: `Action "${action}" bloquee en mode demo. Configurez un provider reel pour activer.`,
  };
}

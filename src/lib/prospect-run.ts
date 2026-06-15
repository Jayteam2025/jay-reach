/**
 * Client-side helper pour le suivi d'un run (scrape + scoring).
 *
 * Persiste le dernier run_id en localStorage pour pouvoir re-afficher
 * la modale de progres meme apres un reload.
 *
 * Miroir de prospect-enrichment-job.ts.
 */

const STORAGE_KEY = 'prospect-run-id';

export function saveRunId(runId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, runId);
  } catch {
    /* storage quota / private mode */
  }
}

export function loadRunId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function clearRunId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
}

/**
 * Machine à états d'une inscription (docs/04-sequenceur.md). Un état terminal
 * est définitif : toute reprise crée une NOUVELLE inscription, jamais une
 * réouverture. Pur et testable.
 */
export type EnrollmentStatus =
  | 'active'
  | 'paused'
  | 'paused_absence'
  | 'completed'
  | 'stopped'
  | 'replied'
  | 'bounced';

export type EnrollmentEvent =
  | { type: 'human_reply' }
  | { type: 'stop_on' }
  | { type: 'hard_bounce' }
  | { type: 'contact_left' }
  | { type: 'absence_detected'; resumeAt: string }
  | { type: 'manual_pause' }
  | { type: 'resume' }
  | { type: 'step_advanced'; isLast: boolean };

const TERMINAL: readonly EnrollmentStatus[] = ['completed', 'stopped', 'replied', 'bounced'];

export function isTerminal(status: EnrollmentStatus): boolean {
  return TERMINAL.includes(status);
}

/** Applique un événement. Un état terminal ne change plus jamais. */
export function applyEvent(status: EnrollmentStatus, event: EnrollmentEvent): EnrollmentStatus {
  if (isTerminal(status)) {
    return status;
  }
  switch (event.type) {
    case 'human_reply':
      return 'replied';
    case 'stop_on':
      return 'stopped';
    case 'hard_bounce':
      return 'bounced';
    case 'contact_left':
      return 'stopped';
    case 'absence_detected':
      return 'paused_absence';
    case 'manual_pause':
      return 'paused';
    case 'resume':
      return status === 'paused' || status === 'paused_absence' ? 'active' : status;
    case 'step_advanced':
      return event.isLast ? 'completed' : status;
  }
}

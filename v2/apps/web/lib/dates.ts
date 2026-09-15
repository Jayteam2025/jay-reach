/**
 * Date relative courte, pour une colonne de tableau (dernière activité d'une
 * campagne, etc.) : minutes/heures en-dessous d'un jour, « hier » entre 24 et
 * 48 h, une date courte au-delà. Fonction pure (l'instant de référence est un
 * paramètre, jamais `new Date()` lu à l'intérieur) — testable sans horloge.
 */
const UNE_MINUTE_MS = 60_000;
const UNE_HEURE_MS = 60 * UNE_MINUTE_MS;
const UN_JOUR_MS = 24 * UNE_HEURE_MS;

export function dateRelativeCourte(iso: string, maintenant: Date = new Date()): string {
  const diffMs = maintenant.getTime() - new Date(iso).getTime();

  if (diffMs < UNE_HEURE_MS) {
    const minutes = Math.max(1, Math.floor(diffMs / UNE_MINUTE_MS));
    return `il y a ${minutes} min`;
  }
  if (diffMs < UN_JOUR_MS) {
    return `il y a ${Math.floor(diffMs / UNE_HEURE_MS)} h`;
  }
  if (diffMs < 2 * UN_JOUR_MS) {
    return 'hier';
  }
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' }).format(new Date(iso));
}

function estMemeJour(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

/**
 * Heure d'un instant à VENIR (prochain passage d'une source, etc.), avec le
 * jour quand ce n'est pas aujourd'hui : une heure seule est ambiguë sinon —
 * « prochain 16:45 » identique à « dernier 16:45 » alors que le prochain
 * passage est le lendemain. Jour relatif jusqu'à demain, sinon une date
 * courte (`16/09 16:45`). Fonction pure, même convention que
 * `dateRelativeCourte` (l'instant de référence est un paramètre).
 */
export function heureAvecJour(iso: string, maintenant: Date = new Date()): string {
  const date = new Date(iso);
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(date);
  if (estMemeJour(date, maintenant)) return heure;
  const demain = new Date(maintenant);
  demain.setDate(demain.getDate() + 1);
  if (estMemeJour(date, demain)) return `demain ${heure}`;
  const jour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit' }).format(date);
  return `${jour} ${heure}`;
}

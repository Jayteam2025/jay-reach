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

/**
 * Clé de jour calendaire d'un instant DANS un fuseau donné (« 2026-09-14 »),
 * pas dans le fuseau d'exécution du serveur — `en-CA` formate en Gregorian
 * ISO (année-mois-jour) quel que soit l'environnement, un simple artefact de
 * cette locale plutôt qu'un choix de langue.
 */
function cleJourDansFuseau(date: Date, fuseau: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
    date,
  );
}

export interface GroupeParJour<T> {
  /**
   * Ancré à midi UTC du jour calendaire (pas minuit) : reformaté ensuite avec
   * le même fuseau via `libelleJour`, un ancrage à midi reste dans le même
   * jour calendaire pour tout fuseau réellement en usage dans l'app
   * (`Europe/Paris`, décalage toujours positif) — minuit UTC s'exposerait à
   * un décalage négatif hypothétique qui ferait glisser le jour affiché.
   */
  jour: Date;
  evenements: T[];
}

/**
 * Regroupe une liste déjà triée par instant décroissant (`quand` ISO) en
 * tranches d'un même jour calendaire, dans LE FUSEAU donné — pas celui du
 * serveur qui l'exécute (R53, tour de correction 1, tâche 13). Fonction pure,
 * même convention que `grouperParHeure` (`TableFileDuJour.tsx`) : la liste
 * paginée reste plate côté serveur, le regroupement est un pur effet
 * d'affichage.
 *
 * `maintenant` n'est pas utilisé ici (le regroupement ne dépend que du jour
 * de chaque événement) — le paramètre existe pour la symétrie d'appel avec
 * `libelleJour`, qui elle en a besoin (« Aujourd'hui »/« Hier »).
 */
export function regrouperParJour<T extends { quand: string }>(
  evenements: readonly T[],
  _maintenant: Date,
  fuseau: string,
): GroupeParJour<T>[] {
  const groupes: { cle: string; jour: Date; evenements: T[] }[] = [];
  for (const evenement of evenements) {
    const cle = cleJourDansFuseau(new Date(evenement.quand), fuseau);
    const dernier = groupes.at(-1);
    if (dernier && dernier.cle === cle) {
      dernier.evenements.push(evenement);
    } else {
      groupes.push({ cle, jour: new Date(`${cle}T12:00:00.000Z`), evenements: [evenement] });
    }
  }
  return groupes.map(({ jour, evenements }) => ({ jour, evenements }));
}

/**
 * Libellé d'un jour de `regrouperParJour` : « Aujourd'hui, lundi 14
 * septembre », « Hier, dimanche 13 septembre », sinon une date pleine avec
 * une majuscule initiale (« Vendredi 11 septembre » — pas de préfixe, donc le
 * jour de semaine porte lui-même la majuscule de début de phrase).
 */
export function libelleJour(jour: Date, maintenant: Date, locale: string, fuseau: string): string {
  const jourSemaineEtDate = new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: fuseau,
  }).format(jour);

  const cleJour = cleJourDansFuseau(jour, fuseau);
  if (cleJour === cleJourDansFuseau(maintenant, fuseau)) {
    return `Aujourd'hui, ${jourSemaineEtDate}`;
  }
  const veille = new Date(maintenant.getTime() - UN_JOUR_MS);
  if (cleJour === cleJourDansFuseau(veille, fuseau)) {
    return `Hier, ${jourSemaineEtDate}`;
  }
  return jourSemaineEtDate.charAt(0).toUpperCase() + jourSemaineEtDate.slice(1);
}

/**
 * Fuseau utilisé par défaut par tous les formateurs de ce fichier quand
 * l'appelant n'en passe pas explicitement (R67) : `organizations` n'a pas de
 * colonne de fuseau (vérifié dans `supabase/migrations`) — seule
 * `organization_settings` porte un réglage `fuseau` (`lireReglages`, déjà
 * `'Europe/Paris'` par défaut, packages/core/src/fonctions/plafonds.ts) —
 * cette constante en est la copie utilisée côté web tant qu'aucun appelant
 * ne fait l'aller-retour jusqu'à ce réglage. Sans elle (et avant ce correctif),
 * `Intl.DateTimeFormat`/`toLocaleTimeString` sans `timeZone` rendaient dans le
 * fuseau du PROCESS qui exécute le rendu — `Europe/Paris` sur le Mac d'un
 * développeur, `UTC` sur Vercel : la même heure s'affichait décalée de deux
 * heures en production (constat du 16/09, Réception : 10:50 Paris affiché 08:50).
 */
export const FUSEAU_PAR_DEFAUT = 'Europe/Paris';

/**
 * Date relative courte, pour une colonne de tableau (dernière activité d'une
 * campagne, etc.) : minutes/heures en-dessous d'un jour, « hier » entre 24 et
 * 48 h, une date courte au-delà. Fonction pure (l'instant de référence est un
 * paramètre, jamais `new Date()` lu à l'intérieur) — testable sans horloge.
 */
const UNE_MINUTE_MS = 60_000;
const UNE_HEURE_MS = 60 * UNE_MINUTE_MS;
const UN_JOUR_MS = 24 * UNE_HEURE_MS;

export function dateRelativeCourte(
  iso: string,
  maintenant: Date = new Date(),
  fuseau: string = FUSEAU_PAR_DEFAUT,
): string {
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
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: fuseau }).format(new Date(iso));
}

/**
 * Date et heure d'un message de la Réception (tâche 16) : « aujourd'hui,
 * 10:22 », « hier, 22:10 », sinon une date courte suivie de l'heure
 * (« 11 sept., 09:12 »). Même frontière de jour DANS `fuseau` que
 * `dateRelativeCourte`/`regrouperParJour` (R53, clé de jour calendaire), pas
 * les accesseurs locaux du serveur qui exécute le rendu.
 */
export function dateHeureMessage(iso: string, maintenant: Date = new Date(), fuseau: string = FUSEAU_PAR_DEFAUT): string {
  const date = new Date(iso);
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(date);
  const cleDate = cleJourDansFuseau(date, fuseau);
  if (cleDate === cleJourDansFuseau(maintenant, fuseau)) return `aujourd'hui, ${heure}`;
  const veille = new Date(maintenant.getTime() - UN_JOUR_MS);
  if (cleDate === cleJourDansFuseau(veille, fuseau)) return `hier, ${heure}`;
  const jourMois = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: fuseau }).format(date);
  return `${jourMois}, ${heure}`;
}

/**
 * Heure d'un instant à VENIR (prochain passage d'une source, etc.), avec le
 * jour quand ce n'est pas aujourd'hui : une heure seule est ambiguë sinon —
 * « prochain 16:45 » identique à « dernier 16:45 » alors que le prochain
 * passage est le lendemain. Jour relatif jusqu'à demain, sinon une date
 * courte (`16/09 16:45`). Fonction pure, même convention que
 * `dateRelativeCourte` (l'instant de référence est un paramètre).
 *
 * La classification aujourd'hui/demain compare des clés de jour calendaire
 * DANS `fuseau` (`cleJourDansFuseau`, définie plus bas — même mécanisme que
 * `regrouperParJour`/R53), jamais les accesseurs locaux (`getFullYear` &
 * co.) : ceux-ci suivent le fuseau du PROCESS qui exécute le rendu, pas celui
 * de l'organisation — un serveur en UTC aurait pu classer « demain » un
 * passage qui, à Paris, tombe encore aujourd'hui (ou l'inverse), près de
 * minuit. `demain` est calculé en ajoutant 24 h en absolu (pas un
 * `setDate` local) pour la même raison.
 */
export function heureAvecJour(
  iso: string,
  maintenant: Date = new Date(),
  fuseau: string = FUSEAU_PAR_DEFAUT,
): string {
  const date = new Date(iso);
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(date);
  const cleDate = cleJourDansFuseau(date, fuseau);
  if (cleDate === cleJourDansFuseau(maintenant, fuseau)) return heure;
  const demain = new Date(maintenant.getTime() + UN_JOUR_MS);
  if (cleDate === cleJourDansFuseau(demain, fuseau)) return `demain ${heure}`;
  const jour = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: fuseau }).format(date);
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

/**
 * Date courte d'un instant PASSÉ (ou présent) — fiche contact (§6.10) : notes,
 * historique, échanges (R79, tour de correction 1 de la tâche 17 : remplace
 * quatre copies locales de la même formule dans `components/contact/*`).
 * « aujourd'hui, HH:MM » / « hier, HH:MM » sur les deux derniers jours
 * calendaires (dans `fuseau`, même mécanisme que `regrouperParJour`/R53),
 * sinon une date courte SANS heure (« 4 sept. ») — perdre l'heure précise
 * d'un événement ancien est un compromis délibéré, plus lisible qu'une
 * minute sans contexte. Reproduit aussi le mineur de la maquette
 * `fiche-contact.html` : le message le plus récent d'un fil affiche
 * « aujourd'hui, 10:22 », les précédents une date nue.
 * Fonction pure (l'instant de référence est un paramètre), même convention
 * que `dateRelativeCourte`/`heureAvecJour`.
 */
export function dateCourte(iso: string, maintenant: Date = new Date(), fuseau: string = FUSEAU_PAR_DEFAUT): string {
  const date = new Date(iso);
  const cleDate = cleJourDansFuseau(date, fuseau);
  const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(date);
  if (cleDate === cleJourDansFuseau(maintenant, fuseau)) return `aujourd'hui, ${heure}`;
  const veille = new Date(maintenant.getTime() - UN_JOUR_MS);
  if (cleDate === cleJourDansFuseau(veille, fuseau)) return `hier, ${heure}`;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: fuseau }).format(date);
}

/**
 * Vrai quand `dateCourte` rendrait une valeur relative (« aujourd'hui, HH:MM »
 * / « hier, HH:MM ») pour cet instant, faux pour une date absolue (« 4 sept. »).
 * Sert aux gabarits qui préfixent la date d'un connecteur (« Modifié LE »,
 * « Connectée LE ») : le connecteur n'a de sens que devant une date absolue —
 * « Modifié le aujourd'hui » est fautif dans les trois langues (« le
 * aujourd'hui », « on today », « op vandaag »), constat recette du 18/09 sur
 * Réglages › Plafonds et Expéditeurs. Même frontière de jour DANS `fuseau` que
 * le reste du fichier.
 */
export function estDateRelative(iso: string, maintenant: Date = new Date(), fuseau: string = FUSEAU_PAR_DEFAUT): boolean {
  const cleDate = cleJourDansFuseau(new Date(iso), fuseau);
  if (cleDate === cleJourDansFuseau(maintenant, fuseau)) return true;
  const veille = new Date(maintenant.getTime() - UN_JOUR_MS);
  return cleDate === cleJourDansFuseau(veille, fuseau);
}

/**
 * HH:MM pour aujourd'hui, « hier » pour la veille, sinon « il y a N j » —
 * carte « À traiter » d'Aujourd'hui (`app/(app)/page.tsx`). Déplacée ici
 * (I5, revue finale) : un export nommé quelconque depuis un `page.tsx` fait
 * échouer `next build` (« is not a valid Page export field »), et cette
 * fonction est de toute façon un formateur de date de plus, à sa place à
 * côté de `dateCourte`/`heureAvecJour`. La classification aujourd'hui/hier
 * compare des clés de jour calendaire DANS `fuseau` (pas `toDateString()`,
 * qui suit le fuseau du PROCESS qui exécute le rendu) — même correctif que
 * `heureAvecJour`. Fonction pure, même convention que `dateRelativeCourte`.
 */
export function quandRelatif(iso: string | null, maintenant: Date = new Date(), fuseau: string = FUSEAU_PAR_DEFAUT): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (cleJourDansFuseau(date, fuseau) === cleJourDansFuseau(maintenant, fuseau)) {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(date);
  }
  const veille = new Date(maintenant.getTime() - UN_JOUR_MS);
  if (cleJourDansFuseau(date, fuseau) === cleJourDansFuseau(veille, fuseau)) return 'hier';
  const jours = Math.max(1, Math.round((maintenant.getTime() - date.getTime()) / UN_JOUR_MS));
  return `il y a ${jours} j`;
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

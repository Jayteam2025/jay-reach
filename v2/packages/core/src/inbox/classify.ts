/**
 * Classification des réponses entrantes (T26). Trois passes prévues :
 *   1. Motifs multilingues FR/EN/NL sur le corps — `classifyByRules`
 *   2. En-têtes (auto-reply) — `classifyByHeaders`, repli quand le corps est muet
 *   3. Modèle (dernier recours) — appelé côté serveur si les règles sont muettes
 *
 * Le corps passe AVANT les en-têtes (constat du 18/09, production) : un
 * en-tête `auto-submitted` ne sait dire que « ceci est automatique » — Outlook
 * le pose aussi bien sur une absence que sur un départ d'entreprise. Seul le
 * corps distingue les deux (« I am no longer with... » vs « I am out of
 * office... »), donc c'est lui qui doit décider dès qu'il dit quelque chose de
 * reconnaissable ; l'en-tête ne sert plus que de repli quand le corps est
 * muet (signature automatique sans texte exploitable, par exemple).
 *
 * Ce module ne fait que les passes 1 et 2 (pures, testables). La passe 3 (IA)
 * vit côté application (clé Anthropic). Effets sur les inscriptions décidés par
 * l'appelant selon la classification (arrêt / pause datée / départ).
 */

export type ReplyClassification = 'human_reply' | 'auto_absence' | 'auto_left_company' | 'auto_other' | 'unclassified';

export interface ClassifyResult {
  readonly classification: ReplyClassification;
  /** Pour une absence : nombre de jours avant reprise (défaut si non daté). */
  readonly resumeInDays?: number;
}

const ABSENCE = /\b(absent|en cong[ée]s?|cong[ée]s?|out of office|on vacation|away from (the|my) (office|desk)|afwezig|met verlof|vakantie|de retour le|back (on|from)|réponse automatique|automatic reply|automatisch antwoord)\b/i;
const LEFT_COMPANY = /\b(ne (suis|travaille) plus|n'est plus (en poste|dans l'entreprise|chez)|plus en poste|a quitt[ée] (l'entreprise|la soci[ée]t[ée]|nos [ée]quipes)|no longer (with|at|works? (at|for))|has left the (company|organi[sz]ation)|left the company|niet meer (bij|werkzaam)|uit dienst)\b/i;

/** Jours avant reprise quand le corps ne donne aucune date exploitable. */
const REPRISE_PAR_DEFAUT = 7;
/** Au-delà, une date lue vaut moins qu'une valeur par défaut plausible. */
const BORNE_JOURS_MAX = 90;
const MS_PAR_JOUR = 24 * 60 * 60 * 1000;

/**
 * Mois FR/EN/NL → numéro (1-12). Les orthographes sans accent restent
 * acceptées (les messages qui arrivent en base ne sont pas toujours bien
 * encodés). Aucune collision entre langues : les mois qui s'écrivent pareil
 * (septembre/september, november, april…) valent le même numéro de toute façon.
 */
const MOIS: Record<string, number> = {
  janvier: 1, février: 2, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  août: 8, aout: 8, septembre: 9, octobre: 10, novembre: 11, décembre: 12, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  januari: 1, februari: 2, maart: 3, mei: 5, juni: 6, juli: 7, augustus: 8,
  oktober: 10,
};

const MOIS_ALTERNATION = Object.keys(MOIS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * « 23/09 » ou « 23/09/2026 » (jour/mois). Séparateur `/` UNIQUEMENT : un `.`
 * sépare aussi une heure (« 10.12 ») ou un numéro de téléphone (« 01.12.34.56.78»)
 * en FR comme en NL — accepté un temps, ça a lu un horaire de bureau néerlandais
 * comme un retour en décembre (faux positif constaté le 18/09 en relecture).
 */
const DATE_NUMERIQUE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;
/** « 23 septembre », « 23 September », « 23 september » (jour puis mois en lettres — FR/NL, et EN « until 23 September »). */
const DATE_JOUR_MOIS = new RegExp(`\\b(\\d{1,2})(?:er|st|nd|rd|th)?\\.?\\s+(${MOIS_ALTERNATION})\\b\\.?,?\\s*(\\d{4})?`, 'i');
/** « September 23 », « September 23, 2026 » (mois puis jour — tournure EN la plus courante). */
const DATE_MOIS_JOUR = new RegExp(`\\b(${MOIS_ALTERNATION})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b,?\\s*(\\d{4})?`, 'i');

/**
 * Marqueurs de retour FR/EN/NL : une date n'est cherchée que dans leur
 * voisinage, jamais ailleurs dans le corps. Sans cette restriction, un
 * horaire de bureau ou un numéro de téléphone en signature se lisait comme
 * une date de reprise (faux positif constaté le 18/09 en relecture). Triés
 * du plus long au plus court pour que « tot en met » l'emporte sur son
 * préfixe « tot » quand les deux sont présents.
 */
const MARQUEURS_RETOUR = [
  'upon my return on', 'returning on', 'à partir du', 'de retour le',
  'tot en met', 'terug op', 'back from', "jusqu'au", 'back on', "jusqu'a",
  'until', 'vanaf', 'till', 'tot',
].sort((a, b) => b.length - a.length);

/** Nombre de caractères regardés après un marqueur pour y chercher une date. */
const FENETRE_APRES_MARQUEUR = 40;

function normaliserAnnee(brut: string): number {
  const n = Number(brut);
  return brut.length <= 2 ? 2000 + n : n;
}

interface DateLue {
  readonly jour: number;
  readonly mois: number;
  /** `null` quand le message ne précise pas l'année (cas le plus fréquent). */
  readonly annee: number | null;
}

/** Vrai si le caractère est une lettre (accentuée comprise) — sert à vérifier qu'un marqueur n'est pas un fragment d'un mot plus long (« tot » dans « totaal »). */
function estUneLettre(caractere: string | undefined): boolean {
  return caractere !== undefined && /[a-zà-ÿ]/i.test(caractere);
}

/** Positions (fin de correspondance), triées par ordre d'apparition, de chaque marqueur de retour trouvé dans `texte`. */
function trouverFinsMarqueurs(texte: string): number[] {
  const occurrences: { debut: number; fin: number }[] = [];
  for (const marqueur of MARQUEURS_RETOUR) {
    let depuis = 0;
    for (;;) {
      const debut = texte.indexOf(marqueur, depuis);
      if (debut === -1) break;
      const fin = debut + marqueur.length;
      // Le marqueur doit être un mot entier, pas le fragment d'un mot plus
      // long (le NL « totaal » contient « tot », par exemple).
      if (!estUneLettre(texte[debut - 1]) && !estUneLettre(texte[fin])) {
        occurrences.push({ debut, fin });
      }
      depuis = debut + 1;
    }
  }
  return occurrences.sort((a, b) => a.debut - b.debut).map((o) => o.fin);
}

/** Cherche une date dans une fenêtre de texte : numérique d'abord (sans ambiguïté), puis en lettres, jour-mois puis mois-jour. */
function dateDansFenetre(fenetre: string): DateLue | null {
  const numerique = fenetre.match(DATE_NUMERIQUE);
  if (numerique) {
    const jour = Number(numerique[1]);
    const mois = Number(numerique[2]);
    if (jour >= 1 && jour <= 31 && mois >= 1 && mois <= 12) {
      return { jour, mois, annee: numerique[3] ? normaliserAnnee(numerique[3]) : null };
    }
  }

  const jourMois = fenetre.match(DATE_JOUR_MOIS);
  if (jourMois) {
    return { jour: Number(jourMois[1]), mois: MOIS[jourMois[2]!]!, annee: jourMois[3] ? Number(jourMois[3]) : null };
  }

  const moisJour = fenetre.match(DATE_MOIS_JOUR);
  if (moisJour) {
    return { jour: Number(moisJour[2]), mois: MOIS[moisJour[1]!]!, annee: moisJour[3] ? Number(moisJour[3]) : null };
  }

  return null;
}

/**
 * Cherche une date de reprise dans le corps, dans les `FENETRE_APRES_MARQUEUR`
 * caractères qui suivent un marqueur de retour — jamais ailleurs (signature,
 * horaires, adresse). Plusieurs marqueurs peuvent se suivre (« absent jusqu'à
 * nouvel ordre, de retour le 23 septembre ») : on essaie chaque fenêtre dans
 * l'ordre du texte et on garde la première date trouvée.
 */
function extraireDateRetour(body: string): DateLue | null {
  const texte = body.toLowerCase().replace(/’/g, "'");
  for (const fin of trouverFinsMarqueurs(texte)) {
    const lue = dateDansFenetre(texte.slice(fin, fin + FENETRE_APRES_MARQUEUR));
    if (lue) return lue;
  }
  return null;
}

/** Minuit UTC du jour calendaire de `date` — comparer des jours, pas des instants (indépendant du TZ du process). */
function auMinuitUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Résout l'année d'une date lue sans année : celle qui rend la date proche et
 * future par rapport à la référence, pas mécaniquement l'année en cours — un
 * message reçu le 28 décembre qui annonce un retour le 5 janvier reprend
 * l'année suivante, pas une date déjà passée depuis onze mois.
 *
 * Quand l'année est explicite dans le message, elle prime toujours : c'est
 * elle qui permet aux bornes de sûreté (date passée, trop lointaine) de
 * s'appliquer plus bas.
 */
function resoudreDate(lue: DateLue, reference: Date): Date | null {
  if (lue.annee !== null) {
    const date = new Date(Date.UTC(lue.annee, lue.mois - 1, lue.jour));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const refMinuit = auMinuitUTC(reference);
  const anneeRef = refMinuit.getUTCFullYear();
  const candidat = new Date(Date.UTC(anneeRef, lue.mois - 1, lue.jour));
  if (Number.isNaN(candidat.getTime())) return null;
  if (candidat.getTime() >= refMinuit.getTime()) return candidat;
  return new Date(Date.UTC(anneeRef + 1, lue.mois - 1, lue.jour));
}

/**
 * Jours avant reprise à partir du corps du message, ou le défaut si aucune
 * date n'y figure ou si elle ne passe pas les bornes de sûreté.
 *
 * Pure : ne lit jamais l'horloge, `reference` (date de réception du message)
 * vient de l'appelant.
 */
function resoudreReprise(body: string, reference: Date): number {
  const lue = extraireDateRetour(body);
  if (!lue) return REPRISE_PAR_DEFAUT;
  const dateLue = resoudreDate(lue, reference);
  if (!dateLue) return REPRISE_PAR_DEFAUT;

  const refMinuit = auMinuitUTC(reference);
  const joursJusquaLaDate = Math.round((dateLue.getTime() - refMinuit.getTime()) / MS_PAR_JOUR);
  // Bornes de sûreté : une date passée (année explicite antérieure à la
  // référence) ou trop lointaine (plus de 90 jours) vaut moins qu'une valeur
  // par défaut plausible — on ne pose jamais une reprise absurde.
  if (joursJusquaLaDate < 0 || joursJusquaLaDate > BORNE_JOURS_MAX) return REPRISE_PAR_DEFAUT;
  // Reprise au LENDEMAIN de la date lue : « absent jusqu'au 23 » veut dire
  // qu'on ne relance pas encore le 23, seulement à partir du 24.
  return joursJusquaLaDate + 1;
}

/** Passe 1 — motifs multilingues sur le corps du message, et la date de reprise si elle y figure. */
export function classifyByRules(body: string, referenceDate: Date): ClassifyResult | null {
  const text = body ?? '';
  if (LEFT_COMPANY.test(text)) return { classification: 'auto_left_company' };
  if (ABSENCE.test(text)) return { classification: 'auto_absence', resumeInDays: resoudreReprise(text, referenceDate) };
  return null;
}

/** Passe 2 — en-têtes d'auto-réponse. Ne sait dire que « c'est automatique », jamais de quoi il s'agit. */
export function classifyByHeaders(headers: Record<string, unknown> | null | undefined): ClassifyResult | null {
  if (!headers) return null;
  const get = (k: string): string => String(headers[k] ?? headers[k.toLowerCase()] ?? '').toLowerCase();
  if (get('auto-submitted').includes('auto-') || get('x-autoreply') === 'yes' || get('x-autorespond') !== '' || get('precedence') === 'auto_reply') {
    return { classification: 'auto_absence', resumeInDays: REPRISE_PAR_DEFAUT };
  }
  return null;
}

/**
 * Passes 1 + 2 combinées : le corps décide dès qu'il dit quelque chose de
 * reconnaissable, l'en-tête ne sert que de repli quand le corps est muet (voir
 * le commentaire de module — POURQUOI cet ordre). Renvoie null si rien de sûr
 * (→ passer au modèle).
 *
 * Quand c'est l'en-tête qui décide (le corps n'a rien de reconnaissable pour
 * `ABSENCE`/`LEFT_COMPANY` — une tournure d'absence que ces motifs ne
 * couvrent pas, par exemple), on relit quand même le corps pour la date de
 * reprise, avec la même fonction et les mêmes bornes que la passe corps :
 * l'en-tête ne sait dire que « c'est automatique », jamais combien de temps,
 * et ne doit donc jamais imposer 7 jours à la place d'une date que le message
 * annonce réellement. `classifyByHeaders` reste pure et ignorante du corps ;
 * c'est ici, où corps et en-tête sont déjà réunis, que la relecture est faite.
 */
export function classifyReply(
  body: string,
  headers: Record<string, unknown> | null | undefined,
  referenceDate: Date,
): ClassifyResult | null {
  const parCorps = classifyByRules(body, referenceDate);
  if (parCorps) return parCorps;
  const parEntetes = classifyByHeaders(headers);
  if (!parEntetes) return null;
  return { ...parEntetes, resumeInDays: resoudreReprise(body ?? '', referenceDate) };
}

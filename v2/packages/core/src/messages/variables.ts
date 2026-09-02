/**
 * Moteur de variables des messages (T19, docs/05-messages-et-langues.md).
 * Fonctions PURES : extraction, validation statique (à l'enregistrement), rendu
 * (substitution + valeurs de repli), et contraintes de longueur par canal.
 *
 * Règle non négociable (CLAUDE.md #2) : une variable non résolue bloque l'envoi.
 * `renderTemplate` ne « devine » jamais : une variable vide et sans repli est
 * remontée dans `missing`, que le séquenceur transforme en action bloquée
 * (`missing_variable`) — jamais un `{{champ}}` littéral ni un blanc dans un envoi.
 */

/** Nature de la campagne : alimentée par un signal daté, ou par une liste. */
export type CampaignNature = 'signal' | 'list';

/** Disponibilité d'une variable selon la nature de la campagne. */
export type VariableAvailability = 'always' | 'signal' | 'list';

/**
 * Variables standard et leur disponibilité (spec §16, tableau). « always » =
 * dispo pour signal ET liste ; « signal »/« list » = réservé à cette nature.
 */
export const STANDARD_VARIABLES: Readonly<Record<string, VariableAvailability>> = {
  prenom: 'always',
  /**
   * Formule d'appel complète : « Bonjour Marie » ou « Bonjour » à défaut.
   *
   * Existait dans le socle v1 et n'avait pas d'équivalent ici. Elle résout le
   * cas que `prenom` interdit d'affronter : celui-ci refuse toute valeur de
   * repli, pour ne jamais expédier « Bonjour , ». `salutation` s'en charge à sa
   * place, et permet donc d'écrire à un contact dont on ignore le prénom.
   */
  salutation: 'always',
  nom: 'always',
  poste: 'always',
  entreprise: 'always',
  ville: 'always',
  effectif: 'always',
  persona_angle: 'always',
  signal_date: 'signal',
  signal_mois: 'signal',
  signal_titre: 'signal',
  signal_zone: 'signal',
  /** Adresse de l'annonce, pour y renvoyer explicitement. */
  lien_offre: 'signal',
  contexte: 'list',
  /** Nom de domaine du compte, sans le protocole. */
  site: 'always',
  /** Deux premiers chiffres du code postal — « 44 », « 75 ». */
  departement: 'always',
  pays: 'always',
};

/**
 * Ce que les modèles du socle v1 appelaient, et ce que cela devient ici.
 *
 * La migration des données legacy a recopié les corps tels quels : les modèles
 * importés parlent donc encore anglais. Ce n'est pas une invention de
 * l'opérateur — ces noms étaient bien ceux de Jay Reach avant la refonte.
 *
 * `signature` n'y figure pas : sa valeur ne dépend pas du prospect, c'est un
 * extrait réutilisable défini par l'organisation, pas une variable.
 */
export const VARIABLES_HERITEES: Readonly<Record<string, string>> = {
  first_name: 'prenom',
  last_name: 'nom',
  company: 'entreprise',
  company_name: 'entreprise',
  job_title: 'poste',
};

/** Variables sur lesquelles une valeur de repli est interdite (spec : jamais {{prenom}}). */
export const NO_FALLBACK_VARIABLES: ReadonlySet<string> = new Set(['prenom']);

/** Un jeton `{{nom}}` ou `{{nom|valeur de repli}}` trouvé dans un corps. */
export interface TemplateToken {
  readonly name: string;
  /** Valeur de repli (après `|`), ou null si absente. `{{x|}}` → repli vide (''). */
  readonly fallback: string | null;
  /** Le texte source exact (`{{...}}`), pour la substitution. */
  readonly raw: string;
}

// Nom = lettres/chiffres/underscore ; repli = tout sauf `}` (jusqu'à `}}`).
const TOKEN_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*(?:\|([^}]*))?\}\}/g;

/**
 * Ce qu'un opérateur écrit quand il ne connaît pas la convention : une seule
 * accolade, des majuscules, des espaces autour du nom.
 *
 * La double accolade est une habitude de développeur. Écrire `{prenom}` était
 * silencieusement accepté et le message partait avec les accolades visibles
 * chez le prospect — alors que notre première règle interdit d'expédier un
 * champ littéral.
 */
const TOKEN_TOLERANT_RE = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|([^}]*))?\}?\}/g;

/**
 * Ramène les formes tolérées à la forme canonique `{{nom}}`.
 *
 * On ne convertit QUE si le nom désigne une variable connue : sans cette
 * réserve, « le tarif est de {50} euros » deviendrait une variable fantôme, et
 * le message serait bloqué à l'envoi pour une accolade décorative.
 */
export function normalizeVariableSyntax(body: string): string {
  return body.replace(TOKEN_TOLERANT_RE, (brut, nom: string, repli?: string) => {
    // L'ancien vocabulaire est traduit avant d'être reconnu : les modèles
    // importés du socle v1 parlent encore anglais.
    const clef = VARIABLES_HERITEES[nom.toLowerCase()] ?? nom.toLowerCase();
    if (!(clef in STANDARD_VARIABLES)) {
      return brut;
    }
    return repli === undefined ? `{{${clef}}}` : `{{${clef}|${repli}}}`;
  });
}

/**
 * Le contenu entre accolades prétend-il être une variable ?
 *
 * Un identifiant simple — lettres et souligné, sans espace — est presque
 * sûrement une tentative de variable, même mal orthographiée. Une accolade
 * qui entoure des mots ou des chiffres est décorative, et on la laisse vivre.
 */
const QUASI_VARIABLE_RE = /\{\{?\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\|[^}]*)?\}?\}/g;

/** Distance de Levenshtein, pour proposer le nom que l'opérateur visait. */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cout);
    }
  }
  return d[a.length]![b.length]!;
}

/** Variable connue la plus proche d'un nom mal orthographié, s'il y en a une. */
export function suggestVariable(nom: string): string | undefined {
  const candidats = Object.keys(STANDARD_VARIABLES)
    .map((v) => ({ v, d: distance(nom.toLowerCase(), v) }))
    .filter((c) => c.d <= 2)
    .sort((a, b) => a.d - b.d);
  return candidats[0]?.v;
}

/** Extrait tous les jetons d'un corps, dans l'ordre (doublons inclus). */
export function parseTemplateTokens(body: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  for (const m of body.matchAll(TOKEN_RE)) {
    tokens.push({
      name: (m[1] ?? '').toLowerCase(),
      fallback: m[2] === undefined ? null : m[2],
      raw: m[0],
    });
  }
  return tokens;
}

/** Noms de variables distincts utilisés dans un corps (ordre de première apparition). */
export function extractVariableNames(body: string): string[] {
  const seen = new Set<string>();
  for (const t of parseTemplateTokens(body)) seen.add(t.name);
  return [...seen];
}

/** Problème de validation statique d'un corps (refus à l'enregistrement). */
export interface TemplateValidationIssue {
  readonly variable: string;
  readonly kind: 'unknown' | 'unavailable' | 'fallback_forbidden';
  readonly message: string;
  /** Variable connue la plus proche, quand le nom semble mal orthographié. */
  readonly suggestion?: string;
}

/**
 * Valide un corps à l'enregistrement, selon la nature de la campagne. Renvoie la
 * liste des problèmes (vide = OK). Trois refus :
 *  - `unknown` : variable inexistante ;
 *  - `unavailable` : variable réservée à l'autre nature (ex. `{{signal_date}}`
 *    dans une campagne alimentée par une liste) ;
 *  - `fallback_forbidden` : valeur de repli sur une variable qui l'interdit.
 */
export function validateTemplateVariables(
  body: string,
  nature: CampaignNature,
  /**
   * Noms des extraits réutilisables de l'organisation (`signature`, mentions).
   * Leur valeur ne dépend pas du prospect, mais ils se résolvent au même
   * moment et s'écrivent de la même façon — inutile d'imposer une seconde
   * syntaxe à l'opérateur.
   */
  extraits: readonly string[] = [],
): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  const seen = new Set<string>();
  // On valide sur le texte normalisé : une accolade simple autour d'un nom
  // connu est une variable pour l'opérateur, elle doit l'être ici aussi.
  for (const token of parseTemplateTokens(normalizeVariableSyntax(body))) {
    if (extraits.includes(token.name)) continue;
    const availability = STANDARD_VARIABLES[token.name];
    if (availability === undefined) {
      if (!seen.has(`unknown:${token.name}`)) {
        const proche = suggestVariable(token.name);
        issues.push({
          variable: token.name,
          kind: 'unknown',
          message: proche
            ? `La variable « ${token.name} » n'existe pas. Vouliez-vous dire « ${proche} » ?`
            : `La variable « ${token.name} » n'existe pas.`,
          ...(proche ? { suggestion: proche } : {}),
        });
        seen.add(`unknown:${token.name}`);
      }
      continue;
    }
    if (availability !== 'always' && availability !== nature) {
      if (!seen.has(`unavailable:${token.name}`)) {
        const other = nature === 'list' ? 'une campagne alimentée par une liste' : 'une campagne alimentée par un signal';
        issues.push({
          variable: token.name,
          kind: 'unavailable',
          message: `La variable {{${token.name}}} n'existe pas pour ${other}.`,
        });
        seen.add(`unavailable:${token.name}`);
      }
    }
    if (token.fallback !== null && NO_FALLBACK_VARIABLES.has(token.name)) {
      if (!seen.has(`fallback:${token.name}`)) {
        issues.push({
          variable: token.name,
          kind: 'fallback_forbidden',
          message: `Une valeur de repli est interdite sur « ${token.name} ».`,
        });
        seen.add(`fallback:${token.name}`);
      }
    }
  }

  // Reste ce qui ressemble à une variable sans en être une : `{name}` en
  // accolade simple, que la normalisation n'a pas converti faute de nom connu.
  // Ces formes traversaient tous les contrôles et partaient littéralement chez
  // le prospect.
  for (const m of body.matchAll(QUASI_VARIABLE_RE)) {
    const brut = (m[1] ?? '').toLowerCase();
    const nom = VARIABLES_HERITEES[brut] ?? brut;
    if (nom in STANDARD_VARIABLES || extraits.includes(nom) || seen.has(`unknown:${nom}`)) continue;
    const proche = suggestVariable(nom);
    issues.push({
      variable: nom,
      kind: 'unknown',
      message: proche
        ? `La variable « ${nom} » n'existe pas. Vouliez-vous dire « ${proche} » ?`
        : `« ${nom} » n'est pas une variable. Choisissez-en une dans la liste, ou retirez les accolades.`,
      ...(proche ? { suggestion: proche } : {}),
    });
    seen.add(`unknown:${nom}`);
  }

  return issues;
}

/** Résultat d'un rendu : texte substitué + variables manquantes (vides sans repli). */
export interface RenderResult {
  readonly text: string;
  /** Noms des variables non résolues (distinctes). Non vide → l'envoi est bloqué. */
  readonly missing: string[];
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

/**
 * Rend un corps en substituant les variables par `values`. Une variable vide
 * utilise sa valeur de repli si présente ; sinon elle est remontée dans `missing`
 * (et remplacée par une chaîne vide dans le texte — jamais de `{{champ}}` littéral).
 */
export function renderTemplate(body: string, values: Record<string, string | null | undefined>): RenderResult {
  const missing = new Set<string>();
  const text = body.replace(TOKEN_RE, (_full, rawName: string, rawFallback?: string) => {
    const name = rawName.toLowerCase();
    const value = values[name];
    if (!isBlank(value)) return String(value);
    if (rawFallback !== undefined) return rawFallback; // repli (éventuellement vide)
    missing.add(name);
    return '';
  });
  return { text, missing: [...missing] };
}

/**
 * Rôle d'un message pour la contrainte de longueur (spec §44-54). Un email
 * d'ouverture et une relance n'ont pas le même plafond, d'où la distinction.
 */
export type MessageRole = 'email_opening' | 'email_followup' | 'linkedin_invite' | 'linkedin_message' | 'letter';

/** Plafonds de mots par rôle (spec). */
export const CHANNEL_WORD_LIMITS: Readonly<Record<MessageRole, number>> = {
  email_opening: 90,
  email_followup: 70,
  linkedin_invite: 45,
  linkedin_message: 60,
  letter: 120,
};

/** Compte les mots (séquences non blanches). */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Le texte dépasse-t-il le plafond de mots du rôle ? */
export function exceedsWordLimit(text: string, role: MessageRole): boolean {
  return countWords(text) > CHANNEL_WORD_LIMITS[role];
}

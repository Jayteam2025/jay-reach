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
  contexte: 'list',
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
}

/**
 * Valide un corps à l'enregistrement, selon la nature de la campagne. Renvoie la
 * liste des problèmes (vide = OK). Trois refus :
 *  - `unknown` : variable inexistante ;
 *  - `unavailable` : variable réservée à l'autre nature (ex. `{{signal_date}}`
 *    dans une campagne alimentée par une liste) ;
 *  - `fallback_forbidden` : valeur de repli sur une variable qui l'interdit.
 */
export function validateTemplateVariables(body: string, nature: CampaignNature): TemplateValidationIssue[] {
  const issues: TemplateValidationIssue[] = [];
  const seen = new Set<string>();
  for (const token of parseTemplateTokens(body)) {
    const availability = STANDARD_VARIABLES[token.name];
    if (availability === undefined) {
      if (!seen.has(`unknown:${token.name}`)) {
        issues.push({ variable: token.name, kind: 'unknown', message: `La variable {{${token.name}}} n'existe pas.` });
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
          message: `Une valeur de repli est interdite sur {{${token.name}}}.`,
        });
        seen.add(`fallback:${token.name}`);
      }
    }
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

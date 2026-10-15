/**
 * Adaptateur réel du sujet d'un post : implémente `RedacteurDeSujet` via Anthropic. Avec
 * `scorer-anthropic.ts`, le seul endroit qui appelle le modèle (règle CLAUDE.md #4).
 *
 * Même modèle que le scoring (niveau `smart`, surchargeable par `model_smart`) : l'appel se produit
 * quelques fois par jour, le coût ne justifie pas un modèle plus permissif. `thinking` est désactivé
 * pour la même raison que dans le scorer.
 *
 * Chaque appel consomme UNE unité du crédit `anthropic` que le scoring consomme déjà, prise juste
 * avant l'appel ; un texte vide n'en dépense aucune.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  nettoyerSujetPost,
  resolveScoringModel,
  SUJET_POST_MAX_TOKENS,
  SUJET_POST_SYSTEM_PROMPT,
} from '@jay-reach/core';
import type { RedacteurDeSujet } from './handlers/fiche-post.js';

/** Un post en dépasse rarement un millier ; le reste ne change pas le sujet et coûte des tokens. */
const TEXTE_POST_MAX_CARACTERES = 4000;

/** Ce que le modèle répond au texte d'un post (brut, avant nettoyage). */
export type AppelModeleSujet = (texte: string) => Promise<string | null>;

export interface ConfigFournisseur {
  readonly apiKey: string;
  /** Réglages non sensibles du provider (dont `model_smart`). */
  readonly config?: Record<string, string | undefined> | null;
  /** Prend une unité du crédit du jour ; `false` quand le plafond est atteint. */
  readonly prendreCredit: () => Promise<boolean>;
}

/** Le contrat du rédacteur, sans fournisseur : prouvable sans réseau. */
export function creerRedacteurDeSujet(deps: {
  readonly appeler: AppelModeleSujet;
  readonly prendreCredit: () => Promise<boolean>;
}): RedacteurDeSujet {
  return async (texte) => {
    if (texte.trim() === '') return null;
    if (!(await deps.prendreCredit())) return null;
    try {
      return nettoyerSujetPost(await deps.appeler(texte));
    } catch {
      // Le message d'une erreur fournisseur peut porter une URL ou une clé : rien n'en sort.
      return null;
    }
  };
}

export function createAnthropicRedacteurDeSujet(cfg: ConfigFournisseur): RedacteurDeSujet {
  const client = new Anthropic({ apiKey: cfg.apiKey });
  const model = resolveScoringModel('smart', cfg.config);
  return creerRedacteurDeSujet({
    prendreCredit: cfg.prendreCredit,
    appeler: async (texte) => {
      const res = await client.messages.create({
        model,
        max_tokens: SUJET_POST_MAX_TOKENS,
        thinking: { type: 'disabled' },
        system: SUJET_POST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: texte.slice(0, TEXTE_POST_MAX_CARACTERES) }],
      });
      return res.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    },
  });
}

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
  construireMessagePost,
  nettoyerSujetPost,
  resolveScoringModel,
  SUJET_POST_MAX_TOKENS,
  SUJET_POST_SYSTEM_PROMPT,
} from '@jay-reach/core';
import type { RedacteurDeSujet } from './handlers/fiche-post.js';

/** Ce que le modèle répond au texte d'un post (brut, avant nettoyage). */
export type AppelModeleSujet = (texte: string) => Promise<string | null>;

export interface ConfigFournisseur {
  readonly apiKey: string;
  /** Réglages non sensibles du provider (dont `model_smart`). */
  readonly config?: Record<string, string | undefined> | null;
  /** Prend une unité du crédit du jour ; `false` quand le plafond est atteint. */
  readonly prendreCredit: () => Promise<boolean>;
}

/**
 * Le contrat du rédacteur, sans fournisseur : prouvable sans réseau.
 *
 * Il dit ce qu'il a FAIT, pas seulement ce qu'il rend, parce que l'appelant compte les tentatives
 * et que deux « pas de sujet » ne se paient pas pareil. La frontière est le crédit : tant qu'il
 * n'est pas pris, rien n'a été demandé au modèle (`impossible`, aucune tentative) ; une fois pris,
 * c'est une tentative (`refuse`), que le modèle ait répondu quelque chose d'inutilisable ou que
 * l'appel ait échoué — dans les deux cas le crédit est parti, et recommencer sur le même texte
 * dans l'heure redonnera la même chose.
 */
export function creerRedacteurDeSujet(deps: {
  readonly appeler: AppelModeleSujet;
  readonly prendreCredit: () => Promise<boolean>;
}): RedacteurDeSujet {
  return async (texte) => {
    if (texte.trim() === '') return { etat: 'impossible' };
    if (!(await deps.prendreCredit())) return { etat: 'impossible' };
    try {
      const sujet = nettoyerSujetPost(await deps.appeler(texte));
      return sujet === null ? { etat: 'refuse' } : { etat: 'ecrit', sujet };
    } catch {
      // Le message d'une erreur fournisseur peut porter une URL ou une clé : rien n'en sort.
      return { etat: 'refuse' };
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
        messages: [{ role: 'user', content: construireMessagePost(texte) }],
      });
      return res.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
    },
  });
}

/**
 * Validation IA des candidats /people/search par rapport a un role cible.
 *
 * Pourquoi : FullEnrich /people/search est imprecis. Cast wide (seniority +
 * fuzzy titles) retourne 20 candidats dont 5-10 ne correspondent pas vraiment.
 * Ex: "Head of Indirect Sales Tools" qui matche "head of sales" mais est un
 * manager outils, pas une direction commerciale.
 *
 * Au lieu de regex hardcodees (impossibles a maintenir et limitees au FR/EN),
 * on demande a Claude Haiku de valider en batch chaque candidat :
 *   - Input : description du role cible + liste {idx, name, title}
 *   - Output : pour chaque candidat, match: true/false + raison
 *
 * Architecture pensee open-source / SaaS futur :
 *   - Description du role en langage naturel (multilingue, configurable)
 *   - Pas de patterns hardcodes specifiques a un domaine ou langue
 *   - Future API : les utilisateurs definissent leurs propres roles cibles
 *
 * Fallback : si Claude est indisponible ou timeout, on retourne tous les candidats
 * tels quels (le caller doit avoir un filtre regex de secours).
 */

import type { LLMHandle } from "./providers/types.ts";

// Timeout hard sur l'appel Claude : evite que le worker enrich-company hang
// si Claude est lent / down (cas reel observe 18/05 : worker bloque 12min
// sans logs). Si timeout, on retourne null -> caller fallback regex.
// 10s est confortable pour Claude Haiku (typiquement 0.5-3s) sans bloquer.
const LLM_TIMEOUT_MS = 10_000;

export interface RoleValidationCandidate {
  /** Index dans le tableau source, pour matcher la reponse */
  idx: number;
  /** Nom de la personne (juste pour le contexte du LLM) */
  name: string;
  /** Titre du poste (LinkedIn ou FE) */
  title: string;
}

export interface RoleValidationResult {
  idx: number;
  match: boolean;
  /** Raison courte (~10 mots), utile pour debug et logs */
  reason: string;
}

export interface RoleDefinition {
  /** Identifiant interne (ex: "sales_director") */
  id: string;
  /** Nom court affichable (ex: "Directeur Commercial") */
  display_name: string;
  /** Description naturelle du role pour le LLM. Doit inclure :
   * - Ce qui correspond (titles, fonctions, niveau hierarchique)
   * - Ce qui NE correspond PAS (anti-patterns explicites)
   * - Multilingue : ecrit en francais et anglais combines pour couvrir
   *   les titres LinkedIn FR/EN sans biais. */
  description: string;
}

/**
 * Valide en BATCH une liste de candidats contre un role cible via Claude Haiku.
 *
 * Retourne un Set d'indices des candidats valides. Si Claude fail ou timeout
 * (network error, rate limit, JSON invalide), retourne null pour signaler
 * au caller qu'il doit utiliser le fallback regex.
 *
 * @example
 * const valid = await validateCandidatesWithAI(
 *   llm, // LLMHandle résolu via resolveLLM (provider actif du workspace)
 *   roleDefinition, // une RoleDefinition (cf. buildRoleDefinition dans persona-enrichment-core)
 *   [{ idx: 0, name: "Marie A.", title: "Head of Indirect Sales Tools" }, ...]
 * );
 * // valid = Set { 1, 3, 5 } -> on garde ces idx
 */
export async function validateCandidatesWithAI(
  llm: LLMHandle,
  role: RoleDefinition,
  candidates: RoleValidationCandidate[],
): Promise<{ validIndices: Set<number>; details: RoleValidationResult[] } | null> {
  if (candidates.length === 0) {
    return { validIndices: new Set(), details: [] };
  }

  // Si > 30 candidats, on split en chunks pour rester sous la limite de
  // tokens output (Claude renvoie un JSON par candidat).
  const MAX_BATCH = 30;
  if (candidates.length > MAX_BATCH) {
    const chunks: RoleValidationCandidate[][] = [];
    for (let i = 0; i < candidates.length; i += MAX_BATCH) {
      chunks.push(candidates.slice(i, i + MAX_BATCH));
    }
    const results = await Promise.all(
      chunks.map(c => validateCandidatesWithAI(llm, role, c)),
    );
    if (results.some(r => r === null)) return null;
    const validIndices = new Set<number>();
    const details: RoleValidationResult[] = [];
    for (const r of results) {
      if (r) {
        r.validIndices.forEach(i => validIndices.add(i));
        details.push(...r.details);
      }
    }
    return { validIndices, details };
  }

  const candidatesText = candidates
    .map(c => `${c.idx}|${c.name}|${c.title}`)
    .join("\n");

  const prompt = `You are a B2B sales prospecting filter.

TARGET ROLE: ${role.display_name}

ROLE DEFINITION:
${role.description}

CANDIDATES (format: idx|name|title) :
${candidatesText}

TASK: For each candidate, decide if the title matches the target role.
- match=true if the title clearly corresponds (even with variations or language)
- match=false otherwise
- reason: short justification (max 10 words, in English)

Return JSON ONLY:
{"results": [{"idx": 0, "match": true, "reason": "..."}, ...]}`;

  try {
    // Promise.race timeout : si le LLM hang > 10s, on coupe et fallback regex.
    // complete() n'a pas de timeout interne, donc on l'enveloppe.
    const callPromise = llm.provider.complete({
      tier: "fast",
      system: "",
      user: prompt,
      jsonMode: true,
      temperature: 0,
      // Claude rend du JSON indenté (plus de tokens que le compact de Mistral) :
      // budget élargi, sinon la réponse est tronquée → JSON.parse échoue →
      // fallback regex permanent (vérifié sur staging 2026-06-10). Chunk ≤ 30 candidats.
      maxTokens: Math.min(200 + candidates.length * 120, 8000),
    }, llm.context);
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`LLM timeout ${LLM_TIMEOUT_MS}ms`)), LLM_TIMEOUT_MS)
    );
    const result = await Promise.race([callPromise, timeoutPromise]);

    // Claude peut entourer le JSON de ```json ... ``` — strippe défensivement
    let jsonText = result.text.trim();
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.replace(/^```\s*/, "").replace(/\s*```$/, "");
    }

    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.results)) return null;

    const validIndices = new Set<number>();
    const details: RoleValidationResult[] = [];
    for (const r of parsed.results) {
      if (typeof r.idx !== "number") continue;
      const result: RoleValidationResult = {
        idx: r.idx,
        match: Boolean(r.match),
        reason: String(r.reason || "").substring(0, 100),
      };
      details.push(result);
      if (result.match) validIndices.add(result.idx);
    }
    return { validIndices, details };
  } catch (err) {
    console.warn(`[ai-role-validator] Claude call failed: ${(err as Error).message} - fallback to regex`);
    return null;
  }
}

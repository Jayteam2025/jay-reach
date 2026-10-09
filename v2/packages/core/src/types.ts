/**
 * Types de domaine — squelette (T1).
 * Le détail canonique vit dans `docs/02-data-model.md` ; ces types seront
 * complétés et générés (Supabase) au fil des tickets. Aucun SDK externe ici.
 */

export type ChannelKind = 'email' | 'linkedin' | 'mail';
/**
 * Les natures de signal, telles que l'enum `signal_kind` les porte en base.
 *
 * Ce type en ignorait deux : `post_engagement` existait depuis le lot 4a et n'a jamais été
 * ajouté ici, ce qui n'a rien cassé parce que rien ne s'en sert pour décider. Le laisser faux
 * entretenait l'idée qu'il n'y avait que trois natures.
 */
export type SignalKind =
  | 'job_posting'
  | 'appointment'
  | 'tradeshow'
  | 'post_engagement'
  | 'people_search'
  | 'job_change';

/**
 * Les signaux qui décrivent une PERSONNE, par opposition à une entreprise (une offre d'emploi,
 * un salon). Scoring, écart, purge, enrichissement et origine les traitent tous pareil, et
 * différemment des signaux d'entreprise.
 *
 * Cette liste existe parce que la question « est-ce un signal de personne ? » était écrite
 * `kind = 'post_engagement'` à vingt et un endroits, dans sept fichiers. Chacun de ces endroits
 * aurait dû être retrouvé et corrigé à l'ajout d'une source de personnes, et en oublier un
 * n'aurait produit aucune erreur : juste des gens jamais scorés, jamais purgés, ou dont
 * l'origine ne s'affiche pas. C'est le défaut qui a coûté trois corrections le 09/10 (voir
 * `sqlCampagneSansEmail`) — brancher une troisième source de personnes ne doit toucher que
 * cette ligne.
 */
export const KINDS_PERSONNE = ['post_engagement', 'people_search', 'job_change'] as const satisfies readonly SignalKind[];
export type KindPersonne = (typeof KINDS_PERSONNE)[number];

/** Vrai quand ce signal décrit une personne. À préférer à toute comparaison en dur. */
export function estSignalDePersonne(kind: string): kind is KindPersonne {
  return (KINDS_PERSONNE as readonly string[]).includes(kind);
}

/**
 * Fragment SQL : « ce signal décrit une personne », pour l'alias de table donné.
 *
 * Les valeurs viennent d'une constante du code, jamais d'une saisie : rien à paramétrer.
 */
export function sqlEstSignalDePersonne(alias: string): string {
  return `${alias}.kind = any('{${KINDS_PERSONNE.join(',')}}'::signal_kind[])`;
}

export interface RawSignal {
  readonly externalId: string;
  readonly raw: unknown;
}

export interface Signal {
  readonly externalId: string;
  readonly kind: SignalKind;
  readonly occurredAt: string;
  readonly companyHint?: string;
  readonly title?: string;
  readonly url?: string;
}

export interface RunContext {
  readonly organizationId: string;
  readonly cursor?: unknown;
}

export interface Outcome {
  readonly type: string;
  readonly occurredAt: string;
  readonly raw?: unknown;
}

export interface OutboundAction {
  readonly id: string;
  readonly channel: ChannelKind;
  readonly payload: unknown;
}

export interface DispatchResult {
  readonly providerRef?: string;
  readonly costEur?: number;
}

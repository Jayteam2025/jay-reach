/**
 * Vérification de délivrabilité d'un email (Reoon), avec cache et plafond.
 *
 * Sans elle, `contacts.email_status` ne peut venir que du statut renvoyé par
 * FullEnrich à l'enrichissement, et le gate de délivrabilité — qui ne laisse
 * passer qu'un `valid` explicite — bloque tout le reste.
 *
 * Trois précautions, parce que Reoon est facturé à l'appel et plafonné à vingt
 * vérifications par jour sur l'offre gratuite :
 *   1. cache par email (`provider_cache`), une adresse n'est vérifiée qu'une fois ;
 *   2. plafond quotidien atomique, deux workers ne peuvent pas prendre le dernier
 *      crédit tous les deux ;
 *   3. toute panne se traduit par `unknown`, jamais par une exception — un email
 *      non vérifié est bloqué par le gate, ce qui est le comportement voulu.
 */
import type { Pool } from 'pg';
import { verifyEmail, reoonToVerdict, type ReoonVerifyResponse } from '@jay-reach/providers/email-validation';
import { providerCache } from './provider-cache.js';
import type { EmailStatus } from './enrichment-persist.js';

/** Verdict provider-agnostique, tel que le lit le gate et l'enum `email_status`. */
export type Deliverability = EmailStatus;

/** Confiance associée, écrite dans `contacts.email_confidence`. */
const CONFIANCE: Record<Deliverability, number> = {
  valid: 0.95,
  risky: 0.5,
  role: 0.3,
  disposable: 0.1,
  invalid: 0.05,
  unknown: 0.2,
};

const CACHE_TYPE = 'reoon_verify';
/** Une adresse ne change pas de nature tous les jours ; le socle re-vérifie à 30 j. */
const TTL_JOURS = 30;
/** Plafond de l'offre gratuite Reoon. Relevable par la config du provider. */
export const PLAFOND_REOON_PAR_DEFAUT = 20;

export interface VerificationResult {
  readonly status: Deliverability;
  readonly confidence: number;
  /** D'où vient le verdict — utile pour comprendre un blocage a posteriori. */
  readonly source: 'cache' | 'reoon' | 'cap_reached' | 'error' | 'no_key';
}

function verdictVersResultat(verdict: Deliverability, source: VerificationResult['source']): VerificationResult {
  return { status: verdict, confidence: CONFIANCE[verdict], source };
}

/**
 * Vérifie une adresse. Renvoie toujours un résultat : `unknown` quand la
 * vérification n'a pas pu avoir lieu (pas de clé, plafond atteint, panne).
 *
 * `dailyCap` vient de la configuration du provider ; la valeur par défaut est
 * celle de l'offre gratuite.
 */
export async function verifyDeliverability(
  pool: Pool,
  organizationId: string,
  email: string,
  apiKey: string | null,
  dailyCap: number = PLAFOND_REOON_PAR_DEFAUT,
): Promise<VerificationResult> {
  const cleaned = email.trim().toLowerCase();
  if (!cleaned.includes('@')) return verdictVersResultat('invalid', 'error');
  if (!apiKey) return verdictVersResultat('unknown', 'no_key');

  const cache = providerCache(pool, organizationId);

  // 1. Déjà vérifiée ? On ne repaie pas.
  const hit = await cache
    .from('enrichment_cache')
    .select('data, expires_at')
    .eq('cache_type', CACHE_TYPE)
    .eq('cache_key', cleaned)
    .maybeSingle();
  if (hit.data && (!hit.data.expires_at || new Date(hit.data.expires_at) > new Date())) {
    const cached = hit.data.data as { verdict?: Deliverability } | null;
    if (cached?.verdict) return verdictVersResultat(cached.verdict, 'cache');
  }

  // 2. Plafond du jour. Le crédit est consommé AVANT l'appel : mieux vaut perdre
  //    un crédit sur un appel qui échoue que dépasser le quota du fournisseur.
  const credit = await pool.query<{ ok: boolean }>(
    `select app.consume_provider_credit($1, 'reoon', $2, 1) as ok`,
    [organizationId, dailyCap],
  );
  if (credit.rows[0]?.ok !== true) {
    console.warn(`[verif] plafond Reoon atteint pour l'organisation ${organizationId} — email non vérifié`);
    return verdictVersResultat('unknown', 'cap_reached');
  }

  // 3. Appel réel.
  let reponse: ReoonVerifyResponse;
  try {
    reponse = await verifyEmail(apiKey, cleaned, 'power');
  } catch (err) {
    // Ne jamais propager : un email non vérifié reste `unknown`, donc bloqué par
    // le gate. Faire échouer l'enrichissement perdrait aussi le contact.
    console.warn(`[verif] échec Reoon : ${(err as Error).message}`);
    return verdictVersResultat('unknown', 'error');
  }

  const verdict = reoonToVerdict(reponse) as Deliverability;

  await cache.from('enrichment_cache').upsert(
    {
      cache_type: CACHE_TYPE,
      cache_key: cleaned,
      data: { verdict, checked_at: new Date().toISOString() },
      expires_at: new Date(Date.now() + TTL_JOURS * 86400_000).toISOString(),
    },
    { onConflict: 'cache_type,cache_key' },
  );

  return verdictVersResultat(verdict, 'reoon');
}

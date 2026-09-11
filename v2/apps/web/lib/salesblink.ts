/**
 * Client SalesBlink minimal côté web — uniquement ce qu'il faut pour lister
 * les boîtes du workspace dans l'écran Expéditeurs (sélecteur de liaison).
 *
 * Ne réimporte PAS `@jay-reach/providers/outreach` (qui porte déjà
 * `listerBoites`) : ce sous-chemin résout vers `dist/`, absent tant que le
 * paquet n'a pas été construit — ce que Vercel ne fait pas pour les paquets
 * internes lors du build de `apps/web`. L'importer casserait le déploiement.
 *
 * Aucune clé, en-tête `Authorization` ni corps de réponse ne doit jamais
 * fuiter dans une erreur : `listerBoitesSalesBlink` ne renvoie qu'un code
 * générique (`no_key`, `reseau`, `limite:<statut>`, `client:<statut>`,
 * `serveur:<statut>`).
 */
import { getPool } from './db';

const BASE_SALESBLINK = 'https://run.salesblink.io/api/public/v1.0.0';
/** Même ordre de grandeur que les autres providers (`adzuna.ts`, `reoon.ts`), mais plus court : cet appel est sur le chemin de rendu de l'écran Expéditeurs, pas dans un job de fond. */
const TIMEOUT_MS = 5_000;

export interface BoiteSalesBlink {
  readonly id: string;
  readonly email: string;
  readonly nom: string;
  readonly connectee: boolean;
  readonly envoiActif: boolean;
  readonly receptionActive: boolean;
  readonly plafondQuotidien: number | null;
}

export type ResultatBoitesSalesBlink = { ok: true; boites: BoiteSalesBlink[] } | { ok: false; error: string };

/**
 * Résout la clé SalesBlink de l'organisation : coffre chiffré d'abord,
 * variable d'environnement en repli — même ordre que `resolveAnthropicKey`
 * (`apps/web/lib/anthropic.ts`).
 */
async function resolveSalesblinkKey(organizationId: string): Promise<string | null> {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (encryptionKey) {
    try {
      const res = await getPool().query<{ secret: string | null }>(
        'select app.get_credential($1, $2, $3) as secret',
        [organizationId, 'salesblink', encryptionKey],
      );
      const brut = res.rows[0]?.secret;
      // Pas de dépliage JSON ici (contrairement à `resolveAnthropicKey`, qui
      // porte cet héritage du socle v1) : aucune clé SalesBlink n'existe hors
      // de Jay Reach, la saisie dans l'onglet Fournisseurs est toujours la
      // clé brute.
      if (brut) return brut;
    } catch {
      // Coffre injoignable : on retombe sur l'environnement plutôt que d'échouer.
    }
  }
  return process.env.SALESBLINK_API_KEY ?? null;
}

function texte(valeur: unknown, repli = ''): string {
  return typeof valeur === 'string' ? valeur : repli;
}

function booleen(valeur: unknown): boolean {
  return valeur === true;
}

function nombreOuNull(valeur: unknown): number | null {
  return typeof valeur === 'number' && Number.isFinite(valeur) ? valeur : null;
}

/** Déplie l'enveloppe `{ success, data, message }` de SalesBlink. */
function donnees(resultat: unknown): unknown {
  if (resultat && typeof resultat === 'object' && 'data' in (resultat as Record<string, unknown>)) {
    return (resultat as Record<string, unknown>).data;
  }
  return resultat;
}

/**
 * Liste les boîtes (expéditeurs) du workspace SalesBlink de l'organisation,
 * pour le sélecteur « Boîte SalesBlink » de l'écran Expéditeurs.
 *
 * Noms de champs mesurés empiriquement le 11/09 sur `GET /senders` (non typé
 * dans la spec OpenAPI), les mêmes que pour `listerBoites` de
 * `packages/providers/src/outreach/salesblink.ts` : `alias`/`google_email` en
 * repli pour l'adresse, `senderName`, `sendingEnabled`, `receivingEnabled`,
 * `sequence_max_daily_frequency` pour le plafond de séquence.
 */
export async function listerBoitesSalesBlink(organizationId: string): Promise<ResultatBoitesSalesBlink> {
  const cle = await resolveSalesblinkKey(organizationId);
  if (!cle) return { ok: false, error: 'no_key' };

  let reponse: Response;
  try {
    reponse = await fetch(`${BASE_SALESBLINK}/senders`, {
      method: 'GET',
      headers: { Authorization: cle, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Réseau injoignable ou délai dépassé (`AbortSignal.timeout` rejette avec
    // un `DOMException` nommé `TimeoutError`) : même code générique, la cause
    // exacte n'a pas à transiter jusqu'à l'écran.
    return { ok: false, error: 'reseau' };
  }

  const texteReponse = await reponse.text();
  if (!reponse.ok) {
    if (reponse.status === 429) return { ok: false, error: `limite:${reponse.status}` };
    if (reponse.status >= 500) return { ok: false, error: `serveur:${reponse.status}` };
    return { ok: false, error: `client:${reponse.status}` };
  }

  let corps: unknown;
  try {
    corps = texteReponse ? JSON.parse(texteReponse) : null;
  } catch {
    return { ok: false, error: 'serveur:invalide' };
  }

  const lignes = donnees(corps);
  if (!Array.isArray(lignes)) return { ok: true, boites: [] };

  const boites: BoiteSalesBlink[] = lignes.map((brut) => {
    const ligne = (brut ?? {}) as Record<string, unknown>;
    const email = texte(ligne.alias, texte(ligne.google_email));
    const envoiActif = booleen(ligne.sendingEnabled);
    const receptionActive = booleen(ligne.receivingEnabled);
    return {
      id: texte(ligne.id),
      email,
      nom: texte(ligne.senderName, email),
      connectee: envoiActif || receptionActive,
      envoiActif,
      receptionActive,
      plafondQuotidien: nombreOuNull(ligne.sequence_max_daily_frequency),
    };
  });

  return { ok: true, boites };
}

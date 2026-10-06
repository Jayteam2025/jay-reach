/**
 * Acheter l'adresse email d'une personne QU'ON CONNAÎT DÉJÀ.
 *
 * Le chemin d'enrichissement historique part d'une entreprise : il la résout,
 * cherche qui y occupe les postes du persona, puis enrichit les personnes
 * trouvées. Un engageur de post LinkedIn est l'inverse — une personne nommée,
 * avec son adresse de profil, et sans entreprise fiable. Il n'a PAS de compte
 * (`contacts.account_id` est nul), donc le producteur historique, qui balaie
 * les `accounts`, ne le verrait jamais. D'où ce second chemin, et sa file.
 *
 * C'est la première dépense d'argent réel du lot 4a. Quatre précautions :
 *
 *  1. **On ne paie que ce qui a une chance d'aboutir.** `raisonDeNePasAcheter`
 *     refuse une adresse de profil fabriquée à partir de l'identifiant interne
 *     LinkedIn et un nom de famille réduit à son initiale — deux états ordinaires
 *     qui produisent un appel facturé et aucun résultat.
 *  2. **Le crédit se prend AVANT l'appel**, au plafond `enrichissements_par_jour`
 *     que l'opérateur règle à l'écran. Perdre un crédit sur un appel qui échoue
 *     vaut mieux que dépasser le plafond.
 *  3. **Le coût réel rendu par FullEnrich est enregistré** (`credits_spent`), et
 *     son ABSENCE est signalée au lieu de passer pour zéro.
 *  4. **Rien ne lève après l'appel payant.** Une panne d'écriture ferait rejouer
 *     le job par pg-boss, donc racheter la même adresse. Tout ce qui suit l'achat
 *     est capturé et consigné ; seules les pannes ANTÉRIEURES à l'achat laissent
 *     le job repartir.
 *
 * Le worker utilise la clé de service (il contourne la RLS) : chaque requête
 * filtre explicitement par organisation.
 */
import type { Pool } from 'pg';
import { z } from 'zod';
import {
  submitBulkEnrichment,
  pollBulkEnrichment,
  pickBestEmailWithSource,
  type FullEnrichContactInput,
  type FullEnrichContactResult,
} from '@jay-reach/providers/enrichment';
import { plafondDuJour, fuseauDeLOrganisation, jourCourantDansFuseau } from '@jay-reach/core';
import { mapEmailStatus } from '../enrichment-persist.js';
import { rawStatusOf } from './enrich.js';
import { lienProfilDeduit } from './post-engagement.js';
import { resolveProviderCredentials } from '../credentials.js';

/** Identifiant du fournisseur dans `credentials` et `provider_daily_usage`. */
const FOURNISSEUR = 'fullenrich';

/**
 * Temps maximal d'attente, repris de l'enrichissement d'entreprise : FullEnrich
 * met 28,9 s en moyenne et 55,8 s au pire (mesuré le 01/09/2026). En worker
 * permanent rien ne coupe, `ENRICH_MAX_WAIT_MS` permet de lui rendre tout le
 * temps qu'il demande.
 */
const ATTENTE_MAX_MS = Number(process.env.ENRICH_MAX_WAIT_MS ?? 40_000);

/** Charge utile de la file `enrichment.contact_connu`. */
export interface EnrichContactConnuJob {
  readonly organizationId: string;
  readonly contactId: string;
}

export const enrichContactConnuSchema = z.object({
  organizationId: z.string().uuid(),
  contactId: z.string().uuid(),
}) satisfies z.ZodType<EnrichContactConnuJob>;

/** Ce que l'achat a rendu. `credits` vaut `undefined` quand la réponse n'en portait AUCUN. */
export interface AchatFullEnrich {
  readonly resultat: FullEnrichContactResult | null;
  /**
   * Coût réel du job. `undefined` = la réponse ne portait pas de coût, ce qui
   * n'est PAS la même chose que zéro : un appel facturé dont on ignore le prix
   * doit se voir, pas se fondre dans un total.
   */
  readonly credits: number | undefined;
}

/**
 * Ce dont l'enrichissement a besoin. L'appel PAYANT est injecté : aucun test ne
 * peut le déclencher par inadvertance, et le reste du handler (lecture,
 * plafond, écritures) s'exécute sur un vrai Postgres.
 */
export interface DependancesEnrichissementContact {
  readonly pool: Pool;
  readonly cleFullEnrich: (organizationId: string) => Promise<string | null>;
  readonly acheter: (apiKey: string, entree: FullEnrichContactInput) => Promise<AchatFullEnrich>;
}

export type RaisonRefus = 'sans_adresse' | 'adresse_deduite' | 'nom_tronque';

export type IssueEnrichissement =
  | 'achete'
  | 'sans_email'
  | 'email_deja_pris'
  | 'refuse'
  | 'plafond'
  | 'sans_cle'
  | 'introuvable'
  | 'deja_enrichi'
  | 'panne_fournisseur';

/** Les champs du contact dont dépend la décision d'acheter. */
export interface ContactAEnrichir {
  readonly linkedinUrl: string | null;
  readonly linkedinProviderId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
}

/**
 * Un nom de famille réduit à son initiale (« L. », « L »). LinkedIn abrège ainsi
 * les hors-réseau dans les vignettes d'affichage ; la collecte préfère l'entité
 * profil quand elle existe, mais rien ne garantit qu'elle existe. Acheter sur
 * « Ada L. » est un appel facturé pour une personne que FullEnrich ne peut pas
 * identifier.
 */
const INITIALE_SEULE = /^\p{L}\.?$/u;

/**
 * Pourquoi cette personne ne vaut pas qu'on paie pour elle — ou `null` si elle
 * le vaut. Lue DEUX FOIS, et c'est voulu : le producteur s'en sert pour ne pas
 * enfiler, le handler pour ne pas appeler. Un seul des deux ne suffirait pas —
 * sans le premier la file se remplit de travail nul, sans le second un job
 * déposé autrement (reprise à la main, serveur MCP à venir) partirait acheter.
 */
export function raisonDeNePasAcheter(c: ContactAEnrichir): RaisonRefus | null {
  if (!c.linkedinUrl) return 'sans_adresse';
  // Sans identifiant de membre, il n'y a RIEN à comparer : le défaut est donc
  // d'acheter. C'est le bon sens de défaut — seul `enregistrerEngageur` fabrique
  // une adresse, et il pose toujours l'identifiant (son schéma d'entrée exige un
  // URN à dernier segment non vide). Un contact sans identifiant vient d'un
  // import ou du chemin entreprise, où l'adresse a été saisie ou rendue par le
  // fournisseur. Le SQL du producteur dit la même chose (`is null or <>`).
  // L'adresse a été FABRIQUÉE à partir de l'identifiant interne LinkedIn
  // (`lienProfilDeduit`) parce que la collecte n'a pas lu l'identifiant public.
  // Elle est stable, donc elle suffit à dédoublonner un contact — mais LinkedIn
  // ne la résout pas, et FullEnrich non plus. L'adresse achetée dessus ne se
  // rattacherait à personne. Comparée à la fonction de production elle-même,
  // pas à un préfixe recopié : les deux ne peuvent pas diverger.
  if (c.linkedinProviderId && c.linkedinUrl === lienProfilDeduit(c.linkedinProviderId)) {
    return 'adresse_deduite';
  }
  // Nom tronqué : on RENONCE à acheter. Le handler marque ensuite la personne
  // comme traitée, et c'est sans perte aujourd'hui — `enregistrerEngageur`
  // n'écrase jamais un nom déjà posé (`coalesce(last_name, …)`), donc aucun
  // passage ultérieur ne complétera « L. ». Le jour où la collecte saura corriger
  // un nom tronqué a posteriori, cette marque devra être levée.
  if (c.lastName !== null && INITIALE_SEULE.test(c.lastName.trim())) return 'nom_tronque';
  return null;
}

/**
 * Ce que l'opérateur lit dans les journaux du worker. Groupés et exportés pour
 * être testés TELS QU'ILS S'AFFICHENT : vérifier l'état final laisserait passer
 * un message qui nomme la mauvaise cause, et c'est la cause que l'opérateur lit.
 */
export const MSG = {
  prefixe: '[enrich-contact-connu]',
  introuvable: (contactId: string) => `contact ${contactId} introuvable dans l'organisation — job ignoré`,
  dejaEnrichi: (contactId: string) => `contact ${contactId} a déjà un email — rien à acheter`,
  refus: (contactId: string, raison: RaisonRefus) => `contact ${contactId} non enrichissable (${raison}) — aucun appel, aucun crédit`,
  sansCle: (organizationId: string) => `FullEnrich non configuré pour l’org ${organizationId} — job ignoré`,
  plafond: (organizationId: string) => `plafond quotidien d'enrichissement atteint pour l'organisation ${organizationId} — contact reporté à demain`,
  panne: (contactId: string, type: string) => `achat échoué pour le contact ${contactId} (${type}) — crédit consommé, contact reporté`,
  sansEmail: (contactId: string) => `aucune adresse trouvée pour le contact ${contactId}`,
  emailDejaPris: (contactId: string) => `l'adresse achetée pour le contact ${contactId} appartient déjà à une autre fiche — contact laissé sans email`,
  coutAbsent: (contactId: string) => `FullEnrich n'a rendu AUCUN coût pour le contact ${contactId} — la dépense du jour est donc sous-estimée`,
  coutPerdu: (organizationId: string, credits: number) => `coût de ${credits} crédit(s) non enregistré pour l'organisation ${organizationId} — aucune ligne de consommation pour ce jour`,
  achete: (contactId: string, credits: number | undefined) =>
    `adresse achetée pour le contact ${contactId} — coût ${credits === undefined ? 'inconnu' : `${credits} crédit(s)`}`,
} as const;

/** Type d'une erreur, sans jamais exposer son message : une URL de provider y porte souvent sa clé. */
function typeErreur(err: unknown): string {
  return err instanceof Error ? err.constructor.name : typeof err;
}

interface LigneContact {
  readonly id: string;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly linkedin_url: string | null;
  readonly linkedin_provider_id: string | null;
  readonly email: string | null;
}

/**
 * Marque le contact comme traité SANS lui donner d'email : on a statué sur lui,
 * on ne le rachètera pas demain. `enriched_at` porte cette marque parce que
 * c'est elle que le producteur lit pour composer son lot.
 *
 * Attention au second effet : la purge d'ancienneté épargne un engageur dont
 * l'email a été acheté récemment. Cette épargne exige désormais un email
 * (`producer.ts`, `ecarterSignauxTropAnciens`) — sinon marquer ici rouvrirait la
 * rétention indéfinie que la tâche 6 a fermée, sur une personne pour qui on n'a
 * rien obtenu.
 */
async function marquerTraite(pool: Pool, organizationId: string, contactId: string): Promise<void> {
  await pool.query(`update contacts set enriched_at = now() where id = $1 and organization_id = $2`, [
    contactId,
    organizationId,
  ]);
}

export async function enrichirContactConnu(
  deps: DependancesEnrichissementContact,
  donnees: unknown,
): Promise<IssueEnrichissement> {
  const job = enrichContactConnuSchema.parse(donnees);
  const { pool } = deps;
  const org = job.organizationId;

  // --- Avant l'achat : tout peut lever, le job repartira sans avoir rien payé.

  const lu = await pool.query<LigneContact>(
    `select id, first_name, last_name, linkedin_url, linkedin_provider_id, email
       from contacts where id = $1 and organization_id = $2`,
    [job.contactId, org],
  );
  const contact = lu.rows[0];
  if (!contact) {
    console.warn(`${MSG.prefixe} ${MSG.introuvable(job.contactId)}`);
    return 'introuvable';
  }
  // Course : deux jobs pour le même contact, ou un email arrivé par le chemin
  // entreprise entre l'enfilage et ici. On ne rachète pas ce qu'on a déjà.
  if (contact.email !== null) {
    console.warn(`${MSG.prefixe} ${MSG.dejaEnrichi(job.contactId)}`);
    return 'deja_enrichi';
  }

  const refus = raisonDeNePasAcheter({
    linkedinUrl: contact.linkedin_url,
    linkedinProviderId: contact.linkedin_provider_id,
    firstName: contact.first_name,
    lastName: contact.last_name,
  });
  if (refus) {
    console.warn(`${MSG.prefixe} ${MSG.refus(job.contactId, refus)}`);
    // Marqué traité : sans cela le producteur le représenterait à chaque tour,
    // et son refus occuperait une place du lot au détriment d'un contact payable.
    await marquerTraite(pool, org, job.contactId);
    return 'refuse';
  }

  const apiKey = await deps.cleFullEnrich(org);
  if (!apiKey) {
    console.warn(`${MSG.prefixe} ${MSG.sansCle(org)}`);
    return 'sans_cle';
  }

  // Le jour du plafond suit le fuseau de l'ORGANISATION, pas celui du serveur :
  // c'est la même journée que celle qu'affiche l'écran Plafonds.
  const jour = jourCourantDansFuseau(await fuseauDeLOrganisation(pool, org));
  const plafond = await plafondDuJour(pool, org, 'enrichissements_par_jour');
  const credit = await pool.query<{ ok: boolean }>(
    `select app.consume_provider_credit($1, $2, $3, 1, $4::date) as ok`,
    [org, FOURNISSEUR, plafond, jour],
  );
  if (credit.rows[0]?.ok !== true) {
    // Pas d'erreur levée : rejouer le job ne ferait que redemander le crédit du
    // même jour. Le contact reste candidat (ni email ni `enriched_at`) et le
    // producteur le reprendra demain, sous un nouvel identifiant de job.
    console.warn(`${MSG.prefixe} ${MSG.plafond(org)}`);
    return 'plafond';
  }

  // --- L'achat. À partir d'ici, plus rien ne lève.

  const entree: FullEnrichContactInput = {
    ...(contact.first_name ? { first_name: contact.first_name } : {}),
    ...(contact.last_name ? { last_name: contact.last_name } : {}),
    // Non nul : `raisonDeNePasAcheter` a refusé `sans_adresse` plus haut.
    ...(contact.linkedin_url ? { linkedin_url: contact.linkedin_url } : {}),
  };

  let achat: AchatFullEnrich;
  try {
    achat = await deps.acheter(apiKey, entree);
  } catch (err) {
    // Le crédit est perdu, pas le contact : il repartira demain. Seul le TYPE de
    // l'erreur est consigné — une URL FullEnrich porte la clé en clair.
    console.warn(`${MSG.prefixe} ${MSG.panne(job.contactId, typeErreur(err))}`);
    return 'panne_fournisseur';
  }

  await enregistrerCout(pool, org, job.contactId, jour, achat.credits);

  const choisi = achat.resultat ? pickBestEmailWithSource(achat.resultat) : { email: null };
  if (!choisi.email) {
    console.warn(`${MSG.prefixe} ${MSG.sansEmail(job.contactId)}`);
    await marquerTraiteSansLever(pool, org, job.contactId);
    return 'sans_email';
  }

  const brut = achat.resultat ? rawStatusOf(achat.resultat, choisi.email) : null;
  const { status, confidence } = mapEmailStatus(brut);
  try {
    await pool.query(
      `update contacts set
          email = $3, email_status = $4::email_status, email_confidence = $5, enriched_at = now()
        where id = $1 and organization_id = $2 and email is null`,
      [job.contactId, org, choisi.email, status, confidence],
    );
  } catch (err) {
    // 23505 : l'adresse appartient déjà à une AUTRE fiche (index unique
    // org + lower(email)). Cas ordinaire — la même personne connue par deux
    // chemins — et non une panne : on ne fusionne pas deux fiches ici, le
    // contact reste sans email, et le passage continue.
    if ((err as { code?: string }).code !== '23505') {
      console.warn(`${MSG.prefixe} ${MSG.panne(job.contactId, typeErreur(err))}`);
      return 'panne_fournisseur';
    }
    console.warn(`${MSG.prefixe} ${MSG.emailDejaPris(job.contactId)}`);
    await marquerTraiteSansLever(pool, org, job.contactId);
    return 'email_deja_pris';
  }

  console.log(`${MSG.prefixe} ${MSG.achete(job.contactId, achat.credits)}`);
  return 'achete';
}

/**
 * Le coût réel, là où l'écran Fournisseurs le lira. Trois cas distincts, et il
 * FAUT qu'ils le restent :
 *   - coût absent de la réponse : signalé. Zéro serait un mensonge — on a payé
 *     quelque chose qu'on ne sait pas chiffrer ;
 *   - coût nul : rien à ajouter, rien à dire ;
 *   - coût non enregistré (aucune ligne de consommation pour ce jour) : signalé,
 *     parce que le chiffre vient de disparaître. Avaler cette erreur est
 *     exactement ce qui rendait la dépense invisible jusqu'ici.
 */
async function enregistrerCout(
  pool: Pool,
  organizationId: string,
  contactId: string,
  jour: string,
  credits: number | undefined,
): Promise<void> {
  if (credits === undefined) {
    console.warn(`${MSG.prefixe} ${MSG.coutAbsent(contactId)}`);
    return;
  }
  if (credits <= 0) return;
  try {
    const res = await pool.query<{ ok: boolean }>(
      `select app.record_provider_cost($1, $2, $3::numeric, $4::date) as ok`,
      [organizationId, FOURNISSEUR, credits, jour],
    );
    if (res.rows[0]?.ok !== true) {
      console.warn(`${MSG.prefixe} ${MSG.coutPerdu(organizationId, credits)}`);
    }
  } catch (err) {
    console.warn(`${MSG.prefixe} ${MSG.panne(contactId, typeErreur(err))}`);
  }
}

/** `marquerTraite`, mais une panne de base ne fait pas rejouer un achat déjà payé. */
async function marquerTraiteSansLever(pool: Pool, organizationId: string, contactId: string): Promise<void> {
  try {
    await marquerTraite(pool, organizationId, contactId);
  } catch (err) {
    console.warn(`${MSG.prefixe} ${MSG.panne(contactId, typeErreur(err))}`);
  }
}

/**
 * Les dépendances réelles. `acheter` appelle FullEnrich pour une SEULE personne
 * et lit le coût TEL QUEL — `enrichContactsViaFullEnrich`, l'aide tout-en-un,
 * écrase l'absence de coût en zéro (`job.cost?.credits ?? 0`) et rendrait les
 * deux cas indiscernables.
 */
export function dependancesEnrichissementReelles(
  pool: Pool,
  encryptionKey: string | undefined,
): DependancesEnrichissementContact {
  return {
    pool,
    cleFullEnrich: async (organizationId) => {
      const creds = await resolveProviderCredentials(pool, organizationId, FOURNISSEUR, { encryptionKey });
      return creds?.api_key ?? null;
    },
    acheter: async (apiKey, entree) => {
      const cle = 'c_0';
      const id = await submitBulkEnrichment(apiKey, `enrich-contact-${Date.now()}`, [
        { ...entree, custom: { contact_key: cle } },
      ]);
      const job = await pollBulkEnrichment(apiKey, id, { maxWaitMs: ATTENTE_MAX_MS });
      const resultat = (job.data ?? []).find((item) => item.custom?.contact_key === cle) ?? null;
      return { resultat, credits: job.cost?.credits };
    },
  };
}

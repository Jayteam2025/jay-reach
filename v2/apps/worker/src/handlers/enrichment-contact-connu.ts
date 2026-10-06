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
 * Tentatives PAYÉES au-delà desquelles on renonce à cette personne.
 *
 * Le crédit est consommé avant l'appel, et une panne du fournisseur laisse le
 * contact candidat : sans ce plafond, il repart chaque jour et coûte un crédit
 * chaque jour, pour toujours. Trois essais laissent passer une panne franche du
 * fournisseur et un incident réseau ; au quatrième, le problème n'est pas
 * passager.
 *
 * La marque posée alors est LEVABLE : remettre `contacts.enrichment_attempts` à
 * zéro (et `enriched_at` à null) suffit à autoriser un nouvel essai, le jour où
 * l'on voudra réessayer une fois le fournisseur réparé.
 */
const TENTATIVES_PAYEES_MAX = 3;

/**
 * Temps maximal d'attente d'une réponse FullEnrich.
 *
 * **90 s, et non les 40 s de l'enrichissement d'entreprise.** Ces 40 s ont été
 * choisies pour « rendre la main proprement avant la coupure à soixante »
 * (`enrich.ts`) — la coupure d'une fonction serverless. Le moteur tourne en
 * worker permanent sur le VPS depuis le 10/09/2026, et plus rien ne le coupe.
 * Or FullEnrich met 28,9 s en moyenne et **55,8 s au pire** (mesuré le
 * 01/09/2026) : à 40 s, on abandonnait un appel qui allait aboutir, alors que le
 * crédit était déjà payé et que rien n'oblige à rendre la main.
 *
 * La valeur est donc dérivée du pire cas mesuré, avec de la marge, et non d'un
 * budget d'exécution. `ENRICH_MAX_WAIT_MS` reste le réglage, pour une
 * installation qui hébergerait ce handler derrière une fonction coupée.
 */
const ATTENTE_MAX_MS = Number(process.env.ENRICH_MAX_WAIT_MS ?? 90_000);

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
  | 'panne_fournisseur'
  /** Le fournisseur a répondu et l'adresse est payée, mais NOTRE base refuse de l'écrire. */
  | 'ecriture_echouee'
  /** L'adresse est payée, mais une autre source avait déjà posé un email entre-temps. */
  | 'achat_perdu';

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
  tropDeTentatives: (contactId: string, tentatives: number) =>
    `contact ${contactId} abandonné après ${tentatives} tentative(s) PAYÉE(S) sans résultat — remettre enrichment_attempts à zéro pour réessayer`,
  plafondNul: (organizationId: string) =>
    `le plafond d'enrichissement de l'organisation ${organizationId} est réglé à zéro — aucun achat possible, rien n'a été consommé`,
  panne: (contactId: string, type: string) => `achat échoué pour le contact ${contactId} (${type}) — crédit consommé, contact reporté`,
  reessai: (contactId: string, type: string) => `écriture de l'adresse du contact ${contactId} en échec (${type}) — un second essai`,
  ecritureEchouee: (contactId: string, type: string) =>
    `adresse PAYÉE mais non enregistrée pour le contact ${contactId} (${type}) — la base refuse l'écriture, pas le fournisseur ; contact marqué pour ne pas la racheter`,
  achatPerdu: (contactId: string) =>
    `adresse PAYÉE pour le contact ${contactId} alors qu'une autre source venait de poser son email — achat perdu`,
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
    // Marqué traité pour `nom_tronque` SEULEMENT, et c'est une asymétrie voulue.
    //
    // La marque est irréversible : elle sort le contact du lot pour toujours. Un
    // nom tronqué l'est aussi — `enregistrerEngageur` n'écrase jamais un nom déjà
    // posé (`coalesce(last_name, …)`), donc « L. » ne sera jamais complété et le
    // contact resterait éternellement candidat sans devenir payable.
    //
    // Une adresse FABRIQUÉE, elle, peut cesser de l'être : il suffit qu'un
    // passage de collecte lise l'identifiant public et que le contact reçoive sa
    // vraie adresse. La marquer fermerait cette porte définitivement. Le
    // producteur l'exclut déjà en SQL, donc ne pas marquer ne coûte rien — et ce
    // chemin ne s'emprunte que pour un job déposé autrement (reprise à la main,
    // serveur MCP à venir).
    if (refus === 'nom_tronque') {
      await marquerTraite(pool, org, job.contactId);
    }
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
  // `consume_provider_credit` rend `false` pour DEUX raisons distinctes, et le
  // message doit dire laquelle. Lu dans la fonction (migration
  // `20260917130000`) : elle commence par `if p_cap <= 0 ... return false`, AVANT
  // de toucher au compteur — la ligne du jour, elle, est toujours créée ensuite
  // par un `insert ... on conflict`, donc son absence n'est jamais une cause de
  // refus. Un plafond réglé à zéro (valeur que l'écran Plafonds accepte,
  // `z.number().int().min(0)`) donnerait donc « plafond atteint » alors que rien
  // n'a jamais été consommé, et l'opérateur chercherait une consommation
  // inexistante au lieu de son propre réglage.
  if (plafond <= 0) {
    console.warn(`${MSG.prefixe} ${MSG.plafondNul(org)}`);
    return 'plafond';
  }
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

  // Le crédit est pris : cette tentative est PAYÉE, qu'elle aboutisse ou non.
  // Comptée ici et pas plus bas, pour qu'une coupure pendant l'appel ne la fasse
  // pas oublier — c'est le crédit qu'on compte, pas le résultat.
  const tentatives = (
    await pool.query<{ enrichment_attempts: number }>(
      `update contacts set enrichment_attempts = enrichment_attempts + 1
        where id = $1 and organization_id = $2
        returning enrichment_attempts`,
      [job.contactId, org],
    )
  ).rows[0]?.enrichment_attempts ?? 0;

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
    // …mais pas indéfiniment. Au-delà du plafond d'essais payés, on marque : le
    // contact coûterait sinon un crédit par jour sans jamais rien produire.
    if (tentatives >= TENTATIVES_PAYEES_MAX) {
      console.warn(`${MSG.prefixe} ${MSG.tropDeTentatives(job.contactId, tentatives)}`);
      await marquerTraiteSansLever(pool, org, job.contactId);
    }
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

  // L'adresse est PAYÉE : à partir d'ici, tout chemin de sortie doit laisser le
  // contact dans un état qui ne sera pas racheté demain. Un seul réessai, puis
  // la marque — insister davantage ferait attendre un job qui, de toute façon,
  // ne sera plus rejoué par la file (`retryLimit: 0`).
  let ecrit = 0;
  let echec: unknown = null;
  for (const essai of [1, 2]) {
    try {
      const r = await pool.query(
        `update contacts set
            email = $3, email_status = $4::email_status, email_confidence = $5, enriched_at = now()
          where id = $1 and organization_id = $2 and email is null`,
        [job.contactId, org, choisi.email, status, confidence],
      );
      ecrit = r.rowCount ?? 0;
      echec = null;
      break;
    } catch (err) {
      echec = err;
      // 23505 : l'adresse appartient déjà à une AUTRE fiche (index unique
      // org + lower(email)). Cas ordinaire — la même personne connue par deux
      // chemins — et non une panne : réessayer donnerait la même erreur.
      if ((err as { code?: string }).code === '23505') break;
      if (essai === 2) break;
      console.warn(`${MSG.prefixe} ${MSG.reessai(job.contactId, typeErreur(echec))}`);
    }
  }

  if (echec !== null) {
    if ((echec as { code?: string }).code === '23505') {
      console.warn(`${MSG.prefixe} ${MSG.emailDejaPris(job.contactId)}`);
      await marquerTraiteSansLever(pool, org, job.contactId);
      return 'email_deja_pris';
    }
    // Ce n'est PAS une panne du fournisseur : il a répondu, on lui a payé une
    // adresse, et c'est NOTRE base qui refuse de l'écrire. L'opérateur qui lit
    // « panne fournisseur » irait chercher du côté de FullEnrich. Et le contact
    // est marqué : sans cela il serait racheté demain, puis chaque jour, tant
    // que l'écriture échoue — c'est le seul chemin où l'on paie sans rien garder.
    console.warn(`${MSG.prefixe} ${MSG.ecritureEchouee(job.contactId, typeErreur(echec))}`);
    await marquerTraiteSansLever(pool, org, job.contactId);
    return 'ecriture_echouee';
  }

  if (ecrit === 0) {
    // La clause `and email is null` n'a trouvé personne : une autre source (le
    // chemin entreprise) a posé l'email entre notre lecture et cette écriture.
    // L'achat est perdu, mais le contact a bien son adresse — on ne dit donc ni
    // « achetée » (ce serait faux : la nôtre a été jetée) ni « déjà enrichi »
    // (qui désigne un cas où rien n'a été dépensé).
    console.warn(`${MSG.prefixe} ${MSG.achatPerdu(job.contactId)}`);
    return 'achat_perdu';
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

/**
 * L'accroche du post : la règle qui décide QUI peut entrer en campagne et POUR QUI on dépense,
 * quand le message nomme le post qui a fait réagir la personne.
 *
 * Mesuré par Alexandre le 14/10/2026, à sourcing identique : 31,1 % de réponses quand le message
 * nomme le post, 0 % quand il ne le nomme pas. L'accroche est donc ce qui fait la campagne — et
 * une accroche fausse (« le post de uptoo-france sur null ») la défait. D'où la règle que ce
 * fichier porte : **on n'inscrit personne, et on ne dépense rien, sur un post qu'un humain n'a
 * pas relu.**
 *
 * UNE définition, plusieurs écritures, c'est le point : la garde vit à quatre endroits (le
 * pré-filtre du producteur, le contrôle autoritaire de la fonction qui inscrit, celui de la
 * fonction qui dépense, et le décompte montré à l'opérateur). Quatre copies auraient divergé, et
 * la divergence se paie ici par une campagne qui retient tout le monde en silence — pire qu'une
 * campagne en panne.
 *
 * Les fragments prennent un ALIAS SQL écrit dans le code appelant, jamais une donnée
 * d'utilisateur : même convention que `sqlEstSignalDePersonne` (`../types.js`).
 */
import type { Executeur } from '../executeur.js';
// Imports internes au paquet (pas via le barrel `index.js`) : ces deux modules EN font partie,
// passer par le barrel créerait un cycle.
import { VARIABLES_DE_POST } from '../messages/variables.js';
import { TYPES_SOURCES_DE_POST } from '../fonctions/sources.js';

/**
 * Le motif Postgres qui reconnaît, dans un corps de message, un jeton parmi `variables`.
 *
 * Même forme que `TOKEN_RE` (`messages/variables.ts`) — espaces tolérés autour du nom, valeur de
 * repli facultative après `|`, qui ne peut pas contenir d'accolade fermante. Les noms de
 * variables sont des identifiants (`[a-z_]`), donc rien à échapper dans l'alternative.
 */
function motifSqlDesVariables(variables: readonly string[]): string {
  return `\\{\\{\\s*(${variables.join('|')})\\s*(\\|[^}]*)?\\}\\}`;
}

/**
 * Le motif des QUATRE variables de post, dérivé de `VARIABLES_DE_POST` et jamais recopié : le
 * jour où une cinquième existe, la garde la connaît sans qu'on y pense.
 *
 * Comparé en insensible à la casse (`~*`) par les fragments ci-dessous : l'enregistrement
 * canonise bien `{{POST_AUTEUR}}` en minuscules (`normalizeVariableSyntax`), mais une ligne
 * écrite avant cette canonisation, ou par une importation, doit compter quand même — se tromper
 * ici laisserait partir une accroche sans relecture.
 */
export const MOTIF_SQL_VARIABLE_DE_POST = motifSqlDesVariables([...VARIABLES_DE_POST]);

/**
 * Ce que CHAQUE variable de post exige de la fiche pour se résoudre — la condition SQL miroir de
 * ce que `construireValeursContact` lit (`messages/valeurs-contact.ts`).
 *
 * C'est le cœur de la garde : elle n'exige que les variables réellement écrites par la campagne.
 * Une campagne qui ne cite que `{{post_url}}` part dès la validation du post, puisque l'adresse
 * existe dès la création de la fiche ; exiger d'elle un auteur affiché et un sujet serait une
 * rétention silencieuse, exactement ce que cette garde existe pour éviter.
 *
 * `post_auteur` lit `author_display_name` et JAMAIS `author_name` : en mode créateur,
 * `author_name` peut valoir un identifiant technique (« uptoo-france »), que le nom affiché
 * laisse délibérément vide pour qu'aucune accroche illisible ne parte. Tester `author_name`
 * ferait entrer une personne dont le message dirait « le post de uptoo-france sur … ».
 *
 * La liste doit couvrir `VARIABLES_DE_POST` en entier : `accroche-post.test.ts` le vérifie, car
 * une variable sans exigence serait gardée (la campagne « nomme le post ») sans jamais être
 * vérifiée, et fabriquerait une action bloquée à l'envoi.
 */
export const EXIGENCES_VARIABLE_DE_POST: readonly {
  readonly variable: string;
  /** Condition SQL sur la fiche, dont l'alias est passé en paramètre. */
  readonly colonneRenseignee: (fiche: string) => string;
}[] = [
  { variable: 'post_auteur', colonneRenseignee: (f) => `coalesce(btrim(${f}.author_display_name), '') <> ''` },
  { variable: 'post_sujet', colonneRenseignee: (f) => `coalesce(btrim(${f}.subject), '') <> ''` },
  { variable: 'post_url', colonneRenseignee: (f) => `coalesce(btrim(${f}.url), '') <> ''` },
  { variable: 'post_date', colonneRenseignee: (f) => `${f}.posted_at is not null` },
];

/**
 * « Une étape en vigueur de cette campagne porte ce motif. »
 *
 * Le sujet compte autant que le corps : l'objet d'un email est rendu par le même
 * `renderTemplate` (`email-salesblink.ts`). Seules les versions EN VIGUEUR (`is_active`) sont
 * lues, parce que ce sont les seules que `resolveTemplate` choisit : une variable restée dans
 * une version désactivée ne part jamais, et retenir ses personnes serait du gel sans cause.
 */
function sqlGabaritPorteLeMotif(campagne: string, motif: string): string {
  return `exists (
            select 1 from public.sequence_steps st_ap
              join public.message_templates mt_ap
                on (mt_ap.id = st_ap.template_parent_id or mt_ap.parent_id = st_ap.template_parent_id)
             where st_ap.campaign_id = ${campagne}
               and mt_ap.is_active
               and (coalesce(mt_ap.body, '') ~* '${motif}'
                 or coalesce(mt_ap.subject, '') ~* '${motif}'))`;
}

/**
 * « Au moins une étape de cette campagne nomme le post. » C'est ce qui DÉCLENCHE la garde.
 *
 * @param campagne expression SQL qui donne l'id de la campagne (`c.id`)
 */
export function sqlCampagneNommeUnPost(campagne: string): string {
  return sqlGabaritPorteLeMotif(campagne, MOTIF_SQL_VARIABLE_DE_POST);
}

/** « Cette campagne écrit CETTE variable de post. » C'est ce qui décide de ce que la garde EXIGE. */
export function sqlCampagneEcritVariableDePost(campagne: string, variable: string): string {
  return sqlGabaritPorteLeMotif(campagne, motifSqlDesVariables([variable]));
}

/**
 * « La fiche du post de ce signal est relue par un humain, ET elle résout ce que CETTE campagne
 * écrit. »
 *
 * Deux conditions, pas une :
 *
 *  - `review_status = 'approved'` : un humain a vu le post. C'est la règle du lot, et elle ne
 *    dépend pas des variables écrites.
 *  - chaque variable de post que la campagne écrit se résout (`EXIGENCES_VARIABLE_DE_POST`).
 *    Une variable non résolue est remontée par `renderTemplate` dans `missing`, et l'envoi est
 *    bloqué : inscrire quand même brûlerait une place du plafond du jour pour fabriquer une
 *    action qui ne partira jamais — exactement le silence que ce lot existe pour supprimer.
 *    Retenue, la personne est COMPTÉE (`compterRetenuesParPost`) et l'opérateur peut compléter
 *    la fiche.
 *
 * Les variables que la campagne N'ÉCRIT PAS n'exigent rien : une campagne qui ne cite que
 * `{{post_url}}` entre dès la validation, sans auteur affiché ni sujet.
 *
 * @param campagne expression SQL qui donne l'id de la campagne (`c.id`)
 * @param signal   alias SQL du signal (`s`), dont on lit `linkedin_post_id` et `organization_id`
 */
export function sqlFichePostUtilisable(campagne: string, signal: string): string {
  const exigences = EXIGENCES_VARIABLE_DE_POST.map(
    (e) => `(not ${sqlCampagneEcritVariableDePost(campagne, e.variable)}
                     or ${e.colonneRenseignee('fp_ap')})`,
  ).join('\n               and ');
  return `exists (
            select 1 from public.linkedin_posts fp_ap
             where fp_ap.id = ${signal}.linkedin_post_id
               and fp_ap.organization_id = ${signal}.organization_id
               and fp_ap.review_status = 'approved'
               and ${exigences})`;
}

/**
 * « La fiche du post de ce signal attend encore sa relecture, et sa fenêtre n'est pas passée. »
 *
 * `expires_at` passé : plus d'attente, même si la bascule périodique n'a pas encore écrit
 * `rejected`. La date fait foi, pas l'horaire du passage.
 *
 * @param signal alias SQL du signal (`s`)
 */
export function sqlFichePostEnAttente(signal: string): string {
  return `exists (
            select 1 from public.linkedin_posts fp_at
             where fp_at.id = ${signal}.linkedin_post_id
               and fp_at.organization_id = ${signal}.organization_id
               and fp_at.review_status = 'pending'
               and fp_at.expires_at > now())`;
}

/**
 * « Une campagne NON ARCHIVÉE reliée à cette source nomme le post. »
 *
 * AU MOINS UNE : c'est le quantificateur de l'ÉPARGNE, dont l'erreur coûteuse est d'effacer à
 * tort, irréversiblement.
 *
 * `draft` et `paused` comptent : une campagne mise en pause une semaine, ou encore en
 * préparation, est précisément le cas ordinaire que la fenêtre de décision existe pour couvrir,
 * et l'épargne reste bornée par `expires_at` de toute façon.
 *
 * `archived` ne compte PAS, et c'est le seul statut exclu : une campagne archivée n'attend plus
 * rien. Garder pour elle le nom et l'intitulé de personnes jamais contactées, c'est payer la
 * rétention sans en acheter le bénéfice — exactement ce que l'arbitrage de la fenêtre a tranché.
 *
 * @param source expression SQL qui donne l'id de la source (`s.source_id`)
 */
export function sqlSourceAUneCampagneQuiNommeUnPost(source: string): string {
  return `exists (
            select 1 from public.campaign_sources cs_at
              join public.campaigns cp_at on cp_at.id = cs_at.campaign_id
             where cs_at.source_id = ${source}
               and cp_at.status <> 'archived'
               and ${sqlCampagneNommeUnPost('cp_at.id')})`;
}

/**
 * « QUELQU'UN attend la relecture de ce post » : la fiche est en attente DANS sa fenêtre, et une
 * campagne reliée à la source d'où ce post vient le nomme.
 *
 * C'est la branche d'épargne de la purge d'ancienneté. Les deux moitiés comptent :
 *
 *  - sans la première, l'épargne serait sans terme ;
 *  - sans la seconde, on garderait plus longtemps le nom et l'intitulé de personnes que PERSONNE
 *    n'attend. La fenêtre échange du temps de décision contre de la rétention : la payer sans
 *    acheter le bénéfice n'aurait aucun sens.
 *
 * Même atome que la garde d'entrée et que le gel de la dépense (`sqlCampagneNommeUnPost`),
 * composé différemment parce que les trois protègent d'erreurs opposées.
 *
 * La personne a été collectée le jour où le post a été découvert, et la fenêtre de décision
 * dépasse le délai d'ancienneté des signaux (`schemaEcrireReglage` le refuse autrement) : sans
 * cette épargne, la purge l'effacerait avant que l'opérateur ait pu valider son post, et valider
 * n'inscrirait plus personne.
 *
 * @param signal alias SQL du signal (`s`, ou `signals` quand la table n'est pas aliasée)
 */
export function sqlEpargneParUnPostARelire(signal: string): string {
  return `(${sqlFichePostEnAttente(signal)}
            and ${sqlSourceAUneCampagneQuiNommeUnPost(`${signal}.source_id`)})`;
}

/**
 * « L'achat de l'adresse de cette personne attend la relecture d'un post. »
 *
 * Posé à l'échelle d'une SOURCE, parce que l'enrichissement part d'un signal, qui connaît sa
 * source mais pas la campagne qui inscrira la personne. La question exacte est : « AUCUNE
 * campagne active de cette source ne peut l'inscrire aujourd'hui ». Une campagne le peut si elle
 * ne nomme pas le post, ou si la fiche résout déjà les variables qu'elle écrit.
 *
 * Le quantificateur est « TOUTES », pas « au moins une », et ce n'est pas une nuance. Si UNE
 * campagne active de cette source peut l'inscrire, elle le fera dès qu'elle aura son adresse :
 * geler l'achat la stériliserait pour rien (contrôle 21f du harnais).
 *
 * `status = 'active'` : une campagne en pause n'inscrit personne, donc elle ne décide rien ici.
 * Sans cette réserve, mettre sa campagne en pause une semaine gèlerait en silence tous les
 * achats de ses sources — un comportement que ce lot n'a pas à changer (contrôle 21g). C'est
 * l'inverse du quantificateur de l'épargne, et pour la raison inverse : ici l'erreur coûteuse
 * est de GELER à tort, là-bas d'EFFACER à tort.
 *
 * Aucune campagne active du tout : `false`, donc on n'empêche rien — le défaut sûr est celui qui
 * ne change pas le comportement existant.
 *
 * Le pré-filtre du producteur (`enqueueEnrichmentContactsConnus`) et le contrôle autoritaire de
 * la fonction qui dépense (`enrichirContactConnu`) posent la MÊME condition, écrite une fois.
 * Le refus est TEMPORAIRE : la fiche validée, le contact redevient candidat dès le tour suivant,
 * et rien n'est marqué sur lui entre-temps.
 *
 * @param signal alias SQL du signal d'origine du contact (`s`)
 */
export function sqlAchatRetenuParUnPost(signal: string): string {
  const jointure = `from public.campaign_sources cs_ap
                      join public.campaigns cp_ap on cp_ap.id = cs_ap.campaign_id
                     where cs_ap.source_id = ${signal}.source_id and cp_ap.status = 'active'`;
  return `(exists (select 1 ${jointure})
            and not exists (select 1 ${jointure}
                              and (not ${sqlCampagneNommeUnPost('cp_ap.id')}
                                or ${sqlFichePostUtilisable('cp_ap.id', signal)})))`;
}

/**
 * Lecture autoritaire de `sqlCampagneNommeUnPost` : vrai si une étape de la campagne utilise
 * `post_auteur`, `post_sujet`, `post_url` ou `post_date`.
 *
 * Appelée par la fonction qui INSCRIT (`enrollContact`), parce que c'est là que la garde doit
 * vivre : un job déposé autrement que par le producteur (reprise à la main, serveur MCP #100)
 * ne doit pas contourner la règle.
 */
export async function campagneNommeUnPost(ex: Executeur, campagneId: string): Promise<boolean> {
  const res = await ex.query<{ nomme: boolean }>(
    `select ${sqlCampagneNommeUnPost('$1::uuid')} as nomme /* jr:campagne_nomme_un_post */`,
    [campagneId],
  );
  return res.rows[0]?.nomme === true;
}

/**
 * Lecture autoritaire de `sqlFichePostUtilisable`, pour UN signal précis.
 *
 * Le signal est celui que portera l'inscription (`enrollments.signal_id`), donc celui que le
 * chemin d'ENVOI relit pour résoudre les variables (`REQUETE_LIGNE_INSCRIPTION`, jointure sur
 * `e.signal_id` seul). L'aperçu d'écran, lui, retient `coalesce(e.signal_id, c.source_signal_id)` :
 * divergence ANTÉRIEURE à ce lot, qu'on ne corrige pas ici (l'aligner changerait le rendu de
 * toutes les campagnes). La garde suit l'envoi, pour que garde et envoi ne puissent pas être en
 * désaccord sur le post nommé.
 *
 * Sans signal (`signalId` nul) : faux. Une inscription sans signal n'a pas de post, donc pas
 * d'accroche possible.
 */
export async function fichePostUtilisable(
  ex: Executeur,
  organisationId: string,
  campagneId: string,
  signalId: string | null | undefined,
): Promise<boolean> {
  if (!signalId) return false;
  const res = await ex.query<{ utilisable: boolean }>(
    `select ${sqlFichePostUtilisable('$3::uuid', 's')} as utilisable /* jr:fiche_post_utilisable */
       from signals s where s.id = $1 and s.organization_id = $2`,
    [signalId, organisationId, campagneId],
  );
  return res.rows[0]?.utilisable === true;
}

/** Lecture autoritaire de `sqlAchatRetenuParUnPost`, pour UN contact précis. */
export async function achatRetenuParUnPost(
  ex: Executeur,
  organisationId: string,
  contactId: string,
): Promise<boolean> {
  const res = await ex.query<{ retenu: boolean }>(
    `select ${sqlAchatRetenuParUnPost('s')} as retenu /* jr:achat_retenu_par_un_post */
       from contacts c join signals s on s.id = c.source_signal_id and s.organization_id = c.organization_id
      where c.id = $1 and c.organization_id = $2`,
    [contactId, organisationId],
  );
  return res.rows[0]?.retenu === true;
}

/**
 * Les fiches de post qui attendent encore la décision d'un humain, pour l'organisation.
 *
 * Le chiffre que l'écran Réglages › LinkedIn affiche à côté de la fenêtre de validation : sans
 * lui, le réglage n'aurait aucun ancrage — l'opérateur lirait « 28 jours » sans savoir s'il a
 * quoi que ce soit à relire. Compte les fiches ENCORE dans leur fenêtre : une fiche échue est
 * rejetée au passage suivant du moteur, la montrer comme « en attente » serait un mensonge.
 */
export async function compterPostsEnAttenteDeValidation(ex: Executeur, organisationId: string): Promise<number> {
  const res = await ex.query<{ n: string }>(
    `select count(*)::text as n /* jr:posts_en_attente_de_validation */
       from linkedin_posts
      where organization_id = $1 and review_status = 'pending' and expires_at > now()`,
    [organisationId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * Pourquoi personne ne part : ce que la garde retient, et ce qu'elle ne retient pas.
 *
 * Une campagne qui retient tout le monde sans rien afficher est pire qu'une campagne en panne.
 * Ces quatre faits suffisent à l'opérateur pour comprendre sans ouvrir un journal.
 */
export interface RetenuesParPost {
  /** Au moins une étape en vigueur de la campagne écrit une variable de post. */
  readonly nommeUnPost: boolean;
  /**
   * Au moins une source de la campagne produit des fiches de post. Faux avec `nommeUnPost` vrai,
   * c'est la mauvaise configuration que l'enregistrement accepte DÉLIBÉRÉMENT (pour ne pas
   * bloquer un opérateur qui branchera la source après coup) et que l'écran doit dire.
   */
  readonly aUneSourceDePost: boolean;
  /** Personnes pas encore inscrites dont le post attend sa relecture (fiche `pending` dans sa fenêtre). */
  readonly enAttenteDeValidation: number;
  /** Personnes pas encore inscrites qui ne viennent d'AUCUN post : aucune accroche ne les concerne. */
  readonly sansPost: number;
  /** Personnes dont le post est rejeté, échu, ou validé mais sans nom affiché ni sujet : fiche inexploitable. */
  readonly postInexploitable: number;
}

/**
 * Compte, par campagne, les personnes que la garde retient et dit pourquoi.
 *
 * La population comptée est volontairement LARGE : les personnes des sources de cette campagne
 * qui n'ont aucune inscription vivante. Elle ne rejoue pas les autres conditions d'entrée
 * (persona, score minimum, plafond du jour), et c'est délibéré — les recopier ici les ferait
 * diverger de `enqueueEnrollments`, pour un chiffre qui ne serait pas plus utile. Ce sont donc
 * des majorants honnêtes : « jusqu'à N personnes attendent la validation de leur post ».
 */
export async function compterRetenuesParPost(
  ex: Executeur,
  organisationId: string,
  campagneId: string,
): Promise<RetenuesParPost> {
  const res = await ex.query<{
    nomme_un_post: boolean;
    a_une_source_de_post: boolean;
    en_attente: string;
    sans_post: string;
    inexploitable: string;
  }>(
    `select ${sqlCampagneNommeUnPost('$2::uuid')} as nomme_un_post, /* jr:retenues_par_post */
            exists (select 1 from campaign_sources cs join sources so on so.id = cs.source_id
                     where cs.campaign_id = $2 and so.organization_id = $1
                       and so.config->>'sourceType' = any($3::text[])) as a_une_source_de_post,
            count(*) filter (where ${sqlFichePostEnAttente('s')})::text as en_attente,
            count(*) filter (where s.linkedin_post_id is null)::text as sans_post,
            count(*) filter (where s.linkedin_post_id is not null
                               and not ${sqlFichePostEnAttente('s')}
                               and not ${sqlFichePostUtilisable('$2::uuid', 's')})::text as inexploitable
       from contacts ct
       join signals s on s.id = ct.source_signal_id and s.organization_id = ct.organization_id
      where ct.organization_id = $1
        and exists (select 1 from campaign_sources cs2 where cs2.campaign_id = $2 and cs2.source_id = s.source_id)
        and not exists (select 1 from enrollments e
                         where e.contact_id = ct.id and e.status in ('active', 'paused', 'paused_absence'))`,
    [organisationId, campagneId, TYPES_SOURCES_DE_POST],
  );
  const l = res.rows[0];
  return {
    nommeUnPost: l?.nomme_un_post === true,
    aUneSourceDePost: l?.a_une_source_de_post === true,
    enAttenteDeValidation: Number(l?.en_attente ?? 0),
    sansPost: Number(l?.sans_post ?? 0),
    postInexploitable: Number(l?.inexploitable ?? 0),
  };
}

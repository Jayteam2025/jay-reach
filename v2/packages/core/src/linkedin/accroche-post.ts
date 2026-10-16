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
 * Elle vaut SANS RÉSERVE : dès qu'une étape en vigueur parle du post, de quelque façon que ce
 * soit — repli compris —, la relecture est exigée (`sqlCampagneNommeUnPost`). Ce qu'un repli
 * change, et la seule chose qu'il change, c'est ce qu'on exige de la FICHE : `{{post_date|le 12
 * octobre}}` n'attend pas de date, puisque le message part de toute façon. Le post se relit, la
 * fiche n'a rien à fournir. Les deux questions, et pourquoi elles ne peuvent pas partager un
 * motif, sont écrites sur `motifSqlDesVariables`.
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
 * Les motifs Postgres qui reconnaissent, dans un corps de message, un jeton parmi `variables`.
 *
 * Même forme que `TOKEN_RE` (`messages/variables.ts`) : espaces tolérés autour du nom, valeur de
 * repli facultative après `|`, qui ne peut pas contenir d'accolade fermante. Les noms de
 * variables sont des identifiants (`[a-z_]`), donc rien à échapper dans l'alternative.
 *
 * DEUX motifs, parce qu'il y a DEUX questions, et qu'un seul motif pour les deux se trompe
 * forcément sur l'une :
 *
 *  - `repli: true` — « cette campagne PARLE-T-ELLE du post ? » C'est ce qui déclenche la
 *    relecture humaine, et un repli n'en dispense pas. « j'ai vu votre réaction à ce post :
 *    `{{post_url|https://www.linkedin.com/feed/}}` » envoie l'adresse RÉELLE du post, puisque
 *    `url` est renseignée dès la création de la fiche : le repli ne sert jamais, et pourtant il
 *    suffirait à désactiver toute la relecture sans que l'opérateur le sache, ni que l'écran le
 *    dise. La relecture est une règle du lot, pas une question de résolution de variable.
 *  - `repli: false` — « que faut-il EXIGER de la fiche ? » Là, un repli change tout : la règle du
 *    dépôt est qu'une variable non résolue bloque l'envoi, et une variable à repli EST résolue
 *    (`renderTemplate` rend le repli dès que la valeur est vide). Exiger une date de la fiche
 *    pour `{{post_date|le 12 octobre}}`, ce serait retenir la personne indéfiniment en attendant
 *    un horodatage que seul le rattrapage peut poser, et que ce message n'attend pas.
 *
 * **Un repli VIDE n'est pas un repli** (`{{post_date|}}`, ou fait d'espaces) : `renderTemplate`
 * rendrait une chaîne vide, donc un blanc dans un envoi, ce que le dépôt interdit. Il se lit
 * comme une absence de repli, des deux côtés. La même lecture vit côté écran
 * (`fonctions/posts.ts`), et `accroche-post.test.ts` compare les deux sur les mêmes écritures.
 *
 * Deux variables seulement peuvent porter un repli : `NO_FALLBACK_VARIABLES` le refuse sur
 * `post_auteur` et `post_sujet` dès l'enregistrement, parce qu'il y serait l'interrupteur
 * silencieux vers le message sans accroche (0 % de réponses contre 31,1 %).
 */
function motifSqlDesVariables(variables: readonly string[], opts: { repli: boolean }): string {
  const jeton = `\\{\\{\\s*(${variables.join('|')})\\s*`;
  return opts.repli ? `${jeton}(\\|[^}]*)?\\}\\}` : `${jeton}(\\|\\s*)?\\}\\}`;
}

/**
 * Le motif des QUATRE variables de post, dérivé de `VARIABLES_DE_POST` et jamais recopié : le
 * jour où une cinquième existe, la garde la connaît sans qu'on y pense.
 *
 * Celui de la question « cette campagne parle-t-elle du post », donc tolérant au repli.
 *
 * Comparé en insensible à la casse (`~*`) par les fragments ci-dessous : l'enregistrement
 * canonise bien `{{POST_AUTEUR}}` en minuscules (`normalizeVariableSyntax`), mais une ligne
 * écrite avant cette canonisation, ou par une importation, doit compter quand même — se tromper
 * ici laisserait partir une accroche sans relecture.
 */
export const MOTIF_SQL_VARIABLE_DE_POST = motifSqlDesVariables([...VARIABLES_DE_POST], { repli: true });

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
 * TROIS champs, et il en faut trois : ce sont les trois qui peuvent se retrouver dans ce que
 * le prospect lit.
 *
 *  - `body` : le corps du message ;
 *  - `subject` : l'objet d'un email, rendu par le même `renderTemplate` ;
 *  - `name`, **mais seulement quand il devient l'objet** : un pas d'étape en email dont le sujet
 *    est NUL. `subject ?? name`, à l'envoi (`email-salesblink.ts`) comme à l'aperçu de la file
 *    du jour (`file-du-jour.ts`) — `??`, donc un sujet vide (`''`) ne se replie pas, seul un
 *    sujet nul le fait. Le nom d'un gabarit n'est ni validé, ni normalisé, ni proposé à
 *    l'insertion : rien n'empêche d'y écrire une variable, et un gabarit nommé « Votre réaction
 *    à {{post_url}} », au sujet nul, envoyait l'adresse réelle d'un post que personne n'avait
 *    relu — sans garde d'entrée, sans gel d'achat, sans épargne, et avec un écran muet.
 *
 * La BORNE compte autant que la lecture : le nom d'un gabarit d'étape est le nom de la campagne,
 * et `verserDansBibliotheque` réécrit celui de toute la lignée. Lu sans condition, une campagne
 * nommée avec un jeton gèlerait inscriptions et achats sur TOUS les canaux, pour un nom que
 * personne ne lirait jamais.
 *
 * Les trois champs valent pour les DEUX questions : un nom qui écrit `{{post_sujet}}` doit
 * exiger un sujet de la fiche, sinon l'email part avec un objet vide.
 *
 * Seules les versions EN VIGUEUR (`is_active`) sont lues, parce que ce sont les seules que
 * `resolveTemplate` choisit : une variable restée dans une version désactivée ne part jamais, et
 * retenir ses personnes serait du gel sans cause.
 */
function sqlGabaritPorteLeMotif(campagne: string, motif: string): string {
  return `exists (
            select 1 from public.sequence_steps st_ap
              join public.message_templates mt_ap
                on (mt_ap.id = st_ap.template_parent_id or mt_ap.parent_id = st_ap.template_parent_id)
             where st_ap.campaign_id = ${campagne}
               and mt_ap.is_active
               and (coalesce(mt_ap.body, '') ~* '${motif}'
                 or coalesce(mt_ap.subject, '') ~* '${motif}'
                 or (st_ap.channel = 'email' and mt_ap.subject is null
                     and coalesce(mt_ap.name, '') ~* '${motif}')))`;
}

/**
 * « Au moins une étape de cette campagne nomme le post. » C'est ce qui DÉCLENCHE la garde.
 *
 * @param campagne expression SQL qui donne l'id de la campagne (`c.id`)
 */
export function sqlCampagneNommeUnPost(campagne: string): string {
  return sqlGabaritPorteLeMotif(campagne, MOTIF_SQL_VARIABLE_DE_POST);
}

/**
 * « Cette campagne écrit CETTE variable de post, sans repli. » C'est ce qui décide de ce que la
 * garde EXIGE de la fiche — et un repli dispense de l'exigence, lui, parce qu'il résout la
 * variable. Voir `motifSqlDesVariables` : ce n'est pas la même question que « nomme-t-elle un
 * post », qui, elle, reste vraie avec un repli.
 */
export function sqlCampagneEcritVariableDePost(campagne: string, variable: string): string {
  return sqlGabaritPorteLeMotif(campagne, motifSqlDesVariables([variable], { repli: false }));
}

/**
 * « Cette fiche résout TOUT ce que cette campagne écrit, et rien de plus. »
 *
 * Le quantificateur du lot, isolé pour avoir DEUX lecteurs et une seule écriture : la garde
 * d'entrée (`sqlFichePostUtilisable`, ci-dessous) et la validation à l'écran (`validerPost`,
 * `fonctions/posts.ts`). Les deux doivent exiger la même chose, sous peine d'offrir à l'opérateur
 * un bouton « Valider » qui ne débloque rien — il valide, la garde continue de retenir, et rien à
 * l'écran ne dit pourquoi.
 *
 * @param campagne expression SQL qui donne l'id de la campagne
 * @param fiche    alias SQL de la ligne `linkedin_posts`
 */
export function sqlFicheResoutCeQuEcritLaCampagne(campagne: string, fiche: string): string {
  return EXIGENCES_VARIABLE_DE_POST.map(
    (e) => `(not ${sqlCampagneEcritVariableDePost(campagne, e.variable)}
                     or ${e.colonneRenseignee(fiche)})`,
  ).join('\n               and ');
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
  const exigences = sqlFicheResoutCeQuEcritLaCampagne(campagne, 'fp_ap');
  return `exists (
            select 1 from public.linkedin_posts fp_ap
             where fp_ap.id = ${signal}.linkedin_post_id
               and fp_ap.organization_id = ${signal}.organization_id
               and fp_ap.review_status = 'approved'
               and ${exigences})`;
}

/**
 * « Le post de ce signal RETIENT cette personne. »
 *
 * Deux conditions, et la première est celle qui manquait : **une fiche doit exister**. Retenir
 * une personne dont le signal n'a aucun post rattaché — un contact Adzuna, une ligne importée —
 * la bloquait POUR TOUJOURS : il n'y a aucune fiche à relire, donc aucun geste d'écran ne lève
 * la rétention, et `missing_variable` ne prend pas le relais quand la campagne écrit un repli
 * (le repli résout la variable, l'envoi partait très bien avant ce lot).
 *
 * La règle est donc : **on ne retient que s'il y a quelque chose à relire.** Pas de fiche, rien à
 * relire, le message part — le rendu décide seul, repli ou variable manquante. Une fiche
 * rattachée et non relue (ou qui ne résout pas ce que la campagne écrit), on retient.
 *
 * Ça ne rouvre AUCUN des chemins que la garde ferme, parce que tous en ont une : l'engageur d'un
 * post a sa fiche dès la capture, y compris pour l'accroche cachée dans le nom du gabarit. La
 * seule population que ce prédicat relâche est celle qui n'a jamais eu de post.
 *
 * CONSÉQUENCE ASSUMÉE : un engageur dont la fiche n'a pas pu être enregistrée (`collecte-linkedin`
 * continue sans elle, et rien ne rattache un signal après coup) n'en aura jamais. Son message
 * part donc avec le repli — une accroche fausse. Sans repli, `missing_variable` le bloque, et
 * c'est le cas ordinaire.
 *
 * @param campagne expression SQL qui donne l'id de la campagne
 * @param signal   alias SQL du signal (`s`)
 */
export function sqlPostRetientLaPersonne(campagne: string, signal: string): string {
  return `(${signal}.linkedin_post_id is not null
            and not ${sqlFichePostUtilisable(campagne, signal)})`;
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
 * « La fiche du post de ce signal est encore dans sa fenêtre », quel que soit son état de
 * relecture. C'est ce que l'ÉPARGNE regarde, et la raison tient en une phrase :
 *
 * **la fenêtre annoncée à l'écran doit être celle où valider sert encore.**
 *
 * L'épargne s'indexait sur `pending` seul, quand les quatre autres gardes s'indexent sur
 * `approved`. Au moment précis où l'opérateur validait, l'épargne tombait — et dans `produire`,
 * la purge d'ancienneté passe AVANT l'enfilage des inscriptions. Le geste utile effaçait donc
 * ses propres personnes au passage suivant, quinze minutes plus tard : la ligne promettait
 * « effacées le 29/10 », et valider le 20 les supprimait. Fenêtre annoncée 28 jours, fenêtre
 * réelle 14.
 *
 * Trois autres états sont dans le même cas, et pour la même raison : une fiche `approved` mais
 * INCOMPLÈTE retient (la garde exige qu'elle résolve ce que la campagne écrit), une fiche
 * `rejected` retient aussi, et toutes deux se réparent — compléter le sujet, ou « Rouvrir ».
 * Retenir sans épargner, c'est promettre une fenêtre qu'on n'honore pas.
 *
 * CE QUE ÇA COÛTE : on garde le nom et l'intitulé d'une personne jusqu'à `expires_at` même quand
 * sa fiche est rejetée et ne sera jamais rouverte. C'est borné par la fenêtre réglable, qui est
 * exactement la promesse faite à l'écran — et c'est le prix de cette promesse, pas un oubli.
 *
 * LE RÉSIDU, assumé et écrit ici pour qu'on ne le redécouvre pas comme un bug. `produire`
 * enchaîne expiration de fiches, puis purge d'ancienneté, puis enfilage des inscriptions
 * (`apps/worker/src/traitements.ts`). Valider dans les toutes dernières minutes de la fenêtre ne
 * sert donc à rien : au cycle suivant, l'expiration passe la fiche `rejected` ET la sort de sa
 * fenêtre, l'épargne tombe, et la purge efface avant que l'enfilage n'ait vu la personne.
 *
 * Pourquoi on n'inverse PAS purge et enfilage : cet ordre vaut pour tout le moteur, pas seulement
 * pour les posts, et le toucher déplacerait le risque sur des chemins que ce lot ne couvre pas.
 * Le défaut qu'on vient de fermer valait quatorze jours sur vingt-huit ; celui-ci vaut quelques
 * minutes au bout de vingt-huit jours. L'échange est net, et c'est une décision, pas un oubli.
 *
 * @param signal alias SQL du signal (`s`)
 */
export function sqlFichePostDansSaFenetre(signal: string): string {
  return `exists (
            select 1 from public.linkedin_posts fp_fe
             where fp_fe.id = ${signal}.linkedin_post_id
               and fp_fe.organization_id = ${signal}.organization_id
               and fp_fe.expires_at > now())`;
}

/**
 * « Cette source alimente cette campagne. »
 *
 * DEUX liens, pas un : la table de liaison `campaign_sources`, et le lien historique
 * `campaigns.source_id`, que le producteur accepte toujours (`sqlPairesEligibles`). Ne regarder
 * que le premier donne une campagne qui RETIENT ses personnes avec un onglet Posts vide — la
 * garde voit les deux liens, l'écran n'en verrait qu'un. Zéro campagne concernée aujourd'hui ;
 * c'est la raison pour laquelle on l'écrit ici une fois, plutôt que de le découvrir sur une
 * campagne vivante.
 *
 * @param campagne expression SQL qui donne l'id de la campagne
 * @param source   expression SQL qui donne l'id de la source
 */
export function sqlSourceAlimenteLaCampagne(campagne: string, source: string): string {
  return `(exists (select 1 from public.campaigns cp_sa
                    where cp_sa.id = ${campagne} and cp_sa.source_id = ${source})
            or exists (select 1 from public.campaign_sources cs_sa
                        where cs_sa.campaign_id = ${campagne} and cs_sa.source_id = ${source}))`;
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
            select 1 from public.campaigns cp_at
             where cp_at.status <> 'archived'
               and ${sqlSourceAlimenteLaCampagne('cp_at.id', source)}
               and ${sqlCampagneNommeUnPost('cp_at.id')})`;
}

/**
 * « QUELQU'UN attend la relecture de ce post » : la fiche est en attente DANS sa fenêtre, et une
 * campagne reliée à la source d'où ce post vient le nomme.
 *
 * C'est la branche d'épargne de la purge d'ancienneté. Les deux moitiés comptent :
 *
 *  - sans la première, l'épargne serait sans terme ; c'est la FENÊTRE qu'elle regarde, et non
 *    l'état de relecture (`sqlFichePostDansSaFenetre`) — s'indexer sur `pending` faisait tomber
 *    l'épargne à l'instant même où l'opérateur validait, et la purge, qui passe avant l'enfilage,
 *    effaçait les personnes qu'il venait de débloquer ;
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
  return `(${sqlFichePostDansSaFenetre(signal)}
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
  const jointure = `from public.campaigns cp_ap
                     where cp_ap.status = 'active'
                       and ${sqlSourceAlimenteLaCampagne('cp_ap.id', `${signal}.source_id`)}`;
  return `(exists (select 1 ${jointure})
            and not exists (select 1 ${jointure}
                              and (not ${sqlCampagneNommeUnPost('cp_ap.id')}
                                or not ${sqlPostRetientLaPersonne('cp_ap.id', signal)})))`;
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
 * Lecture autoritaire de `sqlPostRetientLaPersonne`, pour UN signal précis.
 *
 * Le signal est celui que portera l'inscription (`enrollments.signal_id`), donc celui que le
 * chemin d'ENVOI relit pour résoudre les variables (`REQUETE_LIGNE_INSCRIPTION`, jointure sur
 * `e.signal_id` seul). L'aperçu d'écran, lui, retient `coalesce(e.signal_id, c.source_signal_id)` :
 * divergence ANTÉRIEURE à ce lot, qu'on ne corrige pas ici (l'aligner changerait le rendu de
 * toutes les campagnes). La garde suit l'envoi, pour que garde et envoi ne puissent pas être en
 * désaccord sur le post nommé.
 *
 * Sans signal (`signalId` nul) : rien ne retient. Une inscription sans signal n'a aucune fiche à
 * faire relire ; c'est le rendu qui décidera, repli ou variable manquante.
 */
export async function postRetientLaPersonne(
  ex: Executeur,
  organisationId: string,
  campagneId: string,
  signalId: string | null | undefined,
): Promise<boolean> {
  if (!signalId) return false;
  const res = await ex.query<{ retenu: boolean }>(
    `select ${sqlPostRetientLaPersonne('$3::uuid', 's')} as retenu /* jr:post_retient_la_personne */
       from signals s where s.id = $1 and s.organization_id = $2`,
    [signalId, organisationId, campagneId],
  );
  return res.rows[0]?.retenu === true;
}

/**
 * « Cet envoi nomme un post que personne n'a relu. »
 *
 * La garde d'entrée ne protège que l'ENTRÉE en séquence : elle décide qui s'inscrit, pas ce qui
 * part. Or le chemin d'usage le plus probable est justement l'autre — une campagne qui tourne
 * déjà, à laquelle on ajoute l'accroche après coup, ce que les 31,1 % mesurés invitent à faire.
 * Ses personnes sont inscrites depuis longtemps ; à l'étape suivante, `{{post_url}}` se résout
 * (l'adresse existe dès la création de la fiche), rien ne manque, et le message part en nommant
 * un post que personne n'a relu. C'est exactement ce que ce lot promet d'empêcher.
 *
 * Même quantificateur que la garde d'entrée (`sqlPostRetientLaPersonne`), et le même signal :
 * celui que porte l'inscription (`enrollments.signal_id`), donc celui que le chemin d'envoi relit
 * pour résoudre les variables.
 *
 * Sans signal (`signalId` nul), et plus généralement sans fiche rattachée : faux, et ce n'est pas
 * un trou. Rien à relire, donc rien à retenir ; c'est le rendu qui décide, repli ou variable
 * manquante — et une variable non résolue bloque déjà l'envoi par le mécanisme ordinaire.
 */
export async function envoiRetenuParUnPost(
  ex: Executeur,
  organisationId: string,
  campagneId: string,
  signalId: string | null | undefined,
): Promise<boolean> {
  if (!signalId) return false;
  const res = await ex.query<{ retenu: boolean }>(
    `select (${sqlCampagneNommeUnPost('$3::uuid')}
              and ${sqlPostRetientLaPersonne('$3::uuid', 's')}) as retenu /* jr:envoi_retenu_par_un_post */
       from signals s where s.id = $1 and s.organization_id = $2`,
    [signalId, organisationId, campagneId],
  );
  return res.rows[0]?.retenu === true;
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
  /**
   * Personnes dont le post est rejeté, échu, ou validé mais sans nom affiché ni sujet : fiche
   * inexploitable.
   *
   * Il n'y a PLUS de catégorie « sans aucun post » : depuis `sqlPostRetientLaPersonne`, ces
   * personnes ne sont plus retenues du tout, et annoncer une rétention qui n'a pas lieu est le
   * défaut d'en face — celui qui éteint les vraies alertes.
   */
  readonly postInexploitable: number;
}

/**
 * Ce que l'écran a le DROIT d'affirmer.
 *
 * Le quantificateur du moteur, reporté sur l'affichage : la garde ne retient personne tant que la
 * campagne ne nomme pas le post, et l'épargne de purge n'existe pas davantage. Sans cette
 * condition, l'écran annonce des personnes bloquées et une date d'effacement qui ne valent pas
 * pour cette campagne — l'opérateur passe son temps à valider des posts en croyant débloquer ce
 * que rien ne bloque, et le jour où la rétention sera vraie il ne la lira plus (ce dépôt a déjà
 * payé « une alerte fausse en éteint une vraie »).
 *
 * Pure, et ici plutôt que dans l'écran, pour vivre à côté du quantificateur qu'elle recopie.
 */
export function retenuesAAfficher(r: RetenuesParPost): {
  /** La campagne nomme un post mais aucune de ses sources n'en produit : personne n'entrera. */
  readonly sansSource: boolean;
  readonly postInexploitable: number;
  readonly enAttenteDeValidation: number;
  /** L'échéance d'une fiche ne se promet que si l'épargne de purge s'applique : même condition. */
  readonly echeances: boolean;
  /**
   * Le travail de relecture s'ANNONCE (résumé de la barre, badge de l'onglet). Même condition,
   * décision distincte : sans accroche, relire ne débloque personne, et l'annoncer envoie
   * l'opérateur valider pour rien. Le badge, lui, est déjà borné à la source
   * (`compterPostsAValiderDeCampagne`) ; ce drapeau-ci est ce qui en dit autant à la barre.
   */
  readonly relecture: boolean;
} {
  if (!r.nommeUnPost) {
    return { sansSource: false, postInexploitable: 0, enAttenteDeValidation: 0, echeances: false, relecture: false };
  }
  return {
    sansSource: !r.aUneSourceDePost,
    postInexploitable: r.postInexploitable,
    enAttenteDeValidation: r.enAttenteDeValidation,
    echeances: true,
    relecture: true,
  };
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
    inexploitable: string;
  }>(
    `select ${sqlCampagneNommeUnPost('$2::uuid')} as nomme_un_post, /* jr:retenues_par_post */
            exists (select 1 from sources so
                     where so.organization_id = $1
                       and so.config->>'sourceType' = any($3::text[])
                       and ${sqlSourceAlimenteLaCampagne('$2::uuid', 'so.id')}) as a_une_source_de_post,
            count(*) filter (where ${sqlFichePostEnAttente('s')})::text as en_attente,
            count(*) filter (where not ${sqlFichePostEnAttente('s')}
                               and ${sqlPostRetientLaPersonne('$2::uuid', 's')})::text as inexploitable
       from contacts ct
       join signals s on s.id = ct.source_signal_id and s.organization_id = ct.organization_id
      where ct.organization_id = $1
        and ${sqlSourceAlimenteLaCampagne('$2::uuid', 's.source_id')}
        and not exists (select 1 from enrollments e
                         where e.contact_id = ct.id and e.status in ('active', 'paused', 'paused_absence'))`,
    [organisationId, campagneId, TYPES_SOURCES_DE_POST],
  );
  const l = res.rows[0];
  return {
    nommeUnPost: l?.nomme_un_post === true,
    aUneSourceDePost: l?.a_une_source_de_post === true,
    enAttenteDeValidation: Number(l?.en_attente ?? 0),
    postInexploitable: Number(l?.inexploitable ?? 0),
  };
}

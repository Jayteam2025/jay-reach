/**
 * L'écran de validation des posts : la FAÇADE métier de la relecture humaine que la garde
 * d'accroche (`linkedin/accroche-post.ts`) exige. Sans elle, la garde retient tout le monde
 * indéfiniment.
 *
 * Une fonction, deux façades : l'écran (Server Actions) et le futur serveur MCP (#100) appellent
 * ces fonctions telles quelles, avec le même `Contexte`.
 *
 * AUCUNE de ces fonctions n'efface quoi que ce soit. Rejeter est un drapeau réversible : les
 * personnes restent, elles retombent sous la purge ordinaire (`expires_at`). Un clic ne doit pas
 * pouvoir effacer quatre-vingt-treize personnes.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { ErreurEntree, ErreurIntrouvable, exiger, valider } from './contexte.js';
import { VARIABLES_DE_POST, renderTemplatePartial } from '../messages/variables.js';
// Imports internes au paquet (pas via le barrel) : la garde d'accroche EN fait partie, et c'est
// elle qui dit ce qu'une campagne exige d'une fiche. UNE écriture, deux lecteurs — la garde du
// moteur et la validation de cet écran — parce qu'un bouton « Valider » qui exige autre chose que
// la garde est un bouton qui ne débloque rien.
import {
  EXIGENCES_VARIABLE_DE_POST,
  sqlCampagneEcritVariableDePost,
  sqlCampagneNommeUnPost,
  sqlFicheResoutCeQuEcritLaCampagne,
  sqlSourceAlimenteLaCampagne,
} from '../linkedin/accroche-post.js';
// Même borne que le sujet écrit par le modèle : un sujet de l'opérateur se glisse dans la même phrase.
import { SUJET_POST_MAX_CARACTERES } from '../scoring.js';

export type EtatPost = 'pending' | 'approved' | 'rejected';

export type LignePost = {
  id: string;
  url: string;
  auteur: string | null;
  sujet: string | null;
  posteLe: Date | null;
  etat: EtatPost;
  personnesEnAttente: number;
  expireLe: Date;
  apercuAccroche: string | null;
};

const ETATS: readonly [EtatPost, ...EtatPost[]] = ['pending', 'approved', 'rejected'];

/**
 * Borne du nom d'auteur affiché. Du même ordre que celle du sujet, et pour la même raison : ce
 * texte se glisse dans une phrase envoyée à un prospect, il ne doit pas la noyer. Plus large que
 * le sujet parce qu'un nom de page LinkedIn peut être long sans être bavard.
 */
export const AUTEUR_POST_MAX_CARACTERES = 80;

const schemaListe = z.object({ campagneId: z.string().uuid(), etat: z.enum(ETATS).optional() });
const schemaPost = z.object({ postId: z.string().uuid() });
/**
 * Valider se fait DEPUIS une campagne, et pas dans l'absolu : ce qu'il faut exiger de la fiche,
 * c'est ce que cette campagne écrit (`sqlFicheResoutCeQuEcritLaCampagne`). Sans l'id de campagne,
 * la fonction devrait inventer un quantificateur que la garde, elle, n'a pas.
 */
const schemaValidation = z.object({ postId: z.string().uuid(), campagneId: z.string().uuid() });
const schemaCorrection = z.object({
  postId: z.string().uuid(),
  sujet: z.string().trim().min(1, 'Le sujet ne peut pas être vide.').max(SUJET_POST_MAX_CARACTERES, `Le sujet doit tenir en ${SUJET_POST_MAX_CARACTERES} caractères : il se glisse dans une phrase.`),
});
const schemaCorrectionAuteur = z.object({
  postId: z.string().uuid(),
  auteur: z.string().trim().min(1, 'Le nom de l\'auteur ne peut pas être vide.').max(AUTEUR_POST_MAX_CARACTERES, `Le nom de l'auteur doit tenir en ${AUTEUR_POST_MAX_CARACTERES} caractères : il se glisse dans une phrase.`),
});
const schemaCampagne = z.object({ campagneId: z.string().uuid() });

/** Les deux parties de l'accroche que l'opérateur ÉCRIT lui-même, dans la phrase. */
export const CHAMPS_ACCROCHE = ['auteur', 'sujet'] as const;
export type ChampAccroche = (typeof CHAMPS_ACCROCHE)[number];

/**
 * Les variables de post que la CAPTURE relève et que l'opérateur ne peut pas écrire : l'adresse
 * du post et sa date de publication.
 *
 * La date n'est pas une chaîne, c'est un horodatage ; l'offrir à la saisie, c'est accepter qu'un
 * message parte sur une date inventée. Elle n'a donc aucun champ à l'écran — ce qui oblige à la
 * dire autrement quand elle manque, au lieu de laisser le jeton brut sous les yeux de
 * l'opérateur et de compter la ligne validable (« Tout valider » butait dessus à chaque
 * passage, et le refus du serveur lui demandait d'écrire ce qui ne s'écrit pas).
 *
 * `CHAMPS_ACCROCHE` et cette liste couvrent `VARIABLES_DE_POST` en entier, et `posts.test.ts` le
 * vérifie : une cinquième variable de post doit choisir son camp, faute de quoi elle
 * retomberait en silence du mauvais côté.
 */
export const VARIABLES_DE_POST_RELEVEES = ['post_url', 'post_date'] as const;
export type VariableDePostRelevee = (typeof VARIABLES_DE_POST_RELEVEES)[number];

/**
 * Un morceau d'accroche : du texte déjà résolu, un champ que l'opérateur édite dans la phrase, ou
 * une variable relevée par la capture qui n'a pas pu l'être (`manquant`) — celle-là ne s'écrit
 * pas, elle se signale.
 */
export type MorceauAccroche =
  | { readonly texte: string }
  | { readonly champ: ChampAccroche }
  | { readonly manquant: VariableDePostRelevee };

/**
 * Les jetons de post restés dans l'aperçu, et ceux qui suffisent à faire d'une phrase une accroche.
 *
 * Ces deux-ci tolèrent le repli, là où le motif de la GARDE l'exclut (`motifSqlDesVariables`), et
 * la divergence est voulue : les deux ne répondent pas à la même question. La garde demande « que
 * faut-il EXIGER de la fiche », et une variable à repli n'exige rien puisqu'elle se résout
 * toujours. Ces motifs-ci demandent « quelle phrase parle du post, et qu'y reste-t-il à
 * l'écran » : écarter une phrase parce que sa date porte un repli ferait retomber l'écran sur sa
 * phrase par défaut — une phrase inventée, que cette campagne n'enverra jamais.
 */
const JETON_DE_POST_RESTANT = new RegExp(`\\{\\{\\s*(${[...VARIABLES_DE_POST].join('|')})\\s*(?:\\|[^}]*)?\\}\\}`, 'gi');
const JETON_DE_POST = new RegExp(`\\{\\{\\s*(?:${[...VARIABLES_DE_POST].join('|')})\\s*(?:\\|[^}]*)?\\}\\}`, 'i');

/**
 * Coupe une accroche rendue en morceaux : le texte déjà résolu, les champs que l'opérateur édite
 * DANS la phrase (le nom de l'auteur, le sujet), et ce que la capture n'a pas pu relever.
 *
 * L'entrée est un rendu PARTIEL (`listerPostsDeCampagne`) : l'adresse et la date y sont déjà
 * substituées quand elles existent. Un jeton de post qui a survécu à ce rendu est donc, par
 * construction, soit un champ laissé exprès à l'opérateur, soit une valeur cherchée et vide —
 * d'où les deux issues de la boucle. C'est le SEUL endroit qui le sait, et c'est pour ça que
 * c'est ici que la distinction se fait plutôt que dans l'écran.
 *
 * `null` seulement quand il n'y a pas d'accroche du tout (aucune étape de la campagne ne nomme le
 * post) : l'écran retombe alors sur sa phrase par défaut. Une accroche qui ne cite que
 * `{{post_url}}` rend UN morceau de texte et aucun champ — c'est exact, il n'y a rien à écrire.
 *
 * L'ancienne découpe en `avant` / `apres` ne connaissait que le sujet : une accroche qui nomme
 * l'auteur laissait donc `{{post_auteur}}` en clair sous les yeux de l'opérateur, sans aucun moyen
 * de le corriger.
 */
export function decouperAccroche(apercu: string | null): MorceauAccroche[] | null {
  if (apercu === null) return null;
  const morceaux: MorceauAccroche[] = [];
  let curseur = 0;
  for (const m of apercu.matchAll(JETON_DE_POST_RESTANT)) {
    if (m.index > curseur) morceaux.push({ texte: apercu.slice(curseur, m.index) });
    const nom = (m[1] ?? '').toLowerCase();
    const champ = CHAMPS_ACCROCHE.find((c) => `post_${c}` === nom);
    morceaux.push(champ ? { champ } : { manquant: nom as VariableDePostRelevee });
    curseur = m.index + m[0].length;
  }
  if (curseur < apercu.length) morceaux.push({ texte: apercu.slice(curseur) });
  return morceaux;
}

/**
 * La phrase du gabarit qui nomme le post, ou `null`. Une phrase finit à `. ! ?` ou à un saut de
 * ligne.
 *
 * N'importe laquelle des quatre variables de post suffit, et pas seulement le sujet : une campagne
 * qui ne cite que `{{post_auteur}}` retombait sinon sur la phrase par défaut, où le sujet
 * s'éditait alors qu'il ne partirait jamais. L'écran doit rendre éditable ce qui partira, ni plus
 * ni moins — la même règle que la garde.
 */
function phraseAvecVariableDePost(corps: string): string | null {
  for (const morceau of corps.split(/(?<=[.!?])\s+|\n+/)) {
    if (JETON_DE_POST.test(morceau)) return morceau.trim();
  }
  return null;
}

interface LignePostBrute {
  id: string;
  url: string;
  author_display_name: string | null;
  subject: string | null;
  posted_at: Date | null;
  review_status: EtatPost;
  expires_at: Date;
  personnes: string;
}

/**
 * Les posts des sources de cette campagne, les plus pressés d'abord.
 *
 * `personnesEnAttente` : les personnes de CETTE campagne rattachées au post et sans inscription
 * vivante (même population que `compterRetenuesParPost`, un majorant honnête).
 *
 * `apercuAccroche` : la phrase du gabarit en vigueur qui nomme le post, avec la date et le lien
 * déjà résolus pour CE post, et les jetons de l'AUTEUR et du SUJET laissés en place — ce sont les
 * deux que l'opérateur écrit lui-même, dans la phrase (`decouperAccroche`). `null` si aucune étape
 * de la campagne ne nomme le post.
 */
export async function listerPostsDeCampagne(ctx: Contexte, entree: unknown): Promise<LignePost[]> {
  exiger(ctx, 'viewer');
  const e = valider(schemaListe, entree);
  const [posts, gabarits] = await Promise.all([
    ctx.ex.query<LignePostBrute>(
      `select lp.id, lp.url, lp.author_display_name, lp.subject, lp.posted_at, lp.review_status, lp.expires_at,
              (select count(distinct ct.id)::text
                 from signals s
                 join contacts ct on ct.source_signal_id = s.id and ct.organization_id = s.organization_id
                where s.linkedin_post_id = lp.id and s.organization_id = $1
                  and ${sqlSourceAlimenteLaCampagne('$2::uuid', 's.source_id')}
                  and not exists (select 1 from enrollments en
                                   where en.contact_id = ct.id and en.status in ('active', 'paused', 'paused_absence'))) as personnes
         from linkedin_posts lp
        where lp.organization_id = $1
          and ($3::text is null or lp.review_status = $3)
          and exists (select 1 from signals s
                        join campaigns c on c.id = $2 and c.organization_id = $1
                       where s.linkedin_post_id = lp.id and s.organization_id = $1
                         and ${sqlSourceAlimenteLaCampagne('c.id', 's.source_id')})
        order by (lp.review_status = 'pending') desc,
                 case when lp.review_status = 'pending' then lp.expires_at end asc,
                 lp.posted_at desc nulls last, lp.id`,
      [ctx.organisationId, e.campagneId, e.etat ?? null],
    ),
    ctx.ex.query<{ body: string | null }>(
      `select mt.body
         from sequence_steps st
         join message_templates mt on (mt.id = st.template_parent_id or mt.parent_id = st.template_parent_id)
        where st.campaign_id = $2 and mt.is_active and mt.organization_id = $1
        order by st.position, mt.locale`,
      [ctx.organisationId, e.campagneId],
    ),
  ]);
  let phrase: string | null = null;
  for (const g of gabarits.rows) {
    phrase = g.body === null ? null : phraseAvecVariableDePost(g.body);
    if (phrase !== null) break;
  }
  return posts.rows.map((p) => ({
    id: p.id,
    url: p.url,
    auteur: p.author_display_name?.trim() || null,
    sujet: p.subject?.trim() || null,
    posteLe: p.posted_at,
    etat: p.review_status,
    personnesEnAttente: Number(p.personnes),
    expireLe: p.expires_at,
    // `post_auteur` n'est volontairement PAS résolu ici : c'est un champ que l'opérateur édite dans
    // la phrase, au même titre que le sujet. Le résoudre laissait `{{post_auteur}}` en clair quand
    // le nom manquait (« valeur cherchée mais vide » : `renderTemplatePartial` garde le gabarit),
    // sans aucun moyen de le corriger.
    apercuAccroche:
      phrase === null
        ? null
        : renderTemplatePartial(phrase, {
            post_url: p.url,
            post_date: p.posted_at ? new Date(p.posted_at).toLocaleDateString('fr-FR') : undefined,
          }),
  }));
}

/**
 * Nombre de posts de la campagne qui attendent leur relecture et dont la fenêtre court encore
 * (badge de l'onglet, et le résumé de la barre qui dit la même chose en toutes lettres).
 *
 * ZÉRO tant que la campagne ne NOMME aucun post, et ce n'est pas un détail d'affichage : un badge
 * annonce du travail. Sans accroche, la garde ne retient personne et relire ces posts ne débloque
 * rien — l'opérateur valide pour rien, et le jour où la rétention sera vraie il ne lira plus le
 * badge (« une alerte fausse en éteint une vraie »). Même condition que le bandeau et l'échéance
 * (`retenuesAAfficher`), posée ici pour que le badge du calque et l'écran ne puissent pas
 * diverger.
 */
export async function compterPostsAValiderDeCampagne(ctx: Contexte, entree: unknown): Promise<number> {
  exiger(ctx, 'viewer');
  const e = valider(schemaCampagne, entree);
  const res = await ctx.ex.query<{ n: string }>(
    `select count(*)::text as n
       from linkedin_posts lp
      where lp.organization_id = $1 and lp.review_status = 'pending' and lp.expires_at > now()
        and exists (select 1 from campaigns c
                     where c.id = $2 and c.organization_id = $1
                       and ${sqlCampagneNommeUnPost('c.id')})
        and exists (select 1 from signals s
                      join campaigns c on c.id = $2 and c.organization_id = $1
                     where s.linkedin_post_id = lp.id and s.organization_id = $1
                       and ${sqlSourceAlimenteLaCampagne('c.id', 's.source_id')})`,
    [ctx.organisationId, e.campagneId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

const MESSAGE_ECHEANCE_PASSEE =
  'L\'échéance de ce post est passée : les personnes collectées sur ce post ne sont plus en attente (la purge ordinaire s\'applique), il ne peut donc plus être validé ni rouvert.';

function refus(message: string): ErreurEntree {
  return new ErreurEntree({ formErrors: [message], fieldErrors: {} });
}

/** Dit pourquoi une mise à jour n'a rien touché : introuvable, ou état qui ne s'y prête pas. */
async function etatDuPost(ctx: Contexte, postId: string) {
  const res = await ctx.ex.query<{ review_status: EtatPost; expired: boolean }>(
    `select review_status, expires_at <= now() as expired
       from linkedin_posts where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Post');
  return ligne;
}

/** Ce que chaque variable de post désigne, pour le dire à l'opérateur dans sa langue de travail. */
const LIBELLE_VARIABLE_DE_POST: Readonly<Record<string, string>> = {
  post_auteur: 'le nom de l\'auteur',
  post_sujet: 'le sujet',
  post_url: 'l\'adresse du post',
  post_date: 'la date de publication',
};

/** « L'opérateur écrit cette variable lui-même, dans la phrase. » Les deux champs de l'écran. */
function sEcritDansLaPhrase(variable: string): boolean {
  return CHAMPS_ACCROCHE.some((c) => `post_${c}` === variable);
}

/**
 * La campagne nommée en entrée appartient-elle à l'organisation ?
 *
 * `campagneId` est une ENTRÉE, pas un id lu en base : l'écran le prend dans son URL, et le
 * serveur MCP (#100) le recevra d'un appel. Un uuid absent ou étranger rend vraies toutes les
 * exigences de `sqlFicheResoutCeQuEcritLaCampagne` (aucune étape ne nomme le post, donc rien
 * n'est exigé) et ferait approuver la fiche sans relecture utile.
 */
async function exigerCampagneDeLOrganisation(ctx: Contexte, campagneId: string): Promise<void> {
  const res = await ctx.ex.query(
    `select 1 from campaigns where id = $2 and organization_id = $1`,
    [ctx.organisationId, campagneId],
  );
  if ((res.rowCount ?? 0) === 0) throw new ErreurIntrouvable('Campagne');
}

/**
 * Les variables de post que CETTE campagne écrit et que la fiche ne résout pas — exactement ce que
 * la garde refuserait (`sqlFicheResoutCeQuEcritLaCampagne`, lu par les deux).
 */
async function variablesManquantes(ctx: Contexte, postId: string, campagneId: string): Promise<string[]> {
  const colonnes = EXIGENCES_VARIABLE_DE_POST.map(
    (e) => `(${sqlCampagneEcritVariableDePost('$3::uuid', e.variable)}
              and not ${e.colonneRenseignee('p')}) as "${e.variable}"`,
  ).join(',\n            ');
  const res = await ctx.ex.query<Record<string, boolean>>(
    `select ${colonnes}
       from linkedin_posts p where p.organization_id = $1 and p.id = $2`,
    [ctx.organisationId, postId, campagneId],
  );
  const ligne = res.rows[0];
  if (!ligne) return [];
  return EXIGENCES_VARIABLE_DE_POST.filter((e) => ligne[e.variable] === true).map((e) => e.variable);
}

/**
 * Valide un post : ses personnes peuvent entrer en séquence.
 *
 * REFUSÉ tant que la fiche ne porte pas ce que la campagne ÉCRIT — ni plus, ni moins. Le même
 * quantificateur que la garde, et la même écriture (`sqlFicheResoutCeQuEcritLaCampagne`) : exiger
 * davantage fabrique un travail inutile (écrire un sujet qui ne partira pas), exiger moins fabrique
 * pire — l'opérateur valide, la garde continue de retenir ses personnes, et rien ne le lui dit.
 *
 * L'écriture est conditionnelle (un seul `update`) : pas de fenêtre entre la lecture de la fiche et
 * la validation.
 */
export async function validerPost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId, campagneId } = valider(schemaValidation, entree);
  // La campagne est JOINTE sur l'organisation, comme chez ses voisines : le filtre vit dans la
  // requête qui écrit, pas dans une lecture préalable qu'une course pourrait contredire.
  const res = await ctx.ex.query(
    `update linkedin_posts p
        set review_status = 'approved', reviewed_at = now(), reviewed_by = $3
       from campaigns c
      where c.id = $4::uuid and c.organization_id = $1
        and p.organization_id = $1 and p.id = $2 and p.review_status = 'pending' and p.expires_at > now()
        and ${sqlFicheResoutCeQuEcritLaCampagne('c.id', 'p')}`,
    [ctx.organisationId, postId, ctx.utilisateurId, campagneId],
  );
  if ((res.rowCount ?? 0) > 0) return;
  // AVANT de diagnostiquer : sans campagne à nous, il n'y a rien à exiger, donc rien à dire.
  await exigerCampagneDeLOrganisation(ctx, campagneId);
  const etat = await etatDuPost(ctx, postId);
  if (etat.review_status === 'approved') return;
  if (etat.review_status === 'rejected') throw refus('Ce post est rejeté : rouvrez-le avant de le valider.');
  if (etat.expired) throw refus(MESSAGE_ECHEANCE_PASSEE);
  const manquantes = await variablesManquantes(ctx, postId, campagneId);
  // Les variables RELEVÉES par la capture d'abord : demander de les écrire est un ordre
  // impossible à exécuter (aucun champ à l'écran ne les porte, et une date ne se saisit pas).
  const relevees = manquantes.filter((v) => !sEcritDansLaPhrase(v));
  const aEcrire = manquantes.filter(sEcritDansLaPhrase);
  if (relevees.length > 0) {
    const quoi = relevees.map((v) => LIBELLE_VARIABLE_DE_POST[v]).join(', ');
    const constat =
      relevees.length > 1
        ? 'ces informations n\'ont pas pu être lues sur la page du post, et le rattrapage les reposera'
        : 'cette information n\'a pas pu être lue sur la page du post, et le rattrapage la reposera';
    const reste =
      aEcrire.length > 0
        ? ` Il manque aussi ${aEcrire.map((v) => LIBELLE_VARIABLE_DE_POST[v]).join(', ')}, qui se complète dans la phrase.`
        : '';
    throw refus(`Ce post n'a pas ${quoi} : ${constat}.${reste}`);
  }
  if (aEcrire.length === 1) {
    throw refus(`Ce post n'a pas ${LIBELLE_VARIABLE_DE_POST[aEcrire[0]!]} : écrivez-le dans la phrase avant de le valider.`);
  }
  if (aEcrire.length > 1) {
    throw refus(
      `Ce post ne porte pas tout ce que votre message écrit (${aEcrire.map((v) => LIBELLE_VARIABLE_DE_POST[v]).join(', ')}) : complétez la phrase avant de le valider.`,
    );
  }
  throw refus('Ce post n\'a pas pu être validé : rechargez l\'écran.');
}

/**
 * Pose le sujet de l'opérateur (`subject_origin = 'operator'`) : une capture ultérieure ne
 * l'écrase jamais (le worker n'écrit que `where subject is null`).
 *
 * La correction vient de l'opérateur : elle EST la relecture humaine (c'est ce que dit
 * `subject_origin = 'operator'`). L'état de relecture n'est donc jamais touché : un post validé
 * dont on corrige une coquille reste validé, et la campagne qui tournait ne s'arrête pas.
 */
export async function corrigerSujetDePost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId, sujet } = valider(schemaCorrection, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set subject = $3, subject_origin = 'operator'
      where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId, sujet],
  );
  if ((res.rowCount ?? 0) === 0) throw new ErreurIntrouvable('Post');
}

/**
 * Pose le nom d'auteur affiché, celui qui PART dans le message (`{{post_auteur}}`).
 *
 * Sans elle, une fiche dont la capture n'a pas su lire l'auteur était une impasse : la garde exige
 * `author_display_name` dès que la campagne l'écrit, le rattrapage ne reprend que les fiches
 * incomplètes (celle-ci ne l'est pas, son `author_name` porte le slug de la page), et aucun écran
 * ne permettait de le corriger. L'opérateur voyait « Auteur inconnu », validait, et rien ne
 * bougeait. La spec l'exigeait en toutes lettres : le nom affiché est « relisible et corrigeable
 * comme le sujet ».
 *
 * Comme `corrigerSujetDePost`, elle ne touche PAS l'état de relecture : corriger une coquille sur
 * un post validé ne remet pas la campagne en attente.
 */
export async function corrigerAuteurDePost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId, auteur } = valider(schemaCorrectionAuteur, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set author_display_name = $3
      where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId, auteur],
  );
  if ((res.rowCount ?? 0) === 0) throw new ErreurIntrouvable('Post');
}

/**
 * Rejette un post : un DRAPEAU, rien n'est effacé. Les personnes restent et retombent sous la
 * purge ordinaire ; `reouvrirPost` annule le geste.
 */
export async function rejeterPost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId } = valider(schemaPost, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set review_status = 'rejected', reviewed_at = now(), reviewed_by = $3
      where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId, ctx.utilisateurId],
  );
  if ((res.rowCount ?? 0) === 0) throw new ErreurIntrouvable('Post');
}

/**
 * Ramène un post rejeté en attente. L'échéance n'est PAS prolongée : elle borne la rétention des
 * personnes. Un post dont la fenêtre est passée n'est donc plus rouvrable, la purge est faite ou
 * sur le point de l'être.
 */
export async function reouvrirPost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId } = valider(schemaPost, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set review_status = 'pending', reviewed_at = null, reviewed_by = null
      where organization_id = $1 and id = $2 and review_status = 'rejected' and expires_at > now()`,
    [ctx.organisationId, postId],
  );
  if ((res.rowCount ?? 0) > 0) return;
  const etat = await etatDuPost(ctx, postId);
  if (etat.review_status === 'rejected' && etat.expired) {
    throw refus(MESSAGE_ECHEANCE_PASSEE);
  }
}

/** Ce que l'échéance exige de l'opérateur : `loin` ne demande rien, `bientot` demande d'y penser, `urgent` d'agir. */
export type TonEcheance = 'loin' | 'bientot' | 'urgent';

export interface EcheancePost {
  cle: 'loin' | 'bientot' | 'demain' | 'aujourdhui' | 'passee';
  /** Jours entiers restants, arrondis au-dessus (29 h = 2 jours : on ne promet pas un jour de plus que celui qu'il reste). */
  jours: number;
  ton: TonEcheance;
}

/** Au-delà de ce nombre de jours, l'échéance reste neutre. */
export const JOURS_ECHEANCE_PROCHE = 7;

/**
 * L'échéance d'un post, en clé de libellé et en ton. L'erreur (`urgent`) est réservée au dernier
 * moment, parce que le design réserve cette couleur à ce qui exige une action immédiate : un
 * écran qui la prodigue à sept jours la rend muette le jour où elle compte.
 */
export function echeanceDePost(expireLe: Date, maintenant: Date, fuseau = 'Europe/Paris'): EcheancePost {
  const ms = expireLe.getTime() - maintenant.getTime();
  const jours = Math.ceil(ms / 86_400_000);
  if (ms <= 0) return { cle: 'passee', jours: 0, ton: 'urgent' };
  // « Aujourd'hui » et « demain » se disent au calendrier du fuseau de l'organisation, pas en
  // tranches de 24 h : 20 h plus tard, c'est demain matin.
  const jour = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: fuseau });
  if (jour(expireLe) === jour(maintenant)) return { cle: 'aujourdhui', jours, ton: 'urgent' };
  if (jour(expireLe) === jour(new Date(maintenant.getTime() + 86_400_000))) return { cle: 'demain', jours, ton: 'urgent' };
  if (jours <= JOURS_ECHEANCE_PROCHE) return { cle: 'bientot', jours, ton: 'bientot' };
  return { cle: 'loin', jours, ton: 'loin' };
}

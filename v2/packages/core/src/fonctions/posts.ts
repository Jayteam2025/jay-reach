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
import { renderTemplatePartial } from '../messages/variables.js';
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

const schemaListe = z.object({ campagneId: z.string().uuid(), etat: z.enum(ETATS).optional() });
const schemaPost = z.object({ postId: z.string().uuid() });
const schemaCorrection = z.object({
  postId: z.string().uuid(),
  sujet: z.string().trim().min(1, 'Le sujet ne peut pas être vide.').max(SUJET_POST_MAX_CARACTERES, `Le sujet doit tenir en ${SUJET_POST_MAX_CARACTERES} caractères : il se glisse dans une phrase.`),
});
const schemaCampagne = z.object({ campagneId: z.string().uuid() });

/** Le jeton de la variable de sujet, tel que `renderTemplatePartial` le laisse (`{{ post_sujet }}`). */
const JETON_SUJET = /\{\{\s*post_sujet\s*(?:\|[^}]*)?\}\}/i;

/**
 * Coupe une accroche rendue autour de son sujet : ce qui précède, ce qui suit. `null` quand le
 * sujet n'y figure pas (l'écran retombe alors sur sa phrase par défaut).
 *
 * Pure et exportée : l'écran édite le sujet À L'INTÉRIEUR de la phrase, il lui faut donc les deux
 * moitiés, pas la phrase entière.
 */
export function decouperAccroche(apercu: string | null): { avant: string; apres: string } | null {
  if (apercu === null) return null;
  const m = JETON_SUJET.exec(apercu);
  if (!m) return null;
  return { avant: apercu.slice(0, m.index), apres: apercu.slice(m.index + m[0].length) };
}

/** La phrase du gabarit qui porte le sujet, ou `null`. Une phrase finit à `. ! ?` ou à un saut de ligne. */
function phraseDuSujet(corps: string): string | null {
  for (const morceau of corps.split(/(?<=[.!?])\s+|\n+/)) {
    if (JETON_SUJET.test(morceau)) return morceau.trim();
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
 * `apercuAccroche` : la phrase du gabarit en vigueur qui nomme le sujet, avec auteur, date et lien
 * déjà résolus pour CE post, et le jeton du sujet laissé en place (`decouperAccroche`). `null` si
 * aucune étape de la campagne ne cite `{{post_sujet}}`.
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
                  and exists (select 1 from campaign_sources cs where cs.campaign_id = $2 and cs.source_id = s.source_id)
                  and not exists (select 1 from enrollments en
                                   where en.contact_id = ct.id and en.status in ('active', 'paused', 'paused_absence'))) as personnes
         from linkedin_posts lp
        where lp.organization_id = $1
          and ($3::text is null or lp.review_status = $3)
          and exists (select 1 from signals s
                        join campaign_sources cs on cs.source_id = s.source_id and cs.campaign_id = $2
                        join campaigns c on c.id = cs.campaign_id and c.organization_id = $1
                       where s.linkedin_post_id = lp.id and s.organization_id = $1)
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
    phrase = g.body === null ? null : phraseDuSujet(g.body);
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
    apercuAccroche:
      phrase === null
        ? null
        : renderTemplatePartial(phrase, {
            post_auteur: p.author_display_name?.trim() || undefined,
            post_url: p.url,
            post_date: p.posted_at ? new Date(p.posted_at).toLocaleDateString('fr-FR') : undefined,
          }),
  }));
}

/** Nombre de posts de la campagne qui attendent leur relecture et dont la fenêtre court encore (badge de l'onglet). */
export async function compterPostsAValiderDeCampagne(ctx: Contexte, entree: unknown): Promise<number> {
  exiger(ctx, 'viewer');
  const e = valider(schemaCampagne, entree);
  const res = await ctx.ex.query<{ n: string }>(
    `select count(*)::text as n
       from linkedin_posts lp
      where lp.organization_id = $1 and lp.review_status = 'pending' and lp.expires_at > now()
        and exists (select 1 from signals s
                      join campaign_sources cs on cs.source_id = s.source_id and cs.campaign_id = $2
                      join campaigns c on c.id = cs.campaign_id and c.organization_id = $1
                     where s.linkedin_post_id = lp.id and s.organization_id = $1)`,
    [ctx.organisationId, e.campagneId],
  );
  return Number(res.rows[0]?.n ?? 0);
}

function refus(message: string): ErreurEntree {
  return new ErreurEntree({ formErrors: [message], fieldErrors: {} });
}

/** Dit pourquoi une mise à jour n'a rien touché : introuvable, ou état qui ne s'y prête pas. */
async function etatDuPost(ctx: Contexte, postId: string) {
  const res = await ctx.ex.query<{ review_status: EtatPost; subject: string | null; expired: boolean }>(
    `select review_status, subject, expires_at <= now() as expired
       from linkedin_posts where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Post');
  return ligne;
}

/**
 * Valide un post : ses personnes peuvent entrer en séquence. REFUSÉ sans sujet : on ne valide pas
 * ce qu'on n'a pas relu, et une phrase sans sujet est ce que la garde existe pour empêcher.
 * L'écriture est conditionnelle (un seul `update`) : pas de fenêtre entre la lecture du sujet et
 * la validation.
 */
export async function validerPost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId } = valider(schemaPost, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set review_status = 'approved', reviewed_at = now(), reviewed_by = $3
      where organization_id = $1 and id = $2 and review_status = 'pending'
        and coalesce(btrim(subject), '') <> ''`,
    [ctx.organisationId, postId, ctx.utilisateurId],
  );
  if ((res.rowCount ?? 0) > 0) return;
  const etat = await etatDuPost(ctx, postId);
  if (etat.review_status === 'approved') return;
  if (etat.review_status === 'rejected') throw refus('Ce post est rejeté : rouvrez-le avant de le valider.');
  throw refus('Ce post n\'a pas de sujet : écrivez-le avant de le valider.');
}

/**
 * Pose le sujet de l'opérateur (`subject_origin = 'operator'`) : une capture ultérieure ne
 * l'écrase jamais (le worker n'écrit que `where subject is null`).
 *
 * Corriger le sujet d'un post DÉJÀ validé le ramène en attente : la phrase qui partirait n'est
 * plus celle qu'un humain a relue. Un post rejeté le reste.
 */
export async function corrigerSujetDePost(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { postId, sujet } = valider(schemaCorrection, entree);
  const res = await ctx.ex.query(
    `update linkedin_posts
        set subject = $3, subject_origin = 'operator',
            review_status = case when review_status = 'approved' then 'pending' else review_status end,
            reviewed_at = case when review_status = 'approved' then null else reviewed_at end,
            reviewed_by = case when review_status = 'approved' then null else reviewed_by end
      where organization_id = $1 and id = $2`,
    [ctx.organisationId, postId, sujet],
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
    throw refus('La fenêtre de décision de ce post est passée : il ne peut plus être rouvert.');
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

/**
 * Séquence d'une campagne et tiroir d'étape (onglet Séquence, tâche 12, lot 2).
 * Spec « une fonction, deux façades » : l'écran
 * (`apps/web/app/actions/step-message.ts`) et le futur serveur MCP appellent
 * ces mêmes fonctions avec le même `Contexte`.
 *
 * R19 : une étape courrier ou appel n'a pas de canal affichable ici — la
 * séquence ne montre QUE les étapes email et LinkedIn (`CANAUX_AFFICHES`
 * ci-dessous). Le tiroir peut créer/éditer les deux (R48, tour de correction
 * 1 : une séquence réelle alterne déjà email et LinkedIn), avec un objet
 * seulement pour l'email (`canalReelEtape` ci-dessous) — le tiroir ne
 * distingue pas invitation/message LinkedIn, une nuance pilotée côté serveur
 * (lot 4, pas encore livré) : il garde le canal LinkedIn déjà en base pour une
 * étape existante, ou pose `linkedin_message` par défaut à la création.
 *
 * Vocabulaire des étapes (`titre`, `titreEtape` ci-dessous) : même convention
 * que `nomEtape` (`fonctions/file-du-jour.ts`) pour une étape email —
 * « Premier email » / « Relance » / « Dernier mot » (maquette
 * `campagne-sequence.html`) — avec un vocabulaire propre au canal LinkedIn
 * (constaté en base réelle, R30 : une séquence alterne email et
 * invitations/messages LinkedIn, jamais couvert par la maquette).
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable, ErreurEntree } from './contexte.js';
import { ecrireEvenement } from '../journal.js';
import {
  renderTemplate,
  lireValeursContact,
  normalizeVariableSyntax,
  validateTemplateVariables,
  normalizeListColumnName,
  type CampaignNature,
} from '../messages/index.js';
import { lireListeSourceCampagne, schemaCampagneId, type ListeSourceResume } from './campagnes.js';
import { SQL_PROVIDER_ID_AFFICHAGE } from './sources.js';
import { dansUneTransaction } from '../transaction.js';
import { actionIdempotencyKey } from '../sequencer/actions.js';
import { echeanceEtapeSuivante } from '../sequencer/scheduling.js';

// ---------------------------------------------------------------------------
// lireSequence
// ---------------------------------------------------------------------------

/** Canaux affichés dans l'onglet (R19) : courrier et appel n'y figurent jamais. */
const CANAUX_AFFICHES = ['email', 'linkedin_invite', 'linkedin_message'] as const;
type CanalAffiche = 'email' | 'linkedin';

function canalAffiche(channel: string): CanalAffiche {
  return channel.startsWith('linkedin') ? 'linkedin' : 'email';
}

export interface EtapeVue {
  readonly id: string;
  /** 1-based (`sequence_steps.position` part de 0), même conversion que `campagnes.ts`/`aujourdhui.ts`. */
  readonly position: number;
  readonly canal: CanalAffiche;
  readonly titre: string;
  /** `null` pour un canal sans objet (LinkedIn) ou une étape sans message écrit. */
  readonly sujet: string | null;
  readonly corps: string;
  readonly delaiHeures: number;
  /** Contacts dont une action de cette étape a été réellement envoyée (`dispatched`/`delivered`). */
  readonly passes: number;
  readonly repondusIci: { readonly total: number; readonly contacts: { readonly nom: string; readonly photoUrl: string | null }[] };
}

export interface VueSequence {
  /** `providerId` peut être `null` (R70, tour de correction 4) : aucun des trois repères de fournisseur n'a de valeur. */
  readonly sources: { readonly providerId: string | null }[];
  readonly qualifies: number;
  readonly etapes: EtapeVue[];
  readonly finDeSequence: { readonly termines: number };
  /**
   * Liste qui alimente la campagne (point 2, issue #120 ; revue F5, constat
   * bloquant 1) — `null` pour une campagne à sources. Même résolution et même
   * forme que `VueDEnsemble.listeSource` (`campagnes.ts`, `lireListeSourceCampagne`,
   * réutilisée ici) : le nœud Sources de l'onglet Séquence montrait encore
   * « 0 source alimente cette campagne, 0 contact qualifié » pour une
   * campagne à liste avant ce correctif.
   */
  readonly listeSource: ListeSourceResume | null;
}

interface LigneEtapeBrute {
  id: string;
  position: number;
  channel: string;
  delay_hours: number;
  template_parent_id: string | null;
}

interface LigneGabaritFamille {
  family_id: string;
  subject: string | null;
  body: string;
}

/** Nombre maximum d'avatars renvoyés par étape pour la pile « Ont répondu ici » (le reste compte dans `total`). */
const MAX_AVATARS_REPONDUS = 5;

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

/**
 * Même vocabulaire que `nomEtape` (`file-du-jour.ts`) pour les étapes email —
 * étendu ici à « Dernier mot » pour la dernière étape d'une séquence à
 * plusieurs étapes — mais propre au canal LinkedIn (constaté en base, R30 :
 * une séquence réelle alterne email et invitations/messages LinkedIn ;
 * « Premier email » sur une invitation LinkedIn aurait été trompeur).
 */
function titreEtape(channel: string, indexAffiche: number, nbEtapesAffichees: number): string {
  const derniere = nbEtapesAffichees > 1 && indexAffiche === nbEtapesAffichees - 1;
  if (channel === 'linkedin_invite') return 'Invitation LinkedIn';
  if (channel === 'linkedin_message') {
    if (derniere) return 'Dernier message LinkedIn';
    return indexAffiche === 0 ? 'Premier message LinkedIn' : 'Relance LinkedIn';
  }
  if (indexAffiche === 0) return 'Premier email';
  if (derniere) return 'Dernier mot';
  return 'Relance';
}

export async function lireSequence(ctx: Contexte, entree: unknown): Promise<VueSequence> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaCampagneId, entree);

  const campRes = await ctx.ex.query<{ id: string }>(
    `select id from campaigns /* jr:sequence_campagne */ where id = $1 and organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  if (!campRes.rows[0]) throw new ErreurIntrouvable('Campagne');

  // Résolu avant le reste (revue F5, constat bloquant 1) : une campagne à liste n'a ni
  // `campaign_sources` ni signal — `sourcesRes`/`qualifiesRes` y restent vides à raison,
  // `listeSource` porte alors l'information réelle pour le nœud Sources du flux.
  const { listeSource } = await lireListeSourceCampagne(ctx, campagneId);

  const [sourcesRes, qualifiesRes, etapesRes, finRes] = await Promise.all([
    ctx.ex.query<{ provider_id: string | null }>(
      `select distinct ${SQL_PROVIDER_ID_AFFICHAGE} as provider_id /* jr:sequence_sources */
         from campaign_sources cs join sources so on so.id = cs.source_id
        where cs.campaign_id = $1`,
      [campagneId],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:sequence_qualifies */
         from signals s join campaign_sources cs on cs.source_id = s.source_id
        where cs.campaign_id = $1 and s.status in ('qualified', 'enrolled')`,
      [campagneId],
    ),
    ctx.ex.query<LigneEtapeBrute>(
      `select id, position, channel, delay_hours, template_parent_id /* jr:sequence_etapes */
         from sequence_steps
        where campaign_id = $1 and channel::text = any($2::text[])
        order by position asc`,
      [campagneId, CANAUX_AFFICHES as unknown as string[]],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:sequence_fin */ from enrollments where campaign_id = $1 and status = 'completed'`,
      [campagneId],
    ),
  ]);

  const etapesBrutes = etapesRes.rows;
  const stepIds = etapesBrutes.map((e) => e.id);
  const familyIds = [...new Set(etapesBrutes.map((e) => e.template_parent_id).filter((x): x is string => x !== null))];

  const [gabaritsRes, passesRes, repondusRes] = await Promise.all([
    familyIds.length === 0
      ? Promise.resolve({ rows: [] as LigneGabaritFamille[] })
      : ctx.ex.query<LigneGabaritFamille>(
          `select coalesce(parent_id, id) as family_id, subject, body /* jr:sequence_gabarits */
             from message_templates
            where organization_id = $1 and is_active and coalesce(parent_id, id) = any($2::uuid[])`,
          [ctx.organisationId, familyIds],
        ),
    stepIds.length === 0
      ? Promise.resolve({ rows: [] as { step_id: string; n: number }[] })
      : ctx.ex.query<{ step_id: string; n: number }>(
          `select step_id, count(*)::int as n /* jr:sequence_passes */
             from actions
            where organization_id = $1 and step_id = any($2::uuid[]) and status in ('dispatched', 'delivered')
            group by step_id`,
          [ctx.organisationId, stepIds],
        ),
    stepIds.length === 0
      ? Promise.resolve({ rows: [] as { step_id: string; first_name: string | null; last_name: string | null; photo_url: string | null }[] })
      : ctx.ex.query<{ step_id: string; first_name: string | null; last_name: string | null; photo_url: string | null }>(
          `select st.id as step_id, c.first_name, c.last_name, c.photo_url /* jr:sequence_repondus */
             from outcomes o
             join actions a on a.id = o.action_id and a.organization_id = $1
             join sequence_steps st on st.id = a.step_id
             join enrollments e on e.id = a.enrollment_id
             join contacts c on c.id = e.contact_id
            where st.id = any($2::uuid[]) and o.type = 'replied'
            order by o.occurred_at asc`,
          [ctx.organisationId, stepIds],
        ),
  ]);

  const gabaritParFamille = new Map(gabaritsRes.rows.map((g) => [g.family_id, g]));
  const passesParEtape = new Map(passesRes.rows.map((p) => [p.step_id, p.n]));
  const repondusParEtape = new Map<string, { nom: string; photoUrl: string | null }[]>();
  for (const r of repondusRes.rows) {
    const liste = repondusParEtape.get(r.step_id) ?? [];
    liste.push({ nom: nomComplet(r.first_name, r.last_name), photoUrl: r.photo_url });
    repondusParEtape.set(r.step_id, liste);
  }

  const etapes: EtapeVue[] = etapesBrutes.map((e, index) => {
    const gabarit = e.template_parent_id ? gabaritParFamille.get(e.template_parent_id) : undefined;
    const repondus = repondusParEtape.get(e.id) ?? [];
    return {
      id: e.id,
      position: e.position + 1,
      canal: canalAffiche(e.channel),
      titre: titreEtape(e.channel, index, etapesBrutes.length),
      sujet: gabarit?.subject ?? null,
      corps: gabarit?.body ?? '',
      delaiHeures: e.delay_hours,
      passes: passesParEtape.get(e.id) ?? 0,
      repondusIci: { total: repondus.length, contacts: repondus.slice(0, MAX_AVATARS_REPONDUS) },
    };
  });

  return {
    sources: sourcesRes.rows.map((r) => ({ providerId: r.provider_id })),
    qualifies: qualifiesRes.rows[0]?.n ?? 0,
    etapes,
    finDeSequence: { termines: finRes.rows[0]?.n ?? 0 },
    listeSource,
  };
}

// ---------------------------------------------------------------------------
// enregistrerVersionModele — versionnage partagé (étape ET bibliothèque)
// ---------------------------------------------------------------------------

/**
 * Canal porté par un `message_templates` — mêmes valeurs que `channel_kind`
 * en base (`supabase/migrations/20260817120000_init_schema.sql`).
 */
export type CanalModele = 'email' | 'linkedin_invite' | 'linkedin_message' | 'letter' | 'call';

export const schemaEnregistrerVersionModele = z.object({
  familyId: z.string().uuid().nullable().optional(),
  nom: z.string().min(1),
  canal: z.enum(['email', 'linkedin_invite', 'linkedin_message', 'letter', 'call']),
  locale: z.string().min(1),
  sujet: z.string().nullable().optional(),
  corps: z.string().min(1),
  nature: z.enum(['signal', 'list']),
  origin: z.enum(['library', 'step']).default('library'),
});

/**
 * Valide les variables du corps (C5 : refus à l'enregistrement d'une variable
 * inconnue), sinon lève `ErreurEntree` avec le détail au format `flatten()`
 * attendu par les façades (`formErrors`), pour qu'un message de validation
 * s'affiche comme n'importe quelle autre entrée invalide.
 */
async function validerVariables(ctx: Contexte, corps: string, nature: CampaignNature): Promise<string> {
  const corpsNormalise = normalizeVariableSyntax(corps);
  const extraitsRes = await ctx.ex.query<{ name: string }>(
    `select name from message_snippets /* jr:sequence_extraits */ where organization_id = $1`,
    [ctx.organisationId],
  );
  const noms = extraitsRes.rows.map((r) => r.name);
  const problemes = validateTemplateVariables(corpsNormalise, nature, noms);
  if (problemes.length > 0) {
    throw new ErreurEntree({ formErrors: problemes.map((p) => p.message), fieldErrors: {} });
  }
  return corpsNormalise;
}

/**
 * Insère une nouvelle version d'un modèle (nouvelle lignée si `familyId` est
 * absent, sinon version suivante de la lignée pour cette langue — l'ancienne
 * version active est désactivée avant l'insertion, comme le faisait la RPC
 * `save_message_template_version`). N'ouvre PAS de transaction : l'appelant
 * l'entoure d'un `begin`/`commit` si son propre appel doit rester atomique
 * avec d'autres écritures (`enregistrerEtape`) ; `enregistrerVersionModele`
 * (export ci-dessous) le fait pour un appel autonome.
 */
async function inserVersionModele(
  ctx: Contexte,
  e: {
    familyId: string | null;
    nom: string;
    canal: CanalModele;
    locale: string;
    sujet: string | null;
    corps: string;
    origin: 'library' | 'step';
  },
): Promise<string> {
  if (!e.familyId) {
    const ins = await ctx.ex.query<{ id: string }>(
      `insert into message_templates /* jr:sequence_modele_creer */
         (organization_id, name, channel, locale, version, subject, body, is_active, origin, created_by)
       values ($1, $2, $3, $4, 1, $5, $6, true, $7, $8)
       returning id`,
      [ctx.organisationId, e.nom, e.canal, e.locale, e.sujet, e.corps, e.origin, ctx.utilisateurId],
    );
    return ins.rows[0]!.id;
  }

  const verRes = await ctx.ex.query<{ next: number }>(
    `select coalesce(max(version), 0) + 1 as next /* jr:sequence_modele_prochaine_version */
       from message_templates
      where coalesce(parent_id, id) = $1 and locale = $2 and organization_id = $3`,
    [e.familyId, e.locale, ctx.organisationId],
  );
  const prochaineVersion = verRes.rows[0]!.next;

  await ctx.ex.query(
    `update message_templates /* jr:sequence_modele_desactiver */
        set is_active = false
      where coalesce(parent_id, id) = $1 and locale = $2 and organization_id = $3 and is_active`,
    [e.familyId, e.locale, ctx.organisationId],
  );

  const ins = await ctx.ex.query<{ id: string }>(
    `insert into message_templates /* jr:sequence_modele_versionner */
       (organization_id, parent_id, name, channel, locale, version, subject, body, is_active, origin, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10)
     returning id`,
    [ctx.organisationId, e.familyId, e.nom, e.canal, e.locale, prochaineVersion, e.sujet, e.corps, e.origin, ctx.utilisateurId],
  );
  return ins.rows[0]!.id;
}

/**
 * Façade autonome (bibliothèque, `templates.ts`, ET étape isolée,
 * `step-message.ts`) : mêmes garanties que la RPC `save_message_template_version`
 * qu'elle remplace (atomique, jamais un état sans version active entre deux
 * écritures), mais portée par `Contexte`/`pg` plutôt que par une fonction
 * SECURITY DEFINER dépendante de `auth.uid()` — indisponible hors d'une
 * requête Supabase authentifiée (donc jamais depuis le futur serveur MCP).
 */
export async function enregistrerVersionModele(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'admin');
  const e = valider(schemaEnregistrerVersionModele, entree);
  const corpsNormalise = await validerVariables(ctx, e.corps, e.nature);

  // M10 (Mineur, revue finale du 14/09) : `inserVersionModele` filtre bien
  // par organisation pour le numéro de version et la désactivation (la
  // version créée reste chez nous), mais un `familyId` d'une autre
  // organisation n'était jamais rejeté — son `parent_id` traversait quand
  // même la frontière. Vérifié avant d'ouvrir la transaction.
  if (e.familyId) {
    const lignee = await ctx.ex.query<{ id: string }>(
      `select id from message_templates /* jr:sequence_modele_lignee */
        where id = $1 and organization_id = $2`,
      [e.familyId, ctx.organisationId],
    );
    if (lignee.rowCount === 0) throw new ErreurIntrouvable('Modèle');
  }

  const id = await dansUneTransaction(ctx.ex, (tx) =>
    inserVersionModele(
      { ...ctx, ex: tx },
      {
        familyId: e.familyId ?? null,
        nom: e.nom,
        canal: e.canal,
        locale: e.locale,
        sujet: e.canal === 'email' ? (e.sujet?.trim() ?? null) : null,
        corps: corpsNormalise,
        origin: e.origin,
      },
    ),
  );
  return { id };
}

// ---------------------------------------------------------------------------
// verserDansBibliotheque — retour 9.3 (promoteStepMessage)
// ---------------------------------------------------------------------------

export const schemaVerserDansBibliotheque = z.object({
  campagneId: z.string().uuid(),
  templateParentId: z.string().uuid(),
  nom: z.string().min(1),
});

/** Fait passer toute la lignée d'un message écrit dans une étape dans la bibliothèque (origin `step` -> `library`). */
export async function verserDansBibliotheque(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { templateParentId, nom } = valider(schemaVerserDansBibliotheque, entree);

  const res = await ctx.ex.query(
    `update message_templates /* jr:sequence_verser_bibliotheque */
        set origin = 'library', name = $1
      where organization_id = $2 and (id = $3 or parent_id = $3)`,
    [nom.trim(), ctx.organisationId, templateParentId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Modèle');
}

// ---------------------------------------------------------------------------
// enregistrerEtape / supprimerEtape
// ---------------------------------------------------------------------------

export const schemaEnregistrerEtape = z
  .object({
    campagneId: z.string().uuid(),
    etapeId: z.string().uuid().optional(),
    /** LinkedIn n'a pas d'objet (`sujet` facultatif) — un email en a toujours besoin, voir `superRefine`. */
    canal: z.enum(['email', 'linkedin']).default('email'),
    sujet: z.string().max(200).optional(),
    corps: z.string().min(1),
    delaiHeures: z.number().int().min(0),
    position: z.number().int().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.canal === 'email' && !v.sujet?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sujet'], message: 'Un email a besoin d’un objet.' });
    }
  });

/**
 * Canal `channel_kind` réel d'une étape à écrire (R48) : `email` → `'email'` ;
 * `linkedin` → garde le canal LinkedIn déjà en base pour cette étape s'il y en
 * a un (`linkedin_invite`/`linkedin_message`, jamais changé par ce tiroir qui
 * n'a pas de notion d'invitation/message), sinon `'linkedin_message'` par
 * défaut à la création (une invitation se crée aujourd'hui côté serveur, lot
 * 4 — ce tiroir ne propose que le message).
 */
function canalReelEtape(canalFormulaire: 'email' | 'linkedin', canalExistant: string | undefined): CanalModele {
  if (canalFormulaire === 'email') return 'email';
  if (canalExistant === 'linkedin_invite' || canalExistant === 'linkedin_message') return canalExistant;
  return 'linkedin_message';
}

interface LigneCampagneEtape {
  name: string;
  source_id: string | null;
  locale: string | null;
}

/**
 * Exportée pour `apps/web/app/actions/step-message.ts` (façade fine : le nom
 * du modèle reprend celui de la campagne).
 *
 * `campaigns` n'a PAS de colonne `locale` (tour de correction 2, R61 —
 * `column "locale" does not exist` en recette, transaction annulée avant la
 * moindre écriture) : seules `message_templates`/`accounts`/`contacts` en ont
 * une. La locale d'un message vient du réglage de l'organisation
 * (`organizations.default_locale`, `text not null default 'fr'`).
 */
export async function lireCampagnePourEtape(ctx: Contexte, campagneId: string): Promise<LigneCampagneEtape> {
  const res = await ctx.ex.query<LigneCampagneEtape>(
    `select c.name, c.source_id, o.default_locale as locale
       from campaigns c /* jr:sequence_etape_campagne_lire */
       join organizations o on o.id = c.organization_id
      where c.id = $1 and c.organization_id = $2`,
    [campagneId, ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Campagne');
  return ligne;
}

/**
 * Crée (sans `etapeId`) ou réécrit (avec) une étape de la séquence, email ou
 * LinkedIn (R48 : la campagne réelle alterne les deux). Message et étape
 * s'écrivent dans une seule transaction : un message versionné sans son étape
 * à jour (ou l'inverse) laisserait la séquence dans un état incohérent
 * qu'aucun écran ne rattraperait.
 */
export async function enregistrerEtape(ctx: Contexte, entree: unknown): Promise<{ etapeId: string }> {
  exiger(ctx, 'admin');
  const e = valider(schemaEnregistrerEtape, entree);
  const campagne = await lireCampagnePourEtape(ctx, e.campagneId);
  const nature: CampaignNature = campagne.source_id ? 'signal' : 'list';
  const locale = campagne.locale ?? 'fr';

  let templateParentId: string | null = null;
  let canalExistant: string | undefined;
  if (e.etapeId) {
    const etapeRes = await ctx.ex.query<{ template_parent_id: string | null; channel: string }>(
      `select template_parent_id, channel from sequence_steps /* jr:sequence_etape_existante */
        where id = $1 and campaign_id = $2`,
      [e.etapeId, e.campagneId],
    );
    const etape = etapeRes.rows[0];
    if (!etape) throw new ErreurIntrouvable('Étape');
    templateParentId = etape.template_parent_id;
    canalExistant = etape.channel;
  }

  const canalReel = canalReelEtape(e.canal, canalExistant);
  const corpsNormalise = await validerVariables(ctx, e.corps, nature);

  const etapeId = await dansUneTransaction(ctx.ex, async (tx) => {
    const ctxTx = { ...ctx, ex: tx };
    const nouveauTemplateId = await inserVersionModele(ctxTx, {
      familyId: templateParentId,
      nom: campagne.name,
      canal: canalReel,
      locale,
      sujet: e.canal === 'email' ? e.sujet!.trim() : null,
      corps: corpsNormalise,
      origin: 'step',
    });
    const templateFamilyId = templateParentId ?? nouveauTemplateId;

    if (e.etapeId) {
      // `e.position` ne s'applique qu'à la création (ordre d'insertion) : ce
      // tiroir n'a pas de réorganisation des étapes existantes (aucune flèche
      // haut/bas dans la maquette), une étape réécrite garde sa position.
      const upd = await tx.query<{ id: string }>(
        `update sequence_steps /* jr:sequence_etape_maj */
            set template_parent_id = $1, delay_hours = $2, channel = $3
          where id = $4 and campaign_id = $5
          returning id`,
        [templateFamilyId, e.delaiHeures, canalReel, e.etapeId, e.campagneId],
      );
      if (!upd.rows[0]) throw new ErreurIntrouvable('Étape');
      return upd.rows[0].id;
    }

    const posRes = await tx.query<{ n: number }>(
      `select coalesce(max(position), -1) + 1 as n /* jr:sequence_etape_position */
         from sequence_steps where campaign_id = $1`,
      [e.campagneId],
    );
    const positionSuivante = e.position !== undefined ? e.position - 1 : posRes.rows[0]!.n;
    const ins = await tx.query<{ id: string }>(
      `insert into sequence_steps /* jr:sequence_etape_creer */
         (campaign_id, position, channel, delay_hours, template_parent_id)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [e.campagneId, positionSuivante, canalReel, e.delaiHeures, templateFamilyId],
    );
    return ins.rows[0]!.id;
  });

  await ecrireEvenementEtape(
    ctx,
    'step.saved',
    e.campagneId,
    e.etapeId ? 'Étape de séquence modifiée.' : 'Étape de séquence ajoutée.',
  );
  return { etapeId };
}

export const schemaSupprimerEtape = z.object({ campagneId: z.string().uuid(), etapeId: z.string().uuid() });

export async function supprimerEtape(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { campagneId, etapeId } = valider(schemaSupprimerEtape, entree);
  await lireCampagnePourEtape(ctx, campagneId);

  const res = await ctx.ex.query(
    `delete from sequence_steps /* jr:sequence_etape_supprimer */ where id = $1 and campaign_id = $2`,
    [etapeId, campagneId],
  );
  if (res.rowCount === 0) throw new ErreurIntrouvable('Étape');

  await ecrireEvenementEtape(ctx, 'step.deleted', campagneId, 'Étape de séquence supprimée.');
}

async function ecrireEvenementEtape(
  ctx: Contexte,
  action: 'step.saved' | 'step.deleted' | 'step.test_sent',
  campagneId: string,
  libelle: string,
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'campaign',
      entityId: campagneId,
      action,
      diff: { libelle, campagneId },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn(`[journal] ${action}`, err);
  }
}

// ---------------------------------------------------------------------------
// colonnesDeListeCampagne (T29, partie A)
// ---------------------------------------------------------------------------

export const schemaColonnesDeListeCampagne = z.object({ campagneId: z.string().uuid() });

interface LigneRawRowListe {
  readonly raw_row: Record<string, unknown> | null;
}

/** Échantillon maximum de `list_members` lu pour découvrir les colonnes disponibles — les plus récentes d'abord. */
const MAX_LIGNES_ECHANTILLON_LISTE = 200;

/**
 * Noms de variables `liste_<colonne>` (déjà préfixées) disponibles pour une
 * campagne — celles que le tiroir d'étape (`TiroirEtape.tsx`) propose à
 * l'insertion, et que l'aperçu fictif (`apercuEtape`) sait rendre en espace
 * réservé plutôt qu'en variable manquante.
 *
 * Source : un échantillon (au plus `MAX_LIGNES_ECHANTILLON_LISTE`, les plus
 * récentes) des `list_members.raw_row` des listes reliées à la campagne —
 * celle de chaque inscription (`enrollments.list_id`) ET celle de la
 * campagne elle-même (`campaigns.list_id`, campagne alimentée directement par
 * une liste). Clés normalisées par `normalizeListColumnName` (même règle que
 * `construireValeursContact`/`validateTemplateVariables`), clés qui
 * normalisent vers une chaîne vide ignorées, dédoublonnées, dans l'ordre de
 * première apparition. Sans liste reliée : `[]`.
 *
 * `c.organization_id = $2` (tour de correction 1, Bloquant de la relecture) :
 * ce pool n'a pas de RLS (rôle service, `apps/web/lib/contexte.ts`) — sans ce
 * garde, une campagne d'une autre organisation aurait rendu les noms de
 * colonnes de SA liste importée. Même modèle qu'`apercuEtape`/`lireSequence`.
 * Posé comme un `exists` PUR (rien d'autre n'en dépend) : une campagne hors
 * organisation, ou inexistante, rend simplement `[]` — acceptable pour une
 * fonction de suggestions (le seul appelant écran, `sequence/page.tsx`, tourne
 * de toute façon en parallèle de `lireSequence`, qui rejette déjà pour ce cas ;
 * un futur appel MCP direct reçoit une liste vide plutôt qu'une exception qui
 * confirmerait l'existence d'une campagne hors de sa portée).
 */
export async function colonnesDeListeCampagne(ctx: Contexte, entree: unknown): Promise<string[]> {
  exiger(ctx, 'viewer');
  const { campagneId } = valider(schemaColonnesDeListeCampagne, entree);

  const res = await ctx.ex.query<LigneRawRowListe>(
    `select lm.raw_row /* jr:sequence_colonnes_liste */
       from list_members lm
      where exists (
              select 1 from campaigns c where c.id = $1 and c.organization_id = $2
            )
        and lm.list_id in (
          select distinct list_id from (
            select list_id from enrollments where campaign_id = $1 and list_id is not null
            union
            select list_id from campaigns where id = $1 and list_id is not null
          ) x
        )
      order by lm.added_at desc
      limit ${MAX_LIGNES_ECHANTILLON_LISTE}`,
    [campagneId, ctx.organisationId],
  );

  const vues = new Set<string>();
  const colonnes: string[] = [];
  for (const ligne of res.rows) {
    if (!ligne.raw_row) continue;
    for (const cle of Object.keys(ligne.raw_row)) {
      const colonne = normalizeListColumnName(cle);
      if (!colonne) continue;
      const variable = `liste_${colonne}`;
      if (vues.has(variable)) continue;
      vues.add(variable);
      colonnes.push(variable);
    }
  }
  return colonnes;
}

// ---------------------------------------------------------------------------
// apercuEtape
// ---------------------------------------------------------------------------

export const schemaApercuEtape = z.object({ etapeId: z.string().uuid(), contactId: z.string().uuid().optional() });

/**
 * Contact fictif de rendu (aucune personne réelle) utilisé quand aucun
 * `contactId` réel n'est fourni — l'écran n'a aujourd'hui aucun sélecteur de
 * contact, donc c'est le cas normal de l'aperçu du tiroir.
 */
const VALEURS_CONTACT_FICTIF: Readonly<Record<string, string>> = {
  prenom: 'Claire',
  salutation: 'Bonjour Claire',
  nom: 'Moreau',
  poste: 'Directrice commerciale',
  entreprise: 'Néolia',
  ville: 'Nantes',
  effectif: '48',
  persona_angle: 'directeur commercial',
  signal_titre: 'Recrute un responsable grands comptes',
  signal_zone: 'Pays de la Loire',
  lien_offre: 'https://exemple.fr/offres/12345',
  contexte: 'Fait partie de la liste « Prospects qualifiés ».',
  site: 'neolia.example',
  departement: '44',
  pays: 'France',
  signal_date: '12 septembre 2026',
  signal_mois: 'septembre',
};

export interface ApercuEtape {
  readonly sujet: string;
  readonly corps: string;
  /** `renderTemplate(...).missing` de l'objet et du corps, dédoublonnées — même mécanique qu'`apercuEnvoi` (`file-du-jour.ts`, C5). */
  readonly variablesManquantes: string[];
}

export async function apercuEtape(ctx: Contexte, entree: unknown): Promise<ApercuEtape> {
  exiger(ctx, 'viewer');
  const { etapeId, contactId } = valider(schemaApercuEtape, entree);

  const etapeRes = await ctx.ex.query<{ campaign_id: string; template_parent_id: string | null }>(
    `select st.campaign_id, st.template_parent_id /* jr:sequence_apercu_etape */
       from sequence_steps st join campaigns c on c.id = st.campaign_id
      where st.id = $1 and c.organization_id = $2`,
    [etapeId, ctx.organisationId],
  );
  const etape = etapeRes.rows[0];
  if (!etape) throw new ErreurIntrouvable('Étape');

  if (!etape.template_parent_id) return { sujet: '', corps: '', variablesManquantes: [] };

  const gabaritRes = await ctx.ex.query<{ subject: string | null; body: string }>(
    `select subject, body from message_templates /* jr:sequence_apercu_gabarit */
      where (id = $1 or parent_id = $1) and is_active
      order by version desc
      limit 1`,
    [etape.template_parent_id],
  );
  const gabarit = gabaritRes.rows[0];
  if (!gabarit) return { sujet: '', corps: '', variablesManquantes: [] };

  let valeurs: Record<string, string | undefined> = VALEURS_CONTACT_FICTIF;
  if (contactId) {
    const contact = await lireValeursContact(ctx.ex, ctx.organisationId, contactId, etape.campaign_id);
    valeurs = contact?.valeurs ?? {};
  } else {
    // Le contact fictif ne connaît aucune colonne de liste importée. Une
    // variable liste_<colonne> QUE LA CAMPAGNE POSSÈDE s'affiche en espace
    // réservé (`{{liste_poste}}` → `[poste]`) plutôt que manquante — sinon
    // l'opérateur croirait la variable cassée alors qu'elle se résoudra pour
    // un contact réel (`lireValeursContact` fait alors le vrai travail).
    // Une variable liste_ que la campagne ne possède PAS reste manquante.
    const colonnesListe = await colonnesDeListeCampagne(ctx, { campagneId: etape.campaign_id });
    if (colonnesListe.length > 0) {
      const placeholders = Object.fromEntries(
        colonnesListe.map((variable) => [variable, `[${variable.slice('liste_'.length)}]`]),
      );
      valeurs = { ...VALEURS_CONTACT_FICTIF, ...placeholders };
    }
  }

  const renduObjet = renderTemplate(gabarit.subject ?? '', valeurs);
  const renduCorps = renderTemplate(gabarit.body, valeurs);

  return {
    sujet: renduObjet.text,
    corps: renduCorps.text,
    variablesManquantes: [...new Set([...renduObjet.missing, ...renduCorps.missing])],
  };
}

// ---------------------------------------------------------------------------
// envoyerTest
// ---------------------------------------------------------------------------

export const schemaEtapeId = z.object({ etapeId: z.string().uuid() });

interface LigneEtapePourTest {
  campaign_id: string;
  entry_rules: unknown;
}

function boiteIdsDeEntryRules(entryRules: unknown): string[] | undefined {
  const v = (entryRules as { boiteIds?: unknown } | null)?.boiteIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined;
}

/**
 * Inscrit le contact de test de l'ORGANISATION (un seul, partagé entre
 * campagnes — adresse de l'opérateur, `auth.users.email`) à cette étape et
 * crée une action `scheduled` immédiate : le worker l'envoie par le chemin
 * normal (`rejouerActionsEmailEnAttente`, `apps/worker/src/traitements.ts`),
 * cette fonction n'appelle jamais SalesBlink elle-même.
 *
 * Une seule inscription « vivante » par contact est permise en base
 * (`enrollments_one_active_uidx`) : si le contact de test est déjà inscrit
 * ailleurs, cette inscription est arrêtée avant d'en (re)créer une pour CETTE
 * campagne — le contact de test change de campagne à chaque nouveau test,
 * jamais engagé dans deux à la fois.
 */
export async function envoyerTest(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { etapeId } = valider(schemaEtapeId, entree);
  if (!ctx.utilisateurId) throw new ErreurIntrouvable('Utilisateur');

  const etapeRes = await ctx.ex.query<LigneEtapePourTest>(
    `select st.campaign_id, c.entry_rules /* jr:sequence_test_etape */
       from sequence_steps st join campaigns c on c.id = st.campaign_id
      where st.id = $1 and c.organization_id = $2 and st.channel = 'email'`,
    [etapeId, ctx.organisationId],
  );
  const etape = etapeRes.rows[0];
  if (!etape) throw new ErreurIntrouvable('Étape email');

  const userRes = await ctx.ex.query<{ email: string | null }>(
    `select email from auth.users /* jr:sequence_test_utilisateur */ where id = $1`,
    [ctx.utilisateurId],
  );
  const email = userRes.rows[0]?.email;
  if (!email) throw new ErreurIntrouvable('Adresse de l’opérateur');

  const boiteIds = boiteIdsDeEntryRules(etape.entry_rules);
  const senderRes = await ctx.ex.query<{ id: string }>(
    `select id from senders /* jr:sequence_test_expediteur */
      where organization_id = $1 and kind = 'email' and is_active
        and ($2::uuid[] is null or id = any($2::uuid[]))
      order by identity
      limit 1`,
    [ctx.organisationId, boiteIds ?? null],
  );
  const senderId = senderRes.rows[0]?.id;
  if (!senderId) throw new ErreurIntrouvable('Expéditeur actif');

  // Contact de test : créé au besoin, `do_not_contact` levé pour lui seul —
  // c'est l'adresse de l'opérateur, jamais une adresse à protéger d'un envoi.
  const contactRes = await ctx.ex.query<{ id: string }>(
    `insert into contacts (organization_id, email, first_name, status) /* jr:sequence_test_contact */
     values ($1, $2, 'Test', 'active')
     on conflict (organization_id, lower(email)) do update set status = 'active'
     returning id`,
    [ctx.organisationId, email],
  );
  const contactId = contactRes.rows[0]!.id;

  // Arrête toute autre inscription vivante de ce contact (une seule autorisée en base).
  await ctx.ex.query(
    `update enrollments /* jr:sequence_test_arreter_ailleurs */
        set status = 'stopped', stop_reason = 'test_contact_reassigned', ended_at = now()
      where contact_id = $1 and campaign_id <> $2 and status in ('active', 'paused', 'paused_absence')`,
    [contactId, etape.campaign_id],
  );

  const enrollmentExistant = await ctx.ex.query<{ id: string }>(
    `select id from enrollments /* jr:sequence_test_inscription_existante */
      where campaign_id = $1 and contact_id = $2
      order by started_at desc
      limit 1`,
    [etape.campaign_id, contactId],
  );
  let enrollmentId: string;
  if (enrollmentExistant.rows[0]) {
    enrollmentId = enrollmentExistant.rows[0].id;
    await ctx.ex.query(
      `update enrollments /* jr:sequence_test_reactiver */
          set status = 'active', ended_at = null, stop_reason = null, resume_at = null
        where id = $1`,
      [enrollmentId],
    );
  } else {
    const ins = await ctx.ex.query<{ id: string }>(
      `insert into enrollments (organization_id, campaign_id, contact_id, status, current_step, started_at) /* jr:sequence_test_inscrire */
       values ($1, $2, $3, 'active', 0, now())
       returning id`,
      [ctx.organisationId, etape.campaign_id, contactId],
    );
    enrollmentId = ins.rows[0]!.id;
  }

  await ctx.ex.query(
    `insert into actions /* jr:sequence_test_action */
       (organization_id, enrollment_id, step_id, channel, status, sender_id, scheduled_for, dispatch_after, payload, idempotency_key)
     values ($1, $2, $3, 'email', 'scheduled', $4, now(), now(), $5::jsonb, $6)`,
    [
      ctx.organisationId,
      enrollmentId,
      etapeId,
      senderId,
      JSON.stringify({ email }),
      `test:${etapeId}:${contactId}:${Date.now()}`,
    ],
  );

  await ecrireEvenementEtape(ctx, 'step.test_sent', etape.campaign_id, 'Test envoyé pour une étape de séquence.');
}

// ---------------------------------------------------------------------------
// reprendreInscription (T29, partie B — R93)
// ---------------------------------------------------------------------------

export const schemaReprendreInscription = z.object({ inscriptionId: z.string().uuid() });

interface LigneInscriptionAvant {
  contact_id: string | null;
  campaign_id: string;
  current_step: number;
  status: string;
}

interface LigneInscriptionReprise {
  contact_id: string | null;
  campaign_id: string;
}

async function ecrireEvenementReprise(
  ctx: Contexte,
  contactId: string | null,
  campagneId: string,
  libelle: string = 'Inscription reprise.',
): Promise<void> {
  try {
    await ecrireEvenement(ctx.ex, {
      organisationId: ctx.organisationId,
      entityType: 'contact',
      entityId: contactId,
      action: 'enrollment_resumed',
      diff: { libelle, campagneId },
      actorId: ctx.utilisateurId,
    });
  } catch (err) {
    console.warn('[journal] enrollment_resumed', err);
  }
}

/**
 * Reprend une inscription en pause (`paused`/`paused_absence`, R93) : remet
 * l'inscription `active` et REJOUE VRAIMENT l'étape qui vient d'échouer —
 * `mettreInscriptionEnPause` (worker) a ramené `current_step` sur elle, mais
 * l'action de cette étape existe déjà (`blocked`/`failed`, clé d'idempotence
 * `actionIdempotencyKey(enrollmentId, stepId)`) : sans la remettre
 * `scheduled` explicitement, le tick ne réinsérerait jamais une action dont
 * la clé est déjà prise (`on conflict (idempotency_key) do nothing`), et
 * l'inscription n'avancerait plus jamais. Même traitement que `relancerEnvoi`
 * (`fonctions/file-du-jour.ts`) applique à une action `failed` : `scheduled`,
 * `scheduled_for = now()`, `error = null` — étendu ici à `block_reason` (une
 * action peut aussi être `blocked`) ; le balayage `rejouerActionsEmailEnAttente`
 * (worker) reprend ensuite l'action `scheduled`. Le gestionnaire d'envoi
 * (`apps/worker/src/handlers/email-salesblink.ts`) revérifie lui-même la
 * délivrabilité avant de pousser — une action `email_gate` remise `scheduled`
 * ici ne part donc pas forcément si l'adresse est toujours invalide.
 *
 * Étape courante par RANG ORDINAL, pas par égalité de `position` (tour de
 * correction 1, Important de la relecture) : partout ailleurs, `current_step`
 * est traité comme un INDEX de tableau — `composeTick`
 * (`packages/core/src/sequencer/tick.ts`) fait `steps[currentStep]` sur un
 * tableau construit par `order by position asc`. Les deux ne coïncident que
 * si les `position` d'une campagne sont contiguës 0..N-1, ce que
 * `supprimerEtape` (plus haut dans ce fichier) ne garantit pas — elle ne
 * renumérote jamais les étapes restantes. `order by position asc offset $2
 * limit 1` reproduit exactement `rows[current_step]` après le même tri,
 * quelle que soit la contiguïté des `position`.
 *
 * `next_action_at` distingue les deux motifs de pause (F10) : `paused`
 * (blocage : gate, expéditeur indisponible, échec d'envoi...) reste `now()`,
 * l'opérateur qui clique « Reprendre » attend un redémarrage immédiat, c'est
 * précisément le geste qu'il vient de faire ; `paused_absence` (réponse
 * d'absence automatique) pose `now() + le délai de l'étape EN ATTENTE` : le
 * délai entre deux mails ne court pas pendant l'absence, il repart
 * entièrement au retour, jamais « tout de suite » (le pire moment, une boîte
 * pleine le jour du retour de vacances). Même calcul que le départ réel d'un
 * envoi (`echeanceEtapeSuivante`, partagée avec `poserEcheanceApresDepart`,
 * `sequencer/echeance.ts`), ici depuis l'instant de la reprise plutôt qu'un
 * `dispatched_at` : il n'y a pas d'action en attente à faire partir,
 * l'inscription attend seulement son étape suivante. Le traitement
 * automatique d'une absence échue applique la même règle depuis `resume_at`
 * plutôt que `now` (`reprendreAbsencesEchues`,
 * `apps/worker/src/handlers/sequence.ts`).
 */
export async function reprendreInscription(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'operator');
  const { inscriptionId } = valider(schemaReprendreInscription, entree);

  const avant = await ctx.ex.query<LigneInscriptionAvant>(
    `select contact_id, campaign_id, current_step, status from enrollments /* jr:reprendre_lecture */
      where id = $1 and organization_id = $2 and status in ('paused', 'paused_absence')`,
    [inscriptionId, ctx.organisationId],
  );
  const ligneAvant = avant.rows[0];
  if (!ligneAvant) throw new ErreurIntrouvable('Inscription en pause');

  // Étape EN ATTENTE : le rang stocké par une inscription en pause, qu'elle
  // soit bloquée sur l'action de cette étape (`paused`) ou qu'elle n'ait
  // encore rien émis pour elle (`paused_absence`, l'étape précédente est déjà
  // partie). Même requête, réutilisée plus bas pour rejouer l'action bloquée
  // ET pour le délai d'une reprise d'absence.
  const etapeRes = await ctx.ex.query<{ id: string; delay_hours: number | null }>(
    `select id, delay_hours from sequence_steps /* jr:reprendre_etape */
      where campaign_id = $1
      order by position asc
      offset $2
      limit 1`,
    [ligneAvant.campaign_id, ligneAvant.current_step],
  );
  const etape = etapeRes.rows[0];

  // Repli sur `Date.now()` si l'étape n'existe plus (séquence modifiée
  // pendant l'absence) : jamais laisser `next_action_at` sans valeur, une
  // inscription `active` sans échéance ne serait plus jamais reprise par le
  // tick.
  const nextActionAtMs =
    ligneAvant.status === 'paused_absence'
      ? (echeanceEtapeSuivante(Date.now(), inscriptionId, etape?.delay_hours ?? null) ?? Date.now())
      : Date.now();

  const res = await ctx.ex.query<LigneInscriptionReprise>(
    `update enrollments /* jr:reprendre_inscription */
        set status = 'active', stop_reason = null, resume_at = null, ended_at = null, next_action_at = $3
      where id = $1 and organization_id = $2 and status in ('paused', 'paused_absence')
      returning contact_id, campaign_id`,
    [inscriptionId, ctx.organisationId, new Date(nextActionAtMs).toISOString()],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Inscription en pause');

  const etapeId = etape?.id;
  if (etapeId) {
    const cle = actionIdempotencyKey(inscriptionId, etapeId);
    // M3 (Mineur, revue finale du 14/09) : ne pas rejouer une action qui
    // porte déjà une preuve d'envoi (`payload->>'message_id'`, posée par la
    // relève une fois SalesBlink confirmé) — un envoi accepté par le
    // transport mais dont la réponse HTTP se serait perdue avant que
    // l'action soit marquée `failed`/`blocked` doublerait sinon le message.
    // L'inscription est quand même réactivée (fait plus haut) ; seule
    // l'action n'est pas rejouée, et le journal le dit.
    const dejaEnvoyee = await ctx.ex.query<{ id: string }>(
      `select id from actions /* jr:reprendre_verif_envoi */
        where idempotency_key = $1 and organization_id = $2 and status in ('blocked', 'failed')
          and (payload ->> 'message_id') is not null`,
      [cle, ctx.organisationId],
    );
    if ((dejaEnvoyee.rowCount ?? 0) > 0) {
      await ecrireEvenementReprise(
        ctx,
        ligne.contact_id,
        ligne.campaign_id,
        'Inscription reprise sans rejouer un envoi déjà parti.',
      );
      return;
    }
    await ctx.ex.query(
      `update actions /* jr:reprendre_action */
          set status = 'scheduled', scheduled_for = now(), error = null, block_reason = null
        where idempotency_key = $1 and organization_id = $2 and status in ('blocked', 'failed')`,
      [cle, ctx.organisationId],
    );
  }

  await ecrireEvenementReprise(ctx, ligne.contact_id, ligne.campaign_id);
}

/**
 * Réglages › Messages (tâche 22, lot 2) : la bibliothèque des modèles
 * (`message_templates`) — une ligne par FAMILLE (`coalesce(parent_id, id)`),
 * la version active seulement, dans la langue de l'organisation.
 *
 * Spec « une fonction, deux façades » : l'écran (`apps/web/app/actions/templates.ts`)
 * et le futur serveur MCP appellent les mêmes fonctions avec le même `Contexte`.
 *
 * `enregistrerModele` réutilise `enregistrerVersionModele` (`sequence.ts`,
 * tâche 12) : même garantie « jamais un état sans version active » (la
 * désactivation de l'ancienne version et l'insertion de la nouvelle sont dans
 * la même transaction), sans dupliquer cette logique ici.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider } from './contexte.js';
import { enregistrerVersionModele, type CanalModele } from './sequence.js';

export interface ModeleMessage {
  /** Id de la version active (celle éditée/affichée). */
  readonly id: string;
  /** Id de la lignée (`coalesce(parent_id, id)`) — stable à travers les versions, c'est lui que `sequence_steps.template_parent_id` porte. */
  readonly familyId: string;
  readonly nom: string;
  readonly canal: CanalModele;
  readonly sujet: string | null;
  readonly corps: string;
  /** Noms des campagnes dont une étape pointe vers cette lignée (`sequence_steps.template_parent_id`). */
  readonly campagnes: string[];
  /** Envois réels (`actions` dispatched/delivered) des étapes de cette lignée — PAS `message_templates.sent_count`, jamais incrémenté par le moteur actuel. */
  readonly envois: number;
  readonly modifieLe: string;
  readonly modifiePar: string | null;
}

interface LigneModele {
  id: string;
  family_id: string;
  name: string;
  channel: CanalModele;
  subject: string | null;
  body: string;
  created_at: string;
  modifie_par: string | null;
  campagnes: string[] | null;
  envois: number;
}

/**
 * Version active de chaque lignée, dans la langue par défaut de
 * l'organisation (R61 : la locale d'un modèle vient de
 * `organizations.default_locale`, pas d'une colonne de `campaigns`) — une
 * organisation ne travaille qu'une langue à la fois, jamais un mélange dans
 * cette bibliothèque.
 *
 * `mt.origin = 'library'` (tour de correction 1, bloquant de relecture) :
 * `enregistrerEtape` (`sequence.ts`) écrit une ligne `message_templates` à
 * CHAQUE écriture d'étape, avec `origin: 'step'` — un brouillon d'étape, pas
 * un modèle réutilisable (migration `20260831210000_messages_ecrits_dans_la_sequence.sql`).
 * Sans ce filtre, la bibliothèque affiche une ligne nommée comme la campagne
 * dès qu'un opérateur écrit le message d'une étape, sur N'IMPORTE quelle
 * campagne — jamais « versée » (`verserDansBibliotheque`) et pas censée être
 * réutilisable ailleurs.
 */
export async function listerModeles(ctx: Contexte, entree: unknown): Promise<ModeleMessage[]> {
  exiger(ctx, 'viewer');
  valider(z.object({}), entree);

  const res = await ctx.ex.query<LigneModele>(
    `select mt.id, coalesce(mt.parent_id, mt.id) as family_id, mt.name, mt.channel, mt.subject, mt.body, mt.created_at,
            coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as modifie_par,
            coalesce(array_agg(distinct c.name) filter (where c.name is not null), '{}') as campagnes,
            count(distinct a.id)::int as envois
       from message_templates mt /* jr:messages_lister */
       join organizations o on o.id = mt.organization_id
       left join auth.users u on u.id = mt.created_by
       left join sequence_steps ss on ss.template_parent_id = coalesce(mt.parent_id, mt.id)
       left join campaigns c on c.id = ss.campaign_id and c.organization_id = mt.organization_id
       left join actions a on a.step_id = ss.id and a.status in ('dispatched', 'delivered')
      where mt.organization_id = $1 and mt.is_active and mt.locale = o.default_locale and mt.origin = 'library'
      group by mt.id, mt.parent_id, mt.name, mt.channel, mt.subject, mt.body, mt.created_at, u.raw_user_meta_data, u.email
      order by mt.created_at desc`,
    [ctx.organisationId],
  );

  return res.rows.map((r) => ({
    id: r.id,
    familyId: r.family_id,
    nom: r.name,
    canal: r.channel,
    sujet: r.subject,
    corps: r.body,
    campagnes: r.campagnes ?? [],
    envois: r.envois,
    modifieLe: r.created_at,
    modifiePar: r.modifie_par,
  }));
}

export const schemaEnregistrerModele = z.object({
  familyId: z.string().uuid().nullable().optional(),
  nom: z.string().trim().min(1),
  canal: z.enum(['email', 'linkedin_invite', 'linkedin_message', 'letter', 'call']),
  sujet: z.string().nullable().optional(),
  corps: z.string().min(1),
  /** Nature de campagne visée (disponibilité des variables, `messages/variables.ts`) : un modèle de bibliothèque n'est lié à aucune campagne, l'opérateur la choisit explicitement. */
  nature: z.enum(['signal', 'list']),
});

/**
 * Crée (sans `familyId`) ou verse une nouvelle version dans une lignée
 * existante (avec) — toujours `origin: 'library'`. Locale résolue depuis
 * `organizations.default_locale` (R61), jamais demandée à l'appelant.
 */
export async function enregistrerModele(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'admin');
  const e = valider(schemaEnregistrerModele, entree);

  const localeRes = await ctx.ex.query<{ default_locale: string }>(
    `select default_locale from organizations /* jr:messages_organisation_locale */ where id = $1`,
    [ctx.organisationId],
  );
  const locale = localeRes.rows[0]?.default_locale ?? 'fr';

  return enregistrerVersionModele(ctx, {
    familyId: e.familyId ?? null,
    nom: e.nom,
    canal: e.canal,
    locale,
    sujet: e.canal === 'email' ? e.sujet?.trim() || null : null,
    corps: e.corps,
    nature: e.nature,
    origin: 'library',
  });
}

/**
 * Réglages du Compte (tâche 23) : identité de l'organisation (nom, fuseau,
 * langue) et liste de ses membres (adhésions réelles + invitations en
 * attente). Les notifications et le mot de passe restent portés par les
 * façades existantes (`apps/web/app/actions/notifications.ts`, `auth.ts`) :
 * ni l'une ni l'autre n'a de fonction cœur dédiée dans le plan de cette
 * tâche, ce sont des réglages propres à l'utilisateur courant, pas à
 * l'organisation.
 */
import { z } from 'zod';
import type { MembershipRole } from '../roles.js';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { ecrireReglage } from './plafonds.js';
import { dansUneTransaction } from '../transaction.js';

export interface Organisation {
  id: string;
  nom: string;
  langue: string;
}

interface LigneOrganisation {
  id: string;
  name: string;
  default_locale: string;
}

export async function lireOrganisation(ctx: Contexte): Promise<Organisation> {
  exiger(ctx, 'viewer');
  const res = await ctx.ex.query<LigneOrganisation>(
    `select id, name, default_locale /* jr:compte_organisation */
       from organizations
      where id = $1`,
    [ctx.organisationId],
  );
  const ligne = res.rows[0];
  if (!ligne) throw new ErreurIntrouvable('Organisation');
  return { id: ligne.id, nom: ligne.name, langue: ligne.default_locale };
}

/** Mêmes langues que les trois catalogues i18n (`packages/i18n/src/messages/{fr,en,nl}.json`). */
const LANGUES = ['fr', 'en', 'nl'] as const;

/** IANA à jour du runtime — pas une liste maintenue à la main, qui dériverait de tzdata. */
const FUSEAUX_CONNUS = new Set(Intl.supportedValuesOf('timeZone'));

export const schemaModifierOrganisation = z.object({
  nom: z.string().trim().min(1).max(200),
  fuseau: z.string().refine((v) => FUSEAUX_CONNUS.has(v), { message: 'Fuseau horaire inconnu.' }),
  langue: z.enum(LANGUES),
});

/**
 * Écrit `organizations.name`/`default_locale` et le fuseau de l'organisation
 * (`organization_settings`, clé `fuseau` — réutilise `ecrireReglage`, même
 * table que les plafonds, R67 bis : c'est cette même clé que les formateurs
 * de dates lisent déjà). Une seule transaction : un fuseau enregistré sans
 * son nom (ou l'inverse) sur une erreur réseau laisserait l'organisation
 * dans un état incohérent que rien ne signale à l'écran.
 */
export async function modifierOrganisation(ctx: Contexte, entree: unknown): Promise<void> {
  exiger(ctx, 'admin');
  const { nom, fuseau, langue } = valider(schemaModifierOrganisation, entree);

  await dansUneTransaction(ctx.ex, async (tx) => {
    const res = await tx.query(
      `update organizations /* jr:compte_modifier_organisation */
          set name = $1, default_locale = $2
        where id = $3`,
      [nom, langue, ctx.organisationId],
    );
    if ((res.rowCount ?? 0) === 0) throw new ErreurIntrouvable('Organisation');
    await ecrireReglage({ ...ctx, ex: tx }, { cle: 'fuseau', valeur: fuseau });
  });
}

export interface MembreOrganisation {
  id: string;
  nom: string;
  email: string;
  role: MembershipRole;
  depuis: string;
  enAttente: boolean;
  moiMeme: boolean;
}

interface LigneMembre {
  id: string;
  role: MembershipRole;
  created_at: string;
  email: string;
  nom: string;
}

interface LigneInvitation {
  id: string;
  role: MembershipRole;
  created_at: string;
  email: string;
}

/**
 * Adhésions réelles (`memberships`, jointes à `auth.users` pour le nom et
 * l'email — même motif que `contacts.ts` pour l'auteur d'une note) suivies
 * des invitations encore en attente (`invitations`, ni acceptées ni expirées) :
 * c'est ce que montre la maquette (« Marion … invitée le 13 sept. · en
 * attente »), 3 lignes pour 2 adhésions et 1 invitation.
 */
export async function listerMembres(ctx: Contexte): Promise<MembreOrganisation[]> {
  exiger(ctx, 'viewer');
  const [membresRes, invitationsRes] = await Promise.all([
    ctx.ex.query<LigneMembre>(
      `select m.user_id as id, m.role, m.created_at, u.email,
              coalesce(nullif(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)) as nom
         from memberships m /* jr:compte_membres */
         join auth.users u on u.id = m.user_id
        where m.organization_id = $1
        order by m.created_at asc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneInvitation>(
      `select id, role, created_at, email /* jr:compte_invitations */
         from invitations
        where organization_id = $1
          and accepted_at is null
          and expires_at > now()
        order by created_at asc`,
      [ctx.organisationId],
    ),
  ]);

  return [
    ...membresRes.rows.map((r) => ({
      id: r.id,
      nom: r.nom,
      email: r.email,
      role: r.role,
      depuis: r.created_at,
      enAttente: false,
      moiMeme: r.id === ctx.utilisateurId,
    })),
    ...invitationsRes.rows.map((r) => ({
      id: r.id,
      nom: r.email,
      email: r.email,
      role: r.role,
      depuis: r.created_at,
      enAttente: true,
      moiMeme: false,
    })),
  ];
}

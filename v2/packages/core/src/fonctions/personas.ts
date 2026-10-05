/**
 * Réglages › Personas (tâche 22, lot 2) : la liste des personas de
 * l'organisation, leur fiche (nom, intitulés de poste reconnus, séniorité,
 * consignes de notation lues par le modèle, ce que Jay leur apporte, campagne
 * par défaut) et le test d'appariement sur un intitulé saisi.
 *
 * Spec « une fonction, deux façades » : l'écran (`apps/web/app/actions/personas.ts`)
 * et le futur serveur MCP appellent les mêmes fonctions avec le même `Contexte`.
 *
 * Le test d'appariement (`testerAppariement`) réutilise le moteur PUR existant
 * (`persona-matching.ts`, `matchPersona`) — pas d'appel au modèle de langage :
 * la maquette (`reglages-personas.html`) montre un scoring LLM complet (score,
 * justification, temps de réponse), mais le brief de cette tâche borne
 * explicitement l'interface à `{ persona: string | null }` via ce moteur de
 * correspondance de motifs, déjà utilisé ailleurs (assistant de création de
 * campagne). Écart assumé, documenté dans le rapport de tâche.
 */
import { z } from 'zod';
import type { Contexte } from './contexte.js';
import { exiger, valider, ErreurIntrouvable } from './contexte.js';
import { matchPersona, type PersonaRule } from '../persona-matching.js';

export const SENIORITES_PERSONA = ['executive', 'director', 'manager', 'individual'] as const;
export type SenioritePersona = (typeof SENIORITES_PERSONA)[number];

export interface CampagneOption {
  readonly id: string;
  readonly nom: string;
}

export interface PersonaDetail {
  readonly id: string;
  readonly nom: string;
  readonly intitulesPostes: string[];
  readonly seniorite: SenioritePersona | null;
  readonly consignesNotation: string | null;
  readonly ceQueJayApporte: string | null;
  readonly campagneParDefautId: string | null;
  /**
   * « Publié » (visible dans le sélecteur de l'assistant de création de
   * campagne, `listerPersonasOrganisation`, `campagnes.ts`) — le bouton
   * « Supprimer » de la fiche pose cette valeur à `false` plutôt que de
   * supprimer la ligne (des contacts et des campagnes peuvent déjà s'y
   * référer ; `contacts.persona_id` est en `on delete set null`, mais
   * `campaigns.entry_rules.personas` n'est pas une clé étrangère — une
   * suppression y laisserait un identifiant orphelin).
   */
  readonly estActif: boolean;
  /** Noms des campagnes dont `entry_rules.personas` cite ce persona. */
  readonly campagnesUtilisatrices: string[];
  readonly nombreContacts: number;
  /** Moyenne arrondie des scores des signaux à l'origine des contacts de ce persona — `null` si aucun signal noté. */
  readonly scoreMoyen: number | null;
}

export interface ListePersonasResultat {
  readonly personas: PersonaDetail[];
  /** Toutes les campagnes de l'organisation, pour le sélecteur « campagne par défaut » de la fiche. */
  readonly campagnesDisponibles: CampagneOption[];
}

interface LignePersona {
  id: string;
  name: string;
  title_patterns: string[] | null;
  seniority: string | null;
  scoring_prompt: string | null;
  angle: string | null;
  default_campaign_id: string | null;
  is_active: boolean;
}

interface LigneCampagne {
  id: string;
  name: string;
  entry_rules: { personas?: string[] } | null;
}

export async function listerPersonas(
  ctx: Contexte,
  entree: unknown,
): Promise<ListePersonasResultat> {
  exiger(ctx, 'viewer');
  valider(z.object({}), entree);

  const [personasRes, campagnesRes, contactsRes, scoreRes] = await Promise.all([
    ctx.ex.query<LignePersona>(
      `select id, name, title_patterns, seniority, scoring_prompt, angle, default_campaign_id, is_active
         from personas /* jr:personas_lister */
        where organization_id = $1
        order by name`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneCampagne>(
      `select id, name, entry_rules from campaigns /* jr:personas_campagnes */ where organization_id = $1 order by name`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ persona_id: string; n: number }>(
      `select persona_id, count(*)::int as n /* jr:personas_contacts */
         from contacts
        where organization_id = $1 and persona_id is not null
        group by persona_id`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ persona_id: string; moyenne: number }>(
      `select ct.persona_id, avg(s.score) as moyenne /* jr:personas_score_moyen */
         from contacts ct
         join signals s on s.id = ct.source_signal_id
        where ct.organization_id = $1 and ct.persona_id is not null and s.score is not null
        group by ct.persona_id`,
      [ctx.organisationId],
    ),
  ]);

  const campagnesParPersona = new Map<string, string[]>();
  for (const c of campagnesRes.rows) {
    for (const personaId of c.entry_rules?.personas ?? []) {
      const liste = campagnesParPersona.get(personaId) ?? [];
      liste.push(c.name);
      campagnesParPersona.set(personaId, liste);
    }
  }
  const contactsParPersona = new Map(contactsRes.rows.map((r) => [r.persona_id, r.n]));
  const scoreParPersona = new Map(scoreRes.rows.map((r) => [r.persona_id, r.moyenne]));

  const personas: PersonaDetail[] = personasRes.rows.map((p) => {
    const moyenne = scoreParPersona.get(p.id);
    return {
      id: p.id,
      nom: p.name,
      intitulesPostes: p.title_patterns ?? [],
      seniorite: (p.seniority as SenioritePersona | null) ?? null,
      consignesNotation: p.scoring_prompt,
      ceQueJayApporte: p.angle,
      campagneParDefautId: p.default_campaign_id,
      estActif: p.is_active,
      campagnesUtilisatrices: campagnesParPersona.get(p.id) ?? [],
      nombreContacts: contactsParPersona.get(p.id) ?? 0,
      scoreMoyen: moyenne === undefined ? null : Math.round(Number(moyenne)),
    };
  });

  return {
    personas,
    campagnesDisponibles: campagnesRes.rows.map((c) => ({ id: c.id, nom: c.name })),
  };
}

export const schemaEnregistrerPersona = z.object({
  id: z.string().uuid().optional(),
  nom: z.string().trim().min(1).max(200),
  intitulesPostes: z.array(z.string().min(1).max(120)).max(50).default([]),
  seniorite: z.enum(SENIORITES_PERSONA).nullable().optional(),
  consignesNotation: z.string().max(4000).nullable().optional(),
  ceQueJayApporte: z.string().max(2000).nullable().optional(),
  campagneParDefautId: z.string().uuid().nullable().optional(),
  /** Publié/archivé (voir `PersonaDetail.estActif`) — absent = inchangé à la modification, `true` à la création. */
  estActif: z.boolean().optional(),
});

/**
 * Crée (sans `id`) ou réécrit (avec) un persona. Ne touche QUE les colonnes
 * possédées par cette tâche (nom, intitulés, séniorité, consignes de
 * notation, « ce que Jay leur apporte », campagne par défaut, actif) —
 * `title_exclusions`, `department_patterns` et `channels_priority`
 * (`20260819120000_personas_enrich.sql`) restent aux valeurs déjà en base
 * (une réécriture complète de la ligne les aurait effacées, même défaut que
 * R30/T11 sur `modifierSource`).
 */
export async function enregistrerPersona(ctx: Contexte, entree: unknown): Promise<{ id: string }> {
  exiger(ctx, 'admin');
  const e = valider(schemaEnregistrerPersona, entree);
  const intitules = e.intitulesPostes.map((s) => s.trim()).filter((s) => s.length > 0);
  const consignes = e.consignesNotation?.trim() || null;
  const angle = e.ceQueJayApporte?.trim() || null;
  const seniorite = e.seniorite ?? null;
  const campagneParDefautId = e.campagneParDefautId ?? null;

  if (e.id) {
    const res = await ctx.ex.query<{ id: string }>(
      `update personas /* jr:personas_modifier */
          set name = $1, title_patterns = $2::text[], seniority = $3, scoring_prompt = $4, angle = $5,
              default_campaign_id = $6, is_active = coalesce($7, is_active)
        where id = $8 and organization_id = $9
        returning id`,
      [
        e.nom,
        intitules,
        seniorite,
        consignes,
        angle,
        campagneParDefautId,
        e.estActif ?? null,
        e.id,
        ctx.organisationId,
      ],
    );
    if (res.rowCount === 0) throw new ErreurIntrouvable('Persona');
    return { id: e.id };
  }

  const res = await ctx.ex.query<{ id: string }>(
    `insert into personas /* jr:personas_creer */
       (organization_id, name, title_patterns, seniority, scoring_prompt, angle, default_campaign_id, is_active)
     values ($1, $2, $3::text[], $4, $5, $6, $7, true)
     returning id`,
    [ctx.organisationId, e.nom, intitules, seniorite, consignes, angle, campagneParDefautId],
  );
  return { id: res.rows[0]!.id };
}

export const schemaTesterAppariement = z.object({ intitule: z.string().trim().min(1) });

export type TestAppariementResultat = {
  /** Nom du persona apparié, ou `null` si aucune correspondance unique. */
  readonly persona: string | null;
  readonly statut: 'matched' | 'ambiguous' | 'none';
  /** Noms des personas candidats (plusieurs si `statut === 'ambiguous'`). */
  readonly candidats: string[];
};

/** Teste un intitulé de poste contre les personas ACTIFS de l'organisation (`matchPersona`, `persona-matching.ts`). */
export async function testerAppariement(
  ctx: Contexte,
  entree: unknown,
): Promise<TestAppariementResultat> {
  exiger(ctx, 'viewer');
  const { intitule } = valider(schemaTesterAppariement, entree);

  const res = await ctx.ex.query<{
    id: string;
    name: string;
    title_patterns: string[] | null;
    title_exclusions: string[] | null;
  }>(
    `select id, name, title_patterns, title_exclusions
       from personas /* jr:personas_tester_appariement */
      where organization_id = $1 and is_active`,
    [ctx.organisationId],
  );

  const regles: PersonaRule[] = res.rows.map((r) => ({
    id: r.id,
    titlePatterns: r.title_patterns ?? [],
    titleExclusions: r.title_exclusions ?? [],
  }));
  const nomParId = new Map(res.rows.map((r) => [r.id, r.name]));
  const resultat = matchPersona(intitule, regles);

  return {
    persona:
      resultat.status === 'matched' && resultat.personaId
        ? (nomParId.get(resultat.personaId) ?? null)
        : null,
    statut: resultat.status,
    candidats: resultat.candidates.map((id) => nomParId.get(id) ?? id),
  };
}

/**
 * Vue d'ensemble « Aujourd'hui » : ce qu'un opérateur doit savoir en ouvrant
 * l'app (réponses à traiter, file du jour, moteur, plafonds, campagnes,
 * alertes). Une seule fonction, lue par l'écran comme par la coquille comme
 * par le futur serveur MCP (spec « une fonction, deux façades »).
 */
import type { Contexte } from './contexte.js';
import { lireConsommationDuJour, lireReglages } from './plafonds.js';
import { lireEtatMoteur, type EtatMoteurResume } from './moteur.js';

export type CanalFil = 'email' | 'linkedin';
export type ClassificationFil = 'human_reply' | 'auto_absence' | 'auto_left_company' | 'auto_other' | 'unclassified';

export interface FilResume {
  id: string;
  contactNom: string;
  poste: string | null;
  entreprise: string | null;
  extrait: string;
  quand: string | null;
  canal: CanalFil;
  classification: ClassificationFil;
}

export interface EnvoiPrevu {
  id: string;
  heure: string | null;
  envoye: boolean;
  contactNom: string;
  etape: number | null;
  campagneNom: string | null;
  expediteur: string | null;
  canal: CanalFil;
}

export interface CampagneResume {
  id: string;
  nom: string;
  statut: 'draft' | 'active' | 'paused' | 'archived';
  etapes: number;
  boites: number;
  sources: string[];
  qualifies: number;
  enSequence: number;
  reponses: number;
  tauxReponse: number;
}

export type TypeAlerte = 'pause_envoi' | 'boite_deconnectee' | 'fournisseur_sans_cle' | 'source_orpheline' | 'moteur_silencieux';

export interface Alerte {
  type: TypeAlerte;
  texte: string;
  lien: string;
}

export interface Aujourdhui {
  aTraiter: { total: number; fils: FilResume[] };
  fileDuJour: { total: number; dejaPartis: number; derniereHeure: string | null; envois: EnvoiPrevu[] };
  moteur: EtatMoteurResume;
  plafonds: Awaited<ReturnType<typeof lireConsommationDuJour>>;
  campagnes: CampagneResume[];
  alertes: Alerte[];
}

/** Taille de l'aperçu affiché sur l'écran (le total, lui, porte toujours le compte réel). */
const NOMBRE_FILS_APERCU = 4;
const NOMBRE_ENVOIS_APERCU = 6;

interface LigneFil {
  id: string;
  channel: string;
  classification: ClassificationFil;
  last_message_at: string | null;
  first_name: string | null;
  last_name: string | null;
  job_title: string | null;
  account_name: string | null;
  dernier_message: string | null;
}

interface LigneAction {
  id: string;
  status: string;
  dispatched_at: string | null;
  scheduled_for: string | null;
  dispatch_after: string | null;
  channel: string;
  first_name: string | null;
  last_name: string | null;
  campagne_nom: string | null;
  etape: number | null;
  expediteur: string | null;
}

interface LigneCampagne {
  id: string;
  name: string;
  status: CampagneResume['statut'];
  etapes: number;
  boites: number;
  sources: string[] | null;
  qualifies: number;
  en_sequence: number;
  reponses: number;
}

function canalDe(channel: string): CanalFil {
  return channel.startsWith('linkedin') ? 'linkedin' : 'email';
}

function nomComplet(prenom: string | null, nom: string | null): string {
  return `${prenom ?? ''} ${nom ?? ''}`.trim() || '—';
}

function formatterHeure(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: fuseau, hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export async function lireAujourdhui(ctx: Contexte): Promise<Aujourdhui> {
  const [reglages, filsRes, actionsRes, campagnesRes, orphelinesRes, moteur, plafonds] = await Promise.all([
    lireReglages(ctx),
    ctx.ex.query<LigneFil>(
      `select t.id, t.channel, t.classification, t.last_message_at,
              c.first_name, c.last_name, c.job_title, ac.name as account_name,
              (select m.body from thread_messages m where m.thread_id = t.id order by m.sent_at desc nulls last limit 1) as dernier_message
         from threads t /* jr:threads_a_traiter */
         left join contacts c on c.id = t.contact_id
         left join accounts ac on ac.id = c.account_id
        where t.organization_id = $1
          and t.is_read = false
          and t.resume_at is null
        order by t.last_message_at desc nulls last`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneAction>(
      `select a.id, a.status, a.dispatched_at, a.scheduled_for, a.dispatch_after, a.channel,
              c.first_name, c.last_name, camp.name as campagne_nom, st.position as etape, s.identity as expediteur
         from actions a /* jr:file_du_jour */
         join enrollments e on e.id = a.enrollment_id
         left join contacts c on c.id = e.contact_id
         left join campaigns camp on camp.id = e.campaign_id
         left join sequence_steps st on st.id = a.step_id
         left join senders s on s.id = a.sender_id
        where a.organization_id = $1
          and a.status <> 'cancelled'
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) >= date_trunc('day', now())
          and coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) < date_trunc('day', now()) + interval '1 day'
        order by coalesce(a.dispatched_at, a.scheduled_for, a.dispatch_after) asc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<LigneCampagne>(
      `select c.id, c.name, c.status,
              (select count(*)::int from sequence_steps ss where ss.campaign_id = c.id) as etapes,
              (select count(*)::int from senders sd where sd.organization_id = c.organization_id and sd.kind = 'email' and sd.is_active) as boites,
              coalesce((select array_agg(distinct so.provider_id) from campaign_sources cs join sources so on so.id = cs.source_id where cs.campaign_id = c.id), '{}') as sources,
              (select count(*)::int from enrollments e where e.campaign_id = c.id) as qualifies,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'active') as en_sequence,
              (select count(*)::int from enrollments e where e.campaign_id = c.id and e.status = 'replied') as reponses
         from campaigns c /* jr:campagnes_resume */
        where c.organization_id = $1
        order by c.created_at desc`,
      [ctx.organisationId],
    ),
    ctx.ex.query<{ n: number }>(
      `select count(*)::int as n /* jr:sources_orphelines */
         from sources s
        where s.organization_id = $1
          and s.is_active
          and not exists (select 1 from campaign_sources cs where cs.source_id = s.id)`,
      [ctx.organisationId],
    ),
    lireEtatMoteur(ctx),
    lireConsommationDuJour(ctx),
  ]);

  const fuseau = String(reglages.fuseau);

  const fils: FilResume[] = filsRes.rows.map((r) => ({
    id: r.id,
    contactNom: nomComplet(r.first_name, r.last_name),
    poste: r.job_title,
    entreprise: r.account_name,
    extrait: r.dernier_message ?? '',
    quand: r.last_message_at,
    canal: canalDe(r.channel),
    classification: r.classification,
  }));

  const envois: EnvoiPrevu[] = actionsRes.rows.map((r) => {
    const quand = r.dispatched_at ?? r.scheduled_for ?? r.dispatch_after;
    return {
      id: r.id,
      heure: quand ? formatterHeure(quand, fuseau) : null,
      envoye: r.dispatched_at !== null,
      contactNom: nomComplet(r.first_name, r.last_name),
      etape: r.etape,
      campagneNom: r.campagne_nom,
      expediteur: r.expediteur,
      canal: canalDe(r.channel),
    };
  });
  const dejaPartis = actionsRes.rows.filter((r) => r.dispatched_at !== null).length;
  const derniereEnvoyee = actionsRes.rows
    .filter((r) => r.dispatched_at !== null)
    .map((r) => r.dispatched_at as string)
    .sort()
    .at(-1);

  const campagnes: CampagneResume[] = campagnesRes.rows.map((r) => ({
    id: r.id,
    nom: r.name,
    statut: r.status,
    etapes: r.etapes,
    boites: r.boites,
    sources: r.sources ?? [],
    qualifies: r.qualifies,
    enSequence: r.en_sequence,
    reponses: r.reponses,
    tauxReponse: r.qualifies > 0 ? Math.round((r.reponses / r.qualifies) * 1000) / 10 : 0,
  }));

  const alertes: Alerte[] = [];
  if (!moteur.enMarche) {
    alertes.push({
      type: 'moteur_silencieux',
      texte: moteur.dernierPassage
        ? `Le moteur n'a pas donné signe de vie depuis plus de 15 minutes (dernier passage à ${formatterHeure(moteur.dernierPassage, fuseau)}).`
        : "Le moteur n'a jamais tourné sur cette instance.",
      lien: '/',
    });
  }
  const nbOrphelines = orphelinesRes.rows[0]?.n ?? 0;
  if (nbOrphelines > 0) {
    alertes.push({
      type: 'source_orpheline',
      texte:
        nbOrphelines === 1
          ? "Une source active n'alimente aucune campagne."
          : `${nbOrphelines} sources actives n'alimentent aucune campagne.`,
      lien: '/campaigns',
    });
  }

  return {
    aTraiter: { total: fils.length, fils: fils.slice(0, NOMBRE_FILS_APERCU) },
    fileDuJour: {
      total: envois.length,
      dejaPartis,
      derniereHeure: derniereEnvoyee ? formatterHeure(derniereEnvoyee, fuseau) : null,
      envois: envois.slice(0, NOMBRE_ENVOIS_APERCU),
    },
    moteur,
    plafonds,
    campagnes,
    alertes,
  };
}

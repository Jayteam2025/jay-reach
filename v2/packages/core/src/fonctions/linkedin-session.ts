/**
 * Session LinkedIn du serveur (lot 4a) : son état en base, le verrou qui garantit
 * un seul navigateur à la fois, et l'alerte qui part quand elle se bloque.
 *
 * Fonctions de service, appelées par le worker (pas d'`exiger` : le contexte
 * du worker n'a pas de rôle). Toute requête filtre explicitement par
 * organisation et lit la TABLE, jamais une vue soumise à RLS.
 */
import { notifier } from '../inbox/record-reply.js';
import { dansUneTransaction } from '../transaction.js';
import type { Contexte } from './contexte.js';
import type { Sortie } from './linkedin-sortie.js';

/**
 * Durée de conservation d'une personne collectée sur LinkedIn et jamais contactée. Source unique :
 * la mention de base légale de Réglages › LinkedIn l'affiche, la purge (tâche 11) l'applique,
 * pour que la phrase et le comportement ne puissent pas diverger.
 */
export const RETENTION_PERSONNES_NON_CONTACTEES_JOURS = 90;

export type EtatSession = 'absente' | 'active' | 'bloquee';
export type MotifBlocage = 'defi' | 'cookie_refuse' | 'sortie_inattendue' | 'disjoncteur' | 'revoquee';

export type SessionLinkedIn = {
  etat: EtatSession;
  motif: MotifBlocage | null;
  connecteeLe: Date | null;
  bloqueeLe: Date | null;
  ipAttendue: string | null;
  ipVue: string | null;
  operateur: string | null;
  pays: string | null;
  derniereCollecte: Date | null;
  envoiPauseJusqua: Date | null;
};

interface LigneSession {
  status: EtatSession;
  blocked_reason: MotifBlocage | null;
  connected_at: Date | null;
  blocked_at: Date | null;
  expected_egress_ip: string | null;
  last_egress_ip: string | null;
  last_egress_org: string | null;
  last_egress_country: string | null;
  last_collect_at: Date | null;
  envoi_pause_jusqua: Date | null;
}

export async function lireSessionLinkedIn(ctx: Contexte): Promise<SessionLinkedIn | null> {
  const res = await ctx.ex.query<LigneSession>(
    `select status, blocked_reason, connected_at, blocked_at, expected_egress_ip,
            last_egress_ip, last_egress_org, last_egress_country, last_collect_at,
            envoi_pause_jusqua
       from linkedin_server_sessions /* jr:linkedin_session_lire */
      where organization_id = $1`,
    [ctx.organisationId],
  );
  const l = res.rows[0];
  if (!l) return null;
  return {
    etat: l.status,
    motif: l.blocked_reason,
    connecteeLe: l.connected_at,
    bloqueeLe: l.blocked_at,
    ipAttendue: l.expected_egress_ip,
    ipVue: l.last_egress_ip,
    operateur: l.last_egress_org,
    pays: l.last_egress_country,
    derniereCollecte: l.last_collect_at,
    envoiPauseJusqua: l.envoi_pause_jusqua,
  };
}

/** Marque la session active et efface tout blocage antérieur. `ip` est l'IP de sortie attendue. */
export async function activerSessionLinkedIn(ctx: Contexte, ip: string): Promise<void> {
  await ctx.ex.query(
    `insert into linkedin_server_sessions (organization_id, status, connected_at, expected_egress_ip) /* jr:linkedin_session_activer */
     values ($1, 'active', now(), $2)
     on conflict (organization_id) do update
        set status = 'active', connected_at = now(), expected_egress_ip = $2,
            blocked_at = null, blocked_reason = null`,
    [ctx.organisationId, ip],
  );
}

const TITRE_BLOCAGE = 'Session LinkedIn bloquée';
/** `revoquee` est absent : c'est l'opérateur qui l'a voulue, l'alerter serait crier au loup. */
const CORPS_BLOCAGE: Record<Exclude<MotifBlocage, 'revoquee'>, string> = {
  defi: 'LinkedIn demande une vérification : la collecte est suspendue jusqu’à ce que vous reconnectiez la session.',
  cookie_refuse: 'LinkedIn a refusé la session enregistrée : reconnectez le compte pour reprendre la collecte.',
  sortie_inattendue: 'Le navigateur est sorti par une adresse inattendue : la collecte est suspendue par précaution.',
  disjoncteur: 'Trop d’échecs d’affilée : la collecte est suspendue par précaution.',
};

/**
 * Bloque la session et prévient les membres, une seule fois par blocage : si
 * elle l'est déjà, rien n'est réécrit et personne n'est renotifié.
 *
 * Pas de paramètre de détail : une erreur de navigateur ou de proxy peut porter
 * une URL avec identifiants. Le motif est typé, l'IP vue vit dans `last_egress_ip`.
 */
export async function bloquerSessionLinkedIn(ctx: Contexte, motif: MotifBlocage): Promise<void> {
  // Une seule transaction : si la notification échoue, le blocage est annulé et
  // le rappel suivant retrouvera la session non bloquée, donc renotifiera.
  await dansUneTransaction(ctx.ex, async (tx) => {
    const res = await tx.query(
      `insert into linkedin_server_sessions (organization_id, status, blocked_at, blocked_reason) /* jr:linkedin_session_bloquer */
       values ($1, 'bloquee', now(), $2)
       on conflict (organization_id) do update
          set status = 'bloquee', blocked_at = now(), blocked_reason = $2
        where linkedin_server_sessions.status <> 'bloquee'`,
      [ctx.organisationId, motif],
    );
    if (!res.rowCount || motif === 'revoquee') return;
    await notifier(tx, ctx.organisationId, 'linkedin.session_blocked', TITRE_BLOCAGE, CORPS_BLOCAGE[motif]);
  });
}

/**
 * Prend le verrou en une seule instruction : libre (jamais pris), expiré, ou
 * déjà au même propriétaire (renouvellement, reprise après redémarrage).
 * Rend false si un autre propriétaire le détient encore, ou si la session
 * n'existe pas.
 */
export async function prendreVerrouLinkedIn(ctx: Contexte, proprietaire: string, dureeMs: number): Promise<boolean> {
  const res = await ctx.ex.query(
    `update linkedin_server_sessions /* jr:linkedin_session_verrou */
        set lock_owner = $2, lock_until = now() + ($3::int * interval '1 millisecond')
      where organization_id = $1 and (lock_until is null or lock_until < now() or lock_owner = $2)`,
    [ctx.organisationId, proprietaire, Math.trunc(dureeMs)],
  );
  return (res.rowCount ?? 0) > 0;
}

/**
 * Consigne la dernière sortie observée du navigateur (IP, opérateur, pays).
 * N'écrit ni l'IP attendue ni l'état : c'est de l'observation, pas une décision.
 * Crée la ligne si elle manque (statut `absente` par défaut) pour que l'écran
 * ait quelque chose à afficher dès la première relève.
 */
export async function enregistrerObservationSortie(ctx: Contexte, sortie: Sortie): Promise<void> {
  await ctx.ex.query(
    `insert into linkedin_server_sessions (organization_id, last_egress_ip, last_egress_org, last_egress_country) /* jr:linkedin_session_observer */
     values ($1, $2, $3, $4)
     on conflict (organization_id) do update
        set last_egress_ip = $2, last_egress_org = $3, last_egress_country = $4`,
    [ctx.organisationId, sortie.ip, sortie.operateur ?? null, sortie.pays ?? null],
  );
}

/**
 * Horodate la dernière collecte TERMINÉE. Seul écrivain de `last_collect_at`,
 * que l'écran et `jay-reach linkedin statut` affichent : un passage qui s'arrête
 * sur une friction ne la met pas à jour, sinon la phrase « dernière collecte »
 * annoncerait une collecte qui n'a rien rapporté.
 *
 * N'écrit que sur une ligne existante : la session a forcément été ouverte pour
 * qu'une collecte ait lieu.
 */
export async function marquerCollecteLinkedIn(ctx: Contexte): Promise<void> {
  await ctx.ex.query(
    `update linkedin_server_sessions /* jr:linkedin_collecte_marquer */
        set last_collect_at = now()
      where organization_id = $1`,
    [ctx.organisationId],
  );
}

/**
 * L'opérateur confirme la sortie observée comme la bonne (changement de proxy
 * voulu). Remplace l'IP attendue ; si la session n'était bloquée que pour une
 * sortie inattendue, ce blocage tombe avec : sa cause est levée. Les autres
 * motifs (défi, cookie refusé…) restent, ils n'ont rien à voir avec l'IP.
 * Rend false si la session n'existe pas.
 */
export async function confirmerIpAttendue(ctx: Contexte, ip: string): Promise<boolean> {
  const res = await ctx.ex.query(
    `update linkedin_server_sessions /* jr:linkedin_session_confirmer_ip */
        set expected_egress_ip = $2,
            status = case when status = 'bloquee' and blocked_reason = 'sortie_inattendue' then 'active' else status end,
            blocked_at = case when status = 'bloquee' and blocked_reason = 'sortie_inattendue' then null else blocked_at end,
            blocked_reason = case when status = 'bloquee' and blocked_reason = 'sortie_inattendue' then null else blocked_reason end
      where organization_id = $1`,
    [ctx.organisationId, ip],
  );
  return (res.rowCount ?? 0) > 0;
}

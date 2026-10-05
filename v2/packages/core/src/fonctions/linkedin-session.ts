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
}

export async function lireSessionLinkedIn(ctx: Contexte): Promise<SessionLinkedIn | null> {
  const res = await ctx.ex.query<LigneSession>(
    `select status, blocked_reason, connected_at, blocked_at, expected_egress_ip,
            last_egress_ip, last_egress_org, last_egress_country, last_collect_at
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
const CORPS_BLOCAGE: Record<MotifBlocage, string> = {
  defi: 'LinkedIn demande une vérification : la collecte est suspendue jusqu’à ce que vous reconnectiez la session.',
  cookie_refuse: 'LinkedIn a refusé la session enregistrée : reconnectez le compte pour reprendre la collecte.',
  sortie_inattendue: 'Le navigateur est sorti par une adresse inattendue : la collecte est suspendue par précaution.',
  disjoncteur: 'Trop d’échecs d’affilée : la collecte est suspendue par précaution.',
  revoquee: 'La session a été révoquée : reconnectez le compte pour reprendre la collecte.',
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
    if (!res.rowCount) return;
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

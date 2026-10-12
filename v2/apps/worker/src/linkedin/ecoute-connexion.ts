/**
 * L'écoute du canal chiffré de connexion LinkedIn (lot 5, spec §5).
 *
 * Connexion DÉDIÉE (un `pg.Client`, jamais une connexion du pool de travail : le pool de
 * sessions Supabase est partagé et limité à 15, on n'en prend qu'une). `LISTEN` n'existe
 * qu'en mode session, port 5432 : sur 6543 (mode transaction) le canal se tait sans lever
 * la moindre erreur. Le port est donc IMPOSÉ ici, jamais hérité de l'URL reçue.
 *
 * Aucune charge, même tronquée, n'entre dans un journal : une erreur se journalise par son
 * type seulement.
 */
import { CANAL_CONNEXION_LINKEDIN, lireMessageConnexion, type MessageConnexion } from '@jay-reach/core';
import pg from 'pg';

const PORT_MODE_SESSION = '5432';
const ATTENTE_MIN_MS = 1_000;
const ATTENTE_MAX_MS = 30_000;

/** Même URL, port forcé en mode session. */
export function urlModeSession(url: string): string {
  const u = new URL(url);
  u.port = PORT_MODE_SESSION;
  return u.toString();
}

function nomErreur(e: unknown): string {
  return e instanceof Error ? e.name : 'erreur';
}

/**
 * Écoute le canal et passe chaque message déchiffré à `surMessage`. Se réabonne seule
 * (attente croissante) si la connexion tombe. Rend la fonction qui arrête l'écoute.
 */
export async function ecouterCanalConnexion(
  pool: pg.Pool,
  surMessage: (m: MessageConnexion) => Promise<void>,
): Promise<() => void> {
  const url = pool.options.connectionString;
  if (!url) throw new Error('ecoute_connexion: le pool n\'expose pas de chaîne de connexion');
  const cs = urlModeSession(url);

  let arrete = false;
  let client: pg.Client | null = null;
  let attente = ATTENTE_MIN_MS;
  let minuteur: NodeJS.Timeout | null = null;

  const replanifier = (): void => {
    if (arrete || minuteur) return;
    minuteur = setTimeout(() => {
      minuteur = null;
      void ouvrir();
    }, attente);
    attente = Math.min(attente * 2, ATTENTE_MAX_MS);
  };

  const ouvrir = async (): Promise<void> => {
    if (arrete) return;
    const c = new pg.Client({ connectionString: cs });
    c.on('notification', (n) => {
      if (n.channel !== CANAL_CONNEXION_LINKEDIN || n.payload === undefined) return;
      lireMessageConnexion(n.payload)
        .then(surMessage)
        .catch((e: unknown) => console.error(`[ecoute-connexion] message abandonné (${nomErreur(e)})`));
    });
    // `error` et `end` peuvent se suivre : replanifier est idempotent.
    c.on('error', (e) => {
      console.error(`[ecoute-connexion] connexion perdue (${nomErreur(e)})`);
      c.removeAllListeners();
      c.end().catch(() => {});
      client = null;
      replanifier();
    });
    c.on('end', () => {
      if (client === c) client = null;
      replanifier();
    });
    try {
      await c.connect();
      await c.query(`LISTEN ${CANAL_CONNEXION_LINKEDIN}`);
      client = c;
      attente = ATTENTE_MIN_MS;
    } catch (e) {
      console.error(`[ecoute-connexion] abonnement impossible (${nomErreur(e)})`);
      c.removeAllListeners();
      c.end().catch(() => {});
      replanifier();
    }
  };

  await ouvrir();

  return () => {
    arrete = true;
    if (minuteur) clearTimeout(minuteur);
    const c = client;
    client = null;
    if (c) {
      c.removeAllListeners();
      c.end().catch(() => {});
    }
  };
}

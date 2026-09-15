/**
 * Transaction sur un CLIENT LOUÉ, jamais sur le pool partagé (R47, tour de
 * correction 1 de la tâche 12).
 *
 * `ctx.ex` reçu par les fonctions métier est le `pg.Pool` partagé
 * (`apps/web/lib/contexte.ts`) : chaque `pool.query(...)` peut être servi par
 * une connexion DIFFÉRENTE (le pool en a plusieurs, 4 ici). Enchaîner
 * `pool.query('begin')`, `pool.query(insert)`, `pool.query('commit')` n'offre
 * donc aucune garantie d'atomicité, et un `begin` qui atterrit sur une
 * connexion jamais suivie d'un `commit`/`rollback` sur CETTE MÊME connexion la
 * laisse « idle in transaction » — un pool à 4 connexions se bloque vite.
 *
 * `dansUneTransaction` loue un client dédié (`pool.connect()`) le temps de la
 * fonction `fn`, qui reçoit ce client comme `Executeur` — toutes ses requêtes
 * partent donc sur la même connexion. Patron déjà utilisé ailleurs dans ce
 * dépôt : `apps/web/app/actions/customers.ts` (import CSV), `apps/web/lib/linkedin/queue.ts`
 * (`claimNext`).
 *
 * `ex` peut aussi être un `Executeur` qui n'expose pas `connect()` — un client
 * déjà loué par un appelant, ou un faux de test. Dans ce cas `fn(ex)` s'exécute
 * directement, SANS ouvrir de transaction : une fonction qui reçoit déjà un
 * client ne doit jamais en ouvrir une seconde (transaction imbriquée), et un
 * test qui fournit un `Executeur` minimal continue de fonctionner sans avoir à
 * simuler `connect()`.
 */
import type { Executeur } from './executeur.js';

/** Client loué : un `Executeur` qui sait aussi se rendre au pool. */
export interface ClientLoue extends Executeur {
  release(): void;
}

/** Ce qu'un `pg.Pool` (ou tout exécuteur capable d'en louer un) expose en plus d'`Executeur`. */
export interface ExecuteurConnectable extends Executeur {
  connect(): Promise<ClientLoue>;
}

function estConnectable(ex: Executeur): ex is ExecuteurConnectable {
  return typeof (ex as Partial<ExecuteurConnectable>).connect === 'function';
}

export async function dansUneTransaction<T>(ex: Executeur, fn: (tx: Executeur) => Promise<T>): Promise<T> {
  if (!estConnectable(ex)) {
    return fn(ex);
  }

  const client = await ex.connect();
  try {
    await client.query('begin');
    const resultat = await fn(client);
    await client.query('commit');
    return resultat;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

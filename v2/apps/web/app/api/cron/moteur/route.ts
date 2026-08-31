/**
 * Un tour de moteur, déclenché par la planification Vercel.
 *
 * Le worker est un process permanent : pg-boss écoute ses files et trois
 * boucles produisent le travail. Vercel n'héberge que des fonctions éphémères,
 * alors cette route fait le même tour en un passage — produire, relever les
 * demandes manuelles, avancer les séquences, puis traiter un lot de jobs.
 *
 * Les traitements ne sont pas réécrits : ils viennent de `@jay-reach/worker`,
 * qui les partage avec le mode permanent. Deux implémentations auraient fini
 * par diverger, et cette divergence-là se paierait par des envois qui partent
 * d'un côté et pas de l'autre.
 *
 * Idempotent par construction : les jobs portent un identifiant déterministe
 * dérivé d'une fenêtre temporelle, donc deux invocations rapprochées ne créent
 * pas deux fois le même travail.
 */
import { createRuntime, registerQueues } from '@jay-reach/worker/runtime';
import { createPool } from '@jay-reach/worker/db';
import {
  produire,
  releverDemandes,
  produireTick,
  consommerLesFiles,
  type Contexte,
} from '@jay-reach/worker/traitements';
import { verifierCron } from '../../../../lib/cron/garde';
import { requireEnv } from '../../../../lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Plafond d'exécution. Le budget interne s'arrête avant, pour rendre les jobs
 * en cours proprement plutôt que de se faire couper au milieu.
 */
export const maxDuration = 60;

const BUDGET_MS = 45_000;

export async function GET(req: Request): Promise<Response> {
  const garde = verifierCron(req);
  if (!garde.autorise) {
    return garde.reponse;
  }

  const debut = Date.now();
  const boss = createRuntime(requireEnv('DATABASE_URL'), { ephemere: true });
  const pool = createPool(requireEnv('DATABASE_URL'));
  const ctx: Contexte = { boss, pool, encryptionKey: process.env.ENCRYPTION_KEY };

  try {
    await boss.start();
    await registerQueues(boss);

    // L'ordre compte : on produit avant de consommer, pour que le travail créé
    // pendant ce tour parte dès maintenant plutôt qu'au tour suivant.
    await produire(ctx);
    await releverDemandes(ctx);
    await produireTick(ctx);

    const bilan = await consommerLesFiles(ctx, { parFile: 5, budgetMs: BUDGET_MS });
    const dureeMs = Date.now() - debut;
    console.log(`[cron] ${bilan.traites} job(s) traité(s), ${bilan.echecs} échec(s) en ${dureeMs} ms`);
    return Response.json({ ok: true, ...bilan, dureeMs });
  } catch (err) {
    console.error('[cron] échec du tour', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  } finally {
    // Sans arrêt explicite, les connexions restent ouvertes jusqu'au recyclage
    // de l'instance : le pooler Postgres se remplit en quelques minutes.
    await boss.stop({ graceful: false }).catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

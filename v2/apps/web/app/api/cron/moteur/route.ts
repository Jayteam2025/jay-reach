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

/**
 * Temps qu'une collecte a le droit de prendre.
 *
 * France Travail interroge ses mots-clés un par un — quinze appels d'environ
 * cinq secondes. En série, elle dépassait les soixante secondes de la fonction,
 * qui la tuait au milieu : la collecte entière était perdue, et son exécution
 * restait ouverte. Bornée, elle rend ce qu'elle a trouvé et reprend les
 * mots-clés suivants au tour d'après.
 *
 * Plus court que le budget global : la collecte n'est qu'une partie du tour, et
 * il faut garder de quoi enregistrer ses signaux et refermer proprement.
 */
const BUDGET_COLLECTE_MS = 25_000;

export async function GET(req: Request): Promise<Response> {
  const garde = verifierCron(req);
  if (!garde.autorise) {
    return garde.reponse;
  }

  const debut = Date.now();
  const boss = createRuntime(requireEnv('DATABASE_URL'), { ephemere: true });
  const pool = createPool(requireEnv('DATABASE_URL'));
  const ctx: Contexte = {
    boss,
    pool,
    encryptionKey: process.env.ENCRYPTION_KEY,
    budgetCollecteMs: BUDGET_COLLECTE_MS,
  };

  try {
    await boss.start();
    await registerQueues(boss);

    // Reprendre le travail que le tour précédent n'a pas pu finir.
    //
    // Une fonction éphémère se fait couper à soixante secondes, en plein job.
    // pg-boss laisse alors la ligne en `active` et compte sur sa boucle de
    // supervision pour la remettre en file — boucle que le mode éphémère
    // désactive (`supervise: false`), puisqu'elle ne survivrait pas à
    // l'invocation. Résultat : un job tué ne revenait jamais.
    //
    // Mesuré sur la base le 01/09/2026 : 124 jobs bloqués, dont 99 de scoring
    // et 13 d'enrichissement — le plus ancien depuis vingt et une heures. Le
    // scoring en perdait presque un sur deux, et chaque enrichissement perdu
    // avait déjà été facturé par FullEnrich.
    //
    // `maintain()` fait ce que la supervision aurait fait : rendre à la file
    // les jobs dont le délai d'exécution est dépassé, puis archiver. Trois
    // requêtes, négligeables devant le budget du tour.
    await boss.maintain();

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

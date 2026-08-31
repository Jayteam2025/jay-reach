/**
 * Garde des routes déclenchées par Vercel Cron.
 *
 * Ces routes font tourner tout le moteur — collecte, scoring, enrichissement,
 * envoi. Sans garde, n'importe qui pourrait les appeler en boucle et vider les
 * crédits des providers : le coût n'est pas le nôtre, il est chez FullEnrich et
 * Anthropic, et il se compte en euros par appel.
 *
 * Vercel envoie `Authorization: Bearer $CRON_SECRET` sur les invocations
 * planifiées. La comparaison se fait en temps constant : une comparaison
 * ordinaire s'arrête au premier caractère qui diffère, ce qui laisse mesurer le
 * secret caractère par caractère.
 */
import { timingSafeEqual } from 'node:crypto';

export type ResultatGarde = { readonly autorise: true } | { readonly autorise: false; readonly reponse: Response };

function egalConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function verifierCron(req: Request): ResultatGarde {
  const attendu = process.env.CRON_SECRET;
  if (!attendu) {
    // Refuser plutôt que de laisser passer : une route de moteur ouverte au
    // monde est pire qu'une planification qui ne tourne pas, et l'absence de
    // secret se voit dans le journal dès la première exécution.
    return {
      autorise: false,
      reponse: Response.json({ error: 'CRON_SECRET non configuré' }, { status: 503 }),
    };
  }
  const entete = req.headers.get('authorization') ?? '';
  const jeton = entete.startsWith('Bearer ') ? entete.slice(7) : '';
  if (!jeton || !egalConstant(jeton, attendu)) {
    return { autorise: false, reponse: Response.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { autorise: true };
}

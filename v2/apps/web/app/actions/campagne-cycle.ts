'use server';

/**
 * Façade fine sur `lancer`/`mettreEnPause` (packages/core/src/fonctions/campagnes.ts)
 * pour `BoutonLancerPause` — un fichier séparé de `actions/campaigns.ts` (qui
 * ne dérive plus que `setCampaignStatus`, hérité de l'ancien écran) plutôt
 * qu'un ajout à ce dernier, pour ne pas mélanger les deux générations
 * d'écrans pendant la migration (tâche 9, lot 2).
 */
import { revalidatePath } from 'next/cache';
import { lancer, mettreEnPause, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { revaliderCoquille, revaliderLayoutCampagne } from '../../lib/revalidation-layouts';

export type ResultatCycleCampagne = { ok: true } | { ok: false; manques: string[] };

/** Jamais d'exception non attrapée hors d'une Server Action (même garantie que `resultatDErreur`, `actions/campagns.ts`). */
function messageDErreur(err: unknown): string {
  if (err instanceof ForbiddenError) return 'Droit insuffisant pour cette action.';
  if (err instanceof ErreurIntrouvable) return err.message;
  return err instanceof Error ? err.message : 'Erreur inconnue.';
}

export async function actionLancer(campagneId: string): Promise<ResultatCycleCampagne> {
  try {
    const ctx = await contexteCourant();
    const resultat = await lancer(ctx, { campagneId });
    if (resultat.ok) {
      revalidatePath(`/campaigns/${campagneId}`);
      revalidatePath('/campaigns');
      revaliderLayoutCampagne(campagneId);
      revaliderCoquille();
    }
    return resultat;
  } catch (err) {
    return { ok: false, manques: [messageDErreur(err)] };
  }
}

export async function actionMettreEnPause(campagneId: string): Promise<ResultatCycleCampagne> {
  try {
    const ctx = await contexteCourant();
    await mettreEnPause(ctx, { campagneId });
    revalidatePath(`/campaigns/${campagneId}`);
    revalidatePath('/campaigns');
    revaliderLayoutCampagne(campagneId);
    revaliderCoquille();
    return { ok: true };
  } catch (err) {
    return { ok: false, manques: [messageDErreur(err)] };
  }
}

'use server';

import { revalidatePath } from 'next/cache';

import { ajouterDepuisAnnuaire, sirensConnus, ErreurEntree, ErreurIntrouvable, ForbiddenError } from '@jay-reach/core';
import { contexteCourant } from '../../lib/contexte';
import { searchCompanies, type DirectoryParams, type DirectoryResult } from '../../lib/directory';

// ---------------------------------------------------------------------------
// Source « Annuaire d'entreprises » de l'onglet Sources d'une campagne
// (tâche 11, lot 2). Façade fine sur `ajouterDepuisAnnuaire`
// (`packages/core/src/fonctions/sources.ts`) : la recherche reste celle
// ci-dessous (`searchCompanies`, `apps/web/lib/directory.ts`, une API publique
// sans état) — cette action ne fait que PERSISTER les entreprises déjà
// cochées à l'écran. R41 : verse des entreprises dans `accounts`, jamais de
// contact. R42 (tour de correction 1) : aucun lien entreprise ↔ campagne
// n'est modélisé — voir le commentaire de `ajouterDepuisAnnuaire` (core).
// ---------------------------------------------------------------------------

export interface RechercheAnnuaireResultat extends DirectoryResult {
  /** SIREN du résultat déjà présents dans `accounts` de l'organisation (R42 : annotation avant ajout). */
  readonly sirensConnus: string[];
}

/**
 * Recherche dans l'annuaire depuis le tiroir de la source (composant client),
 * en Server Action plutôt qu'un appel direct de `searchCompanies` depuis le
 * navigateur : une fonction serveur reste la façon sûre d'appeler une API
 * externe sans dépendre du CORS de `recherche-entreprises.api.gouv.fr`.
 * Croise aussi les résultats avec `accounts` (`sirensConnus`, core) pour que
 * l'écran puisse dire, avant même l'ajout, lesquels sont déjà dans la base.
 */
export async function actionRechercherAnnuaire(params: DirectoryParams): Promise<RechercheAnnuaireResultat> {
  const resultat = await searchCompanies(params);
  if (resultat.results.length === 0) {
    return { ...resultat, sirensConnus: [] };
  }
  const ctx = await contexteCourant();
  const connus = await sirensConnus(ctx, { sirens: resultat.results.map((c) => c.siren) });
  return { ...resultat, sirensConnus: connus };
}

export interface EntrepriseAnnuaireInput {
  readonly siren: string;
  readonly name: string;
  readonly naf: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
}

export type ResultatAjouterDepuisAnnuaire =
  | { ok: true; entreprisesRetenues: number; dejaConnues: number }
  | { ok: false; error: string; issues?: string[] };

export async function actionAjouterDepuisAnnuaire(
  campagneId: string,
  entreprises: EntrepriseAnnuaireInput[],
): Promise<ResultatAjouterDepuisAnnuaire> {
  try {
    const ctx = await contexteCourant();
    const r = await ajouterDepuisAnnuaire(ctx, { campagneId, entreprises });
    revalidatePath(`/campaigns/${campagneId}/sources`);
    revalidatePath(`/campaigns/${campagneId}`);
    return { ok: true, ...r };
  } catch (err) {
    if (err instanceof ForbiddenError) return { ok: false, error: 'Droit opérateur requis.' };
    if (err instanceof ErreurEntree) {
      const details = err.details as {
        formErrors?: string[];
        fieldErrors?: Record<string, string[] | undefined>;
      };
      const issues = [
        ...(details.formErrors ?? []),
        ...Object.values(details.fieldErrors ?? {}).flat(),
      ].filter((m): m is string => typeof m === 'string');
      return {
        ok: false,
        error: 'Entrée invalide.',
        issues: issues.length > 0 ? issues : undefined,
      };
    }
    if (err instanceof ErreurIntrouvable) return { ok: false, error: err.message };
    return { ok: false, error: err instanceof Error ? err.message : 'Erreur inconnue.' };
  }
}

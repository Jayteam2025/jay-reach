import { test, expect } from '@playwright/test';

/**
 * Parcours « contacts » (F4, tour de correction du 17/09) : la page Contacts
 * globale (`/contacts`, onglet « Tous » par défaut) tombait en erreur serveur
 * (« Application error: a server-side exception has occurred », digest
 * 3452353769) dès qu'elle affichait au moins deux lignes — un tri en mémoire
 * appelait `.localeCompare()` sur un horodatage `pg` (objet `Date`, pas une
 * chaîne — voir `packages/core/src/temps.ts`). Ce parcours ne rejoue pas ce
 * scénario précis (il dépend des données réelles de l'organisation
 * « Recette e2e ») : il garantit seulement que la page s'affiche sans
 * exception serveur, quel que soit le nombre de lignes.
 */
test('/contacts s’affiche sans erreur serveur, avec un tableau ou l’état vide', async ({ page }) => {
  await page.goto('/contacts');

  await expect(page.getByRole('heading', { name: 'Contacts', exact: true })).toBeVisible();
  await expect(page.getByText('Application error', { exact: false })).toHaveCount(0);

  const tableau = page.getByRole('table');
  const etatVide = page.getByText('Aucun contact pour ce filtre.');
  await expect(tableau.or(etatVide)).toBeVisible();
});

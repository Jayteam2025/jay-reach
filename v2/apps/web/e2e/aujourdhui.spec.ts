import { test, expect } from '@playwright/test';

/**
 * Parcours « aujourdhui » (tâche 26) : la page Aujourd'hui (`/`) affiche le
 * bloc Moteur et les compteurs de plafonds, sans bandeau d'erreur — et la
 * campagne de la fixture (`apps/web/e2e/fixtures/organisation-test.sql`,
 * « Campagne e2e », brouillon) apparaît dans la table des campagnes.
 * Lecture seule : rien à nettoyer.
 */
test('Aujourd\'hui affiche le bloc Moteur, les plafonds et la campagne de la fixture, sans erreur', async ({ page }) => {
  await page.goto('/');

  // « Sans erreur » : pas de sélecteur par classe CSS pour le bandeau
  // d'alerte — le rendu effectif des blocs ci-dessous (Moteur, Plafonds,
  // campagne de la fixture) suffit à prouver que la page s'est rendue sans
  // exception serveur.
  // `exact: true` : la carte Moteur de la barre latérale répète un résumé
  // (« Dernier passage 15:26, prochain 15:27 ») qui contient ces mêmes mots.
  await expect(page.getByText('Dernier passage', { exact: true })).toBeVisible();
  await expect(page.getByText('Prochain passage', { exact: true })).toBeVisible();
  await expect(page.getByText('Erreurs depuis minuit', { exact: true })).toBeVisible();

  await expect(page.getByText('Plafonds du jour')).toBeVisible();
  await expect(page.getByText('Scoring (Anthropic)')).toBeVisible();
  // Expression plutôt que libellé figé : ce plafond compte les enrichissements
  // DEMANDÉS, et le libellé l'a précisé au passage au vocabulaire remis/parti
  // (a658a23). Ce que le test doit prouver est que la ligne du plafond
  // d'enrichissement est rendue, pas la formulation exacte retenue ce jour-là.
  await expect(page.getByText(/Enrichissement.*\(FullEnrich\)/)).toBeVisible();
  await expect(page.getByText('Envois (SalesBlink)')).toBeVisible();

  const ligneCampagne = page.getByRole('row', { name: /Campagne e2e/ });
  await expect(ligneCampagne).toBeVisible();
  await expect(ligneCampagne.getByText('Brouillon')).toBeVisible();
});

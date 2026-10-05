import { test, expect } from '@playwright/test';

// Suffixe unique par exécution : sans ça, deux lancements successifs (aucune
// suppression de campagne possible, seulement l'archivage) laissent plusieurs
// lignes « Campagne assistant e2e » dans /campaigns et cassent le
// `getByRole('row', …)` ci-dessous (violation du mode strict, constaté en
// pratique lors du temps 2 de cette tâche).
const NOM_CAMPAGNE = `Campagne assistant e2e ${Date.now()}`;

/**
 * Parcours « creer-campagne » (tâche 26) : assistant de création (tâche 14)
 * jusqu'à « Enregistrer en brouillon », avec une source et une séquence
 * minimales (le modèle par défaut de l'étape Séquence est déjà valide, non
 * modifié ici). La campagne apparaît dans la liste ; nettoyage par archivage
 * (aucune fonction de suppression de campagne n'existe côté `packages/core`).
 */
test('Assistant Nouvelle campagne : brouillon avec une source, puis archivage', async ({ page }) => {
  await page.goto('/campaigns/new');

  // Étape 1 — Qui
  await page.getByLabel('Nom de la campagne').fill(NOM_CAMPAGNE);
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 2 — Sources : une source Adzuna minimale.
  await page.getByRole('button', { name: '+ Ajouter une source' }).click();
  await page.getByRole('button', { name: /^Adzuna/ }).click();
  await page.getByLabel('Nom de la source').fill('Offres e2e (assistant)');
  await page.getByLabel('Mots-clés').fill('directeur commercial');
  await page.getByRole('button', { name: 'Ajouter', exact: true }).click();
  await expect(page.getByText('Offres e2e (assistant)')).toBeVisible();
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 3 — Séquence : modèle par défaut non modifié (déjà valide).
  await page.getByRole('button', { name: 'Continuer' }).click();

  // Étape 4 — Envoi : brouillon (jamais « Créer et lancer », aucune boîte n'existe pour la fixture).
  await page.getByRole('button', { name: 'Enregistrer en brouillon' }).click();

  await page.waitForURL(/\/campaigns\/[0-9a-f-]{36}$/);
  const idCampagne = page.url().split('/campaigns/')[1]!;
  await expect(page.getByText(NOM_CAMPAGNE)).toBeVisible();

  await page.goto('/campaigns');
  await expect(page.getByRole('row', { name: NOM_CAMPAGNE })).toBeVisible();

  // Nettoyage : archivage (pas de suppression de campagne côté application).
  // `confirmerArchivage` redirige vers /campaigns au succès — cette
  // redirection EST la preuve que l'archivage a réussi (un échec laisserait
  // la page Réglages affichée, avec un bandeau d'erreur).
  await page.goto(`/campaigns/${idCampagne}/settings`);
  await page.getByRole('button', { name: 'Archiver la campagne' }).click();
  await page.getByRole('button', { name: "Confirmer l'archivage" }).click();
  await page.waitForURL('/campaigns');
});

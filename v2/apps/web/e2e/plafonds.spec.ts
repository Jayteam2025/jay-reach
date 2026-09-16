import { test, expect } from '@playwright/test';

/**
 * Parcours « plafonds » (tâche 26) : Réglages › Plafonds — modifier
 * « Enrichissements par jour », enregistrer, recharger, retrouver la valeur ;
 * remise à la valeur d'origine en fin de test (l'écran édite un réglage
 * partagé de l'organisation, pas une ressource créée par le test).
 */
test('Réglages › Plafonds : modifier « Enrichissements par jour » persiste après rechargement, puis remise en état', async ({ page }) => {
  await page.goto('/settings/limits');

  const ligne = page.getByRole('row', { name: 'Enrichissements par jour' });
  await expect(ligne).toBeVisible();

  await ligne.getByRole('button', { name: 'Modifier' }).click();
  const champValeur = ligne.getByRole('textbox');
  const valeurOrigine = await champValeur.inputValue();
  const nouvelleValeur = String(Number(valeurOrigine) + 5);

  await champValeur.fill(nouvelleValeur);
  await ligne.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(ligne.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(ligne).toContainText(nouvelleValeur);

  await page.reload();
  const ligneApresRechargement = page.getByRole('row', { name: 'Enrichissements par jour' });
  await expect(ligneApresRechargement).toContainText(nouvelleValeur);

  // Remise à la valeur d'origine.
  await ligneApresRechargement.getByRole('button', { name: 'Modifier' }).click();
  await ligneApresRechargement.getByRole('textbox').fill(valeurOrigine);
  await ligneApresRechargement.getByRole('button', { name: 'Enregistrer' }).click();
  await expect(ligneApresRechargement.getByRole('button', { name: 'Modifier' })).toBeVisible();
  await expect(ligneApresRechargement).toContainText(valeurOrigine);
});

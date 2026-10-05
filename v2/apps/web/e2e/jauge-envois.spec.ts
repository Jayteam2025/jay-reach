import { test, expect } from '@playwright/test';

/**
 * La jauge d'envois du menu, bout en bout, sur l'organisation de test — qui n'a AUCUNE boîte
 * d'envoi (sa fixture le dit : « aucune clé de fournisseur, aucune boîte d'envoi »). Son plafond
 * vaut donc zéro, et zéro veut dire pause dans ce produit (`placesRestantes`,
 * `packages/core/src/plafonds.ts`), jamais « illimité ».
 *
 * Pourquoi ce parcours. Constat de recette du 05/10 : les trois écrans qui montrent ces jauges
 * ne disaient pas la même chose — Réglages › Plafonds annonçait « plafond à 0 (en pause) » là où
 * l'accueil et la fiche de campagne affichaient « 0 / 0 ». Les tests unitaires couvrent chaque
 * morceau ; celui-ci vérifie que la chaîne entière (base sans boîte -> `lirePlafondEnvois` ->
 * `lireResumeCoquille` -> `CarteEnvois` -> gabarit ICU) aboutit au bon mot à l'écran.
 *
 * Lecture seule : rien à nettoyer.
 */
test('la jauge d’envois dit « en pause » quand aucune boîte n’est réglée, et jamais « / 0 »', async ({ page }) => {
  await page.goto('/');

  // La carte du menu : le coin droit porte l'état du plafond.
  const carteEnvois = page.locator('.jr-barre-pied .jr-carte').filter({ hasText: 'Envois du jour' });
  await expect(carteEnvois).toBeVisible();
  await expect(carteEnvois.locator('.jr-plafond')).toHaveText('en pause');

  // Le même mot sur la carte des plafonds de l'accueil, pour les trois lignes : avant le
  // correctif, cet écran composait « 0 / 0 » à la main.
  const plafondsAccueil = page.locator('.jr-carte').filter({ hasText: 'Plafonds du jour' });
  await expect(plafondsAccueil).toContainText('en pause');
  await expect(plafondsAccueil).not.toContainText('/ 0');

  // Et sur Réglages › Plafonds, qui le disait déjà : les deux écrans s'accordent.
  await page.goto('/settings/limits');
  await expect(page.getByText('plafond à 0 (en pause)').first()).toBeVisible();
});

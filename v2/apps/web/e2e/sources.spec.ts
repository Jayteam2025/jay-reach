import { test, expect } from '@playwright/test';
import { ID_CAMPAGNE_FIXTURE } from './fixtures/ids';

// Suffixe unique par exécution : la campagne de la fixture accumule les
// sources d'un lancement à l'autre (aucune suppression possible, seulement
// la mise en pause) — un nom fixe finit par matcher plusieurs cartes.
const NOM_SOURCE = `Offres commerciales e2e ${Date.now()}`;

/**
 * Parcours « sources » (tâche 26) : onglet Sources de la campagne brouillon
 * de la fixture — ajout d'une source Adzuna, sauvegarde, la source apparaît.
 * Jamais de lancement (« Lancer un passage » n'est de toute façon accessible
 * qu'en modification d'une source déjà créée, jamais à la création).
 *
 * Nettoyage : aucune fonction de suppression de source n'existe côté
 * `packages/core` (seules `creerSource`/`modifierSource`/`activerSource`) —
 * on met donc la source en pause via son interrupteur, geste normal de
 * l'écran, au lieu de la retirer.
 */
test('Sources : ajout d\'une source Adzuna à la campagne de la fixture, sans lancement', async ({ page }) => {
  await page.goto(`/campaigns/${ID_CAMPAGNE_FIXTURE}/sources`);

  await page.getByRole('button', { name: '+ Ajouter une source' }).click();
  await page.getByRole('button', { name: /^Adzuna/ }).click();

  await expect(page.getByRole('heading', { name: /Adzuna/ })).toBeVisible();
  await page.getByLabel('Nom de la source').fill(NOM_SOURCE);
  await page.getByLabel('Intitulés recherchés').fill('directeur commercial');

  await page.getByRole('button', { name: 'Créer la source' }).click();

  // La carte d'une source n'a pas de titre sémantique (`<b>`, pas un heading).
  await expect(page.getByText(NOM_SOURCE)).toBeVisible();

  // Nettoyage : pause de la source (pas de suppression possible depuis l'écran).
  // `.last()` : l'interrupteur de chaque carte source partage le même libellé
  // générique (pas de nom de source dedans) ; `listerSourcesCampagne` trie par
  // `created_at asc`, la source qu'on vient de créer est donc toujours la
  // dernière de la page.
  await page.getByRole('switch', { name: 'Activer ou mettre en pause la source' }).last().click();
  await expect(page.getByText('En pause').last()).toBeVisible();
});

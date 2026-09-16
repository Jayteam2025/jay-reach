import { test, expect } from '@playwright/test';

/**
 * Parcours « connexion » (tâche 26) : seul parcours qui teste la connexion
 * elle-même — pas de session préchargée (`playwright.config.ts`, project
 * `connexion`), contrairement aux cinq autres qui réutilisent celle
 * d'`auth.setup.ts`.
 *
 * Déconnexion : PAS COUVERTE ICI. `signOut` (apps/web/app/actions/auth.ts)
 * existe déjà côté serveur mais aucun écran ne l'appelle — ni la coquille, ni
 * un onglet Réglages « Compte » (inexistant à ce jour). Ajouter ce déclencheur
 * dans la coquille (fichier partagé, hors de la liste « Fichiers » du brief
 * de cette tâche, et potentiellement déjà touché par d'autres tâches du lot
 * en cours) est un choix pour le coordinateur, pas pour cet exécutant — signalé
 * dans le rapport de la tâche 26 plutôt que décidé ici.
 */
test('connexion : arrivée sur Aujourd\'hui avec le menu à cinq entrées', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const motDePasse = process.env.E2E_PASSWORD;
  if (!email || !motDePasse) {
    throw new Error(
      "E2E_EMAIL et E2E_PASSWORD sont requis (variables d'environnement du worktree, jamais commitées).",
    );
  }

  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await page.waitForURL('/');

  const nav = page.getByRole('navigation', { name: 'Navigation principale' });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole('link')).toHaveCount(5);
  for (const nom of ['Aujourd\'hui', 'Campagnes', 'Contacts', 'Réception', 'Réglages']) {
    await expect(nav.getByRole('link', { name: nom })).toBeVisible();
  }
});

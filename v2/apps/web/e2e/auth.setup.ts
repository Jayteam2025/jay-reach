import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as setup, expect } from '@playwright/test';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ETAT_SESSION = path.join(ICI, '.auth/utilisateur.json');

/**
 * Connexion une fois (utilisateur de l'organisation « Recette e2e »,
 * apps/web/e2e/fixtures/organisation-test.sql), pour que les autres parcours
 * réutilisent la session via `storageState` (playwright.config.ts) sans se
 * reconnecter — seul `connexion.spec.ts` re-teste la connexion elle-même,
 * sans session préchargée.
 */
setup('connexion (partagée)', async ({ page }) => {
  const email = process.env.E2E_EMAIL;
  const motDePasse = process.env.E2E_PASSWORD;
  if (!email || !motDePasse) {
    throw new Error(
      "E2E_EMAIL et E2E_PASSWORD sont requis (variables d'environnement du worktree, " +
        "jamais commitées) : identifiants de l'utilisateur de test créé pour " +
        'apps/web/e2e/fixtures/organisation-test.sql.',
    );
  }

  await page.goto('/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Mot de passe').fill(motDePasse);
  await page.getByRole('button', { name: 'Se connecter' }).click();

  await page.waitForURL('/');
  await expect(page.getByRole('navigation', { name: 'Navigation principale' })).toBeVisible();

  await page.context().storageState({ path: ETAT_SESSION });
});

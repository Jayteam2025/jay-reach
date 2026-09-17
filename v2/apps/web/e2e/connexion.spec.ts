import { test, expect } from '@playwright/test';

/**
 * Parcours « connexion » (tâche 26) : seul parcours qui teste la connexion —
 * ET la déconnexion — elles-mêmes : pas de session préchargée
 * (`playwright.config.ts`, project `connexion`), contrairement aux cinq
 * autres qui réutilisent celle d'`auth.setup.ts`. La déconnexion détruit la
 * session : elle ne doit jamais tourner dans le project `chromium` partagé,
 * elle romprait la session des autres parcours.
 *
 * Déconnexion : `Réglages › Compte` (R89) — carte « Session », bouton
 * « Se déconnecter » relié à `signOut` (apps/web/app/actions/auth.ts). On y
 * va par URL directe (`NavReglages.tsx` relie désormais aussi cette entrée,
 * mais ce parcours ne clique pas la sous-navigation Réglages), comme
 * `plafonds.spec.ts` le fait déjà pour `/settings/limits`.
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

  // Déconnexion (Réglages › Compte, carte « Session »).
  await page.goto('/settings/account');
  await expect(page.getByRole('heading', { name: 'Session' })).toBeVisible();
  await page.getByRole('button', { name: 'Se déconnecter' }).click();

  await page.waitForURL('/login');
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();

  // Une page protégée redirige vers /login une fois déconnecté.
  await page.goto('/');
  await page.waitForURL(/\/login/);
  await expect(page.getByRole('heading', { name: 'Connexion' })).toBeVisible();
});

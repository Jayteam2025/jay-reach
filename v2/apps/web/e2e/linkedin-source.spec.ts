import { test, expect } from '@playwright/test';
import { ID_CAMPAGNE_FIXTURE } from './fixtures/ids';

/**
 * Parcours « source LinkedIn » (tâche 9, lot 4a) : la campagne de la fixture « Recette e2e » est en
 * brouillon. Le formulaire des engageurs d'un post le dit, et « Collecter maintenant » est grisé
 * avec son explication — rien ne peut partir vers LinkedIn depuis un brouillon (règle R72 du worker).
 *
 * Ce parcours ne crée aucune source et ne lance aucune collecte. Il ne touche qu'à l'écran : le
 * tiroir s'ouvre par `?ajouter=…`, sans écriture.
 *
 * Prérequis : la base OSS porte les migrations du lot 4a (`20261005130000` et suivantes) — sans
 * elles, la page Réglages › LinkedIn échoue franchement (la table de session n'existe pas), et ce
 * parcours doit échouer avec elle plutôt que d'être contourné.
 */
test('Source LinkedIn : sur une campagne en brouillon, le bandeau est visible et « Collecter maintenant » est désactivé', async ({
  page,
}) => {
  await page.goto(`/campaigns/${ID_CAMPAGNE_FIXTURE}/sources?ajouter=linkedin_post_engagers`);

  await expect(page.getByRole('heading', { name: /Engageurs d.un post/ })).toBeVisible();
  await expect(
    page.getByText("Cette campagne est un brouillon : rien ne sera collecté tant qu'elle n'est pas lancée."),
  ).toBeVisible();

  const bouton = page.getByRole('button', { name: 'Collecter maintenant' });
  await expect(bouton).toBeVisible();
  await expect(bouton).toBeDisabled();
  await expect(page.getByText('Disponible une fois la campagne lancée.')).toBeVisible();
});

test('Réglages › LinkedIn : une phrase d’état, les deux plafonds, l’avertissement, et aucun formulaire de connexion', async ({
  page,
}) => {
  await page.goto('/settings/linkedin');

  await expect(page.getByRole('heading', { name: 'LinkedIn', level: 2 })).toBeVisible();
  await expect(page.getByText('Session LinkedIn', { exact: true })).toBeVisible();

  // Les deux plafonds, aux mêmes clés que Réglages › Plafonds.
  await expect(page.getByLabel('Posts par jour')).toBeVisible();
  await expect(page.getByLabel('Requêtes par heure')).toBeVisible();

  await expect(page.getByText("Collecter depuis LinkedIn est contraire à ses conditions d'utilisation.")).toBeVisible();

  // Sans session, la ligne du bloc « État du moteur » existe quand même et mène ici.
  await expect(page.getByRole('link', { name: /LinkedIn : aucune session/ })).toHaveAttribute('href', '/settings/linkedin');

  // Le logo garde sa couleur de marque (#0A66C2) en toute circonstance, ici sans session : mesuré
  // sur le style CALCULÉ, une classe ne prouve rien (`.jr-app svg` le peignait en noir).
  const BLEU_MARQUE = 'rgb(10, 102, 194)';
  const logoMoteur = page.locator('.jr-barre-pied .jr-moteur-linkedin svg');
  await expect(logoMoteur).toHaveCSS('fill', BLEU_MARQUE);
  await expect(logoMoteur).toHaveCSS('stroke', 'none');
  const tuile = page.locator('.jr-reglages-corps .jr-tuile-logo.li');
  await expect(tuile).toHaveCSS('background-color', BLEU_MARQUE);
  await expect(tuile.locator('svg')).toHaveCSS('fill', 'rgb(255, 255, 255)');

  // Le mot de passe et le code ne transitent jamais par cette page.
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

import { test, expect } from '@playwright/test';

/**
 * Parcours « reception » (tâche 26) : la Réception liste le fil de la
 * fixture (`apps/web/e2e/fixtures/organisation-test.sql` — contact Camille
 * Durand, classification `human_reply`, `handled_at` nul), l'ouvre, affiche
 * la colonne contact. Le fil de fixture n'a pas de transport identifiable
 * (aucun `salesblinkInboxMessageId`/`graphMessageId`) : pas d'envoi de
 * réponse, l'app doit d'ailleurs l'interdire elle-même : la boîte de réponse
 * est affichée en permanence (`ZoneReponseFil`, spec §6.12), avec son bouton
 * « Envoyer » désactivé et la raison affichée à la place de la note
 * habituelle — jamais retirée de la page. Lecture seule (aucune réponse
 * envoyée, aucun fil marqué traité) : rien à nettoyer.
 */
test('Réception : le fil de la fixture s\'ouvre, colonne contact affichée, réponse impossible sans transport', async ({ page }) => {
  await page.goto('/inbox');

  const lienFil = page.getByRole('link', { name: /Camille Durand/ });
  await expect(lienFil).toBeVisible();
  await lienFil.click();

  // Apostrophe droite : c'est celle du corps stocké par la fixture SQL (échappement `''`).
  // `.last()` : la troncature de l'aperçu dans la liste est purement visuelle (CSS
  // `text-overflow`), le texte complet est présent aux DEUX endroits — seul le fil
  // ouvert (rendu après la liste dans le DOM) nous intéresse ici.
  await expect(page.getByText("votre message m'intéresse", { exact: false }).last()).toBeVisible();

  await expect(page.getByRole('heading', { name: 'Coordonnées' })).toBeVisible();

  await expect(
    page.getByText("Message d'origine inconnu : impossible de répondre depuis l'application.", { exact: false }),
  ).toBeVisible();
  // La boîte de réponse reste affichée (spec §6.12) mais son envoi est bloqué :
  // ne jamais y écrire ni cliquer « Envoyer », juste vérifier qu'il est désactivé.
  await expect(page.getByRole('button', { name: 'Envoyer' })).toBeDisabled();
});

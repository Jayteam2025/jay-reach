import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as setup, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const ETAT_SESSION = path.join(ICI, '.auth/utilisateur.json');

/**
 * Routes fixes visitées par les six parcours et par `connexion.spec.ts`
 * (tâche F8), établies en relisant chaque `e2e/*.spec.ts` — `page.goto(...)`
 * et navigations par clic. `/campaigns/[id]` (et ses onglets « Réglages » et
 * « Sources ») est une route dynamique, traitée séparément plus bas avec un
 * identifiant réel. `/login` et `/` sont déjà compilées par la connexion
 * ci-dessus, donc absentes de cette liste.
 */
const ROUTES_FIXES = [
  '/settings', // clic « Réglages » du menu (connexion.spec.ts) — redirige vers /settings/senders
  '/settings/account',
  '/settings/limits',
  '/contacts',
  '/campaigns/new',
  '/inbox',
];

/**
 * Navigue vers une route pour forcer sa compilation par `next dev`, sans
 * jamais faire échouer la suite : le préchauffage prépare, il n'assertionne
 * pas le contenu métier, donc une route qui répond en erreur ou redirige
 * pour une raison légitime ne doit pas le faire échouer. Seule une
 * redirection vers /login fait exception : elle signalerait une session
 * perdue, qui casserait les six parcours suivants — jamais masquée.
 */
async function prechaufferRoute(page: Page, route: string): Promise<void> {
  try {
    await page.goto(route, { timeout: 60_000 });
  } catch (erreur) {
    console.warn(`[préchauffage] ${route} : ${String(erreur)}`);
  }
  if (new URL(page.url()).pathname === '/login') {
    throw new Error(`Préchauffage : redirection vers /login sur ${route} — session perdue.`);
  }
}

/**
 * Connexion une fois (utilisateur de l'organisation « Recette e2e »,
 * apps/web/e2e/fixtures/organisation-test.sql), pour que les autres parcours
 * réutilisent la session via `storageState` (playwright.config.ts) sans se
 * reconnecter — seul `connexion.spec.ts` re-teste la connexion elle-même,
 * sans session préchargée.
 *
 * Préchauffe aussi toutes les routes des six parcours (tâche F8) : contre un
 * `next dev` froid, la première compilation d'une route dépasse parfois les
 * 5 s d'`expect.timeout` (constaté deux fois le 17 et le 18/09, jamais au
 * même endroit) — pas un défaut de l'application. Le préchauffage utilise la
 * session déjà ouverte ci-dessus (pas de deuxième connexion) et n'écrit
 * jamais en base : navigation seule.
 */
setup('connexion (partagée)', async ({ page }, testInfo) => {
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

  // Budget étendu pour CE test seul (jamais le timeout global des parcours ni
  // expect.timeout, qui doivent rester exigeants) : compiler à froid une
  // dizaine de routes peut prendre plusieurs dizaines de secondes chacune.
  testInfo.setTimeout(180_000);

  await setup.step('Préchauffage des routes fixes', async () => {
    for (const route of ROUTES_FIXES) {
      await prechaufferRoute(page, route);
    }
  });

  await setup.step('Préchauffage de /campaigns/[id] et ses onglets', async () => {
    // /campaigns (liste) sert deux fois : préchauffer la route elle-même, et
    // y lire un identifiant réel de campagne — jamais un UUID en dur. La
    // fixture (organisation-test.sql) garantit toujours au moins une ligne.
    await prechaufferRoute(page, '/campaigns');
    const lienCampagne = page.getByRole('table').getByRole('link').first();
    const hrefCampagne = (await lienCampagne.count()) > 0 ? await lienCampagne.getAttribute('href') : null;

    if (!hrefCampagne) {
      console.warn('[préchauffage] aucune campagne dans /campaigns : /campaigns/[id]* non préchauffées.');
      return;
    }
    for (const onglet of ['', '/settings', '/sources']) {
      await prechaufferRoute(page, `${hrefCampagne}${onglet}`);
    }
  });

  await page.context().storageState({ path: ETAT_SESSION });
});

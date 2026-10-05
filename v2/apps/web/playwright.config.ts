import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

/**
 * Config Playwright des parcours de bout en bout (tâche 26, lot 2).
 *
 * Contre un serveur `next dev` lancé sur le port 3100 (JAMAIS 3000 : un
 * serveur de dev tourne déjà dessus depuis le dépôt principal), avec
 * `SALESBLINK_FAKE=1` — packages/providers/src/outreach/salesblink.ts court-
 * circuite alors tout appel réseau à SalesBlink.
 *
 * Un seul login (project `setup`) sauve une session partagée
 * (`storageState`) pour les cinq parcours qui n'ont pas besoin de se
 * reconnecter — seul `connexion.spec.ts` teste la connexion elle-même, donc
 * démarre SANS session.
 *
 * `connexion` tourne APRÈS `chromium` (`dependencies: ['chromium']`), jamais
 * en parallèle : `signOut()` (`@supabase/supabase-js`) déconnecte par défaut
 * l'utilisateur PARTOUT (`scope: 'global'`, vérifié dans le SDK installé —
 * pas seulement le navigateur courant), ce qui invalidait la session partagée
 * des cinq autres parcours quand les deux projects tournaient en même temps
 * (constaté : les cinq échouaient en timeout dès que `connexion` incluait la
 * déconnexion). Même utilisateur de test partout, donc même session.
 *
 * `E2E_EMAIL`/`E2E_PASSWORD` (utilisateur de l'organisation « Recette e2e »,
 * apps/web/e2e/fixtures/organisation-test.sql) : Next.js charge lui-même
 * `.env` pour le SERVEUR (`dev:e2e`), mais le processus Playwright — un
 * second process Node, qui exécute `auth.setup.ts`/`connexion.spec.ts` — ne
 * lit jamais ce fichier tout seul. `chargerEnvLocal` ci-dessous le fait à la
 * main (pas de dépendance `dotenv` pour ce seul besoin), sans écraser une
 * variable déjà posée par l'environnement (CI, par exemple). Absents des deux,
 * `auth.setup.ts` échoue tôt avec un message explicite plutôt qu'un timeout
 * Playwright opaque.
 */
function chargerEnvLocal(cheminEnv: string): void {
  let contenu: string;
  try {
    contenu = readFileSync(cheminEnv, 'utf8');
  } catch {
    return; // Pas de .env (CI) : les variables viennent alors de l'environnement.
  }
  for (const ligne of contenu.split('\n')) {
    const ligneNettoyee = ligne.trim();
    if (!ligneNettoyee || ligneNettoyee.startsWith('#')) continue;
    const correspondance = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(ligneNettoyee);
    if (!correspondance) continue;
    const [, cle, valeurBrute] = correspondance;
    if (process.env[cle!] !== undefined) continue; // L'environnement prime sur le .env.
    const valeur = valeurBrute!.trim().replace(/^['"]|['"]$/g, '');
    process.env[cle!] = valeur;
  }
}

const ICI = path.dirname(fileURLToPath(import.meta.url));
chargerEnvLocal(path.join(ICI, '../../.env')); // v2/.env — deux niveaux au-dessus d'apps/web
const ETAT_SESSION = path.join(ICI, 'e2e/.auth/utilisateur.json');
const PORT = 3100;
const URL_BASE = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',

  use: {
    baseURL: URL_BASE,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  webServer: {
    // `dev:e2e` (pas `dev`) : évite le `predev` d'empaquetage de l'extension,
    // inutile pour ces parcours et non lié au port.
    command: 'pnpm run dev:e2e',
    cwd: path.join(ICI, '.'),
    url: URL_BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { SALESBLINK_FAKE: '1' },
  },

  projects: [
    {
      name: 'setup',
      testMatch: 'auth.setup.ts',
    },
    {
      name: 'chromium',
      testMatch: ['creer-campagne.spec.ts', 'aujourdhui.spec.ts', 'reception.spec.ts', 'sources.spec.ts', 'plafonds.spec.ts', 'contacts.spec.ts', 'jauge-envois.spec.ts'],
      use: { ...devices['Desktop Chrome'], storageState: ETAT_SESSION },
      dependencies: ['setup'],
    },
    {
      // Seul parcours à tester la connexion ET la déconnexion : jamais de
      // session préchargée, sinon il ne testerait rien. Dépend de `chromium`
      // (pas seulement `setup`) pour ne s'exécuter qu'une fois les cinq
      // autres parcours terminés — voir la déconnexion globale ci-dessus.
      name: 'connexion',
      testMatch: 'connexion.spec.ts',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['chromium'],
    },
  ],
});

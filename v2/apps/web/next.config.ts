import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

// Le `.env` du projet vit à la racine du monorepo (voir `.env.example`), mais
// Next ne cherche que dans le dossier de l'application. Sans ce chargement,
// `NEXT_PUBLIC_SUPABASE_URL` est absente, l'application se croit non configurée,
// et le middleware laisse passer toutes les routes en développement — une
// instance ouverte pour quiconque suit le README à la lettre.
// La racine du monorepo se calcule depuis CE fichier, pas depuis le dossier de
// lancement : sur Vercel, le build s'execute dans un cwd qui n'est pas celui du
// developpement, et `process.cwd()/../..` sortait du projet.
const racineMonorepo = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const envRacine = join(racineMonorepo, '.env');
if (existsSync(envRacine)) {
  process.loadEnvFile(envRacine);
}

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    /**
     * Cache de navigation : revenir sur un écran déjà ouvert ne le recharge pas.
     *
     * Next 15 met `dynamic` à 0 par défaut, donc chaque aller-retour entre deux
     * onglets refaisait tout le travail serveur — alors que rien n'avait changé
     * entre-temps.
     *
     * Trente secondes est calé sur le rythme réel des données : le moteur tourne
     * chaque minute et la collecte toutes les quinze. Au-delà, on risquerait
     * d'afficher un compteur périmé ; en deçà, la navigation reste inutilement
     * coûteuse.
     *
     * Ce cache n'est PAS un risque de donnée périmée après une modification :
     * chaque server action qui écrit appelle `revalidatePath`, ce qui le vide
     * pour le chemin concerné. C'est ce qui a été vérifié avant d'activer ceci.
     */
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
  // Les packages internes du monorepo sont transpilés par Next.
  transpilePackages: ['@jay-reach/core', '@jay-reach/i18n', '@jay-reach/ui', '@jay-reach/worker'],
  webpack: (webpackConfig) => {
    // Les sources TS des packages internes utilisent des imports ESM explicites
    // (`./x.js`). On laisse webpack les résoudre vers les fichiers `.ts`.
    webpackConfig.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return webpackConfig;
  },
};

export default withNextIntl(config);

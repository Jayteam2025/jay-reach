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
  // Sans cette racine explicite, Next la devine — et se trompe dès qu'il existe
  // un autre lockfile au-dessus du monorepo. Il le dit lui-même au démarrage
  // (« inferred your workspace root, but it may not be correct »), et la
  // conséquence n'apparaît qu'au déploiement : le tracing des fichiers embarque
  // le mauvais périmètre, donc une image qui pèse trop ou à qui il manque un
  // paquet interne.
  outputFileTracingRoot: racineMonorepo,
  // Les packages internes du monorepo sont transpilés par Next.
  transpilePackages: ['@jay-reach/core', '@jay-reach/i18n', '@jay-reach/ui'],
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

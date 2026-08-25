import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const config: NextConfig = {
  reactStrictMode: true,
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

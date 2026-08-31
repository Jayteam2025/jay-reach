import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import i18next from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/next-env.d.ts',
      // Extension Chrome : JS navigateur (globals chrome/self), hors build TS.
      'apps/extension/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Règle CLAUDE.md : TypeScript strict, pas de `any`, pas de @ts-ignore.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/consistent-type-imports': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    // Code legacy porté (packages/providers) : on garde le typage strict et
    // « pas de any », mais on tolère les échappements défensifs des regex d'origine.
    files: ['packages/providers/src/**/*.ts'],
    rules: {
      'no-useless-escape': 'off',
    },
  },
  {
    // Scripts Node (.mjs) : exposer les globals Node.
    files: ['**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        // Globales du runtime Node depuis la version 18. La liste etait
        // incomplete : un script d'outillage qui appelle une API HTTP echouait
        // au lint sur « fetch is not defined ».
        fetch: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        Buffer: 'readonly',
        crypto: 'readonly',
      },
    },
  },
  {
    // Service worker (Web Push) : `self` est la globale du contexte worker.
    files: ['apps/web/public/sw.js'],
    languageOptions: {
      globals: { self: 'readonly' },
    },
  },
  {
    // Règle CLAUDE.md : aucune chaîne d'interface en dur. Tout texte affiché
    // passe par next-intl. La règle interdit le texte JSX littéral côté web.
    files: ['apps/web/**/*.tsx'],
    plugins: { i18next },
    rules: {
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],
    },
  },
);

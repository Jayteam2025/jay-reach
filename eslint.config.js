import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist",
      "node_modules",
      "*.config.js",
      "*.config.ts",
      "coverage/**",
      "backups/**",
      "archive/**",
      ".worktrees/**",
      "**/* [0-9].ts",
      "**/* [0-9].tsx",
      "**/* [0-9].js",
      "supabase/functions/**",
      "scripts/**",
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.test.tsx",
      "**/*.spec.ts",
      "**/*.spec.tsx"
    ]
  },
  {
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        project: ["./tsconfig.app.json", "./tsconfig.node.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // TypeScript strict rules (migration progressive)
      "@typescript-eslint/no-unused-vars": ["warn", {  // warn au lieu de error
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "off",  // Désactivé temporairement
      "@typescript-eslint/no-unsafe-assignment": "off",  // Désactivé temporairement
      "@typescript-eslint/no-unsafe-member-access": "off",  // Désactivé temporairement
      "@typescript-eslint/no-unsafe-return": "off",  // Désactivé temporairement
      "@typescript-eslint/no-unsafe-call": "off",  // Désactivé temporairement
      "@typescript-eslint/no-unsafe-argument": "off",  // Désactivé temporairement
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-module-boundary-types": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-floating-promises": "warn",  // warn au lieu de error
      "@typescript-eslint/no-misused-promises": "warn",  // warn au lieu de error
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/prefer-optional-chain": "off",  // Désactivé temporairement
      "@typescript-eslint/unbound-method": "off",  // Désactivé temporairement
      "@typescript-eslint/require-await": "warn",  // warn au lieu de error
      "@typescript-eslint/consistent-indexed-object-style": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/consistent-type-definitions": "off",
      "@typescript-eslint/no-base-to-string": "warn",  // warn - beaucoup de faux positifs avec unknown

      // Code quality rules
      "no-console": "error",  // Utiliser logger de @/lib/logger a la place
      "prefer-const": "error",
      "no-var": "error",
      "eqeqeq": ["error", "always"],
      "no-throw-literal": "error",
    },
  },
  // Configuration spécifique pour les fichiers générés automatiquement
  {
    files: ["**/integrations/supabase/types.ts"],
    rules: {
      "@typescript-eslint/no-redundant-type-constituents": "off",  // Fichier auto-généré par Supabase
    },
  },
  // Configuration spécifique pour le logger (utilise console internement)
  {
    files: ["**/lib/logger.ts"],
    rules: {
      "no-console": "off",  // Le logger utilise console.* internement
      "@typescript-eslint/no-redundant-type-constituents": "off",
    },
  },
  // Configuration spécifique pour les fichiers de tests
  {
    files: ["**/__tests__/**/*.{ts,tsx}", "**/*.test.{ts,tsx}", "**/*.spec.{ts,tsx}"],
    rules: {
      // Relâcher les règles pour les tests
      "@typescript-eslint/no-unused-vars": "off",  // Variables non utilisées OK dans les tests
      "@typescript-eslint/no-empty-function": "off",  // Fonctions vides OK pour les mocks
      "@typescript-eslint/no-var-requires": "off",  // require() OK dans les tests
      "@typescript-eslint/no-require-imports": "off",  // require() imports OK dans les tests
      "@typescript-eslint/ban-ts-comment": "off",  // @ts-ignore/@ts-expect-error OK dans les tests
      "@typescript-eslint/no-non-null-assertion": "off",  // Non-null assertion (!) OK dans les tests
      "@typescript-eslint/no-base-to-string": "off",  // Object to string OK dans les tests
      "no-useless-escape": "off",  // Escape chars OK dans les tests
      "no-constant-condition": "off",  // Conditions constantes OK dans les tests
      "no-constant-binary-expression": "off",  // Expressions binaires constantes OK dans les tests
      "@typescript-eslint/require-await": "off",  // async sans await OK dans les tests
      "@typescript-eslint/no-floating-promises": "off",  // Promises non gérées OK dans les tests
      "@typescript-eslint/no-misused-promises": "off",  // Promises mal utilisées OK dans les tests
      "react-hooks/exhaustive-deps": "off",  // Dépendances de hooks OK dans les tests
    },
  }
);

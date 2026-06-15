import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on mode
  const env = loadEnv(mode, process.cwd(), '');

  // Only log in development
  if (mode === 'development') {
    console.log(`Running in ${mode} mode`);
  }

  return {
    server: {
      host: "::",
      port: 8080,
    },
    plugins: [
      react(),
    ].filter(Boolean),
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    // Define environment variables
    define: {
      __APP_ENV__: JSON.stringify(env.VITE_ENV || mode),
    },
    build: {
      minify: 'esbuild',
      ...(mode === 'production' && {
        esbuild: {
          drop: ['debugger'],
          // Keep console.warn and console.error for logger
          // Drop console.log, console.debug, console.info (shouldn't be used directly anymore)
          pure: ['console.log', 'console.debug', 'console.info'],
        },
      }),
      rollupOptions: {
        output: {
          manualChunks: {
            // Separer React et ses dependances
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            // Separer les UI components (Radix UI)
            'ui-vendor': [
              '@radix-ui/react-dialog',
              '@radix-ui/react-dropdown-menu',
              '@radix-ui/react-select',
              '@radix-ui/react-toast',
              '@radix-ui/react-tabs',
              '@radix-ui/react-accordion',
              '@radix-ui/react-avatar',
              '@radix-ui/react-checkbox',
              '@radix-ui/react-label',
              '@radix-ui/react-popover',
              '@radix-ui/react-progress',
              '@radix-ui/react-scroll-area',
              '@radix-ui/react-separator',
              '@radix-ui/react-slider',
              '@radix-ui/react-switch',
              '@radix-ui/react-tooltip',
            ],
            // Separer Supabase
            'supabase-vendor': [
              '@supabase/supabase-js',
              '@supabase/auth-ui-react',
            ],
            // Separer TanStack Query
            'query-vendor': ['@tanstack/react-query'],
            // Separer i18next
            'i18n-vendor': [
              'i18next',
              'react-i18next',
              'i18next-browser-languagedetector',
              'i18next-http-backend',
            ],
            // Separer les icones et utilitaires
            'utils-vendor': [
              'lucide-react',
              'date-fns',
              'clsx',
              'tailwind-merge',
              'class-variance-authority',
            ],
            // Separer les charts
            'charts-vendor': ['recharts'],
            // Libs lourdes prospection — chunks dedies, charges a la demande via
            // import lazy/dynamique (onglets, modale import, telechargement docx).
            // Jay Reach 0.1.0.
            'xlsx-vendor': ['xlsx'],
            'docx-vendor': ['docx'],
            'mammoth-vendor': ['mammoth'],
            'dnd-vendor': [
              '@dnd-kit/react',
              '@dnd-kit/react/sortable',
              '@dnd-kit/helpers',
              '@dnd-kit/abstract',
            ],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
  };
});

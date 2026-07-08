import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ["'Inter Variable'", "Inter", "sans-serif"],
        display: ["'Outfit Variable'", "Outfit", "sans-serif"],
        body: ["'Inter Variable'", "Inter", "sans-serif"],
      },
      colors: {
        jay: {
          purple: "#8B5CF6",
          blue: "#60A5FA",
          dark: "#000000",
          card: "#0A0B1A",
          cardAlt: "#1A1A1A",
        },
        // Accent principal de l'app (utilise en dur comme "violet-*"/"blue-*"),
        // repique sur la palette active (--a1h/--a1s / --a2h/--a2s, cf. index.css)
        // pour que tout suive le selecteur de palette. Lightness par nuance.
        violet: {
          50:  "hsl(var(--a1h) var(--a1s) 97% / <alpha-value>)",
          100: "hsl(var(--a1h) var(--a1s) 94% / <alpha-value>)",
          200: "hsl(var(--a1h) var(--a1s) 86% / <alpha-value>)",
          300: "hsl(var(--a1h) var(--a1s) 76% / <alpha-value>)",
          400: "hsl(var(--a1h) var(--a1s) 67% / <alpha-value>)",
          500: "hsl(var(--a1h) var(--a1s) 58% / <alpha-value>)",
          600: "hsl(var(--a1h) var(--a1s) 50% / <alpha-value>)",
          700: "hsl(var(--a1h) var(--a1s) 42% / <alpha-value>)",
          800: "hsl(var(--a1h) var(--a1s) 34% / <alpha-value>)",
          900: "hsl(var(--a1h) var(--a1s) 27% / <alpha-value>)",
        },
        blue: {
          300: "hsl(var(--a2h) var(--a2s) 78% / <alpha-value>)",
          400: "hsl(var(--a2h) var(--a2s) 70% / <alpha-value>)",
          500: "hsl(var(--a2h) var(--a2s) 60% / <alpha-value>)",
          600: "hsl(var(--a2h) var(--a2s) 52% / <alpha-value>)",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        sidebar: {
          accent: "linear-gradient(90deg, #8B5CF6 0%, #60A5FA 100%)",
        }
      },
      backgroundImage: {
        // Suit la palette d'accent active (--a1/--a2, cf. src/index.css)
        'gradient-primary': 'linear-gradient(90deg, hsl(var(--a1)) 0%, hsl(var(--a2)) 100%)',
      },
      backdropBlur: {
        'xs': '4px',
        'sm': '8px',
        'lg': '8px',
        'md': '12px',
        'xl': '20px',
        '2xl': '28px',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        shimmer: 'progress-shimmer 2s ease-in-out infinite',
        'fade-up': 'fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
  ],
} satisfies Config;

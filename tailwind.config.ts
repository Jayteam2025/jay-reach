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
        'gradient-primary': 'linear-gradient(90deg, #8B5CF6 0%, #60A5FA 100%)',
      },
      backdropBlur: {
        'lg': '8px',
      },
      animation: {
        shimmer: 'progress-shimmer 2s ease-in-out infinite',
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
    require("@tailwindcss/typography"),
  ],
} satisfies Config;

import { Sun, Moon } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

interface ThemeSwitchProps {
  className?: string;
}

export function ThemeSwitch({ className }: ThemeSwitchProps) {
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <button
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn(
        "relative flex items-center w-14 h-7 rounded-full p-0.5 border border-border bg-foreground/10 backdrop-blur-md transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background",
        className
      )}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
    >
      {/* Icônes de repère estompées sur la piste */}
      <Sun className="absolute left-1.5 h-3.5 w-3.5 text-amber-400/50" />
      <Moon className="absolute right-1.5 h-3.5 w-3.5 text-foreground/30" />
      {/* Pastille qui porte l'icône active */}
      <div className={cn(
        "relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-primary text-white shadow-md shadow-primary/30 transition-transform duration-300",
        isDark ? "translate-x-7" : "translate-x-0"
      )}>
        {isDark
          ? <Moon className="h-3.5 w-3.5" />
          : <Sun className="h-3.5 w-3.5" />}
      </div>
    </button>
  );
}

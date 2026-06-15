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
        "relative flex items-center w-14 h-7 rounded-full p-0.5 transition-colors duration-300",
        isDark ? "bg-gray-700" : "bg-gray-300",
        className
      )}
      aria-label={isDark ? "Passer en mode clair" : "Passer en mode sombre"}
    >
      <Sun className={cn(
        "absolute left-1.5 h-3.5 w-3.5 transition-opacity duration-300",
        isDark ? "opacity-30 text-gray-400" : "opacity-100 text-amber-500"
      )} />
      <Moon className={cn(
        "absolute right-1.5 h-3.5 w-3.5 transition-opacity duration-300",
        isDark ? "opacity-100 text-blue-300" : "opacity-30 text-gray-500"
      )} />
      <div className={cn(
        "h-6 w-6 rounded-full bg-white shadow-md transition-transform duration-300",
        isDark ? "translate-x-7" : "translate-x-0"
      )} />
    </button>
  );
}

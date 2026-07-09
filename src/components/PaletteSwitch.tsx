import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Sélecteur de palette d'accent : une pastille (couleur active) qui ouvre un
 * mini-menu maison (pas de Radix, pour éviter tout souci de hook/instance).
 * Écrit `data-palette` sur <html> ; les tokens --a1h/--a1s / --a2h/--a2s
 * (src/index.css) en dérivent tout l'accent. "marque" = défaut. Persisté.
 */
const PALETTES = [
  { id: "marque", label: "Marque", from: "#8B5CF6", to: "#60A5FA" },
  { id: "neon", label: "Néon", from: "#F72585", to: "#22D3EE" },
  { id: "sunset", label: "Sunset", from: "#FF5E3A", to: "#FF2D95" },
  { id: "lime", label: "Lime", from: "#A3E635", to: "#06B6D4" },
  { id: "rouge", label: "Rouge", from: "#EF4444", to: "#7F1D1D" },
] as const;

const STORAGE_KEY = "jay-palette";

function applyPalette(id: string) {
  const root = document.documentElement;
  if (id === "marque") root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", id);
}

interface PaletteSwitchProps {
  className?: string;
}

export function PaletteSwitch({ className }: PaletteSwitchProps) {
  const [active, setActive] = useState<string>("marque");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY) || "marque";
    setActive(saved);
    applyPalette(saved);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const select = (id: string) => {
    setActive(id);
    applyPalette(id);
    localStorage.setItem(STORAGE_KEY, id);
    setOpen(false);
  };

  const current = PALETTES.find((p) => p.id === active) ?? PALETTES[0];

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-label="Changer la palette d'accent"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Palette d'accent"
        onClick={() => setOpen((v) => !v)}
        className="h-6 w-6 rounded-full ring-1 ring-black/10 dark:ring-white/20 transition-transform duration-150 hover:scale-110 ring-offset-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ backgroundImage: `linear-gradient(135deg, ${current.from}, ${current.to})` }}
      />
      {open && (
        <div
          role="menu"
          className="glass-strong absolute right-0 z-50 mt-2 flex items-center gap-1.5 rounded-full p-1.5"
        >
          {PALETTES.map((p) => (
            <button
              key={p.id}
              type="button"
              role="menuitemradio"
              aria-checked={active === p.id}
              aria-label={p.label}
              title={p.label}
              onClick={() => select(p.id)}
              className={cn(
                "h-5 w-5 shrink-0 rounded-full ring-offset-2 ring-offset-background transition-transform duration-150 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active === p.id
                  ? "ring-2 ring-foreground scale-110"
                  : "ring-1 ring-black/10 dark:ring-white/20"
              )}
              style={{ backgroundImage: `linear-gradient(135deg, ${p.from}, ${p.to})` }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

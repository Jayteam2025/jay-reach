import { useEffect, useRef, useState } from 'react';
import { animate, useInView, useReducedMotion } from 'framer-motion';

interface AnimatedNumberProps {
  value: number;
  /** Durée de l'animation (s). */
  duration?: number;
  /** Formatteur de la valeur affichée (ex. arrondi, %, k€). */
  format?: (n: number) => string;
  className?: string;
}

/**
 * Compteur animé : anime de 0 → `value` quand il entre dans le viewport.
 * Respecte reduced-motion (affiche directement la valeur finale, sans compter).
 * Réutilisé par les KPIs (Dashboard) et l'en-tête Campagnes.
 */
export function AnimatedNumber({ value, duration = 0.9, format, className }: AnimatedNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(0);

  const fmt = format ?? ((n: number) => String(Math.round(n)));

  useEffect(() => {
    if (reduce) {
      setDisplay(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration, reduce]);

  return (
    <span ref={ref} className={className}>
      {fmt(reduce ? value : display)}
    </span>
  );
}

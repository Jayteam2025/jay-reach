/**
 * Variants framer-motion partages (Jay Reach — refonte dynamique).
 *
 * Motion sobre et coherente : entrees en fondu + leger deplacement, cascades de
 * listes, transitions d'onglets. L'accessibilite passe par `&lt;MotionConfig
 * reducedMotion="user"&gt;` (voir src/App.tsx) : quand l'utilisateur demande moins
 * de mouvement, framer-motion neutralise automatiquement les transforms, et le
 * bloc CSS `prefers-reduced-motion` (src/index.css) coupe les animations CSS.
 */
import type { Variants, Transition } from 'framer-motion';

// Courbe d'easing maison (out-expo doux), deja utilisee dans Login.tsx.
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE_OUT },
  },
};

export const glassPop: Variants = {
  hidden: { opacity: 0, y: 8, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: EASE_OUT },
  },
};

/** Conteneur qui orchestre l'apparition en cascade de ses enfants. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.06, delayChildren: 0.04 },
  },
};

/** Transition de contenu d'onglet (fondu + leger glissement vertical). */
export const tabTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.28, ease: EASE_OUT } as Transition,
};

/** Props pretes a l'emploi pour une entree simple au montage. */
export const fadeInProps = {
  initial: 'hidden' as const,
  animate: 'show' as const,
  variants: fadeUp,
};

/** Props pour un conteneur en cascade au montage. */
export const staggerProps = {
  initial: 'hidden' as const,
  animate: 'show' as const,
  variants: staggerContainer,
};

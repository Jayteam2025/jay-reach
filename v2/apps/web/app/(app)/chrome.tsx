/**
 * Ancienne barre de navigation (rail `rs-sidebar`), remplacée par la coquille
 * du nouveau design (`components/coquille/Coquille.tsx`, cinq entrées, carte
 * Moteur, jauge d'envois).
 *
 * Conservée en passe-plat le temps que chaque écran encore sous l'ancien
 * design (`rs-*`) soit repris dans la nouvelle coquille (tâche par tâche,
 * lot 2) : chaque page continue de l'appeler (`<AppTopBar active="…" />`), son
 * export reste donc en place pour ne rien casser, mais elle ne rend plus rien
 * — la coquille qui enveloppe désormais ces pages fournit déjà un rail de
 * navigation, un second en dessous serait un doublon.
 */
export function AppTopBar(_props: { active: string }): null {
  return null;
}

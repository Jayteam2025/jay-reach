import { hasMinRole, listerPersonas } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { FichePersona } from '../../../../components/reglages/FichePersona';

/**
 * Réglages › Personas (tâche 22), reconstruite d'après la maquette
 * `reglages-personas.html` — remplace le contenu de l'ancienne page
 * (`persona-board.tsx`, retirée à la tâche 24).
 * Lecture directe (`listerPersonas`), même motif que `lireFiche` dans
 * `contacts/[id]` : pas de façade pour un affichage server-only.
 */
export default async function ReglagesPersonasPage() {
  const ctx = await contexteCourant();
  const peutModifier = ctx.role !== null && hasMinRole(ctx.role, 'admin');
  const { personas, campagnesDisponibles } = await listerPersonas(ctx, {});

  return (
    <FichePersona
      personas={personas}
      campagnesDisponibles={campagnesDisponibles}
      peutModifier={peutModifier}
    />
  );
}

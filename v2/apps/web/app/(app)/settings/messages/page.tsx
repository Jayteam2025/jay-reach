import { hasMinRole, lireReglages, listerModeles } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte } from '../../../../lib/dates';
import { TableModeles } from '../../../../components/reglages/TableModeles';

/**
 * Réglages › Messages (tâche 22), nouvelle page d'après la maquette
 * `reglages-messages.html` — la bibliothèque des modèles, distincte de
 * l'ancienne `settings/templates` (laissée en place, plus liée depuis le
 * menu de Réglages depuis la tâche 20 ; retrait complet à la tâche 24).
 * Lecture directe (`listerModeles`), même motif que `lireFiche` dans
 * `contacts/[id]` : pas de façade pour un affichage server-only.
 */
export default async function ReglagesMessagesPage() {
  const ctx = await contexteCourant();
  const peutModifier = ctx.role !== null && hasMinRole(ctx.role, 'admin');
  const [modeles, reglages] = await Promise.all([listerModeles(ctx, {}), lireReglages(ctx)]);
  const fuseau = String(reglages.fuseau);
  const maintenant = new Date();

  return (
    <TableModeles
      modeles={modeles.map((m) => ({
        ...m,
        modifieLeTexte: dateCourte(m.modifieLe, maintenant, fuseau),
      }))}
      peutModifier={peutModifier}
    />
  );
}

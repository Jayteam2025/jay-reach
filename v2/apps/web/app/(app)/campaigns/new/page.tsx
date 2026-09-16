import { listerBoitesPourCampagne, listerPersonasOrganisation } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { Assistant } from '../../../../components/campagne/assistant/Assistant';

export const revalidate = 0;

/**
 * Assistant de création de campagne en quatre étapes (tâche 14). Ne fait
 * QUE lire les options disponibles (personas, boîtes d'envoi) : l'assistant
 * lui-même n'écrit rien avant son dernier bouton (`creerCampagneComplete`,
 * via l'action serveur `nouvelle-campagne.ts`). La coquille (barre latérale,
 * carte Moteur) vient du layout du groupe `(app)`, pas de cette page.
 */
export default async function NewCampaignPage() {
  const ctx = await contexteCourant();
  const [personas, boites] = await Promise.all([
    listerPersonasOrganisation(ctx, {}),
    listerBoitesPourCampagne(ctx, {}),
  ]);

  return <Assistant personas={personas} boites={boites} />;
}

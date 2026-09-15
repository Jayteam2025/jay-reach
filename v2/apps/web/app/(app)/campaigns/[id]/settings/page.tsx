import { notFound } from 'next/navigation';
import { ErreurIntrouvable, listerBoitesPourCampagne } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../../lib/campagne';
import { FormulaireReglagesCampagne } from '../../../../../components/campagne/FormulaireReglagesCampagne';

export const revalidate = 0;

export default async function CampagneReglagesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteCourant();

  let vue: Awaited<ReturnType<typeof lireVueDEnsembleCourante>>;
  let toutesBoites: Awaited<ReturnType<typeof listerBoitesPourCampagne>>;
  try {
    [vue, toutesBoites] = await Promise.all([
      lireVueDEnsembleCourante(ctx, id),
      listerBoitesPourCampagne(ctx, {}),
    ]);
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }

  return (
    <section className="jr-contenu une-colonne">
      <FormulaireReglagesCampagne
        campagneId={id}
        initial={{
          nom: vue.campagne.nom,
          scoreMin: vue.campagne.scoreMin,
          dailyCap: vue.campagne.dailyCap,
          relecturePremiersEnvois: vue.campagne.relecturePremiersEnvois,
        }}
        boites={toutesBoites}
        boiteIdsSelectionnees={vue.campagne.boites.map((boite) => boite.id)}
        enSequence={vue.entonnoir.enSequence}
        peutArchiver={ctx.role === 'admin' || ctx.role === 'owner'}
      />
    </section>
  );
}

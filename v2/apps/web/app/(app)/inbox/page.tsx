import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable, lireFil, listerCampagnes, listerFils, type FiltreReception, type FilDetail } from '@jay-reach/core';
import { contexteCourant } from '../../../lib/contexte';
import { dateHeureMessage, dateRelativeCourte, FUSEAU_PAR_DEFAUT } from '../../../lib/dates';
import { EtatVide } from '../../../components/ui';
import { ListeFils, type LigneFilAffichage } from '../../../components/reception/ListeFils';
import { Fil, type MessageFilAffiche } from '../../../components/reception/Fil';
import { ColonneContact } from '../../../components/reception/ColonneContact';

export const revalidate = 0;

const FILTRES_VALIDES: FiltreReception[] = ['a_traiter', 'interesses', 'absences', 'traites', 'tous'];

function filtreDemande(brut: string | string[] | undefined): FiltreReception {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  return valeur && (FILTRES_VALIDES as readonly string[]).includes(valeur) ? (valeur as FiltreReception) : 'a_traiter';
}

function idDemande(brut: string | string[] | undefined): string | undefined {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  return valeur && valeur.trim() !== '' ? valeur.trim() : undefined;
}

/**
 * Date courte (« 23/09 ») pour la relance d'une absence — `resume_at` est un
 * instant à VENIR : `dateRelativeCourte` (« il y a… », « hier ») est écrite
 * pour un instant PASSÉ et donnerait un résultat absurde ici.
 */
function dateCourte(iso: string, fuseau: string): string {
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', timeZone: fuseau }).format(new Date(iso));
}

/**
 * Réception à trois volets (tâche 16) : liste + filtre (`?filtre=`,
 * `?campagneId=`), fil (`?fil=`) et sa colonne de contexte. Sélection par
 * navigation serveur (même motif que `FiltresStatuts`/Contacts) — aucun état
 * client hors de la zone de réponse elle-même. Remplace l'ancien écran
 * (`inbox-view.tsx`, `lib/sample-inbox.ts`) qui gardait le chrome `rs-*`
 * d'avant la coquille (`AppTopBar`) au lieu de celui déjà fourni par
 * `app/(app)/layout.tsx`.
 */
export default async function ReceptionPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await contexteCourant();
  const [t, sp] = await Promise.all([getTranslations('reception'), searchParams]);

  const filtre = filtreDemande(sp.filtre);
  const campagneId = idDemande(sp.campagneId) ?? null;
  const filDemandeId = idDemande(sp.fil) ?? null;

  const [resultat, campagnes] = await Promise.all([
    listerFils(ctx, { filtre, campagneId: campagneId ?? undefined, page: 1 }),
    listerCampagnes(ctx),
  ]);

  const maintenant = new Date();
  const fuseau = FUSEAU_PAR_DEFAUT;

  const fils: LigneFilAffichage[] = resultat.fils.map((fil) => ({
    id: fil.id,
    nom: fil.nom,
    canal: fil.canal,
    classification: fil.classification,
    apercu: fil.apercu,
    quandAffiche: fil.quand ? dateRelativeCourte(fil.quand, maintenant, fuseau) : '',
    interet: fil.interet,
    relanceLeAffiche: fil.relanceLe ? dateCourte(fil.relanceLe, fuseau) : null,
  }));

  const filSelectionneId = filDemandeId ?? resultat.fils[0]?.id ?? null;

  let filDetail: FilDetail | null = null;
  if (filSelectionneId) {
    try {
      filDetail = await lireFil(ctx, { filId: filSelectionneId });
    } catch (err) {
      if (!(err instanceof ErreurIntrouvable)) throw err;
      filDetail = null;
    }
  }

  const messagesAffiches: MessageFilAffiche[] = (filDetail?.messages ?? []).map((m) => ({
    ...m,
    quandAffiche: m.quand ? dateHeureMessage(m.quand, maintenant, fuseau) : '',
  }));

  // Canal du FIL (`lireFil().canal`, `threads.channel`) — jamais dérivé des
  // coordonnées du contact, qui peut avoir à la fois un email et un profil LinkedIn.
  const canalContact: 'email' | 'linkedin' = filDetail?.canal ?? 'email';

  return (
    <main className="jr-reception">
      <ListeFils
        t={t}
        fils={fils}
        compteurs={resultat.compteurs}
        filtreActif={filtre}
        campagneId={campagneId}
        campagnes={campagnes.map((c) => ({ id: c.id, nom: c.nom }))}
        filSelectionneId={filSelectionneId}
      />
      {filDetail && filSelectionneId ? (
        <>
          <Fil
            t={t}
            filId={filSelectionneId}
            contact={filDetail.contact}
            canal={canalContact}
            campagne={filDetail.campagne}
            boite={filDetail.boite}
            messages={messagesAffiches}
            interet={filDetail.interet}
            traite={filDetail.traite}
            reponsePossible={filDetail.reponsePossible}
            raisonReponseImpossible={filDetail.raisonReponseImpossible}
            transportReponse={filDetail.transportReponse}
          />
          <ColonneContact
            t={t}
            contact={filDetail.contact}
            canal={canalContact}
            campagne={filDetail.campagne}
            pourquoi={filDetail.pourquoi}
            pourquoiQuandAffiche={filDetail.pourquoi?.quand ? dateRelativeCourte(filDetail.pourquoi.quand, maintenant, fuseau) : null}
          />
        </>
      ) : (
        <div className="jr-fil">
          <EtatVide titre={t('fil.choisirTitre')} texte={t('fil.choisirTexte')} />
        </div>
      )}
    </main>
  );
}

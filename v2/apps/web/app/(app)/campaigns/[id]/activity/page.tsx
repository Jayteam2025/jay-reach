import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable, lireReglages, listerActivite, type Evenement } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { FILTRES_ACTIVITE, JournalCampagne, type FiltreActiviteCampagne } from '../../../../../components/campagne/JournalCampagne';

export const revalidate = 0;

// Dupliqué volontairement de `TAILLE_PAGE_ACTIVITE` (non exportée,
// `packages/core/src/fonctions/campagnes.ts`) — même convention que
// `TAILLE_PAGE` de `contacts/page.tsx`.
const TAILLE_PAGE = 20;

function filtreDemande(brut: string | string[] | undefined): FiltreActiviteCampagne {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  return (FILTRES_ACTIVITE as readonly string[]).includes(valeur ?? '') ? (valeur as FiltreActiviteCampagne) : 'tout';
}

function pageDemandee(brut: string | string[] | undefined): number {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  const n = Number(valeur);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

export default async function CampagneActivitePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp] = await Promise.all([getTranslations('campagne.activite'), searchParams]);

  const filtre = filtreDemande(sp.filtre);
  const page = pageDemandee(sp.page);

  let resultat: Awaited<ReturnType<typeof listerActivite>>;
  try {
    resultat = await listerActivite(ctx, { campagneId: id, filtre, page });
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }
  // Fuseau de l'organisation (R53) : le regroupement par jour du journal
  // suit ce fuseau, pas celui du serveur qui rend la page.
  const reglages = await lireReglages(ctx);
  const fuseau = String(reglages.fuseau);
  const maintenant = new Date();

  const total = resultat.total;
  const debut = total === 0 ? 0 : (page - 1) * TAILLE_PAGE + 1;
  const fin = Math.min(page * TAILLE_PAGE, total);
  const dernierePage = Math.max(1, Math.ceil(total / TAILLE_PAGE));

  function lienPage(p: number): string {
    const qs = new URLSearchParams();
    if (filtre !== 'tout') qs.set('filtre', filtre);
    qs.set('page', String(p));
    return `/campaigns/${id}/activity?${qs.toString()}`;
  }

  const libellesFiltres = Object.fromEntries(FILTRES_ACTIVITE.map((f) => [f, t(`filters.${f}`)])) as Record<
    FiltreActiviteCampagne,
    string
  >;

  // Revue F5, point 4 : le cœur ne construit plus le texte de l'événement synthétique
  // « envois groupés » (`Evenement.donneesEnvois`) — cette page le rend via ses propres
  // clés ICU (`envoisGroupes.withStep`/`withoutStep`), avec ou sans étape connue.
  function libelleEnvoisGroupes(donnees: NonNullable<Evenement['donneesEnvois']>): string {
    return donnees.etape !== null
      ? t('envoisGroupes.withStep', { n: donnees.n, etape: donnees.etape, boites: donnees.boites })
      : t('envoisGroupes.withoutStep', { n: donnees.n, boites: donnees.boites });
  }

  return (
    <section className="jr-contenu une-colonne">
      <JournalCampagne
        base={`/campaigns/${id}/activity`}
        filtreActif={filtre}
        evenements={resultat.evenements}
        maintenant={maintenant}
        fuseau={fuseau}
        libelles={{
          filtres: libellesFiltres,
          videTitre: t('empty.title'),
          videTexte: t('empty.text'),
          videFiltre: t('emptyFilter'),
        }}
        libelleEnvoisGroupes={libelleEnvoisGroupes}
      />

      {total > 0 && (
        <div className="jr-secondaire jr-ligne-entre">
          <span>{t('pageRange', { debut, fin, total })}</span>
          {dernierePage > 1 && (
            <span className="jr-actions large">
              {page > 1 ? (
                <Link href={lienPage(page - 1)} className="jr-lien">
                  {t('previous')}
                </Link>
              ) : (
                <span>{t('previous')}</span>
              )}
              <span>{t('pageOf', { page, dernierePage })}</span>
              {page < dernierePage ? (
                <Link href={lienPage(page + 1)} className="jr-lien">
                  {t('next')}
                </Link>
              ) : (
                <span>{t('next')}</span>
              )}
            </span>
          )}
        </div>
      )}
    </section>
  );
}

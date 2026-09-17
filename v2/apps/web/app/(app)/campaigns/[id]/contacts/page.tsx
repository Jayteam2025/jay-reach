import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable, lireFiche, lireReglages, listerContactsCampagne, ORDRE_STATUTS } from '@jay-reach/core';
import type { StatutContactCampagne } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { Carte } from '../../../../../components/ui';
import { FiltresStatuts } from '../../../../../components/campagne/FiltresStatuts';
import { TableContacts, type LigneTableContacts } from '../../../../../components/campagne/TableContacts';
import { texteEtape } from '../../../../../lib/etape-contact';
import { libelleMotifPause } from '../../../../../lib/motif-pause';
import { TiroirFiche } from '../../../../../components/contact/TiroirFiche';

export const revalidate = 0;

// Dupliqué volontairement de `TAILLE_PAGE_CONTACTS` (non exportée,
// `packages/core/src/fonctions/campagnes.ts`) — même convention que les
// petites constantes locales de ce fichier (`NOMBRE_FILS_APERCU` etc.) :
// pas de couplage cross-fichier pour une seule valeur.
const TAILLE_PAGE = 50;

function filtreDemande(brut: string | string[] | undefined): StatutContactCampagne | 'tous' {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  if (valeur === 'tous' || (valeur && (ORDRE_STATUTS as readonly string[]).includes(valeur))) {
    return valeur as StatutContactCampagne | 'tous';
  }
  return 'tous';
}

function pageDemandee(brut: string | string[] | undefined): number {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  const n = Number(valeur);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function rechercheDemandee(brut: string | string[] | undefined): string | undefined {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  return valeur && valeur.trim() !== '' ? valeur.trim() : undefined;
}

export default async function CampagneContactsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp] = await Promise.all([getTranslations('campagne'), searchParams]);

  const filtre = filtreDemande(sp.filtre);
  const recherche = rechercheDemandee(sp.q);
  const page = pageDemandee(sp.page);

  let resultat: Awaited<ReturnType<typeof listerContactsCampagne>>;
  try {
    resultat = await listerContactsCampagne(ctx, { campagneId: id, filtre, recherche, page });
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }

  const total = resultat.total;
  const debut = total === 0 ? 0 : (page - 1) * TAILLE_PAGE + 1;
  const fin = Math.min(page * TAILLE_PAGE, total);
  const dernierePage = Math.max(1, Math.ceil(total / TAILLE_PAGE));

  const libellesStatut = Object.fromEntries(ORDRE_STATUTS.map((s) => [s, t(`contacts.status.${s}`)])) as Record<
    StatutContactCampagne,
    string
  >;

  const lignes: LigneTableContacts[] = resultat.lignes.map((ligne) => ({
    ...ligne,
    etapeTexte: texteEtape(ligne.etape, ligne.statut, libellesStatut[ligne.statut], (cle, valeurs) =>
      t(`contacts.${cle}`, valeurs),
    ),
    motifPauseAffiche:
      ligne.statut === 'en_pause' && ligne.motifPause
        ? libelleMotifPause(ligne.motifPause, ligne.repriseLe, (cle, valeurs) => t(`contacts.pause.${cle}`, valeurs))
        : null,
  }));

  function lienPage(p: number): string {
    const qs = new URLSearchParams();
    if (filtre !== 'tous') qs.set('filtre', filtre);
    if (recherche) qs.set('q', recherche);
    qs.set('page', String(p));
    return `/campaigns/${id}/contacts?${qs.toString()}`;
  }

  // Tiroir fiche contact (tâche 17) : `TableContacts` (tâche 10) ouvre
  // `?contact=<id>` sur le nom d'une ligne. Un id invalide, hors organisation,
  // ou un contact supprimé entre-temps efface simplement le paramètre plutôt
  // que de faire échouer toute la page (même parade que `?relire=` dans
  // `queue/page.tsx`).
  const brutContact = Array.isArray(sp.contact) ? sp.contact[0] : sp.contact;
  let fiche: Awaited<ReturnType<typeof lireFiche>> | null = null;
  if (brutContact) {
    try {
      fiche = await lireFiche(ctx, { contactId: brutContact, campagneId: id });
    } catch (err) {
      if (!(err instanceof ErreurIntrouvable)) throw err;
    }
  }
  const fermerHref = (() => {
    const qs = new URLSearchParams();
    if (filtre !== 'tous') qs.set('filtre', filtre);
    if (recherche) qs.set('q', recherche);
    if (page > 1) qs.set('page', String(page));
    const suffixe = qs.toString();
    return `/campaigns/${id}/contacts${suffixe ? `?${suffixe}` : ''}`;
  })();
  const reglages = fiche ? await lireReglages(ctx) : null;

  return (
    <section className="jr-contenu une-colonne">
      <div className="jr-ligne-entre">
        <FiltresStatuts
          base={`/campaigns/${id}/contacts`}
          compteurs={resultat.compteurs}
          filtreActif={filtre}
          recherche={recherche}
          libelles={{ tous: t('contacts.filters.all'), ...libellesStatut }}
        />
        <form method="get" className="jr-actions">
          <input type="hidden" name="filtre" value={filtre} />
          <input
            className="jr-champ jr-champ-recherche"
            type="search"
            name="q"
            autoComplete="off"
            defaultValue={recherche ?? ''}
            placeholder={t('contacts.search')}
          />
        </form>
      </div>

      <Carte>
        {resultat.lignes.length === 0 ? (
          <div className="jr-vide">{t('contacts.empty')}</div>
        ) : (
          <TableContacts lignes={lignes} colonnes="campagne" organisationId={ctx.organisationId} campagneId={id} libelles={{
            colonneContact: t('contacts.columns.contact'),
            colonnePourquoi: t('contacts.columns.why'),
            colonneScore: t('contacts.columns.score'),
            colonneEmail: t('contacts.columns.email'),
            colonneEtape: t('contacts.columns.step'),
            colonneCampagne: t('contacts.columns.campaign'),
            colonneAction: t('contacts.columns.status'),
            emailVerifie: t('contacts.email.verified'),
            emailATrouver: t('contacts.email.toFind'),
            sansEtape: t('contacts.noStep'),
            statut: libellesStatut,
            chercherEmail: t('contacts.actions.enrich'),
            coutChercherEmail: t('contacts.actions.enrichCost'),
            ecarter: t('contacts.actions.discard'),
            reprendre: t('contacts.actions.resume'),
            reprendreMaintenant: t('contacts.actions.resumeNow'),
            vide: t('contacts.emptyFilter'),
          }} />
        )}
      </Carte>

      {total > 0 && (
        <div className="jr-secondaire jr-ligne-entre">
          <span>{t('contacts.pageRange', { debut, fin, total })}</span>
          {dernierePage > 1 && (
            <span className="jr-actions large">
              {page > 1 ? (
                <Link href={lienPage(page - 1)} className="jr-lien">
                  {t('contacts.previous')}
                </Link>
              ) : (
                <span>{t('contacts.previous')}</span>
              )}
              <span>{t('contacts.pageOf', { page, dernierePage })}</span>
              {page < dernierePage ? (
                <Link href={lienPage(page + 1)} className="jr-lien">
                  {t('contacts.next')}
                </Link>
              ) : (
                <span>{t('contacts.next')}</span>
              )}
            </span>
          )}
        </div>
      )}

      {fiche && reglages && (
        <TiroirFiche fiche={fiche} campagneId={id} fuseau={String(reglages.fuseau)} fermerHref={fermerHref} />
      )}
    </section>
  );
}

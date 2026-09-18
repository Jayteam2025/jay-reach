import type { ReactNode } from 'react';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import {
  ErreurIntrouvable,
  lireFiche,
  lireReglages,
  listerCampagnes,
  listerClientsEtExclusions,
  listerContacts,
  listerEntreprises,
  ORDRE_STATUTS,
} from '@jay-reach/core';
import type { StatutContactCampagne } from '@jay-reach/core';
import { contexteCourant } from '../../../lib/contexte';
import { texteEtape } from '../../../lib/etape-contact';
import { libelleMotifPause, libelleProchainMessage } from '../../../lib/motif-pause';
import { Carte, Champ, EnTetePage, Onglets } from '../../../components/ui';
import { TableContacts, type LigneTableContacts } from '../../../components/campagne/TableContacts';
import { TableEntreprises } from '../../../components/contact/TableEntreprises';
import { TableExclusions } from '../../../components/contact/TableExclusions';
import { ImportContacts } from '../../../components/contact/ImportContacts';
import { TiroirFiche } from '../../../components/contact/TiroirFiche';

export const revalidate = 0;

const TAILLE_PAGE = 50;

type Onglet = 'tous' | 'entreprises' | 'clients';
type SP = Record<string, string | string[] | undefined>;

function param(sp: SP, cle: string): string | undefined {
  const v = sp[cle];
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() !== '' ? s.trim() : undefined;
}

function ongletDemande(sp: SP): Onglet {
  const v = param(sp, 'onglet');
  return v === 'entreprises' || v === 'clients' ? v : 'tous';
}

function pageDemandee(sp: SP): number {
  const n = Number(param(sp, 'page'));
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

function filtreDemande(sp: SP): StatutContactCampagne | 'tous' {
  const v = param(sp, 'etat');
  if (v === 'tous' || (v && (ORDRE_STATUTS as readonly string[]).includes(v))) return v as StatutContactCampagne | 'tous';
  return 'tous';
}

function emailDemande(sp: SP): 'verifie' | 'a_trouver' | undefined {
  const v = param(sp, 'email');
  return v === 'verifie' || v === 'a_trouver' ? v : undefined;
}

function sourceDemandee(sp: SP): 'adzuna' | 'francetravail' | 'linkedin' | 'manuel' | undefined {
  const v = param(sp, 'source');
  return v === 'adzuna' || v === 'francetravail' || v === 'linkedin' || v === 'manuel' ? v : undefined;
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?campagne=` mal formé (URL modifiée à la main) : ignoré plutôt que de laisser `listerContacts` lever `ErreurEntree` (schéma `.uuid()`) et faire échouer toute la page. */
function campagneIdDemandee(sp: SP): string | undefined {
  const v = param(sp, 'campagne');
  return v && RE_UUID.test(v) ? v : undefined;
}

/** Reconstruit la query string des filtres courants de l'onglet « Tous les contacts » — réutilisé par l'export CSV, `fermerHref` et la pagination. */
function qsFiltres(args: {
  filtre: StatutContactCampagne | 'tous';
  campagneId?: string;
  email?: string;
  source?: string;
  recherche?: string;
  page?: number;
}): URLSearchParams {
  const qs = new URLSearchParams();
  if (args.filtre !== 'tous') qs.set('etat', args.filtre);
  if (args.campagneId) qs.set('campagne', args.campagneId);
  if (args.email) qs.set('email', args.email);
  if (args.source) qs.set('source', args.source);
  if (args.recherche) qs.set('q', args.recherche);
  if (args.page && args.page > 1) qs.set('page', String(args.page));
  return qs;
}

export default async function ContactsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await contexteCourant();
  const [t, sp, campagnesRes, reglages] = await Promise.all([
    getTranslations('contacts'),
    searchParams,
    listerCampagnes(ctx),
    lireReglages(ctx),
  ]);

  const onglet = ongletDemande(sp);
  const fuseau = String(reglages.fuseau);
  // `statut` (F14) : `ImportContacts` avertit quand la campagne choisie n'est
  // pas active — une inscription y entre `active` dès l'import, mais rien ne
  // partira tant que la campagne elle-même ne l'est pas (`tickDueEnrollments`,
  // `apps/worker/src/handlers/sequence.ts`).
  const campagnesOptions = campagnesRes.map((c) => ({ id: c.id, nom: c.nom, statut: c.statut }));
  const peutAjouterClient = ctx.role === 'admin' || ctx.role === 'owner';
  const peutAjouterSuppression = ctx.role === 'operator' || ctx.role === 'admin' || ctx.role === 'owner';

  const filtre = filtreDemande(sp);
  const campagneFiltre = campagneIdDemandee(sp);
  const emailFiltre = emailDemande(sp);
  const sourceFiltre = sourceDemandee(sp);
  const recherche = param(sp, 'q');
  const page = pageDemandee(sp);

  let contenu: ReactNode;
  let compteurTous: number | undefined;
  let compteurEntreprises: number | undefined;
  let compteurClients: number | undefined;
  let fiche: Awaited<ReturnType<typeof lireFiche>> | null = null;
  let fermerHref = '/contacts?onglet=tous';

  if (onglet === 'entreprises') {
    const resultat = await listerEntreprises(ctx, { recherche, page });
    compteurEntreprises = resultat.total;
    const total = resultat.total;
    const debut = total === 0 ? 0 : (page - 1) * TAILLE_PAGE + 1;
    const fin = Math.min(page * TAILLE_PAGE, total);
    const dernierePage = Math.max(1, Math.ceil(total / TAILLE_PAGE));

    contenu = (
      <>
        <Carte>
          {resultat.lignes.length === 0 ? (
            <div className="jr-vide">{t('companies.empty')}</div>
          ) : (
            <TableEntreprises
              lignes={resultat.lignes}
              libelles={{
                colonneEntreprise: t('companies.columns.company'),
                colonneSecteur: t('companies.columns.sector'),
                colonneTaille: t('companies.columns.size'),
                colonneVille: t('companies.columns.city'),
                colonneContacts: t('companies.columns.contacts'),
                colonneLiens: t('companies.columns.links'),
                site: t('companies.site'),
                inconnu: t('companies.unknown'),
                vide: t('companies.empty'),
              }}
            />
          )}
        </Carte>
        {total > 0 && dernierePage > 1 && (
          <div className="jr-secondaire jr-ligne-entre">
            <span>{t('companies.pageRange', { debut, fin, total })}</span>
            <span className="jr-actions large">
              {page > 1 ? (
                <Link href={`/contacts?onglet=entreprises&page=${page - 1}`} className="jr-lien">
                  {t('companies.previous')}
                </Link>
              ) : (
                <span>{t('companies.previous')}</span>
              )}
              <span>{t('companies.pageOf', { page, dernierePage })}</span>
              {page < dernierePage ? (
                <Link href={`/contacts?onglet=entreprises&page=${page + 1}`} className="jr-lien">
                  {t('companies.next')}
                </Link>
              ) : (
                <span>{t('companies.next')}</span>
              )}
            </span>
          </div>
        )}
      </>
    );
  } else if (onglet === 'clients') {
    const resultat = await listerClientsEtExclusions(ctx, {});
    compteurClients = resultat.lignes.length;
    contenu = (
      <TableExclusions
        lignes={resultat.lignes}
        peutAjouterClient={peutAjouterClient}
        peutAjouterSuppression={peutAjouterSuppression}
        tronque={resultat.tronque}
        fuseau={String(reglages.fuseau)}
      />
    );
  } else {
    const resultat = await listerContacts(ctx, {
      filtre,
      campagneId: campagneFiltre,
      email: emailFiltre,
      source: sourceFiltre,
      recherche,
      page,
    });
    compteurTous = resultat.total;

    const libellesStatut = Object.fromEntries(ORDRE_STATUTS.map((s) => [s, t(`status.${s}`)])) as Record<
      StatutContactCampagne,
      string
    >;
    const lignes: LigneTableContacts[] = resultat.lignes.map((ligne) => ({
      ...ligne,
      etapeTexte: texteEtape(ligne.etape, ligne.statut, libellesStatut[ligne.statut], t),
      motifPauseAffiche:
        ligne.statut === 'en_pause' && ligne.motifPause
          ? libelleMotifPause(ligne.motifPause, ligne.repriseLe, (cle, valeurs) => t(`pause.${cle}`, valeurs), fuseau)
          : null,
      prochainMessageAffiche: libelleProchainMessage(ligne.prochainMessageLe, (cle, valeurs) => t(cle, valeurs), fuseau),
    }));

    const total = resultat.total;
    const debut = total === 0 ? 0 : (page - 1) * TAILLE_PAGE + 1;
    const fin = Math.min(page * TAILLE_PAGE, total);
    const dernierePage = Math.max(1, Math.ceil(total / TAILLE_PAGE));

    const basePage = (p: number) => {
      const qs = qsFiltres({ filtre, campagneId: campagneFiltre, email: emailFiltre, source: sourceFiltre, recherche, page: p });
      qs.set('onglet', 'tous');
      return `/contacts?${qs.toString()}`;
    };

    fermerHref = (() => {
      const qs = qsFiltres({ filtre, campagneId: campagneFiltre, email: emailFiltre, source: sourceFiltre, recherche, page });
      qs.set('onglet', 'tous');
      return `/contacts?${qs.toString()}`;
    })();

    const brutContact = param(sp, 'contact');
    if (brutContact && RE_UUID.test(brutContact)) {
      try {
        fiche = await lireFiche(ctx, { contactId: brutContact });
      } catch (err) {
        if (!(err instanceof ErreurIntrouvable)) throw err;
      }
    }

    contenu = (
      <>
        {resultat.tronque && <p className="jr-secondaire">{t('truncated')}</p>}
        {/* Une seule ligne de filtres (tour de correction F6, point 24) : sélecteurs à largeur
            minimale cohérente + recherche + bouton, alignés sur le bas de chaque contrôle
            (`align-items: flex-end`) puisque seuls les sélecteurs portent un libellé au-dessus ;
            passe sur plusieurs lignes sans se coller sous 1280 px (`flex-wrap`). */}
        <form method="get" className="jr-groupe-filtres">
          <input type="hidden" name="onglet" value="tous" />
          <Champ libelle={t('filters.campaign')} className="jr-champ-filtre">
            <select name="campagne" defaultValue={campagneFiltre ?? ''}>
              <option value="">{t('filters.campaignAll')}</option>
              {campagnesOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nom}
                </option>
              ))}
            </select>
          </Champ>
          <Champ libelle={t('filters.status')} className="jr-champ-filtre">
            <select name="etat" defaultValue={filtre}>
              <option value="tous">{t('filters.statusAll')}</option>
              {ORDRE_STATUTS.map((s) => (
                <option key={s} value={s}>
                  {libellesStatut[s]}
                </option>
              ))}
            </select>
          </Champ>
          <Champ libelle={t('filters.email')} className="jr-champ-filtre">
            <select name="email" defaultValue={emailFiltre ?? ''}>
              <option value="">{t('filters.emailAll')}</option>
              <option value="verifie">{t('email.verified')}</option>
              <option value="a_trouver">{t('email.toFind')}</option>
            </select>
          </Champ>
          <Champ libelle={t('filters.source')} className="jr-champ-filtre">
            <select name="source" defaultValue={sourceFiltre ?? ''}>
              <option value="">{t('filters.sourceAll')}</option>
              <option value="adzuna">{'Adzuna'}</option>
              <option value="francetravail">{'France Travail'}</option>
              <option value="linkedin">{'LinkedIn'}</option>
              <option value="manuel">{t('filters.sourceManual')}</option>
            </select>
          </Champ>
          <input
            className="jr-champ jr-champ-recherche"
            type="search"
            name="q"
            autoComplete="off"
            defaultValue={recherche ?? ''}
            placeholder={t('filters.search')}
          />
          <button type="submit" className="jr-bouton petit">
            {t('filters.apply')}
          </button>
        </form>

        <Carte>
          {resultat.lignes.length === 0 ? (
            <div className="jr-vide">{t('empty')}</div>
          ) : (
            <TableContacts
              lignes={lignes}
              colonnes="global"
              organisationId={ctx.organisationId}
              libelles={{
                colonneContact: t('columns.contact'),
                colonnePourquoi: t('columns.why'),
                colonneScore: t('columns.score'),
                colonneEmail: t('columns.email'),
                colonneEtape: t('columns.step'),
                colonneCampagne: t('columns.campaign'),
                colonneAction: t('columns.status'),
                emailVerifie: t('email.verified'),
                emailATrouver: t('email.toFind'),
                sansEtape: t('noStep'),
                statut: libellesStatut,
                chercherEmail: t('actions.enrich'),
                coutChercherEmail: t('actions.enrichCost'),
                ecarter: t('actions.discard'),
                reprendre: t('actions.resume'),
                vide: t('empty'),
              }}
            />
          )}
        </Carte>

        {total > 0 && (
          <div className="jr-secondaire jr-ligne-entre">
            <span>{t('pageRange', { debut, fin, total })}</span>
            {dernierePage > 1 && (
              <span className="jr-actions large">
                {page > 1 ? (
                  <Link href={basePage(page - 1)} className="jr-lien">
                    {t('previous')}
                  </Link>
                ) : (
                  <span>{t('previous')}</span>
                )}
                <span>{t('pageOf', { page, dernierePage })}</span>
                {page < dernierePage ? (
                  <Link href={basePage(page + 1)} className="jr-lien">
                    {t('next')}
                  </Link>
                ) : (
                  <span>{t('next')}</span>
                )}
              </span>
            )}
          </div>
        )}
      </>
    );
  }

  const qsExport = qsFiltres({ filtre, campagneId: campagneFiltre, email: emailFiltre, source: sourceFiltre, recherche });

  return (
    <>
      <EnTetePage
        titre={t('title')}
        description={t('description')}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            <ImportContacts campagnes={campagnesOptions} />
            {onglet === 'tous' && (
              <Link href={`/contacts/export${qsExport.toString() ? `?${qsExport.toString()}` : ''}`} className="jr-bouton">
                {t('export')}
              </Link>
            )}
          </div>
        }
      />
      <Onglets
        actif={`/contacts?onglet=${onglet}`}
        onglets={[
          { href: '/contacts?onglet=tous', libelle: t('tabs.all'), compteur: compteurTous },
          { href: '/contacts?onglet=entreprises', libelle: t('tabs.companies'), compteur: compteurEntreprises },
          { href: '/contacts?onglet=clients', libelle: t('tabs.customers'), compteur: compteurClients },
        ]}
      />
      <section className="jr-contenu une-colonne">{contenu}</section>

      {onglet === 'tous' && fiche && (
        <TiroirFiche fiche={fiche} fuseau={String(reglages.fuseau)} fermerHref={fermerHref} />
      )}
    </>
  );
}

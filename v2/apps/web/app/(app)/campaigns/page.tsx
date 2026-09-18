import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listerCampagnes, campaignStatusSchema } from '@jay-reach/core';
import type { CampaignStatus } from '@jay-reach/core';
import type { Locale } from '@jay-reach/i18n';
import { contexteCourant } from '../../../lib/contexte';
import { dateRelativeCourte } from '../../../lib/dates';
import { formatNombre, formatPourcentage, localeCourante } from '../../../lib/nombres';
import { Carte, EnTetePage, EtatVide, Puce, Table, TuileLogo } from '../../../components/ui';
import type { PuceTon } from '../../../components/ui';
import { PileDeBoites } from '../../../components/campagne/PileDeBoites';

export const revalidate = 60;

const TON_STATUT_CAMPAGNE: Record<CampaignStatus, PuceTon> = {
  draft: 'gris',
  active: 'bon',
  paused: 'attention',
  archived: 'gris',
};

/**
 * Revue F5, point 7 : harmonisation avec Aujourd'hui et la vue d'ensemble de campagne — un
 * taux sans base réelle (aucun envoi parti, `tauxSurPartis` rend `null`) affiche « 0 », jamais
 * un tiret ni rien du tout (cette colonne ne montrait alors même plus le signe %).
 */
function tauxOuZero(taux: number | null, locale: Locale): string {
  return taux !== null ? formatPourcentage(taux, locale) : '0';
}

/** `?etat=` : un statut connu, sinon aucun filtre (une valeur inconnue ne casse jamais la page). */
function etatDemande(brut: string | string[] | undefined): CampaignStatus | undefined {
  const valeur = Array.isArray(brut) ? brut[0] : brut;
  const r = campaignStatusSchema.safeParse(valeur);
  return r.success ? r.data : undefined;
}

function classePuce(actif: boolean): string {
  return ['jr-puce', actif ? 'accent' : undefined].filter(Boolean).join(' ');
}

/**
 * Puces de filtre, cliquables (tour de correction 1, point 6) : chaque puce
 * est un lien vers `?etat=...` (ou vers `/campaigns` sans paramètre pour
 * « Toutes »), le filtrage se fait ici, à la lecture de `searchParams` — pas
 * d'état client, la page reste un composant serveur.
 */
function PucesDeFiltre({
  campagnes,
  etat,
  t,
}: {
  campagnes: { statut: CampaignStatus }[];
  etat: CampaignStatus | undefined;
  t: (cle: string, valeurs: Record<string, number>) => string;
}) {
  const compte = (statut: CampaignStatus) => campagnes.filter((c) => c.statut === statut).length;
  return (
    <div className="jr-puces">
      <Link href="/campaigns" className={classePuce(etat === undefined)}>
        {t('list.filters.all', { n: campagnes.length })}
      </Link>
      <Link href="/campaigns?etat=active" className={classePuce(etat === 'active')}>
        {t('list.filters.active', { n: compte('active') })}
      </Link>
      <Link href="/campaigns?etat=paused" className={classePuce(etat === 'paused')}>
        {t('list.filters.paused', { n: compte('paused') })}
      </Link>
      <Link href="/campaigns?etat=draft" className={classePuce(etat === 'draft')}>
        {t('list.filters.draft', { n: compte('draft') })}
      </Link>
      <Link href="/campaigns?etat=archived" className={classePuce(etat === 'archived')}>
        {t('list.filters.archived', { n: compte('archived') })}
      </Link>
    </div>
  );
}

export default async function CampagnesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const ctx = await contexteCourant();
  const [t, locale, sp, campagnes] = await Promise.all([
    getTranslations('campagne'),
    localeCourante(),
    searchParams,
    listerCampagnes(ctx),
  ]);
  const etat = etatDemande(sp.etat);
  const campagnesAffichees = etat ? campagnes.filter((c) => c.statut === etat) : campagnes;

  return (
    <>
      <EnTetePage
        titre={t('list.title')}
        description={t('list.description')}
        action={
          <Link href="/campaigns/new" className="jr-bouton sombre">
            {t('list.new')}
          </Link>
        }
      />
      <section className="jr-contenu une-colonne">
        <PucesDeFiltre campagnes={campagnes} etat={etat} t={t} />

        {campagnes.length === 0 ? (
          <EtatVide
            titre={t('list.empty.title')}
            texte={t('list.empty.text')}
            action={
              <Link href="/campaigns/new" className="jr-bouton">
                {t('list.empty.action')}
              </Link>
            }
          />
        ) : campagnesAffichees.length === 0 ? (
          <Carte>
            <div className="jr-vide">{t('list.emptyFilter')}</div>
          </Carte>
        ) : (
          <Carte>
            <Table
              colonnes={[
                { cle: 'campagne', titre: t('list.columns.campaign') },
                { cle: 'statut', titre: t('list.columns.status') },
                { cle: 'boites', titre: t('list.columns.boxes'), classe: 'masquable' },
                { cle: 'contacts', titre: t('list.columns.contacts'), num: true },
                { cle: 'sequence', titre: t('list.columns.sequence'), num: true },
                { cle: 'reponses', titre: t('list.columns.replies'), num: true },
                { cle: 'interesses', titre: t('list.columns.interested'), num: true },
                { cle: 'activite', titre: t('list.columns.lastActivity'), classe: 'masquable' },
                { cle: 'action', titre: '' },
              ]}
              lignes={campagnesAffichees.map((campagne) => {
                return {
                  campagne: (
                    <div className="jr-qui">
                      <TuileLogo marque="lettre" lettre={campagne.nom.charAt(0).toUpperCase()} />
                      <span>
                        <b>{campagne.nom}</b>
                        <small>
                          {t('list.persona', { nom: campagne.nom })}
                          {' · '}
                          {campagne.sources.length > 0
                            ? t('list.sourcesCount', { n: campagne.sources.length })
                            : campagne.listeSource
                              // Campagne à liste (point 2, issue #120 ; revue F5, point 1) :
                              // le nom de la liste remplace « aucune source ».
                              ? t('list.listSource', { nom: campagne.listeSource.nom, autres: campagne.listeSource.autresListes })
                              : t('list.noSource')}
                        </small>
                      </span>
                    </div>
                  ),
                  statut: (
                    <Puce ton={TON_STATUT_CAMPAGNE[campagne.statut]} point={campagne.statut !== 'draft'}>
                      {t(`status.${campagne.statut}`)}
                    </Puce>
                  ),
                  boites:
                    campagne.boites.length === 0 ? (
                      <span className="jr-secondaire">{t('list.noBoxes')}</span>
                    ) : (
                      <PileDeBoites boites={campagne.boites} />
                    ),
                  contacts: formatNombre(campagne.contacts, locale),
                  sequence: (
                    <>
                      {formatNombre(campagne.enSequence, locale)}
                      {campagne.enPause > 0 && (
                        <small className="jr-secondaire jr-sous-valeur">{t('list.pausedCount', { n: campagne.enPause })}</small>
                      )}
                    </>
                  ),
                  reponses: (
                    <>
                      <b>{formatNombre(campagne.reponses, locale)}</b>
                      {' '}
                      <small className="jr-secondaire">{tauxOuZero(campagne.tauxReponse, locale)}</small>
                    </>
                  ),
                  interesses: formatNombre(campagne.interesses, locale),
                  activite: campagne.derniereActivite ? (
                    dateRelativeCourte(campagne.derniereActivite)
                  ) : (
                    <span className="jr-secondaire">—</span>
                  ),
                  action: (
                    <Link href={`/campaigns/${campagne.id}`} className="jr-bouton petit">
                      {campagne.statut === 'draft' ? t('list.resume') : t('list.open')}
                    </Link>
                  ),
                };
              })}
            />
          </Carte>
        )}
      </section>
    </>
  );
}

import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { listerCampagnes } from '@jay-reach/core';
import type { CampaignStatus } from '@jay-reach/core';
import { contexteCourant } from '../../../lib/contexte';
import { Carte, EnTetePage, EtatVide, Puce, Table, TuileLogo } from '../../../components/ui';
import type { PuceTon } from '../../../components/ui';

export const revalidate = 60;

const nf = new Intl.NumberFormat('fr-FR');

const TON_STATUT_CAMPAGNE: Record<CampaignStatus, PuceTon> = {
  draft: 'gris',
  active: 'bon',
  paused: 'attention',
  archived: 'gris',
};

/**
 * Puces de filtre : comptes informatifs, pas des filtres cliquables — même
 * registre que `Puce` partout ailleurs dans le kit (une étiquette en lecture
 * seule, jamais un contrôle). Câbler un vrai filtre (client, ou un paramètre
 * sur `listerCampagnes`) est un aller simple pour une prochaine tâche, pas
 * un objet de celle-ci (brief : liste, en-tête à onglets, Vue d'ensemble).
 */
function ComptesParStatut({
  campagnes,
  t,
}: {
  campagnes: { statut: CampaignStatus }[];
  t: (cle: string, valeurs: Record<string, number>) => string;
}) {
  const compte = (statut: CampaignStatus) => campagnes.filter((c) => c.statut === statut).length;
  return (
    <div className="jr-puces">
      <Puce ton="accent">{t('list.filters.all', { n: campagnes.length })}</Puce>
      <Puce>{t('list.filters.active', { n: compte('active') })}</Puce>
      <Puce>{t('list.filters.paused', { n: compte('paused') })}</Puce>
      <Puce>{t('list.filters.draft', { n: compte('draft') })}</Puce>
      <Puce>{t('list.filters.archived', { n: compte('archived') })}</Puce>
    </div>
  );
}

export default async function CampagnesPage() {
  const ctx = await contexteCourant();
  const [t, campagnes] = await Promise.all([getTranslations('campagne'), listerCampagnes(ctx)]);

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
        <ComptesParStatut campagnes={campagnes} t={t} />

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
        ) : (
          <Carte>
            <Table
              colonnes={[
                { cle: 'campagne', titre: t('list.columns.campaign') },
                { cle: 'statut', titre: t('list.columns.status') },
                { cle: 'boites', titre: t('list.columns.boxes') },
                { cle: 'contacts', titre: t('list.columns.contacts'), num: true },
                { cle: 'sequence', titre: t('list.columns.sequence'), num: true },
                { cle: 'reponses', titre: t('list.columns.replies'), num: true },
                { cle: 'interesses', titre: t('list.columns.interested'), num: true },
                { cle: 'activite', titre: t('list.columns.lastActivity') },
                { cle: 'action', titre: '' },
              ]}
              lignes={campagnes.map((campagne) => ({
                campagne: (
                  <div className="jr-qui">
                    <TuileLogo marque="lettre" lettre={campagne.nom.charAt(0).toUpperCase()} />
                    <span>
                      <b>{campagne.nom}</b>
                      <small>
                        {t('list.persona', { nom: campagne.nom })}
                        {' · '}
                        {campagne.sources.length > 0 ? t('list.sourcesCount', { n: campagne.sources.length }) : t('list.noSource')}
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
                    <span className="jr-pile">
                      {campagne.boites.map((boite) => (
                        <span key={boite.id} className="jr-avatar" style={{ background: 'var(--jr-surface)', borderColor: 'var(--jr-filet)' }}>
                          {boite.marque ? <i className={`jr-logo-inline jr-logo-${boite.marque}`} /> : boite.identite.charAt(0).toUpperCase()}
                        </span>
                      ))}
                    </span>
                  ),
                contacts: nf.format(campagne.qualifies),
                sequence: nf.format(campagne.enSequence),
                reponses:
                  campagne.qualifies === 0 ? (
                    <span className="jr-secondaire">—</span>
                  ) : (
                    <>
                      <b>{nf.format(campagne.reponses)}</b>{' '}
                      <small className="jr-secondaire">{campagne.tauxReponse.toLocaleString('fr-FR')} %</small>
                    </>
                  ),
                // Ni « intéressés » ni « dernière activité » ne sont portés par
                // `CampagneListeResume` (packages/core/src/fonctions/campagnes.ts,
                // tâche 7) : un tiret plutôt qu'une valeur inventée.
                interesses: <span className="jr-secondaire">—</span>,
                activite: <span className="jr-secondaire">—</span>,
                action: (
                  <Link href={`/campaigns/${campagne.id}`} className="jr-bouton petit">
                    {campagne.statut === 'draft' ? t('list.resume') : t('list.open')}
                  </Link>
                ),
              }))}
            />
          </Carte>
        )}
      </section>
    </>
  );
}

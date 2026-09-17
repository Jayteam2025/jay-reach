import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../lib/campagne';
import { marqueSource } from '../../../../lib/marque-source';
import { FUSEAU_PAR_DEFAUT, dateCourte } from '../../../../lib/dates';
import { Avatar, Carte, CleValeur, Entonnoir, Journal, TuileLogo } from '../../../../components/ui';

export const revalidate = 60;

const nf = new Intl.NumberFormat('fr-FR');

/** Aperçu de la file du jour affiché sur cette carte — la file complète vit dans l'onglet File du jour (tâche 11). */
const TAILLE_APERCU_FILE = 5;

function formatHeure(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU_PAR_DEFAUT }).format(new Date(iso));
}

function pourcentageTexte(valeur: number): string {
  return `${valeur.toLocaleString('fr-FR')} %`;
}

export default async function CampagneVueDEnsemblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await contexteCourant();

  let t: Awaited<ReturnType<typeof getTranslations>>;
  let tSources: Awaited<ReturnType<typeof getTranslations>>;
  let vue: Awaited<ReturnType<typeof lireVueDEnsembleCourante>>;
  try {
    [t, tSources, vue] = await Promise.all([
      getTranslations('campagne'),
      getTranslations('sources'),
      lireVueDEnsembleCourante(ctx, id),
    ]);
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }

  const apercuFile = vue.fileDuJour.slice(0, TAILLE_APERCU_FILE);
  const resteFile = vue.fileDuJour.length - apercuFile.length;
  const dejaPartis = vue.fileDuJour.filter((envoi) => envoi.envoye).length;

  // Point 1 : « — » plutôt qu'un 0 % quand rien n'est encore parti (jamais une division par
  // zéro déguisée). Point 1 : la marche « En séquence » porte aussi le nombre en pause, en
  // second libellé (même case `taux` que les pourcentages, réutilisée comme simple annotation).
  const tauxOuTiret = (taux: number | null) => (taux !== null ? pourcentageTexte(taux) : '—');
  const enPauseSuffixe = vue.entonnoir.enPause > 0 ? t('overview.funnel.pausedSuffix', { n: vue.entonnoir.enPause }) : undefined;

  // Point 2 (issue #120) : une campagne à liste n'a ni signal ni thème de veille — l'entonnoir
  // part des contacts importés plutôt que de « 0 offres et profils trouvés ».
  const etapesEntonnoir =
    vue.entonnoir.origine === 'liste'
      ? [
          { valeur: vue.entonnoir.contactsImportes, libelle: t('overview.funnel.imported') },
          { valeur: vue.entonnoir.emailVerifie, libelle: t('overview.funnel.emailVerified') },
          { valeur: vue.entonnoir.enSequence, libelle: t('overview.funnel.inSequence'), taux: enPauseSuffixe },
          { valeur: vue.entonnoir.livres, libelle: t('overview.funnel.delivered'), taux: tauxOuTiret(vue.entonnoir.tauxLivres) },
          { valeur: vue.entonnoir.reponses, libelle: t('overview.funnel.replies'), taux: tauxOuTiret(vue.entonnoir.tauxReponses) },
          { valeur: vue.entonnoir.interesses, libelle: t('overview.funnel.interested') },
        ]
      : [
          { valeur: vue.entonnoir.trouves, libelle: t('overview.funnel.found') },
          { valeur: vue.entonnoir.qualifies, libelle: t('overview.funnel.qualified') },
          { valeur: vue.entonnoir.contacts, libelle: t('overview.funnel.contactsIdentified') },
          { valeur: vue.entonnoir.enSequence, libelle: t('overview.funnel.inSequence'), taux: enPauseSuffixe },
          { valeur: vue.entonnoir.livres, libelle: t('overview.funnel.delivered'), taux: tauxOuTiret(vue.entonnoir.tauxLivres) },
          { valeur: vue.entonnoir.reponses, libelle: t('overview.funnel.replies'), taux: tauxOuTiret(vue.entonnoir.tauxReponses) },
          { valeur: vue.entonnoir.interesses, libelle: t('overview.funnel.interested') },
        ];

  return (
    <section className="jr-contenu">
      <Carte className="pleine">
        <Entonnoir etapes={etapesEntonnoir} />
      </Carte>

      <Carte
        titre={t('overview.queue.title')}
        action={
          <>
            <small>{t('overview.queue.count', { envois: vue.fileDuJour.length, partis: dejaPartis })}</small>
            <Link href={`/campaigns/${id}/queue`} className="jr-lien jr-lien-petit">
              {t('overview.queue.seeAll')}
            </Link>
          </>
        }
      >
        {apercuFile.length === 0 ? (
          <div className="jr-vide">{t('overview.queue.empty')}</div>
        ) : (
          <table className="jr-table">
            <tbody>
              {apercuFile.map((envoi) => (
                <tr key={envoi.id}>
                  <td className="jr-sans-retrait-gauche">{envoi.heure ?? '—'}</td>
                  <td>
                    <div className="jr-qui">
                      <Avatar nom={envoi.contactNom} canal={envoi.canal} />
                      <span>
                        <b>{envoi.contactNom}</b>
                        <small>{envoi.etape !== null ? t('overview.queue.step', { n: envoi.etape }) : ''}</small>
                      </span>
                    </div>
                  </td>
                  <td className="jr-secondaire jr-sans-retrait-droite">
                    {envoi.expediteur ?? '—'}
                  </td>
                </tr>
              ))}
              {resteFile > 0 && (
                <tr>
                  <td colSpan={3} className="jr-secondaire jr-sans-retrait-gauche">
                    {t('overview.queue.andMore', { n: resteFile })}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Carte>

      <div className="jr-colonne-cartes">
        <Carte titre={t('overview.caps.title')}>
          <CleValeur
            libelle={t('overview.caps.scoring')}
            valeur={`${nf.format(vue.plafonds.scoring.utilise)} / ${nf.format(vue.plafonds.scoring.plafond)}`}
          />
          <CleValeur
            libelle={t('overview.caps.enrichment')}
            valeur={`${nf.format(vue.plafonds.enrichissement.utilise)} / ${nf.format(vue.plafonds.enrichissement.plafond)}`}
          />
          <CleValeur
            libelle={t('overview.caps.sending', { n: vue.campagne.boites.length })}
            valeur={`${nf.format(vue.plafonds.envois.utilise)} / ${nf.format(vue.plafonds.envois.plafond)}`}
          />
          <Link href="/settings" className="jr-lien jr-lien-petit jr-lien-pied">
            {t('overview.caps.settingsLink')}
          </Link>
        </Carte>

        {vue.listeSource ? (
          // Point 2 (issue #120) : une campagne à liste montre la liste elle-même
          // (nom, contacts, date d'import), plus jamais « Aucune source reliée ».
          <Carte titre={t('overview.sources.title')}>
            <div className="jr-source">
              <TuileLogo marque="lettre" lettre={vue.listeSource.nom.charAt(0).toUpperCase()} />
              <span>
                <b>{vue.listeSource.nom}</b>
                <small>
                  {t('overview.sources.listSubtitle', {
                    n: vue.listeSource.contacts,
                    date: dateCourte(vue.listeSource.importeeLe, new Date(), FUSEAU_PAR_DEFAUT),
                  })}
                </small>
              </span>
            </div>
          </Carte>
        ) : (
          <Carte titre={t('overview.sources.title')} action={<small>{t('overview.sources.count', { n: vue.sources.length })}</small>}>
            {vue.sources.length === 0 ? (
              <p className="jr-secondaire">{t('overview.sources.empty')}</p>
            ) : (
              vue.sources.map((source) => {
                const cleFournisseur = `fournisseurs.${source.providerId}`;
                const libelleFournisseur = source.providerId && tSources.has(cleFournisseur) ? tSources(cleFournisseur) : null;
                return (
                  <div className="jr-source" key={source.id}>
                    <TuileLogo marque={marqueSource(source.providerId)} lettre={source.nom.charAt(0).toUpperCase()} />
                    <span>
                      <b>{source.nom}</b>
                      {libelleFournisseur && libelleFournisseur !== source.nom && <small>{libelleFournisseur}</small>}
                    </span>
                  </div>
                );
              })
            )}
          </Carte>
        )}
      </div>

      <Carte
        className="pleine"
        titre={t('overview.activity.title')}
        action={
          <>
            <small>{t('overview.activity.subtitle')}</small>
            <Link href={`/campaigns/${id}/activity`} className="jr-lien jr-lien-petit">
              {t('overview.activity.seeAll')}
            </Link>
          </>
        }
      >
        {vue.activite.length === 0 ? (
          <p className="jr-secondaire">{t('overview.activity.empty')}</p>
        ) : (
          <Journal
            entrees={vue.activite.map((evenement) => ({
              heure: formatHeure(evenement.quand),
              texte: evenement.libelle,
              note: evenement.detail,
              ton: evenement.type === 'engine_error' ? ('erreur' as const) : undefined,
            }))}
          />
        )}
      </Carte>
    </section>
  );
}

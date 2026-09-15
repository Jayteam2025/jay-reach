import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ErreurIntrouvable } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { lireVueDEnsembleCourante } from '../../../../lib/campagne';
import { Avatar, Carte, CleValeur, Entonnoir, Journal, TuileLogo } from '../../../../components/ui';

export const revalidate = 60;

const nf = new Intl.NumberFormat('fr-FR');

/** Aperçu de la file du jour affiché sur cette carte — la file complète vit dans l'onglet File du jour (tâche 11). */
const TAILLE_APERCU_FILE = 5;

function formatHeure(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

function pourcentageTexte(valeur: number): string {
  return `${valeur.toLocaleString('fr-FR')} %`;
}

/** Tuile de logo pour l'icône d'une source, à partir de son `providerId` — copie locale de celle d'`(app)/page.tsx` (convention du module : pas de partage cross-fichier pour un si petit utilitaire, voir `campagnes.ts`). */
function marqueSource(providerId: string): 'linkedin' | 'adzuna' | 'francetravail' | 'lettre' {
  if (providerId.includes('linkedin')) return 'linkedin';
  if (providerId.includes('adzuna')) return 'adzuna';
  if (providerId.includes('francetravail')) return 'francetravail';
  return 'lettre';
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

  return (
    <section className="jr-contenu">
      <Carte className="pleine">
        <Entonnoir
          etapes={[
            { valeur: vue.entonnoir.trouves, libelle: t('overview.funnel.found') },
            { valeur: vue.entonnoir.qualifies, libelle: t('overview.funnel.qualified') },
            { valeur: vue.entonnoir.contacts, libelle: t('overview.funnel.contactsIdentified') },
            { valeur: vue.entonnoir.enSequence, libelle: t('overview.funnel.inSequence') },
            { valeur: vue.entonnoir.livres, libelle: t('overview.funnel.delivered'), taux: pourcentageTexte(vue.entonnoir.tauxLivres) },
            { valeur: vue.entonnoir.reponses, libelle: t('overview.funnel.replies'), taux: pourcentageTexte(vue.entonnoir.tauxReponses) },
            { valeur: vue.entonnoir.interesses, libelle: t('overview.funnel.interested') },
          ]}
        />
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

        <Carte titre={t('overview.sources.title')} action={<small>{t('overview.sources.count', { n: vue.sources.length })}</small>}>
          {vue.sources.length === 0 ? (
            <p className="jr-secondaire">{t('overview.sources.empty')}</p>
          ) : (
            vue.sources.map((source) => {
              const cle = `fournisseurs.${source.providerId}`;
              const libelle = tSources.has(cle) ? tSources(cle) : source.providerId;
              return (
                <div className="jr-source" key={source.providerId}>
                  <TuileLogo marque={marqueSource(source.providerId)} lettre={source.providerId.charAt(0).toUpperCase()} />
                  <span>
                    <b>{libelle}</b>
                  </span>
                </div>
              );
            })
          )}
        </Carte>
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

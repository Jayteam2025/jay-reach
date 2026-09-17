import { getTranslations } from 'next-intl/server';
import {
  INTERVALLE_PRODUCTION_MS,
  lireEtatMoteur,
  lireEtatPauseEnvoi,
  lireReglages,
  listerErreursRecentes,
  listerTaches,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte, heureAvecJour, FUSEAU_PAR_DEFAUT } from '../../../../lib/dates';
import Link from 'next/link';
import { Carte, Journal } from '../../../../components/ui';
import { EtatMoteur } from '../../../../components/reglages/EtatMoteur';
import { PauseEnvoi } from '../../../../components/reglages/PauseEnvoi';
import { TableTaches, type LigneTache } from '../../../../components/reglages/TableTaches';

export const revalidate = 0;

export default async function ReglagesMoteurPage() {
  const ctx = await contexteCourant();
  const t = await getTranslations('reglages.moteur');

  const [reglages, etat, pause, erreurs, taches] = await Promise.all([
    lireReglages(ctx),
    lireEtatMoteur(ctx),
    lireEtatPauseEnvoi(ctx),
    listerErreursRecentes(ctx),
    listerTaches(ctx),
  ]);

  const fuseau = String(reglages.fuseau ?? FUSEAU_PAR_DEFAUT);
  const maintenant = new Date();

  const tachesEnAttenteTexte =
    taches.scoring.enAttente > 0 || taches.enrichissement.enAttente > 0
      ? t('etat.tachesEnAttenteGabarit', { scoring: taches.scoring.enAttente, enrichissement: taches.enrichissement.enAttente })
      : null;

  // Tour de correction 1 (Important n° 1) : les deux tâches sans mécanisme de
  // déclenchement immédiat (voir `listerTaches`, `packages/core`) portent une
  // ligne d'aide qui le dit — jamais un bouton grisé sans explication.
  const aideTraitementContinu = t('taches.continuAideGabarit', { minutes: INTERVALLE_PRODUCTION_MS / 60_000 });

  const lignesTaches: LigneTache[] = [
    {
      cle: 'sources',
      titre: t('taches.sources.titre'),
      detail:
        taches.sources.dernierPassage !== null
          ? t('taches.sources.detailGabarit', {
              actives: taches.sources.actives,
              dernier: dateCourte(taches.sources.dernierPassage, maintenant, fuseau),
            })
          : t('taches.sources.detailAucunPassage', { actives: taches.sources.actives }),
      lancable: taches.sources.lancable,
    },
    {
      cle: 'scoring',
      titre: t('taches.scoring.titre'),
      detail:
        taches.scoring.enAttente > 0
          ? t('taches.scoring.detailGabarit', { n: taches.scoring.enAttente })
          : t('taches.scoring.detailVide'),
      lancable: taches.scoring.lancable,
      aide: aideTraitementContinu,
    },
    {
      cle: 'enrichissement',
      titre: t('taches.enrichissement.titre'),
      detail:
        taches.enrichissement.enAttente > 0
          ? t('taches.enrichissement.detailGabarit', { n: taches.enrichissement.enAttente })
          : t('taches.enrichissement.detailVide'),
      lancable: taches.enrichissement.lancable,
      aide: aideTraitementContinu,
    },
    {
      cle: 'releve',
      titre: t('taches.releve.titre'),
      detail:
        taches.releve.dernierPassage !== null
          ? t('taches.releve.detailGabarit', { quand: dateCourte(taches.releve.dernierPassage, maintenant, fuseau) })
          : t('taches.releve.detailJamais'),
      lancable: taches.releve.lancable,
      enCours: true,
    },
  ];

  return (
    <div className="jr-reglages-corps">
      <div className="jr-section-entete">
        <div>
          <h2>{t('titre')}</h2>
          <p>{t('description')}</p>
        </div>
      </div>

      <div className="jr-deux-colonnes">
        <EtatMoteur
          enMarche={etat.enMarche}
          version={etat.version}
          dernierPassage={etat.dernierPassage ? dateCourte(etat.dernierPassage, maintenant, fuseau) : null}
          prochainPassage={etat.prochainPassage ? heureAvecJour(etat.prochainPassage, maintenant, fuseau) : null}
          derniereErreur={
            erreurs[0] ? { quand: dateCourte(erreurs[0].quand, maintenant, fuseau), libelle: erreurs[0].libelle } : null
          }
          tachesEnAttenteTexte={tachesEnAttenteTexte}
          libelles={{
            titre: t('etat.titre'),
            enMarche: t('etat.enMarche'),
            arrete: t('etat.arrete'),
            version: t.raw('etat.version'),
            dernierPassage: t('etat.dernierPassage'),
            prochainPassage: t('etat.prochainPassage'),
            aucunPassage: t('etat.aucunPassage'),
            derniereErreur: t('etat.derniereErreur'),
            aucuneErreur: t('etat.aucuneErreur'),
            tachesEnAttente: t('etat.tachesEnAttente'),
            aucuneTache: t('etat.aucuneTache'),
          }}
        />
        <PauseEnvoi
          actif={pause.actif}
          dernierePause={
            pause.dernierePause
              ? {
                  depuis: dateCourte(pause.dernierePause.depuis, maintenant, fuseau),
                  jusqua: dateCourte(pause.dernierePause.jusqua, maintenant, fuseau),
                  parQui: pause.dernierePause.parQui,
                }
              : null
          }
          erreurLibelle={t('pause.erreur')}
          libelles={{
            titre: t('pause.titre'),
            description: t('pause.description'),
            etat: t('pause.etat'),
            levee: t('pause.levee'),
            active: t('pause.active'),
            dernierePause: t('pause.dernierePause'),
            aucunePause: t('pause.aucunePause'),
            dernierePauseGabarit: t.raw('pause.dernierePauseGabarit'),
          }}
        />
      </div>

      <TableTaches
        lignes={lignesTaches}
        erreurLibelle={t('taches.erreur')}
        libelles={{
          titre: t('taches.titre'),
          sousTitre: t('taches.sousTitre'),
          lancer: t('taches.lancer'),
          enCours: t('taches.enCours'),
        }}
      />

      <div className="jr-deux-colonnes" id="erreurs-recentes">
        <Carte
          titre={
            <>
              {t('erreurs.titre')} <small>{t('erreurs.sousTitre')}</small>
            </>
          }
        >
          {erreurs.length === 0 ? (
            <p className="jr-aide">{t('erreurs.vide')}</p>
          ) : (
            <Journal
              entrees={erreurs.map((e) => ({
                heure: dateCourte(e.quand, maintenant, fuseau),
                texte: e.libelle,
                note: e.detail ?? undefined,
                ton: 'erreur' as const,
              }))}
            />
          )}
        </Carte>
        <Carte
          titre={
            <>
              {t('releveLectureSeule.titre')} <small>{t('releveLectureSeule.sousTitre')}</small>
            </>
          }
        >
          <div className="jr-cle-valeur">
            <span>{t('releveLectureSeule.cadence')}</span>
            <b>{t('releveLectureSeule.cadenceValeur')}</b>
          </div>
          <div className="jr-cle-valeur">
            <span>{t('releveLectureSeule.derniere')}</span>
            <b>{taches.releve.dernierPassage ? dateCourte(taches.releve.dernierPassage, maintenant, fuseau) : t('releveLectureSeule.jamais')}</b>
          </div>
          <p className="jr-aide">{t('releveLectureSeule.aide')}</p>
        </Carte>
      </div>

      {pause.actif && pause.depuis && (
        <div className="jr-bandeau attention">
          <span>
            {t('bandeauPause.texteGabarit', {
              depuis: heureAvecJour(pause.depuis, maintenant, fuseau),
              parQui: pause.depuisQui ?? t('bandeauPause.auteurInconnu'),
            })}
          </span>
        </div>
      )}
      {!etat.enMarche && (
        <div className="jr-bandeau erreur">
          <span>
            {etat.dernierPassage
              ? t('bandeauSilencieux.texteGabarit', { dernier: heureAvecJour(etat.dernierPassage, maintenant, fuseau) })
              : t('bandeauSilencieux.texteJamaisDemarre')}
          </span>
          <Link className="jr-lien" href="#erreurs-recentes">
            {t('bandeauSilencieux.lien')}
          </Link>
        </div>
      )}
    </div>
  );
}

import { getLocale, getTranslations } from 'next-intl/server';
import { HARD_CAP_7_DAYS, hasMinRole, lireReglages, lireVolumeEnvoiLinkedIn } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { lireSessionLinkedInCourante } from '../../../../lib/linkedin-session';
import { dateCourte, dateRelativeCourte, estDateRelative } from '../../../../lib/dates';
import { listerBoitesExpediteurs } from '../../../actions/senders';
import { parametresValeurConsommation } from '../../../../lib/plafonds-affichage';
import { Puce } from '../../../../components/ui';
import { CarteBoite } from '../../../../components/reglages/CarteBoite';
import { CarteSessionLinkedIn } from '../../../../components/reglages/CarteSessionLinkedIn';
import { BoutonRelierBoite } from '../../../../components/reglages/BoutonRelierBoite';
import { nomDuPays, phraseEtatSession } from '../../../../components/reglages/linkedin-session-affichage';

/**
 * Réglages › Expéditeurs (tâche 20) : boîtes email (état SalesBlink,
 * plafonds, fenêtre d'envoi, relève des réponses) et comptes LinkedIn.
 * Reconstruite d'après la maquette de la tâche 3 ; remplace le contenu de
 * l'ancienne page (`senders-form.tsx`, retirée à la tâche 24).
 */
export default async function ReglagesExpediteursPage() {
  const ctx = await contexteCourant();
  const peutModifier = ctx.role !== null && hasMinRole(ctx.role, 'admin');

  const maintenantCharge = new Date();
  const [t, tLinkedin, tPlafonds, boitesResultat, reglages, sessionLinkedIn, volumeEnvoi] = await Promise.all([
    getTranslations('reglages.expediteurs'),
    // La phrase d'état vit avec l'écran LinkedIn : une seule formulation pour les deux écrans.
    getTranslations('reglages.linkedin'),
    getTranslations('reglages.plafonds'),
    listerBoitesExpediteurs(),
    lireReglages(ctx),
    lireSessionLinkedInCourante(ctx),
    lireVolumeEnvoiLinkedIn(ctx.ex, ctx.organisationId, maintenantCharge),
  ]);

  const boites = boitesResultat.ok ? boitesResultat.valeur : [];
  const fuseau = String(reglages.fuseau);
  const maintenant = new Date();

  // La sortie réseau se dit comme sur l'écran LinkedIn : le genre de sortie et le pays en toutes
  // lettres (relevé à l'ouverture de la session, jamais supposé), le reste en détails techniques.
  const locale = await getLocale();
  const pays = nomDuPays(sessionLinkedIn?.pays, locale);
  const sortieTexte = !sessionLinkedIn?.ipVue
    ? null
    : pays
      ? tLinkedin('faits.sortieValeur', { pays })
      : tLinkedin('faits.sortieValeurSansPays');

  const auMoinsUneBoiteReliee = boites.some((b) => b.providerRef !== null);

  return (
    <>
      <div className="jr-section-entete">
        <div>
          <h2>{t('boxesTitle')}</h2>
          <p>{t('boxesLead')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Puce ton={auMoinsUneBoiteReliee ? 'bon' : 'gris'} point>
            {t(auMoinsUneBoiteReliee ? 'salesblinkLinked' : 'salesblinkNotLinked')}
          </Puce>
          {peutModifier && <BoutonRelierBoite />}
        </div>
      </div>

      {!boitesResultat.ok ? (
        <div className="jr-notification erreur" role="alert">
          {boitesResultat.error}
        </div>
      ) : boites.length === 0 ? (
        <div className="jr-carte">
          <div className="jr-vide">{t('empty')}</div>
        </div>
      ) : (
        boites.map((boite) => (
          <CarteBoite
            key={boite.id}
            boite={boite}
            creeLeTexte={dateCourte(boite.creeLe, maintenant, fuseau)}
            // « Modifié le aujourd'hui » (constat recette du 18/09) : le gabarit `box.createdOn`
            // choisit lui-même son connecteur, mais a besoin de savoir si `creeLeTexte` est une
            // valeur relative (« aujourd'hui »/« hier ») ou une date absolue.
            creeLeEstRelatif={estDateRelative(boite.creeLe, maintenant, fuseau)}
            derniereReleveTexte={boite.derniereReleve?.quand ? dateCourte(boite.derniereReleve.quand, maintenant, fuseau) : null}
            peutModifier={peutModifier}
          />
        ))
      )}

      <div className="jr-section-entete" style={{ marginTop: 8 }}>
        <div>
          <h2>{t('linkedin.title')}</h2>
          <p>{t('linkedin.lead')}</p>
        </div>
      </div>

      {/* La seule chose qui envoie : la session du serveur. Cette section listait les jetons de
          l'extension gelée, et déclarait « aucun envoi ne partira » sur un expéditeur actif. */}
      <CarteSessionLinkedIn
        session={sessionLinkedIn}
        sortieTexte={sortieTexte}
        etat={{
          ton: phraseEtatSession(sessionLinkedIn).ton,
          phrase: tLinkedin(`etat.${phraseEtatSession(sessionLinkedIn).cle}.phrase`),
        }}
        envoisTexte={
          sessionLinkedIn
            ? tPlafonds(
                'consommation.valeur',
                parametresValeurConsommation(
                  volumeEnvoi.message.envoyes7Jours,
                  Math.min(volumeEnvoi.message.plafondHebdo, HARD_CAP_7_DAYS),
                ),
              )
            : null
        }
        formaterCollecte={(quand) => dateRelativeCourte(quand.toISOString(), maintenant, fuseau)}
        libelles={{
          titre: t('linkedin.serveur.titre'),
          sousTitre: t('linkedin.serveur.sousTitre'),
          compte: t('linkedin.serveur.compte'),
          comptePasEncore: t('linkedin.serveur.comptePasEncore'),
          sortie: t('linkedin.serveur.sortie'),
          detailsTechniques: tLinkedin('faits.detailsTechniques'),
          ip: tLinkedin('faits.ip'),
          operateur: tLinkedin('faits.operateur'),
          envoisSemaine: t('linkedin.serveur.envoisSemaine'),
          derniereCollecte: t('linkedin.serveur.derniereCollecte'),
          jamais: t('linkedin.serveur.jamais'),
          inconnu: t('linkedin.serveur.comptePasEncore'),
          regler: t('linkedin.serveur.regler'),
          connecter: t('linkedin.serveur.connecter'),
        }}
      />
    </>
  );
}

import { getTranslations } from 'next-intl/server';
import {
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  jourCourantDansFuseau,
  lireHeuresEnvoiLinkedIn,
  lirePlafondLinkedIn,
  lireVolumeEnvoiLinkedIn,
  lireReglages,
  prochainEnvoiLinkedIn,
  RETENTION_PERSONNES_NON_CONTACTEES_JOURS,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte, dateRelativeCourte, FUSEAU_PAR_DEFAUT, heureAvecJour } from '../../../../lib/dates';
import { lireSessionLinkedInCourante } from '../../../../lib/linkedin-session';
import { Carte, TuileLogo } from '../../../../components/ui';
import { FenetreEnvoiLinkedin } from '../../../../components/reglages/FenetreEnvoiLinkedin';
import { PlafondsLinkedin } from '../../../../components/reglages/PlafondsLinkedin';
import { phraseEtatEnvoi, phraseEtatSession, varianteDetailSession } from '../../../../components/reglages/linkedin-session-affichage';

export const revalidate = 0;

/** Commande de l'opérateur : la session s'ouvre dans un terminal du serveur, jamais depuis cette page. */
const COMMANDE_CONNEXION = 'jay-reach linkedin connecter';
const UNE_HEURE_MS = 3_600_000;

export default async function ReglagesLinkedinPage() {
  const ctx = await contexteCourant();
  const t = await getTranslations('reglages.linkedin');

  const reglages = await lireReglages(ctx);
  const fuseau = String(reglages.fuseau || FUSEAU_PAR_DEFAUT);
  const maintenant = new Date();

  const [
    session,
    prochain,
    heuresEnvoi,
    volumeEnvoi,
    plafondPosts,
    plafondRequetes,
    plafondPersonnes,
    postsDuJour,
    requetesDeLHeure,
  ] = await Promise.all([
    lireSessionLinkedInCourante(ctx),
    prochainEnvoiLinkedIn(ctx.ex, ctx.organisationId, maintenant),
    lireHeuresEnvoiLinkedIn(ctx),
    lireVolumeEnvoiLinkedIn(ctx.ex, ctx.organisationId, maintenant),
    lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour'),
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    lirePlafondLinkedIn(ctx, 'linkedin_personnes_par_passage'),
    compterPostsLinkedInDuJour(ctx, jourCourantDansFuseau(fuseau, maintenant), fuseau),
    compterRequetesLinkedIn(ctx, new Date(maintenant.getTime() - UNE_HEURE_MS)),
  ]);

  const phrase = phraseEtatSession(session);
  const variante = varianteDetailSession(session);
  const envoi = phraseEtatEnvoi(session, prochain, maintenant);
  const inconnu = t('faits.inconnu');
  const origine = [session?.operateur, session?.pays].filter(Boolean).join(', ');
  const detail = t(`etat.${phrase.cle}.${variante}`, {
    depuis: session?.connecteeLe ? dateCourte(session.connecteeLe.toISOString(), maintenant, fuseau) : inconnu,
    collecte: session?.derniereCollecte
      ? dateRelativeCourte(session.derniereCollecte.toISOString(), maintenant, fuseau)
      : inconnu,
    quand: session?.bloqueeLe ? dateCourte(session.bloqueeLe.toISOString(), maintenant, fuseau) : inconnu,
    ip: session?.ipVue ?? inconnu,
    origine,
  });

  // « jusqu'à » pour une pause, « prochain envoi » pour un créneau à venir : deux dates
  // différentes, une seule variable de texte — chaque phrase ne lit que la sienne.
  const dateEnvoi = (() => {
    if (envoi.cle === 'enPause' && session?.envoiPauseJusqua) {
      return dateCourte(session.envoiPauseJusqua.toISOString(), maintenant, fuseau);
    }
    if (envoi.cle === 'planifie' && prochain.quand) {
      return dateCourte(prochain.quand.toISOString(), maintenant, fuseau);
    }
    // Budget horaire : l'échéance tombe dans l'heure qui vient, donc une HEURE et pas une
    // date — « 8 oct. » pour quelque chose qui se débloque à 11 h 20 ne dirait rien.
    if (envoi.cle === 'plafondHoraireDate' && prochain.disponibleA) {
      return heureAvecJour(prochain.disponibleA.toISOString(), maintenant, fuseau);
    }
    return inconnu;
  })();

  const peutModifier = ctx.role === 'admin' || ctx.role === 'owner';

  return (
    <div className="jr-reglages-corps">
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('lead')}</p>
        </div>
      </div>

      <Carte
        entete={
          <div className="jr-qui">
            <TuileLogo marque="linkedin" taille="grande" />
            <span>
              <b>{t('carte.titre')}</b>
              <small>{t('carte.sousTitre')}</small>
            </span>
          </div>
        }
      >
        {/* Une seule phrase : ce qui empêche de collecter l'emporte sur l'état enregistré. */}
        <div className="jr-session-etat">
          <span className={`jr-session-pastille ${phrase.ton}`} aria-hidden="true" />
          <div>
            <p className="jr-session-phrase">{t(`etat.${phrase.cle}.phrase`)}</p>
            <p className="jr-session-detail">{detail}</p>
            {phrase.avecCommande && (
              <div className="jr-session-action">
                <p className="jr-session-detail jr-session-consigne">
                  {phrase.cle === 'defi' ? t('commande.consigneDefi') : t('commande.consigne')}
                </p>
                <code className="jr-session-commande">{COMMANDE_CONNEXION}</code>
              </div>
            )}
          </div>
        </div>
        {/* Second fait du même canal : « est-ce que ça envoie maintenant ». Il ne peut pas
            contredire la ligne du dessus — `phraseEtatEnvoi` lui demande d'abord si la session
            tient, au lieu de relire l'état pour son compte. */}
        <div className="jr-session-etat">
          <span className={`jr-session-pastille ${envoi.ton}`} aria-hidden="true" />
          <div>
            <p className="jr-session-phrase">{t(`envoi.${envoi.cle}.phrase`, { quand: dateEnvoi })}</p>
          </div>
        </div>
        <dl className="jr-session-faits">
          {/* En tête des faits : c'est l'identité, et un message LinkedIn ne part que vers une
              relation de 1er degré DE CE COMPTE. Sans elle, on ne peut pas dire si un envoi a
              une chance d'aboutir. Lue dans la réponse `/me` du premier envoi, jamais devinée. */}
          <div>
            <dt>{t('faits.compte')}</dt>
            <dd>
              {session?.compteIdentifiant ? (
                <a
                  className="jr-lien mono"
                  href={`https://www.linkedin.com/in/${session.compteIdentifiant}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {session.compteIdentifiant}
                </a>
              ) : (
                t('faits.comptePasEncore')
              )}
            </dd>
          </div>
          <div>
            <dt>{t('faits.sortie')}</dt>
            <dd className="mono">{session?.ipVue ?? inconnu}</dd>
          </div>
          <div>
            <dt>{t('faits.operateur')}</dt>
            <dd>{origine || inconnu}</dd>
          </div>
          <div>
            <dt>{t('faits.collecte')}</dt>
            <dd>
              {session?.derniereCollecte
                ? dateRelativeCourte(session.derniereCollecte.toISOString(), maintenant, fuseau)
                : t('faits.jamais')}
            </dd>
          </div>
        </dl>
      </Carte>

      {/* Envoi d'abord, collecte ensuite : les deux cartes se lisent dans l'ordre des
          deux métiers du canal, et chacune porte ses propres réglages. Sans cette
          carte, la fenêtre d'envoi n'était réglable que depuis la carte d'un compte
          d'extension — donc par personne, sur une instance tenue par la session du
          serveur. */}
      <Carte titre={t('rythme.titre')}>
        <p className="jr-aide">{t('rythme.lead')}</p>
        {/* Le plafond et sa consommation côte à côte : un plafond seul ne dit pas s'il
            est sur le point de bloquer. Les deux chiffres viennent de la fonction que le
            moteur consulte avant chaque envoi, jamais d'un second comptage. */}
        <PlafondsLinkedin
          peutModifier={peutModifier}
          lignes={[
            {
              cle: 'linkedin_invitations_par_semaine',
              nom: t('rythme.invitationsParSemaine.nom'),
              usage: t('rythme.invitationsParSemaine.usage', { n: volumeEnvoi.invite.envoyes7Jours }),
              valeur: volumeEnvoi.invite.plafondHebdo,
            },
            {
              cle: 'linkedin_messages_par_semaine',
              nom: t('rythme.messagesParSemaine.nom'),
              usage: t('rythme.messagesParSemaine.usage', { n: volumeEnvoi.message.envoyes7Jours }),
              valeur: volumeEnvoi.message.plafondHebdo,
            },
          ]}
          libelles={{ enregistrer: t('plafonds.enregistrer'), erreurNombre: t('plafonds.erreurNombre') }}
        />
        <FenetreEnvoiLinkedin valeur={heuresEnvoi} peutModifier={peutModifier} />
      </Carte>

      <Carte titre={t('plafonds.titre')}>
        <p className="jr-aide">{t('plafonds.lead')}</p>
        <PlafondsLinkedin
          peutModifier={peutModifier}
          lignes={[
            {
              cle: 'linkedin_posts_par_jour',
              nom: t('plafonds.postsParJour.nom'),
              usage: t('plafonds.postsParJour.usage', { n: postsDuJour }),
              valeur: plafondPosts,
            },
            {
              cle: 'linkedin_requetes_par_heure',
              nom: t('plafonds.requetesParHeure.nom'),
              usage: t('plafonds.requetesParHeure.usage', { n: requetesDeLHeure }),
              valeur: plafondRequetes,
            },
            {
              cle: 'linkedin_personnes_par_passage',
              nom: t('plafonds.personnesParPassage.nom'),
              usage: t('plafonds.personnesParPassage.usage'),
              valeur: plafondPersonnes,
            },
          ]}
          libelles={{ enregistrer: t('plafonds.enregistrer'), erreurNombre: t('plafonds.erreurNombre') }}
        />
      </Carte>

      <div className="jr-avertissement">
        <p>
          <b>{t('avertissement.titre')}</b> {t('avertissement.risque')}
        </p>
        <p>{t('avertissement.baseLegale', { jours: RETENTION_PERSONNES_NON_CONTACTEES_JOURS })}</p>
      </div>
    </div>
  );
}

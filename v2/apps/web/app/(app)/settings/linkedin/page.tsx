import { getTranslations } from 'next-intl/server';
import {
  compterPostsLinkedInDuJour,
  compterRequetesLinkedIn,
  jourCourantDansFuseau,
  lirePlafondLinkedIn,
  lireReglages,
  RETENTION_PERSONNES_NON_CONTACTEES_JOURS,
} from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte, dateRelativeCourte, FUSEAU_PAR_DEFAUT } from '../../../../lib/dates';
import { lireSessionLinkedInCourante } from '../../../../lib/linkedin-session';
import { Carte, TuileLogo } from '../../../../components/ui';
import { PlafondsLinkedin } from '../../../../components/reglages/PlafondsLinkedin';
import { phraseEtatSession, varianteDetailSession } from '../../../../components/reglages/linkedin-session-affichage';

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

  const [session, plafondPosts, plafondRequetes, plafondPersonnes, postsDuJour, requetesDeLHeure] = await Promise.all([
    lireSessionLinkedInCourante(ctx),
    lirePlafondLinkedIn(ctx, 'linkedin_posts_par_jour'),
    lirePlafondLinkedIn(ctx, 'linkedin_requetes_par_heure'),
    lirePlafondLinkedIn(ctx, 'linkedin_personnes_par_passage'),
    compterPostsLinkedInDuJour(ctx, jourCourantDansFuseau(fuseau, maintenant), fuseau),
    compterRequetesLinkedIn(ctx, new Date(maintenant.getTime() - UNE_HEURE_MS)),
  ]);

  const phrase = phraseEtatSession(session);
  const variante = varianteDetailSession(session);
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
        <dl className="jr-session-faits">
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

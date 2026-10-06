import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { ContexteWeb } from '../../lib/contexte';
import { lireResumeCoquilleCourant } from '../../lib/aujourdhui';
import { composerLigneLinkedIn, lireSessionLinkedInPourLaCoquille } from '../../lib/linkedin-session';
import { Avatar } from '../ui';
import { BarreLaterale } from './BarreLaterale';
import { CarteMoteur } from './CarteMoteur';
import { CarteEnvois } from './CarteEnvois';
import { parametresValeurConsommation } from '../../lib/plafonds-affichage';

export interface CoquilleProps {
  ctx: ContexteWeb;
  children: ReactNode;
}

/**
 * HH:MM dans le fuseau de l'organisation. Le commentaire d'origine (« fuseau du
 * serveur, comme le reste du chrome ») décrivait un choix qui allait à
 * l'encontre de R67 : sans `timeZone`, la même heure de dernier/prochain
 * passage du moteur s'affichait décalée de deux heures sur Vercel (serveur en
 * UTC) par rapport au Mac d'un développeur (déjà à Paris). `FUSEAU_PAR_DEFAUT`
 * a fait le compte un temps, faute de mieux — corrigé le 18/09 : `a.fuseau`
 * (`lireResumeCoquilleCourant`, déjà lu pour la file du jour) coïncidait avec
 * Paris tant que l'organisation n'avait réglé aucun autre fuseau.
 */
function formatHeure(iso: string | null, fuseau: string): string | null {
  return iso ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(new Date(iso)) : null;
}

export async function Coquille({ ctx, children }: CoquilleProps) {
  // Une seule lecture de session par rendu : `contexteCourant()` (mémoïsée)
  // porte déjà le nom affiché, pas besoin d'un second appel à `getUser()`.
  const [t, a, sessionLinkedin] = await Promise.all([
    getTranslations(),
    lireResumeCoquilleCourant(ctx),
    lireSessionLinkedInPourLaCoquille(ctx),
  ]);

  const nomAffiche = ctx.utilisateur.nomAffiche;
  const roleLibelle = ctx.role ? t(`coquille.role.${ctx.role}`) : t('coquille.role.none');

  const dernier = formatHeure(a.moteur.dernierPassage, a.fuseau);
  const prochain = formatHeure(a.moteur.prochainPassage, a.fuseau);
  const detailMoteur = dernier && prochain ? t('coquille.engine.lastNext', { last: dernier, next: prochain }) : dernier ? t('coquille.engine.lastOnly', { last: dernier }) : t('coquille.engine.never');

  return (
    <div className="jr-app">
      <aside className="jr-barre">
        <div className="jr-marque">
          <span className="jr-logo" aria-hidden="true">
            J
          </span>{' '}
          {t('app.name')}
        </div>
        <BarreLaterale aTraiterTotal={a.aTraiterTotal} />
        <div className="jr-barre-pied">
          <CarteMoteur
            ton={a.moteur.enMarche ? 'bon' : 'erreur'}
            libelleEtat={a.moteur.enMarche ? t('coquille.engine.running') : t('coquille.engine.stopped')}
            detail={detailMoteur}
            linkedin={composerLigneLinkedIn(sessionLinkedin, t, new Date(), a.fuseau)}
          />
          {/* La jauge porte sur l'EMAIL, numérateur ET dénominateur : avant la revue de
              cohérence du lot 2, elle comptait tous les canaux au numérateur et l'email seul au
              dénominateur, si bien qu'une action LinkedIn gonflait une barre qu'elle ne consomme
              pas. Le canal LinkedIn aura sa propre jauge, avec son propre quota d'expéditeur. */}
          <CarteEnvois
            libelle={t('coquille.sentToday')}
            partis={a.quotaEnvois.utilise}
            enFile={a.quotaEnvois.enFile}
            plafond={a.quotaEnvois.plafond}
            libellePartis={t('coquille.sent.gone', { n: a.quotaEnvois.utilise })}
            libelleEnFile={t('coquille.sent.queued', { n: a.quotaEnvois.enFile })}
            libelleAucun={t('coquille.sent.none')}
            libellePlafond={t('coquille.sent.cap', parametresValeurConsommation(a.quotaEnvois.utilise, a.quotaEnvois.plafond))}
          />
          <div className="jr-qui" style={{ padding: '4px 6px' }}>
            <Avatar nom={nomAffiche} />
            <span>
              <b>{nomAffiche}</b>
              <small>{roleLibelle}</small>
            </span>
          </div>
        </div>
      </aside>
      <main className="jr-principal">{children}</main>
    </div>
  );
}

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { ContexteWeb } from '../../lib/contexte';
import { lireAujourdhuiCourant } from '../../lib/aujourdhui';
import { Avatar } from '../ui';
import { BarreLaterale } from './BarreLaterale';
import { CarteMoteur } from './CarteMoteur';
import { CarteEnvois } from './CarteEnvois';

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
 * (`lireAujourdhuiCourant`, déjà lu pour la file du jour) coïncidait avec
 * Paris tant que l'organisation n'avait réglé aucun autre fuseau.
 */
function formatHeure(iso: string | null, fuseau: string): string | null {
  return iso ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: fuseau }).format(new Date(iso)) : null;
}

export async function Coquille({ ctx, children }: CoquilleProps) {
  // Une seule lecture de session par rendu : `contexteCourant()` (mémoïsée)
  // porte déjà le nom affiché, pas besoin d'un second appel à `getUser()`.
  const [t, a] = await Promise.all([getTranslations(), lireAujourdhuiCourant(ctx)]);

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
        <BarreLaterale aTraiterTotal={a.aTraiter.total} />
        <div className="jr-barre-pied">
          <CarteMoteur
            ton={a.moteur.enMarche ? 'bon' : 'erreur'}
            libelleEtat={a.moteur.enMarche ? t('coquille.engine.running') : t('coquille.engine.stopped')}
            detail={detailMoteur}
          />
          <CarteEnvois
            libelle={t('coquille.sentToday')}
            partis={a.fileDuJour.dejaPartis}
            enFile={a.fileDuJour.enFile}
            plafond={a.plafonds.envois.plafond}
            libellePartis={t('coquille.sent.gone', { n: a.fileDuJour.dejaPartis })}
            libelleEnFile={t('coquille.sent.queued', { n: a.fileDuJour.enFile })}
            libelleAucun={t('coquille.sent.none')}
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

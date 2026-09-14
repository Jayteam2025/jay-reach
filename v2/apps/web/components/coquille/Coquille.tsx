import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import type { Contexte } from '@jay-reach/core';
import { getUser } from '../../lib/auth';
import { lireAujourdhuiCourant } from '../../lib/aujourdhui';
import { Avatar } from '../ui';
import { BarreLaterale } from './BarreLaterale';
import { CarteMoteur } from './CarteMoteur';
import { CarteEnvois } from './CarteEnvois';

export interface CoquilleProps {
  ctx: Contexte;
  children: ReactNode;
}

/** HH:MM, fuseau du serveur (comme le reste du chrome — `chrome.tsx` d'avant faisait de même pour ses relatifs). */
function formatHeure(iso: string | null): string | null {
  return iso ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : null;
}

export async function Coquille({ ctx, children }: CoquilleProps) {
  const [t, a, utilisateur] = await Promise.all([getTranslations(), lireAujourdhuiCourant(ctx), getUser()]);

  const nomAffiche = utilisateur?.user_metadata?.full_name?.trim() || utilisateur?.email?.split('@')[0] || '—';
  const roleLibelle = ctx.role ? t(`coquille.role.${ctx.role}`) : t('coquille.role.none');

  const dernier = formatHeure(a.moteur.dernierPassage);
  const prochain = formatHeure(a.moteur.prochainPassage);
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
          <CarteEnvois libelle={t('coquille.sentToday')} utilise={a.plafonds.envois.utilise} plafond={a.plafonds.envois.plafond} />
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

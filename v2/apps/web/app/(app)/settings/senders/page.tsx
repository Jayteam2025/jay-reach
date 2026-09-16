import { getTranslations } from 'next-intl/server';
import { hasMinRole, lireReglages } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte } from '../../../../lib/dates';
import { listerBoitesExpediteurs } from '../../../actions/senders';
import { listerComptesLinkedInAction } from '../../../actions/linkedin';
import { Puce } from '../../../../components/ui';
import { CarteBoite } from '../../../../components/reglages/CarteBoite';
import { CarteCompteLinkedIn } from '../../../../components/reglages/CarteCompteLinkedIn';
import { BoutonRelierBoite } from '../../../../components/reglages/BoutonRelierBoite';

/**
 * Réglages › Expéditeurs (tâche 20) : boîtes email (état SalesBlink,
 * plafonds, fenêtre d'envoi, relève des réponses) et comptes LinkedIn.
 * Reconstruite d'après la maquette de la tâche 3 ; remplace le contenu de
 * l'ancienne page (`senders-form.tsx`, désormais orpheline — nettoyage
 * laissé à la tâche 24).
 */
export default async function ReglagesExpediteursPage() {
  const ctx = await contexteCourant();
  const peutModifier = ctx.role !== null && hasMinRole(ctx.role, 'admin');

  const [t, boitesResultat, comptesResultat, reglages] = await Promise.all([
    getTranslations('reglages.expediteurs'),
    listerBoitesExpediteurs(),
    listerComptesLinkedInAction(),
    lireReglages(ctx),
  ]);

  const boites = boitesResultat.ok ? boitesResultat.valeur : [];
  const comptes = comptesResultat.ok ? comptesResultat.valeur : [];
  const fuseau = String(reglages.fuseau);
  const maintenant = new Date();

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

      {!comptesResultat.ok ? (
        <div className="jr-notification erreur" role="alert">
          {comptesResultat.error}
        </div>
      ) : comptes.length === 0 ? (
        <div className="jr-carte">
          <div className="jr-vide">{t('linkedin.empty')}</div>
        </div>
      ) : (
        comptes.map((compte) => <CarteCompteLinkedIn key={compte.id} compte={compte} peutModifier={peutModifier} />)
      )}
    </>
  );
}

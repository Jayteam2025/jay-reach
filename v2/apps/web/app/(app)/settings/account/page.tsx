import { getTranslations } from 'next-intl/server';
import { lireOrganisation, lireReglages, listerMembres } from '@jay-reach/core';
import { contexteCourant } from '../../../../lib/contexte';
import { dateCourte, FUSEAU_PAR_DEFAUT } from '../../../../lib/dates';
import { listerPreferencesNotifications } from '../../../actions/notifications';
import { FormulaireOrganisation } from '../../../../components/reglages/FormulaireOrganisation';
import { TableMembres, type MembreAffiche } from '../../../../components/reglages/TableMembres';
import { PreferencesNotifications } from '../../../../components/reglages/PreferencesNotifications';
import { DeconnexionCompte } from '../../../../components/reglages/DeconnexionCompte';
import { signOut } from '../../../actions/auth';
import type { EvenementNotificationActif } from '../../../../lib/notification-events';

export const revalidate = 0;

type Traducteur = Awaited<ReturnType<typeof getTranslations>>;

/**
 * Appel littéral (`cles-utilisees.test.ts` ne peut vérifier que des clés
 * littérales) — deux événements aujourd'hui (`contact.replied` et `linkedin.session_blocked` ;
 * les autres du catalogue n'ont pas de producteur, ils sont retirés de l'écran, voir `lib/notification-events.ts`).
 */
function libellesEvenements(t: Traducteur): Record<EvenementNotificationActif, { titre: string; detail: string }> {
  return {
    'contact.replied': {
      titre: t('notifications.evenement.contact.replied.titre'),
      detail: t('notifications.evenement.contact.replied.detail'),
    },
    'linkedin.session_blocked': {
      titre: t('notifications.evenement.linkedin.session_blocked.titre'),
      detail: t('notifications.evenement.linkedin.session_blocked.detail'),
    },
  };
}

export default async function ReglagesComptePage() {
  const ctx = await contexteCourant();
  const t = await getTranslations('reglages.compte');

  const [reglages, organisation, membres, preferences] = await Promise.all([
    lireReglages(ctx),
    lireOrganisation(ctx),
    listerMembres(ctx),
    listerPreferencesNotifications(),
  ]);

  const fuseau = String(reglages.fuseau ?? FUSEAU_PAR_DEFAUT);
  const maintenant = new Date();

  const membresAffiches: MembreAffiche[] = membres.map((m) => ({
    id: m.id,
    nom: m.nom,
    email: m.email,
    role: m.role,
    depuis: dateCourte(m.depuis, maintenant, fuseau),
    enAttente: m.enAttente,
    moiMeme: m.moiMeme,
  }));

  return (
    <div className="jr-reglages-corps">
      <div className="jr-section-entete">
        <div>
          <h2>{t('titre')}</h2>
          <p>{t('description')}</p>
        </div>
      </div>

      <FormulaireOrganisation
        initial={{ nom: organisation.nom, fuseau: String(reglages.fuseau ?? FUSEAU_PAR_DEFAUT), langue: organisation.langue }}
        erreurLibelle={t('organisation.erreur')}
        libelles={{
          titre: t('organisation.titre'),
          nom: t('organisation.nom'),
          fuseau: t('organisation.fuseau'),
          fuseauAide: t('organisation.fuseauAide'),
          langue: t('organisation.langue'),
          langueAide: t('organisation.langueAide'),
          enregistrer: t('organisation.enregistrer'),
        }}
      />

      <TableMembres
        organizationId={ctx.organisationId}
        membres={membresAffiches}
        erreurLibelle={t('membres.erreur')}
        libelles={{
          titre: t('membres.titre'),
          compte: t('membres.compteGabarit', { count: membresAffiches.length }),
          inviter: t('membres.inviter'),
          colonneMembre: t('membres.colonneMembre'),
          colonneEmail: t('membres.colonneEmail'),
          colonneRole: t('membres.colonneRole'),
          colonneDepuis: t('membres.colonneDepuis'),
          vous: t('membres.vous'),
          retirer: t('membres.retirer'),
          enAttenteSuffixe: t('membres.enAttenteSuffixe'),
          role: {
            owner: t('membres.role.owner'),
            admin: t('membres.role.admin'),
            operator: t('membres.role.operator'),
            viewer: t('membres.role.viewer'),
          },
          aide: t('membres.aide'),
        }}
      />

      {/* Pleine largeur, comme les autres cartes de cette page (tour de correction F6, point 5) :
          `.jr-deux-colonnes` avec un seul enfant ne laissait la carte occuper que la moitié. */}
      <PreferencesNotifications
        preferences={preferences}
        libelles={{
          titre: t('notifications.titre'),
          sousTitre: t('notifications.sousTitre'),
          erreur: t('notifications.erreur'),
          evenement: libellesEvenements(t),
        }}
      />

      <DeconnexionCompte action={signOut} libelles={{ titre: t('session.titre'), bouton: t('session.bouton') }} />
    </div>
  );
}

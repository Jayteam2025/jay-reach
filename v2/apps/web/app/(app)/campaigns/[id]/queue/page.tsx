import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { apercuEnvoi, ErreurIntrouvable, listerFileDuJour, type EnvoiPrevu, type EtatEnvoi } from '@jay-reach/core';
import { contexteCourant } from '../../../../../lib/contexte';
import { Carte, EtatVide, Puce } from '../../../../../components/ui';
import { TableFileDuJour, TON_ETAT, type LigneTableFileDuJour } from '../../../../../components/campagne/TableFileDuJour';
import { TiroirRelecture, type TiroirRelectureLibelles } from '../../../../../components/campagne/TiroirRelecture';

export const revalidate = 0;

const ETATS_CONNUS: readonly EtatEnvoi[] = [
  'scheduled',
  'pending_approval',
  'approved',
  'dispatched',
  'delivered',
  'failed',
  'blocked',
  'cancelled',
  'skipped',
];

/** Statuts pour lesquels le tiroir montre encore les trois actions (R39, D6) — tout le reste affiche la ligne discrète. */
const STATUTS_A_RELIRE = new Set<EtatEnvoi>(['scheduled', 'pending_approval']);

function compter(envois: readonly EnvoiPrevu[], etats: readonly EtatEnvoi[]): number {
  return envois.filter((e) => etats.includes(e.etatDetaille ?? 'scheduled')).length;
}

/**
 * Construit les textes déjà composés du tiroir « Relire avant envoi » à
 * partir de l'aperçu (`apercuEnvoi`) et de l'éventuelle ligne de la file du
 * jour correspondante (pour l'heure, déjà formatée dans le fuseau de
 * l'organisation — même valeur que la colonne Heure de la table, R38/D1).
 */
function construireLibellesTiroir(
  t: Awaited<ReturnType<typeof getTranslations>>,
  apercu: Awaited<ReturnType<typeof apercuEnvoi>>,
  heureDeLaLigne: string | null | undefined,
): TiroirRelectureLibelles {
  const heureLibelle =
    heureDeLaLigne ??
    (apercu.heurePrevue
      ? new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(apercu.heurePrevue))
      : null);

  const segments = [apercu.contactNom, apercu.contactPoste, apercu.contactEntreprise].filter(
    (v): v is string => Boolean(v),
  );
  if (heureLibelle) segments.push(t('file.drawer.scheduledFor', { heure: heureLibelle }));
  if (apercu.expediteur) segments.push(t('file.drawer.from', { expediteur: apercu.expediteur }));

  const pourquoi = apercu.pourquoi
    ? {
        titre: apercu.pourquoi.titre,
        detail: [apercu.pourquoi.detail, apercu.score != null ? t('file.drawer.scoreDetail', { n: apercu.score }) : null]
          .filter((v): v is string => Boolean(v))
          .join(' · '),
      }
    : null;

  const premierPrenom = apercu.contactNom.split(' ')[0] ?? apercu.contactNom;

  return {
    titre: t('file.drawer.title'),
    fermer: t('file.drawer.close'),
    emailTitre: t('file.drawer.description'),
    heureLibelle,
    statut: t(`file.status.${apercu.statut}`),
    statutTon: TON_ETAT[apercu.statut],
    score: apercu.score != null ? t('file.drawer.score', { n: apercu.score }) : null,
    sousTitre: segments.join(' · '),
    pourquoi,
    pourquoiTitre: t('file.drawer.why'),
    etape: t('file.drawer.step', { n: apercu.etapePosition, nom: apercu.etapeNom }),
    avertissementVariables:
      apercu.variablesManquantes.length > 0
        ? t('file.drawer.missingVariables', { liste: apercu.variablesManquantes.join(', ') })
        : null,
    aide: t('file.drawer.hint', { n: apercu.etapePosition, prenom: premierPrenom }),
    ecarter: t('file.actions.discard'),
    modifierLeTexte: t('file.drawer.editText'),
    bientot: t('file.drawer.soon'),
    envoyerTelQuel: t('file.drawer.sendAsIs'),
    dejaTraite: STATUTS_A_RELIRE.has(apercu.statut)
      ? null
      : t('file.drawer.alreadyProcessed', { statut: t(`file.drawer.notReviewable.${apercu.statut}`) }),
  };
}

export default async function CampagneFileDuJourPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const ctx = await contexteCourant();
  const [t, sp] = await Promise.all([getTranslations('campagne'), searchParams]);

  let resultat: Awaited<ReturnType<typeof listerFileDuJour>>;
  try {
    resultat = await listerFileDuJour(ctx, { campagneId: id });
  } catch (err) {
    if (err instanceof ErreurIntrouvable) notFound();
    throw err;
  }

  // Les deux sous-listes sont chacune déjà triées par heure croissante ;
  // fusionnées puis retriées sur la même clé pour obtenir l'ordre global de
  // la journée (prévus et partis mélangés, comme la file du jour les vit).
  const envois = [...resultat.partis, ...resultat.prevus].sort((a, b) => (a.heure ?? '').localeCompare(b.heure ?? ''));

  const lignes: LigneTableFileDuJour[] = envois.map((e) => ({
    ...e,
    etapeTexte: e.etape !== null ? t('file.step', { n: e.etape }) : null,
  }));

  const compteurs = {
    tous: envois.length,
    prevus: compter(envois, ['scheduled', 'approved']),
    aRelire: compter(envois, ['pending_approval']),
    partis: compter(envois, ['dispatched']),
    livres: compter(envois, ['delivered']),
    echoues: compter(envois, ['failed']),
    bloques: compter(envois, ['blocked']),
  };

  const brutRelire = Array.isArray(sp.relire) ? sp.relire[0] : sp.relire;
  let tiroir: {
    actionId: string;
    contactId: string | null;
    apercu: Awaited<ReturnType<typeof apercuEnvoi>>;
    libelles: TiroirRelectureLibelles;
  } | null = null;
  if (brutRelire) {
    try {
      const apercu = await apercuEnvoi(ctx, { actionId: brutRelire });
      const envoi = envois.find((e) => e.id === brutRelire);
      tiroir = {
        actionId: brutRelire,
        contactId: envoi?.contactId ?? null,
        apercu,
        libelles: construireLibellesTiroir(t, apercu, envoi?.heure),
      };
    } catch (err) {
      if (!(err instanceof ErreurIntrouvable)) throw err;
      // Action introuvable (id invalide, hors organisation, supprimée entre
      // temps) : le paramètre est ignoré plutôt que de faire échouer la page.
    }
  }

  const etatLibelles = Object.fromEntries(ETATS_CONNUS.map((e) => [e, t(`file.status.${e}`)])) as Record<EtatEnvoi, string>;

  return (
    <section className="jr-contenu une-colonne">
      <div className="jr-section-entete">
        <div>
          <h2>{t('file.title', { n: compteurs.tous })}</h2>
          <p>{t('file.description')}</p>
        </div>
      </div>

      <div className="jr-ligne-entre">
        <div className="jr-puces">
          <Puce ton="accent">{t('file.filters.all', { n: compteurs.tous })}</Puce>
          <Puce>{t('file.filters.scheduled', { n: compteurs.prevus })}</Puce>
          <Puce>{t('file.filters.toReview', { n: compteurs.aRelire })}</Puce>
          <Puce>{t('file.filters.dispatched', { n: compteurs.partis })}</Puce>
          <Puce>{t('file.filters.delivered', { n: compteurs.livres })}</Puce>
          <Puce>{t('file.filters.failed', { n: compteurs.echoues })}</Puce>
          <Puce>{t('file.filters.blocked', { n: compteurs.bloques })}</Puce>
        </div>
      </div>

      {lignes.length === 0 ? (
        <EtatVide titre={t('file.empty.title')} texte={t('file.empty.text')} />
      ) : (
        <Carte>
          <TableFileDuJour
            envois={lignes}
            organisationId={ctx.organisationId}
            campagneId={id}
            libelles={{
              colonneHeure: t('file.columns.time'),
              colonneContact: t('file.columns.contact'),
              colonneEtape: t('file.columns.stepAndSubject'),
              colonneDepuis: t('file.columns.from'),
              colonneEtat: t('file.columns.status'),
              groupeCompte: (n: number) => t('file.group.count', { n }),
              etat: etatLibelles,
              livraisonEnAttente: t('file.pendingDelivery'),
              relire: t('file.actions.review'),
              reporter: t('file.actions.postpone'),
              ecarter: t('file.actions.discard'),
              reessayer: t('file.actions.retry'),
              chercherEmail: t('file.actions.findEmail'),
              coutChercherEmail: t('contacts.actions.enrichCost'),
              aucunePlaceholder: '—',
            }}
          />
        </Carte>
      )}

      {tiroir && (
        <TiroirRelecture
          actionId={tiroir.actionId}
          contactId={tiroir.contactId}
          campagneId={id}
          organisationId={ctx.organisationId}
          apercu={tiroir.apercu}
          libelles={tiroir.libelles}
        />
      )}
    </section>
  );
}

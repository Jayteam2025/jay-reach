import { Fragment } from 'react';
import Link from 'next/link';
import type { EnvoiPrevu, EtatEnvoi } from '@jay-reach/core';
import { Avatar, Puce } from '../ui';
import type { PuceTon } from '../ui';
import { BoutonChercherEmail } from './BoutonChercherEmail';
import { BoutonEcarterContact } from './BoutonEcarterContact';
import { BoutonReessayer } from './BoutonReessayer';
import { BoutonReporterEnvoi } from './BoutonReporterEnvoi';

/** Ligne affichée par `TableFileDuJour` : `EnvoiPrevu` + le texte d'étape déjà traduit (l'appelant a accès à `t()`). */
export interface LigneTableFileDuJour extends EnvoiPrevu {
  etapeTexte: string | null;
}

export interface GroupeFileDuJour {
  /** Heure de début de la tranche, deux chiffres (« 09 »). */
  heure: string;
  envois: readonly LigneTableFileDuJour[];
}

/**
 * Regroupe des envois déjà triés par heure croissante en tranches d'une
 * heure (fonction pure — brief : « testez leurs fonctions pures » pour ce
 * qui entoure les composants clients). Un envoi sans heure connue forme sa
 * propre tranche, à sa place dans l'ordre reçu.
 */
export function grouperParHeure(envois: readonly LigneTableFileDuJour[]): GroupeFileDuJour[] {
  const groupes: { heure: string; envois: LigneTableFileDuJour[] }[] = [];
  for (const envoi of envois) {
    const heure = envoi.heure ? envoi.heure.slice(0, 2) : '—';
    const dernier = groupes.at(-1);
    if (dernier && dernier.heure === heure) {
      dernier.envois.push(envoi);
    } else {
      groupes.push({ heure, envois: [envoi] });
    }
  }
  return groupes;
}

/** « 09:00 à 10:00 » à partir de « 09 » — arithmétique pure, pas de traduction (chiffres). */
export function intituleTrancheHoraire(heure: string): string {
  const h = Number(heure);
  if (!Number.isFinite(h)) return '—';
  const fin = (h + 1) % 24;
  const deuxChiffres = (n: number) => String(n).padStart(2, '0');
  return `${deuxChiffres(h)}:00 à ${deuxChiffres(fin)}:00`;
}

export interface TableFileDuJourLibelles {
  colonneHeure: string;
  colonneContact: string;
  colonneEtape: string;
  colonneDepuis: string;
  colonneEtat: string;
  /** Compte d'une tranche (« 4 emails »), pluriel ICU déjà résolu par l'appelant. */
  groupeCompte: (n: number) => string;
  etat: Record<EtatEnvoi, string>;
  livraisonEnAttente: string;
  relire: string;
  reporter: string;
  ecarter: string;
  reessayer: string;
  chercherEmail: string;
  coutChercherEmail: string;
  aucunePlaceholder: string;
}

/** Ton de puce par état — réutilisé par le tiroir « Relire avant envoi » (`TiroirRelecture`, même statut réel). */
export const TON_ETAT: Record<EtatEnvoi, PuceTon> = {
  scheduled: 'gris',
  pending_approval: 'attention',
  approved: 'gris',
  dispatched: 'accent',
  delivered: 'bon',
  failed: 'erreur',
  blocked: 'attention',
  cancelled: 'gris',
  skipped: 'gris',
};

/** États pour lesquels l'envoi n'est pas encore parti — Relire/Reporter/Écarter ont un sens. */
const ETATS_A_VENIR = new Set<EtatEnvoi>(['scheduled', 'pending_approval', 'approved']);

function LigneEnvoiRendue({
  envoi,
  organisationId,
  campagneId,
  libelles,
}: {
  envoi: LigneTableFileDuJour;
  organisationId: string;
  campagneId: string;
  libelles: TableFileDuJourLibelles;
}) {
  const etat = envoi.etatDetaille ?? 'scheduled';

  return (
    <tr>
      <td className="jr-secondaire jr-cell-heure">{envoi.heure ?? '—'}</td>
      <td>
        <div className="jr-qui">
          <Avatar nom={envoi.contactNom} canal={envoi.canal} />
          <span>
            <b>{envoi.contactNom}</b>
            <small>{envoi.campagneNom ?? ''}</small>
          </span>
        </div>
      </td>
      <td>
        <b className="jr-demi-gras">{envoi.etapeTexte ?? '—'}</b>
        {envoi.objet && <small className="jr-secondaire jr-detail-ligne">{envoi.objet}</small>}
      </td>
      <td>
        <span className="jr-secondaire">{envoi.expediteur ?? '—'}</span>
      </td>
      <td>
        <Puce ton={TON_ETAT[etat]} point>
          {libelles.etat[etat]}
        </Puce>
        {etat === 'dispatched' && (
          <small className="jr-secondaire jr-detail-ligne avec-marge">{libelles.livraisonEnAttente}</small>
        )}
        {envoi.raisonEchec && (etat === 'failed' || etat === 'blocked') && (
          <small className="jr-secondaire jr-detail-ligne avec-marge">{envoi.raisonEchec}</small>
        )}
      </td>
      <td className="jr-cell-actions">
        {etat === 'blocked' && envoi.raisonEchec === 'not_sendable' && envoi.signalId ? (
          <BoutonChercherEmail
            organisationId={organisationId}
            signalId={envoi.signalId}
            libelle={libelles.chercherEmail}
            cout={libelles.coutChercherEmail}
          />
        ) : ETATS_A_VENIR.has(etat) ? (
          <span className="jr-actions-en-ligne">
            {etat === 'pending_approval' && (
              <Link href={`?relire=${envoi.id}`} className="jr-bouton petit">
                {libelles.relire}
              </Link>
            )}
            <BoutonReporterEnvoi actionId={envoi.id} campagneId={campagneId} libelle={libelles.reporter} />
            {envoi.contactId && <BoutonEcarterContact contactId={envoi.contactId} campagneId={campagneId} libelle={libelles.ecarter} />}
          </span>
        ) : etat === 'failed' ? (
          <span className="jr-actions-en-ligne">
            <BoutonReessayer actionId={envoi.id} campagneId={campagneId} libelle={libelles.reessayer} />
            {envoi.contactId && <BoutonEcarterContact contactId={envoi.contactId} campagneId={campagneId} libelle={libelles.ecarter} />}
          </span>
        ) : (
          <span className="jr-secondaire">{libelles.aucunePlaceholder}</span>
        )}
      </td>
    </tr>
  );
}

export function TableFileDuJour({
  envois,
  organisationId,
  campagneId,
  libelles,
}: {
  envois: readonly LigneTableFileDuJour[];
  organisationId: string;
  campagneId: string;
  libelles: TableFileDuJourLibelles;
}) {
  const groupes = grouperParHeure(envois);
  return (
    <table className="jr-table">
      <thead>
        <tr>
          <th>{libelles.colonneHeure}</th>
          <th>{libelles.colonneContact}</th>
          <th>{libelles.colonneEtape}</th>
          <th>{libelles.colonneDepuis}</th>
          <th>{libelles.colonneEtat}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {groupes.map((groupe) => (
          <Fragment key={`groupe-${groupe.heure}`}>
            <tr className="groupe">
              <td colSpan={6}>
                {intituleTrancheHoraire(groupe.heure)} · {libelles.groupeCompte(groupe.envois.length)}
              </td>
            </tr>
            {groupe.envois.map((envoi) => (
              <LigneEnvoiRendue
                key={envoi.id}
                envoi={envoi}
                organisationId={organisationId}
                campagneId={campagneId}
                libelles={libelles}
              />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

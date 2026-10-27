import type { AttenteAcceptation } from '@jay-reach/core';
import { Avatar, Carte } from '../ui';
import { BoutonEcarterContact } from './BoutonEcarterContact';

/** Ligne affichée : l'attente + ses textes déjà traduits et formatés dans le fuseau de l'organisation par l'appelant. */
export interface LigneAttenteAcceptation extends AttenteAcceptation {
  etapeTexte: string | null;
  invitationTexte: string;
  limiteTexte: string;
}

/**
 * Prépare les lignes (fonction pure, testée) : la date affichée est `limiteLe` — celle que le moteur
 * applique pour le saut —, jamais `prochaineVerificationLe` ni `depuisLe`, formatée dans le fuseau
 * réglé de l'organisation : un `limiteLe` à 23 h 30 UTC tombe le lendemain à Paris.
 */
export function lignesAttentesAcceptation(
  attentes: readonly AttenteAcceptation[],
  textes: { etape: (n: number) => string; sansInvitation: string },
  locale: string,
  fuseau: string,
): LigneAttenteAcceptation[] {
  const jourMois = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: fuseau });
  return attentes.map((a) => ({
    ...a,
    etapeTexte: a.etape !== null ? textes.etape(a.etape) : null,
    invitationTexte: a.invitationEnvoyeeLe ? jourMois.format(new Date(a.invitationEnvoyeeLe)) : textes.sansInvitation,
    limiteTexte: jourMois.format(new Date(a.limiteLe)),
  }));
}

export interface TableAttentesAcceptationLibelles {
  titre: string;
  explication: string;
  colonneContact: string;
  colonneEtape: string;
  colonneInvitation: string;
  colonneLimite: string;
  ecarter: string;
}

/**
 * Les messages LinkedIn qui attendent que la personne accepte l'invitation (#183).
 *
 * Hors des tranches horaires de la File du jour : ils n'ont pas d'heure de départ, seulement une
 * vérification quotidienne et une date au-delà de laquelle l'étape est passée. La date affichée est
 * `limiteLe`, calculée par la même formule que le saut — l'écran ne promet pas une autre date que
 * celle que le moteur appliquera. Seul geste proposé : Écarter (Reporter n'a pas de sens, la
 * personne décide du départ en acceptant).
 */
export function TableAttentesAcceptation({
  attentes,
  campagneId,
  libelles,
}: {
  attentes: readonly LigneAttenteAcceptation[];
  campagneId: string;
  libelles: TableAttentesAcceptationLibelles;
}) {
  if (attentes.length === 0) return null;
  return (
    <Carte titre={libelles.titre}>
      <p className="jr-secondaire" style={{ margin: '0 0 12px', fontSize: 13.5 }}>
        {libelles.explication}
      </p>
      <table className="jr-table">
        <thead>
          <tr>
            <th>{libelles.colonneContact}</th>
            <th>{libelles.colonneEtape}</th>
            <th>{libelles.colonneInvitation}</th>
            <th>{libelles.colonneLimite}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {attentes.map((a) => (
            <tr key={a.queueId}>
              <td>
                <div className="jr-qui">
                  <Avatar nom={a.contactNom} canal="linkedin" />
                  <span>
                    <b>{a.contactNom}</b>
                  </span>
                </div>
              </td>
              <td>
                <b className="jr-demi-gras">{a.etapeTexte ?? '—'}</b>
              </td>
              <td>
                <span className="jr-secondaire">{a.invitationTexte}</span>
              </td>
              <td>{a.limiteTexte}</td>
              <td className="jr-cell-actions">
                {a.contactId && <BoutonEcarterContact contactId={a.contactId} campagneId={campagneId} libelle={libelles.ecarter} />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Carte>
  );
}

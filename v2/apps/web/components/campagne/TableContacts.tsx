import Link from 'next/link';
import type { ContactCampagne, StatutContactCampagne } from '@jay-reach/core';
import { Avatar, Puce, Table } from '../ui';
import type { PuceTon } from '../ui';
import { BoutonChercherEmail } from './BoutonChercherEmail';
import { BoutonEcarterContact } from './BoutonEcarterContact';

/**
 * Ligne affichée par `TableContacts` : `ContactCampagne`
 * (`packages/core/src/fonctions/campagnes.ts::listerContactsCampagne`),
 * complétée quand la variante `global` (tâche 18, colonne Campagne) l'exige —
 * pas de champ ajouté à `ContactCampagne` lui-même pour ce seul besoin
 * d'affichage.
 */
export interface LigneTableContacts extends ContactCampagne {
  /** Requis en variante `global` (chaque ligne peut appartenir à une campagne différente) ; sinon `campagneId` de `TableContactsProps` fait foi. */
  campagneId?: string;
  campagneNom?: string;
  /** Texte déjà traduit de l'étape (« Étape 3 »), calculé par l'appelant (accès à `t()`) — `null` si `etape` est `null`. */
  etapeTexte: string | null;
}

export interface TableContactsLibelles {
  colonneContact: string;
  colonnePourquoi: string;
  colonneScore: string;
  colonneEmail: string;
  colonneEtape: string;
  colonneCampagne: string;
  colonneAction: string;
  emailVerifie: string;
  emailATrouver: string;
  sansEtape: string;
  statut: Record<StatutContactCampagne, string>;
  chercherEmail: string;
  coutChercherEmail: string;
  ecarter: string;
  vide: string;
}

export interface TableContactsProps {
  lignes: readonly LigneTableContacts[];
  colonnes: 'campagne' | 'global';
  organisationId: string;
  /** Campagne courante — sert aux actions d'une ligne qui ne porte pas son propre `campagneId` (variante `campagne`). */
  campagneId?: string;
  libelles: TableContactsLibelles;
}

/**
 * Statuts pour lesquels la dernière colonne montre une action plutôt qu'une
 * puce d'état : `sans_email` (Chercher l'email) et `a_contacter` (Écarter,
 * seul statut « avant séquence » qui n'a pas encore d'inscription active à
 * arrêter — `ecarterDuneCampagne` marque alors le signal d'origine).
 */
export const TON_STATUT: Record<StatutContactCampagne, PuceTon> = {
  ne_plus_contacter: 'erreur',
  rebond: 'attention',
  interesse: 'bon',
  a_repondu: 'bon',
  ecarte: 'gris',
  termine: 'gris',
  en_sequence: 'accent',
  sans_email: 'attention',
  a_contacter: 'gris',
};

export function TableContacts({ lignes, colonnes, organisationId, campagneId, libelles }: TableContactsProps) {
  return (
    <Table
      colonnes={[
        { cle: 'contact', titre: libelles.colonneContact },
        ...(colonnes === 'global' ? [{ cle: 'campagne', titre: libelles.colonneCampagne }] : []),
        { cle: 'pourquoi', titre: libelles.colonnePourquoi },
        { cle: 'score', titre: libelles.colonneScore },
        { cle: 'email', titre: libelles.colonneEmail },
        { cle: 'etape', titre: libelles.colonneEtape },
        { cle: 'action', titre: libelles.colonneAction },
      ]}
      vide={libelles.vide}
      lignes={lignes.map((ligne) => {
        const campagneDeLaLigne = ligne.campagneId ?? campagneId;
        return {
          contact: (
            <div className="jr-qui">
              <Avatar nom={ligne.nom} />
              <span>
                <b>
                  {ligne.contactId ? (
                    <Link href={`?contact=${ligne.contactId}`} className="jr-lien">
                      {ligne.nom}
                    </Link>
                  ) : (
                    ligne.nom
                  )}
                </b>
                <small>
                  {[ligne.poste, ligne.entreprise].filter(Boolean).join(' · ') || '—'}
                </small>
              </span>
            </div>
          ),
          ...(colonnes === 'global' ? { campagne: ligne.campagneNom ?? '—' } : {}),
          pourquoi: ligne.pourquoi ? (
            <span className="jr-petit jr-tronque">{ligne.pourquoi}</span>
          ) : (
            <span className="jr-secondaire">—</span>
          ),
          score: ligne.score ?? <span className="jr-secondaire">—</span>,
          email: ligne.email ? (
            <Puce ton="bon" point>
              {libelles.emailVerifie}
            </Puce>
          ) : (
            <Puce ton="attention" point>
              {libelles.emailATrouver}
            </Puce>
          ),
          etape: ligne.etapeTexte ?? <span className="jr-secondaire">{libelles.sansEtape}</span>,
          action:
            ligne.statut === 'sans_email' && ligne.signalId ? (
              // Un contact sans email ET sans signal (R36, inscription manuelle sans email
              // renseigné) retombe sur la puce générique ci-dessous : rien à enrichir sans
              // signal (pas de compte à résoudre), `enrichirMaintenant` exige un `signalId`.
              <BoutonChercherEmail
                organisationId={organisationId}
                signalId={ligne.signalId}
                libelle={libelles.chercherEmail}
                cout={libelles.coutChercherEmail}
              />
            ) : ligne.statut === 'a_contacter' ? (
              ligne.contactId && campagneDeLaLigne ? (
                <BoutonEcarterContact contactId={ligne.contactId} campagneId={campagneDeLaLigne} libelle={libelles.ecarter} />
              ) : (
                <Puce ton={TON_STATUT.a_contacter} point>
                  {libelles.statut.a_contacter}
                </Puce>
              )
            ) : (
              <Puce ton={TON_STATUT[ligne.statut]} point>
                {libelles.statut[ligne.statut]}
              </Puce>
            ),
        };
      })}
    />
  );
}

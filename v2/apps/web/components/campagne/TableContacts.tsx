import Link from 'next/link';
import type { ContactCampagne, StatutContactCampagne } from '@jay-reach/core';
import { Avatar, Puce, Table } from '../ui';
import type { PuceTon } from '../ui';
import { BoutonChercherEmail } from './BoutonChercherEmail';
import { BoutonEcarterContact } from './BoutonEcarterContact';
import { BoutonReprendre } from './BoutonReprendre';

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
  /**
   * Libellé déjà traduit du motif de pause (`libelleMotifPause`, `lib/motif-pause.ts`),
   * calculé par l'appelant — `null` hors statut `en_pause`.
   */
  motifPauseAffiche: { texte: string; title: string | null } | null;
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
  /** Libellé du bouton de reprise d'une inscription en pause (T29) — `paused_absence` (motif `absence`) utilise `reprendreMaintenant` à la place. */
  reprendre: string;
  reprendreMaintenant: string;
  vide: string;
}

export interface TableContactsProps {
  lignes: readonly LigneTableContacts[];
  colonnes: 'campagne' | 'global';
  organisationId: string;
  /** Campagne courante — sert aux actions d'une ligne qui ne porte pas son propre `campagneId` (variante `campagne`). */
  campagneId?: string;
  libelles: TableContactsLibelles;
  /**
   * Masque « Pourquoi lui »/Score (tour de correction F6, point 20) : pour une campagne à liste
   * (sans source de signaux), ces deux colonnes n'affichent que des tirets. La donnée qui dit si
   * une campagne a une source vient du cœur (F5, en cours) : par défaut `false`, l'appelant la
   * réglera une fois cette information exposée par `listerContactsCampagne`/`ContactCampagne`.
   */
  masquerScoring?: boolean;
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
  en_pause: 'attention',
  en_sequence: 'accent',
  sans_email: 'attention',
  a_contacter: 'gris',
};

export function TableContacts({ lignes, colonnes, organisationId, campagneId, libelles, masquerScoring }: TableContactsProps) {
  return (
    <Table
      colonnes={[
        { cle: 'contact', titre: libelles.colonneContact },
        ...(colonnes === 'global' ? [{ cle: 'campagne', titre: libelles.colonneCampagne }] : []),
        // Largeurs automatiques (tour de correction F6, point 20) : « Étape 2 » ne coupe plus sur
        // deux lignes, et la colonne statut/action se réduit à son contenu (`largeur: '1%'`,
        // astuce CSS courante pour une colonne « shrink-to-fit » sans mesure JS) plutôt que de
        // s'étaler sur 335 px sans raison.
        ...(masquerScoring ? [] : [{ cle: 'pourquoi', titre: libelles.colonnePourquoi }, { cle: 'score', titre: libelles.colonneScore }]),
        { cle: 'email', titre: libelles.colonneEmail },
        { cle: 'etape', titre: libelles.colonneEtape, nowrap: true },
        { cle: 'action', titre: libelles.colonneAction, nowrap: true, largeur: '1%' },
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
            ) : ligne.statut === 'en_pause' ? (
              // Empilé plutôt que côte à côte (tour de correction F6, point 20) : un motif de
              // pause à côté du bouton Reprendre additionnait leurs deux largeurs et poussait la
              // colonne Statut/Action bien au-delà de son contenu réel (motif le plus long mesuré :
              // « Envoi refusé par le fournisseur d'email »). Le motif lui-même est tronqué
              // (`jr-motif-pause`, ellipse + `title` avec le texte complet) : une phrase ne doit
              // jamais, à elle seule, dicter la largeur de la colonne pour toutes les lignes.
              <div className="jr-action-empilee">
                <Puce ton={TON_STATUT.en_pause} point>
                  {libelles.statut.en_pause}
                </Puce>
                {ligne.motifPauseAffiche && (
                  <div className="jr-petit jr-motif-pause" title={ligne.motifPauseAffiche.title ?? ligne.motifPauseAffiche.texte}>
                    {ligne.motifPauseAffiche.texte}
                  </div>
                )}
                {ligne.inscriptionId && campagneDeLaLigne && (
                  <BoutonReprendre
                    inscriptionId={ligne.inscriptionId}
                    campagneId={campagneDeLaLigne}
                    libelle={ligne.motifPause === 'absence' ? libelles.reprendreMaintenant : libelles.reprendre}
                  />
                )}
              </div>
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

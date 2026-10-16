import type { ReactNode } from 'react';
import type { getTranslations } from 'next-intl/server';
import type { BoiteFil, CampagneFil, InteretFil, MessageFil, ResumeContactFil } from '@jay-reach/core';
import { Avatar, Message, Puce } from '../ui';
import { BoutonMarquerTraite } from './BoutonMarquerTraite';
import { ZoneReponseFil } from './ZoneReponseFil';

export interface MessageFilAffiche extends MessageFil {
  readonly quandAffiche: string;
}

export interface FilProps {
  /**
   * Résolu une fois par `page.tsx` (`await getTranslations('reception')`) et
   * passé en prop plutôt que rappelé ici : garde ce composant SYNCHRONE
   * (testable par `renderToStaticMarkup`, même convention que
   * `EnTeteCampagne`/`FiltresStatuts`) au lieu d'un composant serveur async.
   */
  readonly t: Awaited<ReturnType<typeof getTranslations>>;
  readonly filId: string;
  readonly contact: ResumeContactFil;
  readonly canal: 'email' | 'linkedin';
  readonly campagne: CampagneFil | null;
  readonly boite: BoiteFil | null;
  readonly messages: MessageFilAffiche[];
  readonly interet: InteretFil;
  readonly traite: boolean;
  readonly reponsePossible: boolean;
  readonly raisonReponseImpossible: string | null;
  readonly transportReponse: 'microsoft_graph' | 'salesblink' | null;
}

/**
 * Ce qu'un message sortant affiche à la place de sa date tant qu'il n'est pas parti, et le bandeau
 * qui dit quoi faire quand il y a quelque chose à faire.
 *
 * Trois états, trois intentions différentes :
 * - `en_cours` est transitoire et se réglera tout seul, donc ton neutre et aucun bandeau : rien à
 *   faire, juste à attendre. Le point pulse (`jr-envoi-en-cours`) pour dire « ça travaille » —
 *   c'est la seule chose que la couleur ne sait pas dire, et le seul mouvement de cet écran.
 * - `echec` ne se réglera pas tout seul.
 * - `a_verifier` est le plus délicat : le message est PEUT-ÊTRE parti. Il ne doit jamais ressembler
 *   à un échec, sans quoi l'opérateur renvoie et met un doublon chez un humain. D'où le ton
 *   `attention` et un texte qui demande d'aller voir avant de renvoyer.
 */
function etatDuMessage(
  etat: 'en_cours' | 'echec' | 'a_verifier' | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { marque: ReactNode; bandeau: ReactNode } | null {
  if (etat === 'en_cours') {
    return {
      marque: (
        <span className="jr-envoi-en-cours">
          <Puce ton="gris" point>
            {t('fil.etatEnvoi.enCours')}
          </Puce>
        </span>
      ),
      bandeau: null,
    };
  }
  if (etat === 'echec') {
    return {
      marque: (
        <Puce ton="erreur" point>
          {t('fil.etatEnvoi.echec')}
        </Puce>
      ),
      bandeau: <p className="jr-bandeau erreur">{t('fil.etatEnvoi.echecDetail')}</p>,
    };
  }
  if (etat === 'a_verifier') {
    return {
      marque: (
        <Puce ton="attention" point>
          {t('fil.etatEnvoi.aVerifier')}
        </Puce>
      ),
      bandeau: <p className="jr-bandeau attention">{t('fil.etatEnvoi.aVerifierDetail')}</p>,
    };
  }
  return null;
}

/** « via SalesBlink »/« via Microsoft » : le transport réel, jamais celui que la maquette d'origine supposait partout (avant le lot 3 bis). */
function libelleTransport(transport: 'microsoft_graph' | 'salesblink' | null): string {
  if (transport === 'microsoft_graph') return 'Microsoft';
  return 'SalesBlink';
}

/**
 * Volet central : en-tête du contact (poste, entreprise, campagne, étape,
 * séquence arrêtée), messages en cartes pleine largeur, et la zone de réponse
 * (`ZoneReponseFil`) toujours affichée — jamais un tiroir (spec §6.12).
 */
export function Fil({
  t,
  filId,
  contact,
  canal,
  campagne,
  boite,
  messages,
  interet,
  traite,
  reponsePossible,
  raisonReponseImpossible,
  transportReponse,
}: FilProps) {
  // Clé dynamique (`reception.fil.raisonReponseImpossible.*`) : `t()` de ce
  // fichier est déjà bornée au namespace `reception`, donc le préfixe est
  // retiré avant l'appel.
  const raisonAffichee = raisonReponseImpossible ? t(raisonReponseImpossible.replace(/^reception\./, '')) : null;

  const sousTitre = [contact.poste, contact.entreprise].filter(Boolean).join(' · ');
  const complementCampagne = campagne
    ? `${sousTitre ? ' · ' : ''}${t('fil.campagne', { nom: campagne.nom })}${
        campagne.etape ? `, ${t('fil.etape', { position: campagne.etape.position, total: campagne.etape.total })}` : ''
      }${campagne.sequenceArretee ? `, ${t('fil.sequenceArretee')}` : ''}`
    : '';

  // Le transport s'affiche dès qu'il est connu, même sans boîte liée au
  // contact (aucune ligne `contact_sender_bindings` — rare, mais le transport
  // réel est déjà déterminé : `repondreAuFil` l'utilisera quoi qu'il arrive).
  // Un fil LinkedIn n'a jamais de boîte : sans ce cas, la zone affichait « Répondre » tout court,
  // là où l'email annonce « Répondre depuis telle adresse via tel transport ». Par où part un
  // message est la première chose qu'on veut savoir avant de l'écrire.
  const depuisTexte =
    canal === 'linkedin'
      ? t('reponse.depuisLinkedin')
      : boite
        ? t('reponse.depuis', { boite: boite.identite })
        : t('reponse.depuisSansBoite');
  const depuis = transportReponse ? (
    <>
      {depuisTexte} · {t('reponse.via', { transport: libelleTransport(transportReponse) })}
    </>
  ) : (
    <>{depuisTexte}</>
  );

  return (
    <div className="jr-fil">
      <div className="jr-fil-entete">
        <div className="jr-qui">
          <Avatar nom={contact.nom} taille="grand" canal={canal} />
          <span>
            <b>{contact.nom}</b>
            <small>
              {sousTitre}
              {complementCampagne}
            </small>
          </span>
        </div>
        <BoutonMarquerTraite
          key={filId}
          filId={filId}
          traite={traite}
          libelleMarquer={t('fil.marquerTraite')}
          libelleRouvrir={t('fil.rouvrir')}
        />
      </div>
      <div className="jr-fil-corps">
        {messages.map((m) => {
          const etat = etatDuMessage(m.etatEnvoi, t);
          const repondDepuis = m.repondDepuis ? (
            <p className="jr-secondaire jr-petit">{t('fil.repondDepuis', { adresse: m.repondDepuis })}</p>
          ) : null;
          return (
            <Message
              key={m.id}
              direction={m.direction === 'in' ? 'entrant' : 'sortant'}
              auteur={m.expediteur}
              date={etat ? etat.marque : m.quandAffiche}
              destinataire={m.destinataire ?? undefined}
              objet={m.objet ?? undefined}
              corps={m.corps}
              // Avant le corps, délibérément : l'opérateur doit savoir que le message n'est pas
              // parti AVANT de le relire, sans quoi il le lit, le croit envoyé, et ne voit
              // l'avertissement qu'une fois la page quittée.
              avertissement={
                etat?.bandeau || repondDepuis ? (
                  <>
                    {etat?.bandeau}
                    {repondDepuis}
                  </>
                ) : undefined
              }
            />
          );
        })}
        {/* key : sans rechargement complet, le brouillon, le message « Envoyée » et l'erreur d'un fil ne doivent pas survivre au passage à un autre fil. */}
        <ZoneReponseFil
          key={filId}
          filId={filId}
          depuis={depuis}
          placeholder={t('reponse.placeholder')}
          note={t('reponse.note')}
          interet={interet}
          libelleMarquerInteresse={t('reponse.marquerInteresse')}
          libelleRetirerInteret={t('reponse.retirerInteret')}
          libelleEnvoyer={t('reponse.envoyer')}
          libelleEnvoiEnCours={t('reponse.envoiEnCours')}
          libelleEnvoyee={t('reponse.envoyee')}
          reponsePossible={reponsePossible}
          raisonIndisponible={raisonAffichee}
        />
      </div>
    </div>
  );
}

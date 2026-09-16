import type { getTranslations } from 'next-intl/server';
import type { BoiteFil, CampagneFil, InteretFil, MessageFil, ResumeContactFil } from '@jay-reach/core';
import { Avatar, Message } from '../ui';
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

  const depuis = boite ? (
    <>
      {t('reponse.depuis', { boite: boite.identite })} · {t('reponse.via', { transport: libelleTransport(transportReponse) })}
    </>
  ) : (
    <>{t('reponse.depuisSansBoite')}</>
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
          filId={filId}
          traite={traite}
          libelleMarquer={t('fil.marquerTraite')}
          libelleRouvrir={t('fil.rouvrir')}
        />
      </div>
      <div className="jr-fil-corps">
        {messages.map((m) => (
          <Message
            key={m.id}
            direction={m.direction === 'in' ? 'entrant' : 'sortant'}
            auteur={m.expediteur}
            date={m.quandAffiche}
            destinataire={m.destinataire ?? undefined}
            objet={m.objet ?? undefined}
            corps={m.corps}
            avertissement={
              m.repondDepuis ? <p className="jr-secondaire jr-petit">{t('fil.repondDepuis', { adresse: m.repondDepuis })}</p> : undefined
            }
          />
        ))}
        <ZoneReponseFil
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

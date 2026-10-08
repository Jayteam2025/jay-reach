'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CompteLinkedIn } from '@jay-reach/core';
import { Avatar, Bouton, Carte, Champ, Interrupteur, Puce, Tiroir } from '../ui';
import { actionModifierCompteLinkedIn } from '../../app/actions/linkedin';
import { puceEtatCompteLinkedIn } from './compte-linkedin-affichage';


export interface CarteCompteLinkedInProps {
  compte: CompteLinkedIn;
  /** `false` pour un rôle viewer/operator : l'interrupteur et « Modifier » se lisent, mais n'agissent pas. */
  peutModifier: boolean;
}

/**
 * Carte d'un compte LinkedIn connecté. Les quotas et la fenêtre d'envoi
 * restent réglés PAR ORGANISATION (`linkedin_settings`, une seule ligne
 * aujourd'hui — voir le commentaire de `listerComptesLinkedIn` côté cœur) :
 * les modifier depuis cette carte les change pour tout compte relié, tant
 * qu'un plafond par compte n'existe pas dans le schéma.
 */
export function CarteCompteLinkedIn({ compte, peutModifier }: CarteCompteLinkedInProps) {
  const t = useTranslations('reglages.expediteurs.linkedin');
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const etatCompte = puceEtatCompteLinkedIn(compte);

  const [quotaJour, setQuotaJour] = useState(compte.quotas.parJour);
  const [quotaSemaine, setQuotaSemaine] = useState(compte.quotas.parSemaine);

  async function enregistrer(actifSuivant: boolean) {
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await actionModifierCompteLinkedIn({
        compteId: compte.id,
        active: actifSuivant,
        quotaJour,
        quotaSemaine,
        // La fenêtre d'envoi n'est plus réglable ici (elle appartient à l'écran du canal
        // serveur) : on renvoie celle qui est enregistrée, inchangée.
        heures: compte.heures,
      });
      if (resultat.ok) {
        setOuvert(false);
      } else {
        setErreur(resultat.error);
      }
    } finally {
      setEnCours(false);
    }
  }

  return (
    <Carte
      entete={
        <>
          <div className="jr-qui">
            <Avatar nom={compte.nom} canal="linkedin" taille="grand" />
            <span>
              <b style={{ fontSize: 16 }}>{compte.nom}</b>
              <small>
                {t(compte.connecte ? 'connected' : 'notConnected')} · {t('perDay', { n: compte.quotas.parJour })} ·{' '}
                {t('perWeek', { n: compte.quotas.parSemaine })}
              </small>
            </span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {/*
              F15 : un jeton connecté (et même actif) n'envoie rien tant que
              son expéditeur (`senders`) ne l'est pas — voir le commentaire de
              `CompteLinkedIn.envoiPossible`. Une puce unique (constat recette
              du 18/09) : « Active » et « Aucun envoi ne partira » côte à côte
              étaient deux affirmations contradictoires. `puceEtatCompteLinkedIn`
              donne la priorité à ce qui empêche réellement d'envoyer, dans un
              seul ton/texte qui porte les deux faits.
            */}
            <Puce ton={etatCompte.ton} point>
              {t(etatCompte.cle)}
            </Puce>
            {peutModifier && (
              <>
                <Interrupteur
                  actif={compte.active}
                  onChange={(actif) => enregistrer(actif)}
                  libelle={t(compte.active ? 'active' : 'inactive')}
                  disabled={enCours}
                />
                <Bouton taille="petit" onClick={() => setOuvert(true)}>
                  {t('edit')}
                </Bouton>
              </>
            )}
          </div>
        </>
      }
    >
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}

      <Tiroir
        ouvert={ouvert}
        titre={t('drawerTitle', { nom: compte.nom })}
        onFermer={() => setOuvert(false)}
        libelleFermer={t('close')}
        pied={
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <Bouton onClick={() => setOuvert(false)} disabled={enCours}>
              {t('cancel')}
            </Bouton>
            <Bouton variante="principal" onClick={() => enregistrer(compte.active)} aria-busy={enCours} disabled={enCours}>
              {enCours ? t('saving') : t('save')}
            </Bouton>
          </div>
        }
      >
        <div style={{ display: 'grid', gap: 14 }}>
          {/*
            Depuis que l'envoi passe par le serveur, le rythme n'est plus lu ici : il vient
            de `organization_settings` (`linkedin_invitations_par_semaine`,
            `linkedin_messages_par_semaine`). Les deux champs ci-dessous ne gouvernent plus
            que le pacing de l'extension (`apps/web/lib/linkedin/queue.ts`). Les laisser
            muets ferait croire qu'on règle ici le volume du serveur.
          */}
          <p className="jr-aide">{t('plafondsExtension')}</p>
          <Champ libelle={t('drawerDailyQuota')} id="tiroir-li-quota-jour">
            <input
              id="tiroir-li-quota-jour"
              type="number"
              min={1}
              max={200}
              value={quotaJour}
              onChange={(e) => setQuotaJour(Number(e.target.value))}
            />
          </Champ>
          <Champ libelle={t('drawerWeeklyQuota')} id="tiroir-li-quota-semaine">
            <input
              id="tiroir-li-quota-semaine"
              type="number"
              min={1}
              max={200}
              value={quotaSemaine}
              onChange={(e) => setQuotaSemaine(Number(e.target.value))}
            />
          </Champ>
        </div>
      </Tiroir>
    </Carte>
  );
}

'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { CompteLinkedIn } from '@jay-reach/core';
import { Avatar, Bouton, Carte, Champ, Interrupteur, Puce, Tiroir } from '../ui';
import { actionModifierCompteLinkedIn } from '../../app/actions/linkedin';
import { puceEtatCompteLinkedIn } from './compte-linkedin-affichage';

/** Même liste restreinte que `LinkedInPanel.tsx`. */
const FUSEAUX = ['Europe/Paris', 'Europe/Brussels', 'Europe/London', 'America/Montreal'] as const;
/** Abréviation traduite via `reglages.days.short.*` — jamais câblée en dur. */
const JOURS: { valeur: number; cle: string }[] = [
  { valeur: 1, cle: 'mon' },
  { valeur: 2, cle: 'tue' },
  { valeur: 3, cle: 'wed' },
  { valeur: 4, cle: 'thu' },
  { valeur: 5, cle: 'fri' },
  { valeur: 6, cle: 'sat' },
  { valeur: 7, cle: 'sun' },
];
const HEURES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
const HEURES_FIN = [...HEURES.slice(1), '24:00'];

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
  const tJours = useTranslations('reglages.days.short');
  const [ouvert, setOuvert] = useState(false);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const etatCompte = puceEtatCompteLinkedIn(compte);

  const [quotaJour, setQuotaJour] = useState(compte.quotas.parJour);
  const [quotaSemaine, setQuotaSemaine] = useState(compte.quotas.parSemaine);
  const [debut, setDebut] = useState(compte.heures.debut);
  const [fin, setFin] = useState(compte.heures.fin);
  const [jours, setJours] = useState<number[]>(compte.heures.jours);
  const [fuseau, setFuseau] = useState(compte.heures.fuseau);

  function basculerJour(jour: number) {
    setJours((precedent) =>
      precedent.includes(jour) ? precedent.filter((j) => j !== jour) : [...precedent, jour].sort((a, b) => a - b),
    );
  }

  async function enregistrer(actifSuivant: boolean) {
    setErreur(null);
    setEnCours(true);
    try {
      const resultat = await actionModifierCompteLinkedIn({
        compteId: compte.id,
        active: actifSuivant,
        quotaJour,
        quotaSemaine,
        heures: { debut, fin, jours, fuseau },
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
          <Champ libelle={t('drawerHoursFrom')} id="tiroir-li-debut">
            <select id="tiroir-li-debut" value={debut} onChange={(e) => setDebut(e.target.value)}>
              {HEURES.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </Champ>
          <Champ libelle={t('drawerHoursTo')} id="tiroir-li-fin">
            <select id="tiroir-li-fin" value={fin} onChange={(e) => setFin(e.target.value)}>
              {HEURES_FIN.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </Champ>
          <Champ libelle={t('drawerDays')}>
            <div style={{ display: 'flex', gap: 6 }}>
              {JOURS.map(({ valeur, cle }) => (
                <Bouton
                  key={valeur}
                  taille="petit"
                  variante={jours.includes(valeur) ? 'principal' : undefined}
                  aria-pressed={jours.includes(valeur)}
                  onClick={() => basculerJour(valeur)}
                >
                  {tJours(cle)}
                </Bouton>
              ))}
            </div>
          </Champ>
          <Champ libelle={t('drawerTimezone')} id="tiroir-li-fuseau">
            <select id="tiroir-li-fuseau" value={fuseau} onChange={(e) => setFuseau(e.target.value)}>
              {FUSEAUX.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </Champ>
        </div>
      </Tiroir>
    </Carte>
  );
}

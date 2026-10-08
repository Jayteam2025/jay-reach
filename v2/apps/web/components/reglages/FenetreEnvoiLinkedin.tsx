'use client';

/**
 * Fenêtre d'envoi LinkedIn (Réglages › LinkedIn) : heures, jours actifs, fuseau.
 *
 * Même rythme visuel que `PlafondsLinkedin` juste au-dessus (`jr-plafond-ligne` :
 * le nom et son explication à gauche, le contrôle à droite), mais UN seul bouton
 * pour les trois lignes — une fenêtre sans ses jours ne veut rien dire, les trois
 * champs se valident et s'enregistrent ensemble.
 *
 * Les plafonds de volume ne sont pas ici : ils vivent dans la carte des plafonds,
 * avec les autres réglages chiffrés du compte.
 */
import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { Bouton } from '../ui';
import { actionEnregistrerHeuresEnvoiLinkedIn } from '../../app/actions/linkedin';

/** Même liste restreinte que `CarteCompteLinkedIn` et `LinkedInPanel`. */
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

function hhmm(heure: number): string {
  return `${String(heure).padStart(2, '0')}:00`;
}

const HEURES_DEBUT = Array.from({ length: 24 }, (_, h) => h);
const HEURES_FIN = Array.from({ length: 24 }, (_, h) => h + 1);

export interface FenetreEnvoiLinkedinValeur {
  debutHeure: number;
  finHeure: number;
  jours: number[];
  fuseau: string;
}

export interface FenetreEnvoiLinkedinProps {
  valeur: FenetreEnvoiLinkedinValeur;
  /** `false` pour un rôle viewer/operator : les champs se lisent, mais n'agissent pas. */
  peutModifier: boolean;
}

/**
 * Ce qui empêche d'enregistrer, ou `null`. Fonction pure et exportée pour être
 * éprouvée seule : l'idiome de test de ce dépôt ne rend que du HTML statique,
 * donc une règle laissée dans le gestionnaire de clic ne serait prouvée nulle part.
 */
export function refusFenetreEnvoi(valeur: FenetreEnvoiLinkedinValeur): 'ordre' | 'jours' | null {
  if (valeur.finHeure <= valeur.debutHeure) return 'ordre';
  if (valeur.jours.length === 0) return 'jours';
  return null;
}

/** Deux fenêtres identiques : décide si le bouton d'enregistrement a lieu d'être. */
export function memeFenetre(a: FenetreEnvoiLinkedinValeur, b: FenetreEnvoiLinkedinValeur): boolean {
  return (
    a.debutHeure === b.debutHeure &&
    a.finHeure === b.finHeure &&
    a.fuseau === b.fuseau &&
    a.jours.length === b.jours.length &&
    a.jours.every((j, i) => j === b.jours[i])
  );
}

export function FenetreEnvoiLinkedin({ valeur, peutModifier }: FenetreEnvoiLinkedinProps) {
  const t = useTranslations('reglages.linkedin.rythme.fenetre');
  const tJours = useTranslations('reglages.days.short');
  const [enregistre, setEnregistre] = useState<FenetreEnvoiLinkedinValeur>(valeur);
  const [saisie, setSaisie] = useState<FenetreEnvoiLinkedinValeur>(valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const modifie = !memeFenetre(saisie, enregistre);

  function basculerJour(jour: number) {
    setSaisie((p) => ({
      ...p,
      jours: p.jours.includes(jour) ? p.jours.filter((j) => j !== jour) : [...p.jours, jour].sort((a, b) => a - b),
    }));
  }

  function enregistrer() {
    setErreur(null);
    const refus = refusFenetreEnvoi(saisie);
    if (refus !== null) {
      setErreur(refus === 'ordre' ? t('erreurOrdre') : t('erreurJours'));
      return;
    }
    const aEnregistrer = saisie;
    startTransition(async () => {
      const res = await actionEnregistrerHeuresEnvoiLinkedIn(aEnregistrer);
      if (res.ok) setEnregistre(aEnregistrer);
      else setErreur(res.error);
    });
  }

  return (
    <>
      <div className="jr-plafond-ligne">
        <div>
          <label htmlFor="linkedin-fenetre-debut">
            <b>{t('heures.nom')}</b>
          </label>
          <small className="jr-secondaire jr-etat-detail">{t('heures.aide')}</small>
        </div>
        <div className="jr-plafond-saisie">
          <select
            id="linkedin-fenetre-debut"
            value={saisie.debutHeure}
            onChange={(e) => setSaisie((p) => ({ ...p, debutHeure: Number(e.target.value) }))}
            disabled={!peutModifier || pending}
            aria-label={t('heures.debut')}
          >
            {HEURES_DEBUT.map((h) => (
              <option key={h} value={h}>
                {hhmm(h)}
              </option>
            ))}
          </select>
          <span aria-hidden="true">–</span>
          <select
            value={saisie.finHeure}
            onChange={(e) => setSaisie((p) => ({ ...p, finHeure: Number(e.target.value) }))}
            disabled={!peutModifier || pending}
            aria-label={t('heures.fin')}
          >
            {HEURES_FIN.map((h) => (
              <option key={h} value={h}>
                {hhmm(h)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="jr-plafond-ligne">
        <div>
          <span>
            <b>{t('jours.nom')}</b>
          </span>
          <small className="jr-secondaire jr-etat-detail">{t('jours.aide')}</small>
        </div>
        <div className="jr-plafond-saisie" role="group" aria-label={t('jours.nom')}>
          {JOURS.map(({ valeur: jour, cle }) => (
            <Bouton
              key={jour}
              taille="petit"
              variante={saisie.jours.includes(jour) ? 'principal' : undefined}
              aria-pressed={saisie.jours.includes(jour)}
              onClick={() => basculerJour(jour)}
              disabled={!peutModifier || pending}
            >
              {tJours(cle)}
            </Bouton>
          ))}
        </div>
      </div>

      <div className="jr-plafond-ligne">
        <div>
          <label htmlFor="linkedin-fenetre-fuseau">
            <b>{t('fuseau.nom')}</b>
          </label>
          <small className="jr-secondaire jr-etat-detail">{t('fuseau.aide')}</small>
        </div>
        <div className="jr-plafond-saisie">
          <select
            id="linkedin-fenetre-fuseau"
            value={saisie.fuseau}
            onChange={(e) => setSaisie((p) => ({ ...p, fuseau: e.target.value }))}
            disabled={!peutModifier || pending}
          >
            {FUSEAUX.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}

      {peutModifier && modifie && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Bouton variante="principal" taille="petit" onClick={enregistrer} disabled={pending} aria-busy={pending}>
            {t('enregistrer')}
          </Bouton>
        </div>
      )}
    </>
  );
}

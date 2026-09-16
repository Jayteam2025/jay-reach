'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { CampagneOption, PersonaDetail, SenioritePersona } from '@jay-reach/core';
import { Bouton, Carte, Champ, TuileLogo } from '../ui';
import { actionEnregistrerPersona } from '../../app/actions/personas';
import { TestAppariement } from './TestAppariement';

/** Alias local — `PersonaDetail`/`CampagneOption` (`packages/core/src/fonctions/personas.ts`) sont déjà la forme exacte attendue par cet écran (types seuls, aucun coût runtime dans un composant client). */
export type PersonaVue = PersonaDetail;
export type CampagneOptionVue = CampagneOption;

export interface FichePersonaProps {
  readonly personas: readonly PersonaVue[];
  readonly campagnesDisponibles: readonly CampagneOptionVue[];
  readonly peutModifier: boolean;
}

const SENIORITES: readonly SenioritePersona[] = ['executive', 'director', 'manager', 'individual'];

/** Ligne du panneau maître (liste des personas) — vraie liste sélectionnable, `<button>` (pas `<div role>`). */
function LignePersona({
  persona,
  selectionnee,
  onSelectionner,
  t,
}: {
  persona: PersonaVue;
  selectionnee: boolean;
  onSelectionner: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  // Cette ligne ne rend QUE des personas actifs (`FichePersona` filtre avant
  // d'appeler ce composant, les archivés ont leur propre section) : jamais
  // besoin d'un libellé « archivé » ici.
  const sousTitre =
    persona.campagnesUtilisatrices.length === 0
      ? t('list.draft')
      : persona.scoreMoyen === null
        ? t('list.summary', {
            campaigns: persona.campagnesUtilisatrices.length,
            contacts: persona.nombreContacts,
          })
        : t('list.summaryWithScore', {
            campaigns: persona.campagnesUtilisatrices.length,
            contacts: persona.nombreContacts,
            score: persona.scoreMoyen,
          });

  return (
    <button
      type="button"
      className="jr-source"
      style={{
        cursor: 'pointer',
        width: '100%',
        textAlign: 'left',
        background: selectionnee ? 'var(--jr-accent-doux)' : undefined,
        margin: selectionnee ? '0 -18px' : undefined,
        padding: selectionnee ? '12px 18px' : undefined,
        borderRadius: selectionnee ? 'var(--jr-rayon-controle)' : undefined,
      }}
      aria-pressed={selectionnee}
      onClick={onSelectionner}
    >
      <TuileLogo marque="lettre" lettre={persona.nom.charAt(0).toUpperCase()} />
      <span>
        <b>{persona.nom}</b>
        <small>{sousTitre}</small>
      </span>
      <span className="jr-secondaire">›</span>
    </button>
  );
}

/**
 * Ligne de la section repliée « Archivés » (tour de correction 1, important
 * #3 : un persona archivé n'avait aucun moyen d'être repris). Pas un
 * `<button>` englobant comme `LignePersona` : le bouton « Réactiver » est LUI
 * l'élément interactif, imbriquer un bouton dans un bouton serait invalide.
 * Fonction pure (aucun `useTranslations`/`useRouter`), testable par
 * `renderToStaticMarkup` — même motif que `BlocResultatAnnuaire`
 * (`sources/TiroirSourceAnnuaire.tsx`) et `PiedTiroirRelecture`
 * (`campagne/TiroirRelecture.tsx`).
 */
export function LignePersonaArchivee({
  nom,
  libelleReactiver,
  disabled,
  onReactiver,
}: {
  nom: string;
  libelleReactiver: string;
  disabled: boolean;
  onReactiver: () => void;
}) {
  return (
    <div className="jr-source" style={{ justifyContent: 'space-between' }}>
      <span>
        <b>{nom}</b>
      </span>
      <Bouton taille="petit" onClick={onReactiver} disabled={disabled}>
        {libelleReactiver}
      </Bouton>
    </div>
  );
}

interface EtatFormulaire {
  nom: string;
  campagneParDefautId: string;
  intitules: string[];
  intituleEnCours: string;
  seniorite: SenioritePersona | '';
  consignesNotation: string;
  ceQueJayApporte: string;
}

function etatInitial(persona: PersonaVue | null): EtatFormulaire {
  return {
    nom: persona?.nom ?? '',
    campagneParDefautId: persona?.campagneParDefautId ?? '',
    intitules: persona?.intitulesPostes ?? [],
    intituleEnCours: '',
    seniorite: persona?.seniorite ?? '',
    consignesNotation: persona?.consignesNotation ?? '',
    ceQueJayApporte: persona?.ceQueJayApporte ?? '',
  };
}

/** Fiche d'un persona existant, ou formulaire vierge en création (`persona === null`). */
function FormulairePersona({
  persona,
  campagnesDisponibles,
  peutModifier,
  onEnregistre,
}: {
  persona: PersonaVue | null;
  campagnesDisponibles: readonly CampagneOptionVue[];
  peutModifier: boolean;
  onEnregistre: (id: string) => void;
}) {
  const tForm = useTranslations('reglages.personas.form');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);
  const [etat, setEtat] = useState<EtatFormulaire>(() => etatInitial(persona));

  const disabled = pending || !peutModifier;

  function retirerIntitule(valeur: string) {
    setEtat((e) => ({ ...e, intitules: e.intitules.filter((i) => i !== valeur) }));
  }

  function ajouterIntitule() {
    const valeur = etat.intituleEnCours.trim();
    if (!valeur) return;
    setEtat((e) => ({
      ...e,
      intitules: e.intitules.includes(valeur) ? e.intitules : [...e.intitules, valeur],
      intituleEnCours: '',
    }));
  }

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionEnregistrerPersona({
        id: persona?.id,
        nom: etat.nom.trim(),
        intitulesPostes: etat.intitules,
        seniorite: etat.seniorite || null,
        consignesNotation: etat.consignesNotation.trim() || null,
        ceQueJayApporte: etat.ceQueJayApporte.trim() || null,
        campagneParDefautId: etat.campagneParDefautId || null,
      });
      if (res.ok) {
        router.refresh();
        onEnregistre(res.id);
      } else {
        setErreur(res.error);
      }
    });
  }

  function archiver() {
    if (!persona) return;
    if (typeof window !== 'undefined' && !window.confirm(tForm('archiveConfirm'))) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionEnregistrerPersona({
        id: persona.id,
        nom: persona.nom,
        intitulesPostes: persona.intitulesPostes,
        seniorite: persona.seniorite,
        consignesNotation: persona.consignesNotation,
        ceQueJayApporte: persona.ceQueJayApporte,
        campagneParDefautId: persona.campagneParDefautId,
        estActif: false,
      });
      if (res.ok) router.refresh();
      else setErreur(res.error);
    });
  }

  return (
    <Carte
      titre={
        <>
          {persona ? persona.nom : tForm('titleNew')}{' '}
          {persona && (
            <small>
              {persona.campagnesUtilisatrices.length > 0
                ? tForm('usedBy', { campagnes: persona.campagnesUtilisatrices.join(', ') })
                : tForm('notUsed')}
            </small>
          )}
        </>
      }
    >
      <div className="jr-formulaire" style={{ paddingTop: 12 }}>
        <div className="ligne">
          <Champ libelle={tForm('name')} id="persona-nom">
            <input
              id="persona-nom"
              value={etat.nom}
              disabled={disabled}
              onChange={(e) => setEtat((s) => ({ ...s, nom: e.target.value }))}
            />
          </Champ>
          <div>
            <Champ libelle={tForm('defaultCampaign')} id="persona-campagne">
              <select
                id="persona-campagne"
                value={etat.campagneParDefautId}
                disabled={disabled}
                onChange={(e) => setEtat((s) => ({ ...s, campagneParDefautId: e.target.value }))}
              >
                <option value="">{tForm('defaultCampaignNone')}</option>
                {campagnesDisponibles.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nom}
                  </option>
                ))}
              </select>
            </Champ>
            <div className="jr-aide">{tForm('defaultCampaignHint')}</div>
          </div>
        </div>

        <div>
          <span className="jr-libelle">{tForm('titles')}</span>
          <div
            className="jr-champ"
            style={{ flexWrap: 'wrap', justifyContent: 'flex-start', gap: 6, padding: '6px 8px' }}
          >
            {etat.intitules.map((intitule) => (
              <span key={intitule} className="jr-puce">
                {intitule}{' '}
                <button
                  type="button"
                  className="jr-secondaire"
                  style={{
                    border: 0,
                    background: 'none',
                    padding: 0,
                    cursor: disabled ? 'default' : 'pointer',
                  }}
                  aria-label={tForm('titlesRemove', { intitule })}
                  disabled={disabled}
                  onClick={() => retirerIntitule(intitule)}
                >
                  ×
                </button>
              </span>
            ))}
            <input
              value={etat.intituleEnCours}
              disabled={disabled}
              placeholder={tForm('titlesAdd')}
              style={{
                border: 0,
                outline: 'none',
                flex: 1,
                minWidth: 80,
                background: 'transparent',
              }}
              onChange={(e) => setEtat((s) => ({ ...s, intituleEnCours: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  ajouterIntitule();
                }
              }}
              onBlur={ajouterIntitule}
            />
          </div>
          <div className="jr-aide">{tForm('titlesHint')}</div>
        </div>

        <div className="ligne">
          <Champ libelle={tForm('seniority')} id="persona-seniorite">
            <select
              id="persona-seniorite"
              value={etat.seniorite}
              disabled={disabled}
              onChange={(e) =>
                setEtat((s) => ({ ...s, seniorite: e.target.value as SenioritePersona | '' }))
              }
            >
              <option value="">{tForm('seniorityNone')}</option>
              {SENIORITES.map((s) => (
                <option key={s} value={s}>
                  {tForm(`seniority_${s}`)}
                </option>
              ))}
            </select>
          </Champ>
        </div>

        <div>
          <span className="jr-libelle">{tForm('scoringPrompt')}</span>
          <Champ>
            <textarea
              rows={6}
              style={{ resize: 'vertical' }}
              value={etat.consignesNotation}
              disabled={disabled}
              onChange={(e) => setEtat((s) => ({ ...s, consignesNotation: e.target.value }))}
            />
          </Champ>
        </div>

        <div>
          <span className="jr-libelle">{tForm('angle')}</span>
          <Champ>
            <textarea
              rows={2}
              style={{ resize: 'vertical' }}
              value={etat.ceQueJayApporte}
              disabled={disabled}
              onChange={(e) => setEtat((s) => ({ ...s, ceQueJayApporte: e.target.value }))}
            />
          </Champ>
        </div>

        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}

        {peutModifier && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            {persona ? (
              <Bouton variante="danger" onClick={archiver} disabled={pending}>
                {tForm('archive')}
              </Bouton>
            ) : (
              <span />
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <Bouton onClick={() => setEtat(etatInitial(persona))} disabled={pending}>
                {tForm('cancel')}
              </Bouton>
              <Bouton
                variante="principal"
                onClick={enregistrer}
                disabled={disabled}
                aria-busy={pending}
              >
                {tForm('save')}
              </Bouton>
            </div>
          </div>
        )}
      </div>
    </Carte>
  );
}

/**
 * Réglages › Personas (maquette `reglages-personas.html`) : liste maître à
 * gauche, fiche à droite. La sélection et la création sont purement locales
 * (`useState`) — `router.refresh()` rapatrie les données serveur après une
 * écriture, `onEnregistre` (via la `key` du formulaire) suit la sélection sur
 * le persona qui vient d'être créé/modifié.
 */
export function FichePersona({ personas, campagnesDisponibles, peutModifier }: FichePersonaProps) {
  const t = useTranslations('reglages.personas');
  const router = useRouter();
  const actifs = personas.filter((p) => p.estActif);
  const archives = personas.filter((p) => !p.estActif);

  const [selectionId, setSelectionId] = useState<string | null>(actifs[0]?.id ?? null);
  const [modeCreation, setModeCreation] = useState(false);
  const [archivesOuverts, setArchivesOuverts] = useState(false);
  const [reactivationEnCours, setReactivationEnCours] = useState<string | null>(null);
  const [erreurReactivation, setErreurReactivation] = useState<string | null>(null);
  const [pendingReactivation, startReactivation] = useTransition();

  const selection = modeCreation ? null : (actifs.find((p) => p.id === selectionId) ?? null);

  function reactiver(persona: PersonaVue) {
    setErreurReactivation(null);
    setReactivationEnCours(persona.id);
    startReactivation(async () => {
      const res = await actionEnregistrerPersona({
        id: persona.id,
        nom: persona.nom,
        intitulesPostes: persona.intitulesPostes,
        seniorite: persona.seniorite,
        consignesNotation: persona.consignesNotation,
        ceQueJayApporte: persona.ceQueJayApporte,
        campagneParDefautId: persona.campagneParDefautId,
        estActif: true,
      });
      setReactivationEnCours(null);
      if (res.ok) {
        setSelectionId(res.id);
        router.refresh();
      } else {
        setErreurReactivation(res.error);
      }
    });
  }

  return (
    <>
      <div className="jr-section-entete">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('lead')}</p>
        </div>
        {peutModifier && (
          <Bouton
            variante="principal"
            onClick={() => {
              setModeCreation(true);
              setSelectionId(null);
            }}
          >
            {t('new')}
          </Bouton>
        )}
      </div>

      <div className="jr-contenu jr-maitre-detail">
        <div style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
          <div className="jr-carte">
            <div className="jr-corps" style={{ paddingTop: 10 }}>
              {actifs.length === 0 ? (
                <p className="jr-aide">{t('empty')}</p>
              ) : (
                actifs.map((persona) => (
                  <LignePersona
                    key={persona.id}
                    persona={persona}
                    selectionnee={!modeCreation && persona.id === selectionId}
                    onSelectionner={() => {
                      setModeCreation(false);
                      setSelectionId(persona.id);
                    }}
                    t={t}
                  />
                ))
              )}
            </div>
          </div>

          {archives.length > 0 && (
            <div className="jr-carte">
              <button
                type="button"
                className="jr-secondaire"
                style={{
                  border: 0,
                  background: 'none',
                  width: '100%',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '10px 18px',
                }}
                aria-expanded={archivesOuverts}
                onClick={() => setArchivesOuverts((o) => !o)}
              >
                <span>{t('archivedSection', { n: archives.length })}</span>
                <span>{archivesOuverts ? '▾' : '▸'}</span>
              </button>
              {archivesOuverts && (
                <div className="jr-corps" style={{ display: 'grid', gap: 2, paddingTop: 0 }}>
                  {archives.map((persona) => (
                    <LignePersonaArchivee
                      key={persona.id}
                      nom={persona.nom}
                      libelleReactiver={t('reactivate')}
                      disabled={pendingReactivation && reactivationEnCours === persona.id}
                      onReactiver={() => reactiver(persona)}
                    />
                  ))}
                  {erreurReactivation && (
                    <div className="jr-notification erreur" role="alert">
                      {erreurReactivation}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gap: 16, alignContent: 'start', minWidth: 0 }}>
          <FormulairePersona
            key={selection?.id ?? 'nouveau'}
            persona={selection}
            campagnesDisponibles={campagnesDisponibles}
            peutModifier={peutModifier}
            onEnregistre={(id) => {
              setModeCreation(false);
              setSelectionId(id);
            }}
          />
          <TestAppariement />
        </div>
      </div>
    </>
  );
}

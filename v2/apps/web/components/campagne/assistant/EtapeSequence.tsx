'use client';

import { useState } from 'react';
import { MODELES_SEQUENCE, type ModeleSequence } from '@jay-reach/core';
import { Bouton, Carte, Champ } from '../../ui';

export type CleModeleSequence = ModeleSequence['cle'] | 'vide';

export interface EtapeSequenceEtape {
  readonly cle: string;
  readonly canal: 'email' | 'linkedin';
  readonly sujet: string;
  readonly corps: string;
  /** Délai depuis l'étape précédente, en JOURS (l'écran raisonne en jours ; `delaiHeures` — ×24 — est ce que `creerCampagneComplete` reçoit). */
  readonly delaiJours: number;
}

export interface EtapeSequenceLibelles {
  partirDe: string;
  modeleVideNom: string;
  modeleVideDescription: string;
  apercu: string;
  ajouterEtape: string;
  etape: string;
  canal: string;
  canalEmail: string;
  canalLinkedin: string;
  objet: string;
  corps: string;
  delai: string;
  delaiSuffixe: string;
  /** Pilule d'aperçu entre deux étapes (« +2 j ») — fonction plutôt que chaîne : le délai varie par étape. */
  delaiPilule: (n: number) => string;
  supprimer: string;
  variablesAide: string;
  vide: string;
}

export interface EtapeSequenceProps {
  etapes: readonly EtapeSequenceEtape[];
  onChoisirModele: (cle: CleModeleSequence) => void;
  onAjouterEtape: () => void;
  onModifierEtape: (cle: string, patch: Partial<Omit<EtapeSequenceEtape, 'cle'>>) => void;
  onSupprimerEtape: (cle: string) => void;
  disabled: boolean;
  libelles: EtapeSequenceLibelles;
}

/** Construit les étapes d'un modèle (`packages/core/modeles-sequence.ts`) en cles locales + délais en jours. */
export function etapesDepuisModele(cle: CleModeleSequence): EtapeSequenceEtape[] {
  if (cle === 'vide') return [];
  const modele = MODELES_SEQUENCE.find((m) => m.cle === cle);
  if (!modele) return [];
  return modele.etapes.map((e, index) => ({
    cle: `${cle}-${index}-${Date.now()}`,
    canal: e.canal,
    sujet: e.sujet,
    corps: e.corps,
    delaiJours: Math.round(e.delaiHeures / 24),
  }));
}

/**
 * Étape « Séquence » de l'assistant (maquette `nouvelle-campagne-3.html`) :
 * choisir un point de départ (un des deux modèles de
 * `packages/core/src/fonctions/modeles-sequence.ts`, ou vide), puis ajuster
 * chaque étape. N'écrit rien : `enregistrerEtape` n'est appelé qu'à la
 * création (`creerCampagneComplete`).
 *
 * Pas de tiroir avec aperçu/« M'envoyer un test » (maquette) : ces deux
 * actions dépendent d'une campagne et d'un contact déjà en base
 * (`apercuEtape`/`envoyerTest`), qui n'existent pas encore à ce stade — un
 * simple rappel textuel des variables disponibles les remplace.
 */
export function EtapeSequence({
  etapes,
  onChoisirModele,
  onAjouterEtape,
  onModifierEtape,
  onSupprimerEtape,
  disabled,
  libelles,
}: EtapeSequenceProps) {
  const [etapeOuverte, setEtapeOuverte] = useState<string | null>(etapes[0]?.cle ?? null);
  // Point de départ choisi EXPLICITEMENT par un clic (pas déduit de `etapes`,
  // que l'utilisateur peut ensuite modifier librement étape par étape) —
  // seulement pour l'état visuel `aria-pressed` (R59, tour de correction 1) :
  // `null` tant qu'aucun bouton n'a été cliqué dans CETTE étape de l'assistant.
  const [modeleChoisi, setModeleChoisi] = useState<CleModeleSequence | null>(null);

  function choisir(cle: CleModeleSequence) {
    if (disabled) return;
    setModeleChoisi(cle);
    onChoisirModele(cle);
  }

  return (
    <>
      <Carte>
        <div>
          <span className="jr-libelle">{libelles.partirDe}</span>
          <div className="jr-choix">
            {MODELES_SEQUENCE.map((modele) => (
              <button
                key={modele.cle}
                type="button"
                className="option"
                aria-pressed={modeleChoisi === modele.cle}
                disabled={disabled}
                onClick={() => choisir(modele.cle)}
              >
                <b>{modele.nom}</b>
                <small>{modele.description}</small>
              </button>
            ))}
            <button
              type="button"
              className="option"
              aria-pressed={modeleChoisi === 'vide'}
              disabled={disabled}
              onClick={() => choisir('vide')}
            >
              <b>{libelles.modeleVideNom}</b>
              <small>{libelles.modeleVideDescription}</small>
            </button>
          </div>
        </div>
      </Carte>

      <Carte titre={libelles.apercu}>
        {etapes.length === 0 ? (
          <p className="jr-vide">{libelles.vide}</p>
        ) : (
          <div className="jr-sequence-pilules">
            {etapes.map((etape, index) => (
              <span key={etape.cle}>
                {index > 0 && <span className="delai">{libelles.delaiPilule(etape.delaiJours)}</span>}
                <button
                  type="button"
                  className={['pilule', etapeOuverte === etape.cle ? 'en-cours' : undefined].filter(Boolean).join(' ')}
                  aria-pressed={etapeOuverte === etape.cle}
                  disabled={disabled}
                  onClick={() => setEtapeOuverte(etape.cle)}
                >
                  {index + 1} · {etape.sujet || libelles.etape}
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="jr-actions">
          <Bouton onClick={onAjouterEtape} disabled={disabled}>
            {libelles.ajouterEtape}
          </Bouton>
        </div>

        {etapes
          .filter((etape) => etape.cle === etapeOuverte)
          .map((etape) => (
            <div key={etape.cle} className="jr-formulaire">
              <Champ libelle={libelles.canal}>
                <select
                  value={etape.canal}
                  onChange={(e) => onModifierEtape(etape.cle, { canal: e.target.value === 'linkedin' ? 'linkedin' : 'email' })}
                  disabled={disabled}
                >
                  <option value="email">{libelles.canalEmail}</option>
                  <option value="linkedin">{libelles.canalLinkedin}</option>
                </select>
              </Champ>
              {etape.canal === 'email' && (
                <Champ libelle={libelles.objet}>
                  <input
                    value={etape.sujet}
                    onChange={(e) => onModifierEtape(etape.cle, { sujet: e.target.value })}
                    disabled={disabled}
                  />
                </Champ>
              )}
              <Champ libelle={libelles.corps}>
                <textarea
                  rows={5}
                  value={etape.corps}
                  onChange={(e) => onModifierEtape(etape.cle, { corps: e.target.value })}
                  disabled={disabled}
                />
              </Champ>
              <div className="jr-aide">{libelles.variablesAide}</div>
              <Champ libelle={libelles.delai} suffixe={libelles.delaiSuffixe}>
                <input
                  type="number"
                  min={0}
                  value={etape.delaiJours}
                  onChange={(e) => onModifierEtape(etape.cle, { delaiJours: Number(e.target.value) || 0 })}
                  disabled={disabled}
                />
              </Champ>
              <div className="jr-actions">
                <Bouton
                  variante="danger"
                  onClick={() => {
                    onSupprimerEtape(etape.cle);
                    setEtapeOuverte(null);
                  }}
                  disabled={disabled}
                >
                  {libelles.supprimer}
                </Bouton>
              </div>
            </div>
          ))}
      </Carte>
    </>
  );
}

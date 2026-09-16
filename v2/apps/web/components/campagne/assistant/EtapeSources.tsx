'use client';

import { useState } from 'react';
import { Bouton, Carte, Champ, EtatVide, Menu, TuileLogo } from '../../ui';

export type ProviderIdAssistant = 'adzuna' | 'france_travail';

export interface ConfigSourceAssistant {
  readonly motsCles: string[];
  readonly lieux: string[];
  readonly contrat: 'cdi' | 'tous';
  readonly exclusions: string[];
}

export interface SourceAssistant {
  /** Identifiant LOCAL (pas un id base — la source n'existe pas encore) : sert de clé React et de cible de retrait. */
  readonly cle: string;
  readonly providerId: ProviderIdAssistant;
  readonly nom: string;
  readonly config: ConfigSourceAssistant;
}

export interface EtapeSourcesLibelles {
  titre: string;
  description: string;
  ajouter: string;
  vide: string;
  linkedinAide: string;
  retirer: string;
  menuOffres: string;
  menuAdzunaTitre: string;
  menuAdzunaDescription: string;
  menuFranceTravailTitre: string;
  menuFranceTravailDescription: string;
  formNom: string;
  formMotsCles: string;
  formMotsClesAide: string;
  formLieux: string;
  formContrat: string;
  formContratTous: string;
  formContratCdi: string;
  formAjouter: string;
  formAnnuler: string;
  formErreur: string;
}

export interface EtapeSourcesProps {
  sources: readonly SourceAssistant[];
  onAjouter: (source: SourceAssistant) => void;
  onRetirer: (cle: string) => void;
  disabled: boolean;
  libelles: EtapeSourcesLibelles;
}

function texteVersListe(t: string): string[] {
  return t
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function resumeSource(source: SourceAssistant): string {
  const morceaux = [source.config.motsCles.join(', ')];
  if (source.config.lieux.length > 0) morceaux.push(source.config.lieux.join(', '));
  return morceaux.join(' · ');
}

/**
 * Étape « Sources » de l'assistant (maquette `nouvelle-campagne-2.html`) :
 * n'écrit RIEN (`creerSource` n'est appelé qu'à la fin, par
 * `creerCampagneComplete`) — les sources ajoutées ici vivent dans l'état de
 * `Assistant`, retirables tant que la campagne n'est pas créée.
 *
 * Volontairement limité à Adzuna/France Travail (les deux seuls fournisseurs
 * qui collectent réellement aujourd'hui) : les quatre sources LinkedIn se
 * règlent depuis l'onglet Sources de la campagne une fois créée (même
 * formulaire complet que `TiroirSourceLinkedIn`, hors scope de cet
 * assistant) — rien n'est perdu, seulement déplacé après la création.
 */
export function EtapeSources({ sources, onAjouter, onRetirer, disabled, libelles }: EtapeSourcesProps) {
  const [menuOuvert, setMenuOuvert] = useState(false);
  const [ajoutEnCours, setAjoutEnCours] = useState<ProviderIdAssistant | null>(null);
  const [nom, setNom] = useState('');
  const [motsCles, setMotsCles] = useState('');
  const [lieux, setLieux] = useState('');
  const [contrat, setContrat] = useState<'cdi' | 'tous'>('tous');
  const [erreur, setErreur] = useState(false);

  function ouvrirFormulaire(providerId: ProviderIdAssistant) {
    setMenuOuvert(false);
    setAjoutEnCours(providerId);
    setNom('');
    setMotsCles('');
    setLieux('');
    setContrat('tous');
    setErreur(false);
  }

  function annulerFormulaire() {
    setAjoutEnCours(null);
    setErreur(false);
  }

  function validerFormulaire() {
    const mots = texteVersListe(motsCles);
    if (mots.length === 0) {
      setErreur(true);
      return;
    }
    const providerId = ajoutEnCours!;
    onAjouter({
      cle: `${providerId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      providerId,
      nom: nom.trim() || mots.join(', '),
      config: { motsCles: mots, lieux: texteVersListe(lieux), contrat, exclusions: [] },
    });
    setAjoutEnCours(null);
  }

  return (
    <Carte
      entete={
        <>
          <span>
            <b>{libelles.titre}</b>
            <br />
            <small>{libelles.description}</small>
          </span>
          <div className="jr-menu-ancre">
            <Bouton variante="sombre" onClick={() => setMenuOuvert((v) => !v)} disabled={disabled}>
              {libelles.ajouter}
            </Bouton>
            {menuOuvert && (
              <>
                <button
                  type="button"
                  className="jr-menu-clic-exterieur"
                  aria-label={libelles.ajouter}
                  onClick={() => setMenuOuvert(false)}
                />
                <Menu
                  groupes={[
                    {
                      titre: libelles.menuOffres,
                      entrees: [
                        {
                          icone: <TuileLogo marque="adzuna" />,
                          titre: libelles.menuAdzunaTitre,
                          description: libelles.menuAdzunaDescription,
                          onSelectionner: () => ouvrirFormulaire('adzuna'),
                        },
                        {
                          icone: <TuileLogo marque="francetravail" />,
                          titre: libelles.menuFranceTravailTitre,
                          description: libelles.menuFranceTravailDescription,
                          onSelectionner: () => ouvrirFormulaire('france_travail'),
                        },
                      ],
                    },
                  ]}
                />
              </>
            )}
          </div>
        </>
      }
    >
      {sources.length === 0 && !ajoutEnCours && <EtatVide titre={libelles.vide} texte={libelles.linkedinAide} />}

      {sources.map((source) => (
        <div key={source.cle} className="jr-source">
          <TuileLogo marque={source.providerId === 'adzuna' ? 'adzuna' : 'francetravail'} />
          <span>
            <b>{source.nom}</b>
            <small>{resumeSource(source)}</small>
          </span>
          <Bouton taille="petit" onClick={() => onRetirer(source.cle)} disabled={disabled}>
            {libelles.retirer}
          </Bouton>
        </div>
      ))}

      {ajoutEnCours && (
        <div className="jr-formulaire">
          <Champ libelle={libelles.formNom}>
            <input value={nom} onChange={(e) => setNom(e.target.value)} disabled={disabled} />
          </Champ>
          <Champ libelle={libelles.formMotsCles} erreur={erreur ? libelles.formErreur : undefined}>
            <input value={motsCles} onChange={(e) => setMotsCles(e.target.value)} disabled={disabled} />
          </Champ>
          <div className="jr-aide">{libelles.formMotsClesAide}</div>
          <Champ libelle={libelles.formLieux}>
            <input value={lieux} onChange={(e) => setLieux(e.target.value)} disabled={disabled} />
          </Champ>
          <Champ libelle={libelles.formContrat}>
            <select value={contrat} onChange={(e) => setContrat(e.target.value === 'cdi' ? 'cdi' : 'tous')} disabled={disabled}>
              <option value="tous">{libelles.formContratTous}</option>
              <option value="cdi">{libelles.formContratCdi}</option>
            </select>
          </Champ>
          <div className="jr-actions">
            <Bouton onClick={annulerFormulaire} disabled={disabled}>
              {libelles.formAnnuler}
            </Bouton>
            <Bouton variante="principal" onClick={validerFormulaire} disabled={disabled}>
              {libelles.formAjouter}
            </Bouton>
          </div>
        </div>
      )}

      {sources.length > 0 && !ajoutEnCours && <p className="jr-aide">{libelles.linkedinAide}</p>}
    </Carte>
  );
}

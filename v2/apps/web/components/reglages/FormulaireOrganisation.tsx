'use client';

import { useMemo, useState, useTransition } from 'react';
import { Bouton, Carte, Champ } from '../ui';
import { actionModifierOrganisation } from '../../app/actions/org';

/** Langue → autonyme (le nom d'une langue dans elle-même ne se retraduit pas — même convention que tout sélecteur de langue). */
const LANGUES: readonly { valeur: string; libelle: string }[] = [
  { valeur: 'fr', libelle: 'Français' },
  { valeur: 'en', libelle: 'English' },
  { valeur: 'nl', libelle: 'Nederlands' },
];

export interface FormulaireOrganisationLibelles {
  titre: string;
  nom: string;
  fuseau: string;
  fuseauAide: string;
  langue: string;
  langueAide: string;
  enregistrer: string;
}

// Corps pur (aucun hook d'état serveur) — testable par `renderToStaticMarkup`.
export interface CorpsFormulaireOrganisationProps {
  nom: string;
  onNomChange: (v: string) => void;
  fuseau: string;
  onFuseauChange: (v: string) => void;
  fuseaux: readonly string[];
  langue: string;
  onLangueChange: (v: string) => void;
  disabled: boolean;
  libelles: FormulaireOrganisationLibelles;
  /**
   * Bouton « Enregistrer » dans le pied de CETTE carte (tour de correction F6, point 5) : posé
   * ici plutôt qu'en dessous, entre deux cartes, comme il flottait avant — même pied de carte que
   * les autres formulaires (`.jr-actions.fin`). Optionnel pour ne rien changer aux tests qui
   * rendent `CorpsFormulaireOrganisation` seul, sans action de sauvegarde.
   */
  onEnregistrer?: () => void;
  erreur?: string | null;
}

export function CorpsFormulaireOrganisation({
  nom,
  onNomChange,
  fuseau,
  onFuseauChange,
  fuseaux,
  langue,
  onLangueChange,
  disabled,
  libelles,
  onEnregistrer,
  erreur,
}: CorpsFormulaireOrganisationProps) {
  return (
    <Carte titre={libelles.titre}>
      <div className="jr-formulaire">
        <div className="ligne">
          <Champ libelle={libelles.nom} id="org-nom">
            <input id="org-nom" value={nom} onChange={(e) => onNomChange(e.target.value)} disabled={disabled} />
          </Champ>
          <div>
            <Champ libelle={libelles.fuseau} id="org-fuseau">
              <select id="org-fuseau" value={fuseau} onChange={(e) => onFuseauChange(e.target.value)} disabled={disabled}>
                {fuseaux.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Champ>
            <div className="jr-aide">{libelles.fuseauAide}</div>
          </div>
          <div>
            <Champ libelle={libelles.langue} id="org-langue">
              <select id="org-langue" value={langue} onChange={(e) => onLangueChange(e.target.value)} disabled={disabled}>
                {LANGUES.map((l) => (
                  <option key={l.valeur} value={l.valeur}>
                    {l.libelle}
                  </option>
                ))}
              </select>
            </Champ>
            <div className="jr-aide">{libelles.langueAide}</div>
          </div>
        </div>
      </div>
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
      {onEnregistrer && (
        <div className="jr-actions fin">
          <Bouton variante="principal" onClick={onEnregistrer} disabled={disabled} aria-busy={disabled}>
            {libelles.enregistrer}
          </Bouton>
        </div>
      )}
    </Carte>
  );
}

export interface FormulaireOrganisationProps {
  initial: { nom: string; fuseau: string; langue: string };
  libelles: FormulaireOrganisationLibelles;
  erreurLibelle: string;
}

export function FormulaireOrganisation({ initial, libelles, erreurLibelle }: FormulaireOrganisationProps) {
  const [pending, startTransition] = useTransition();
  const [nom, setNom] = useState(initial.nom);
  const [fuseau, setFuseau] = useState(initial.fuseau);
  const [langue, setLangue] = useState(initial.langue);
  const [erreur, setErreur] = useState<string | null>(null);

  // Le fuseau courant est toujours dans la liste, même si le runtime local
  // (tests, environnements plus anciens) n'en connaît pas exactement la même
  // édition tzdata que la production.
  const fuseaux = useMemo(() => {
    const connus = new Set(Intl.supportedValuesOf('timeZone'));
    connus.add(initial.fuseau);
    return [...connus].sort();
  }, [initial.fuseau]);

  function enregistrer() {
    setErreur(null);
    startTransition(async () => {
      const res = await actionModifierOrganisation({ nom: nom.trim(), fuseau, langue });
      if (!res.ok) {
        setErreur(res.error ?? erreurLibelle);
      }
    });
  }

  return (
    <CorpsFormulaireOrganisation
      nom={nom}
      onNomChange={setNom}
      fuseau={fuseau}
      onFuseauChange={setFuseau}
      fuseaux={fuseaux}
      langue={langue}
      onLangueChange={setLangue}
      disabled={pending}
      libelles={libelles}
      onEnregistrer={enregistrer}
      erreur={erreur}
    />
  );
}

'use client';

/**
 * Les réglages chiffrés de la collecte LinkedIn (maquette `maquettes-lot4a.html`, § 1). Mêmes clés
 * que Réglages › Plafonds, écrites par la même action (`actionEcrireReglage`) : une seule vérité,
 * deux endroits pour la régler. Lecture seule pour qui n'est pas administrateur.
 *
 * Toutes les clés ne sont pas des plafonds : `linkedin_fenetre_validation_post_jours` est une
 * DURÉE. Le composant ne s'en occupe pas — il édite un entier positif et affiche le message que
 * le métier renvoie quand il refuse (la fenêtre doit dépasser le délai d'ancienneté des signaux,
 * `schemaEcrireReglage`). La règle vit dans le métier, pas dans la saisie.
 */
import { useState, useTransition } from 'react';
import { Bouton } from '../ui';
import { actionEcrireReglage } from '../../app/actions/plafonds';

export interface LignePlafondLinkedin {
  cle:
    | 'linkedin_posts_par_jour'
    | 'linkedin_requetes_par_heure'
    | 'linkedin_personnes_par_passage'
    | 'linkedin_invitations_par_semaine'
    | 'linkedin_messages_par_semaine'
    | 'linkedin_visites_profil_par_semaine'
    | 'linkedin_fiches_post_par_jour'
    | 'linkedin_fenetre_validation_post_jours';
  nom: string;
  /** Déjà composé (« 1 utilisé aujourd'hui ») — ce composant ne compte rien. */
  usage: string;
  valeur: number;
}

export interface PlafondsLinkedinProps {
  lignes: LignePlafondLinkedin[];
  peutModifier: boolean;
  libelles: { enregistrer: string; erreurNombre: string };
}

function LigneEditable({
  ligne,
  peutModifier,
  libelles,
}: {
  ligne: LignePlafondLinkedin;
  peutModifier: boolean;
  libelles: PlafondsLinkedinProps['libelles'];
}) {
  const [saisie, setSaisie] = useState(String(ligne.valeur));
  const [enregistre, setEnregistre] = useState(ligne.valeur);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const idChamp = `plafond-linkedin-${ligne.cle}`;
  const modifie = saisie.trim() !== String(enregistre);

  function enregistrer() {
    setErreur(null);
    const nombre = Number(saisie);
    if (saisie.trim() === '' || !Number.isInteger(nombre) || nombre < 0) {
      setErreur(libelles.erreurNombre);
      return;
    }
    startTransition(async () => {
      const res = await actionEcrireReglage(ligne.cle, nombre);
      if (res.ok) setEnregistre(nombre);
      else setErreur(res.error);
    });
  }

  return (
    <div className="jr-plafond-ligne">
      <div>
        <label htmlFor={idChamp}>
          <b>{ligne.nom}</b>
        </label>
        <small className="jr-secondaire jr-etat-detail">{ligne.usage}</small>
        {erreur && (
          <small className="jr-texte-erreur jr-etat-detail" role="alert">
            {erreur}
          </small>
        )}
      </div>
      <div className="jr-plafond-saisie">
        <input
          className="jr-champ"
          id={idChamp}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          disabled={!peutModifier || pending}
        />
        {peutModifier && modifie && (
          <Bouton variante="principal" taille="petit" onClick={enregistrer} disabled={pending} aria-busy={pending}>
            {libelles.enregistrer}
          </Bouton>
        )}
      </div>
    </div>
  );
}

export function PlafondsLinkedin({ lignes, peutModifier, libelles }: PlafondsLinkedinProps) {
  return (
    <>
      {lignes.map((ligne) => (
        <LigneEditable key={ligne.cle} ligne={ligne} peutModifier={peutModifier} libelles={libelles} />
      ))}
    </>
  );
}

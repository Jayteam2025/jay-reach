'use client';

/**
 * L'interrupteur de la collecte LinkedIn automatique, au-dessus des plafonds qui la bornent.
 *
 * Sans lui, le réglage existerait en base et nulle part à l'écran : l'opérateur verrait ses
 * sources ne jamais partir seules, sans rien pouvoir y faire.
 */
import { useState, useTransition } from 'react';
import { actionCollecteAutoLinkedin } from '../../app/actions/plafonds';

export interface CollecteAutoLinkedinProps {
  actif: boolean;
  peutModifier: boolean;
  libelles: {
    titre: string;
    aideActive: string;
    aideInactive: string;
    activer: string;
    desactiver: string;
  };
}

export function CollecteAutoLinkedin({ actif, peutModifier, libelles }: CollecteAutoLinkedinProps) {
  const [etat, setEtat] = useState(actif);
  const [erreur, setErreur] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function basculer() {
    setErreur(null);
    const vise = !etat;
    startTransition(async () => {
      const res = await actionCollecteAutoLinkedin(vise);
      if (res.ok) setEtat(vise);
      else setErreur(res.error);
    });
  }

  return (
    <div className="jr-plafond-ligne">
      <div>
        <b>{libelles.titre}</b>
        <small className="jr-secondaire jr-etat-detail">{etat ? libelles.aideActive : libelles.aideInactive}</small>
        {erreur && (
          <small className="jr-texte-erreur jr-etat-detail" role="alert">
            {erreur}
          </small>
        )}
      </div>
      {peutModifier && (
        <button type="button" className="jr-bouton jr-bouton--discret" onClick={basculer} disabled={pending}>
          {etat ? libelles.desactiver : libelles.activer}
        </button>
      )}
    </div>
  );
}

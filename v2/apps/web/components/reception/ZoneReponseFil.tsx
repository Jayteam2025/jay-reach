'use client';

import type { ReactNode } from 'react';
import { useState, useTransition } from 'react';
import { Bouton, ZoneReponse } from '../ui';
import { repondre, marquerInteret } from '../../app/actions/inbox';

export interface ZoneReponseFilProps {
  filId: string;
  /** « Répondre depuis <logo> <boîte> · via SalesBlink/Microsoft, dans le même fil » — construit par `Fil` (server), qui seul connaît le logo de la boîte. */
  depuis: ReactNode;
  placeholder: string;
  note: string;
  interet: 'interested' | 'not_interested' | null;
  libelleMarquerInteresse: string;
  libelleRetirerInteret: string;
  libelleEnvoyer: string;
  libelleEnvoiEnCours: string;
  libelleEnvoyee: string;
  reponsePossible: boolean;
  /** Déjà traduite par `Fil` (server) — cette clé est dynamique (`reception.fil.raisonReponseImpossible.*`), la traduire ici demanderait un second `useTranslations` sans namespace pour un seul texte. */
  raisonIndisponible: string | null;
}

/**
 * Boîte qui répond, affichée en permanence (spec §6.12) — jamais un tiroir.
 * `repondre`/`marquerInteret` : façades `app/actions/inbox.ts` → fonctions de
 * `packages/core/src/fonctions/reception.ts`. Le bouton Envoyer est désactivé
 * AVANT le clic quand `reponsePossible` est faux (R du 16/09) : la raison
 * s'affiche à la place de la note habituelle.
 */
export function ZoneReponseFil({
  filId,
  depuis,
  placeholder,
  note,
  interet,
  libelleMarquerInteresse,
  libelleRetirerInteret,
  libelleEnvoyer,
  libelleEnvoiEnCours,
  libelleEnvoyee,
  reponsePossible,
  raisonIndisponible,
}: ZoneReponseFilProps) {
  const [corps, setCorps] = useState('');
  const [envoiEnCours, startEnvoi] = useTransition();
  const [marquageEnCours, startMarquage] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function envoyer() {
    const texte = corps.trim();
    if (!texte) return;
    setMessage(null);
    startEnvoi(async () => {
      const res = await repondre(filId, texte);
      if (res.ok) {
        setMessage(libelleEnvoyee);
        window.location.reload();
      } else {
        setMessage(res.error);
      }
    });
  }

  function basculerInteret() {
    setMessage(null);
    startMarquage(async () => {
      const res = await marquerInteret(filId, interet === 'interested' ? null : 'interested');
      if (res.ok) {
        window.location.reload();
      } else {
        setMessage(res.error);
      }
    });
  }

  const enCours = envoiEnCours || marquageEnCours;

  return (
    <ZoneReponse
      depuis={depuis}
      placeholder={placeholder}
      value={corps}
      onChange={setCorps}
      note={message ?? raisonIndisponible ?? note}
      actions={
        <>
          <Bouton taille="petit" disabled={enCours} aria-busy={marquageEnCours} onClick={basculerInteret}>
            {interet === 'interested' ? libelleRetirerInteret : libelleMarquerInteresse}
          </Bouton>
          <Bouton
            variante="principal"
            taille="petit"
            disabled={!reponsePossible || enCours || corps.trim() === ''}
            aria-busy={envoiEnCours}
            title={raisonIndisponible ?? undefined}
            onClick={envoyer}
          >
            {envoiEnCours ? libelleEnvoiEnCours : libelleEnvoyer}
          </Bouton>
        </>
      }
    />
  );
}

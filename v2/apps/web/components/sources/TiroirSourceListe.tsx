'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { ListeResume } from '@jay-reach/core';
import { Bouton, Champ, Tiroir } from '../ui';
import { actionAjouterDepuisListe } from '../../app/actions/sources';
import { CaseACocher } from './CaseACocher';

export interface TiroirSourceListeProps {
  campagneId: string;
  listes: ListeResume[];
}

/**
 * Tiroir « Liste existante » (maquette `tiroir-source-liste.html`). Pas
 * d'aperçu chiffré (« 41 contacts entreront ») avant de valider : ce nombre
 * dépend de l'état de la base au moment de l'ajout (email vérifié, déjà
 * contacté ailleurs) et aucune fonction de lecture dédiée n'a été demandée à
 * cette tâche — `ajouterDepuisListe` reste la seule source de vérité,
 * appliquée directement.
 */
export function TiroirSourceListe({ campagneId, listes }: TiroirSourceListeProps) {
  const t = useTranslations('campagne.sources');
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  const [listId, setListId] = useState(listes[0]?.id ?? '');
  const [seulementEmailVerifie, setSeulementEmailVerifie] = useState(false);
  const [ignorerDejaContactes, setIgnorerDejaContactes] = useState(false);

  function fermer() {
    router.push('?', { scroll: false });
  }

  function ajouter() {
    if (!listId) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAjouterDepuisListe(campagneId, {
        listId,
        seulementEmailVerifie,
        ignorerDejaContactes,
      });
      if (res.ok) {
        fermer();
      } else {
        setErreur(res.issues?.join(' ') ?? res.error);
      }
    });
  }

  return (
    <Tiroir
      ouvert
      onFermer={fermer}
      libelleFermer={t('drawer.close')}
      titre={t('menu.list.title')}
      pied={
        <>
          <span />
          <div className="jr-carte-h-actions">
            <Bouton onClick={fermer}>{t('drawer.cancel')}</Bouton>
            <Bouton variante="principal" onClick={ajouter} disabled={pending || !listId}>
              {t('drawer.save')}
            </Bouton>
          </div>
        </>
      }
    >
      <div className="jr-formulaire">
        <Champ libelle={t('drawer.listSelect')}>
          <select value={listId} onChange={(e) => setListId(e.target.value)}>
            {listes.length === 0 && <option value="">—</option>}
            {listes.map((l) => (
              <option key={l.id} value={l.id}>
                {l.nom} · {l.nombreContacts}
              </option>
            ))}
          </select>
        </Champ>
        <div>
          <span className="jr-libelle">{t('drawer.listResult')}</span>
          <CaseACocher coche={seulementEmailVerifie} onChange={setSeulementEmailVerifie}>
            {t('drawer.listOnlyVerified')}
          </CaseACocher>
          <CaseACocher coche={ignorerDejaContactes} onChange={setIgnorerDejaContactes}>
            {t('drawer.listIgnoreContacted')}
          </CaseACocher>
        </div>
        {erreur && (
          <div className="jr-notification erreur" role="alert">
            {erreur}
          </div>
        )}
      </div>
    </Tiroir>
  );
}

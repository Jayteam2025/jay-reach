'use client';

/**
 * Carte « Mes notifications » de Réglages › Compte (tâche 23) — pas l'un des
 * cinq composants nommés par le plan (`EtatMoteur`, `PauseEnvoi`,
 * `TableTaches`, `FormulaireOrganisation`, `TableMembres`) : préférence
 * personnelle de l'utilisateur, portée par la façade existante
 * `app/actions/notifications.ts` (déjà « Modifier » dans le plan), pas par
 * `compte.ts`. Petit fichier à part plutôt qu'inliné dans la page, même motif
 * que `NavReglages`/`ChampsSourceLinkedIn` dans les tâches précédentes.
 */
import { useState, useTransition } from 'react';
import { Carte, CleValeur, Interrupteur } from '../ui';
import { actionModifierPreferenceNotification } from '../../app/actions/notifications';
import type { EvenementNotification, PreferenceNotification } from '../../lib/notification-events';

export interface PreferencesNotificationsLibelles {
  titre: string;
  sousTitre: string;
  evenement: Record<EvenementNotification, { titre: string; detail: string }>;
  erreur: string;
}

export interface PreferencesNotificationsProps {
  preferences: PreferenceNotification[];
  libelles: PreferencesNotificationsLibelles;
}

export function PreferencesNotifications({ preferences, libelles }: PreferencesNotificationsProps) {
  const [pending, startTransition] = useTransition();
  const [etat, setEtat] = useState(preferences);
  const [erreur, setErreur] = useState<string | null>(null);

  function basculer(event: EvenementNotification, actif: boolean) {
    setErreur(null);
    setEtat((precedent) => precedent.map((p) => (p.event === event ? { ...p, actif } : p)));
    startTransition(async () => {
      const res = await actionModifierPreferenceNotification(event, actif);
      if (!res.ok) {
        setEtat((precedent) => precedent.map((p) => (p.event === event ? { ...p, actif: !actif } : p)));
        setErreur(res.error ?? libelles.erreur);
      }
    });
  }

  return (
    <Carte
      titre={
        <>
          {libelles.titre} <small>{libelles.sousTitre}</small>
        </>
      }
    >
      <div style={{ paddingTop: 4 }}>
        {etat.map(({ event, actif }) => (
          <CleValeur
            key={event}
            libelle={
              <span>
                <b style={{ fontWeight: 500 }}>{libelles.evenement[event].titre}</b>
                <small className="jr-secondaire" style={{ display: 'block', fontSize: 12 }}>
                  {libelles.evenement[event].detail}
                </small>
              </span>
            }
            valeur={
              <Interrupteur
                actif={actif}
                libelle={libelles.evenement[event].titre}
                disabled={pending}
                onChange={(v) => basculer(event, v)}
              />
            }
          />
        ))}
      </div>
      {erreur && (
        <div className="jr-notification erreur" role="alert">
          {erreur}
        </div>
      )}
    </Carte>
  );
}

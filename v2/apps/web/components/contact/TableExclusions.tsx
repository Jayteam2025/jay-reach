'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { LigneClientExclusion } from '@jay-reach/core';
import { Bouton, Carte, Journal, Puce } from '../ui';
import { actionAjouterAListe, actionAjouterSuppression } from '../../app/actions/contacts';
import { dateCourte } from '../../lib/dates';

export interface TableExclusionsProps {
  lignes: readonly LigneClientExclusion[];
  /** Droit ADMIN — RLS de `customer_lists`/`customer_list_entries` (voir `ajouterAListe`, `packages/core/src/fonctions/contacts.ts`). */
  peutAjouterClient: boolean;
  /** Droit OPERATOR — RLS de `suppressions`. */
  peutAjouterSuppression: boolean;
  fuseau: string;
}

const SCOPES: { valeur: 'email' | 'domain' | 'linkedin'; cle: 'scopeEmail' | 'scopeDomain' | 'scopeLinkedin' }[] = [
  { valeur: 'email', cle: 'scopeEmail' },
  { valeur: 'domain', cle: 'scopeDomain' },
  { valeur: 'linkedin', cle: 'scopeLinkedin' },
];

/**
 * Onglet « Clients et exclusions » de la page Contacts globale (tâche 18,
 * spec §6.11) : deux encarts — la liste clients (`customer_list_entries`,
 * exclusion au niveau du compte) et les suppressions manuelles (email,
 * domaine, LinkedIn). Chacun son formulaire d'ajout, chacun son droit
 * (`ajouterAListe` = admin, `ajouterSuppression` = operator — voir leurs
 * docs dans `packages/core/src/fonctions/contacts.ts`) : le serveur refuse de
 * toute façon un rôle insuffisant, `peutAjouterClient`/`peutAjouterSuppression`
 * ne servent qu'à ne pas montrer un formulaire voué à échouer (même motif que
 * `peutArchiver` dans `campaigns/[id]/settings/page.tsx`).
 */
export function TableExclusions({ lignes, peutAjouterClient, peutAjouterSuppression, fuseau }: TableExclusionsProps) {
  const t = useTranslations('contacts.customers');
  const router = useRouter();

  const clients = lignes.filter((l) => l.type === 'client');
  const exclusions = lignes.filter((l) => l.type !== 'client');

  return (
    <div className="jr-deux-colonnes">
      <Carte
        titre={
          <>
            {t('clientsTitle')} <small>{t('clientsCount', { n: clients.length })}</small>
          </>
        }
      >
        {clients.length === 0 ? (
          <p className="jr-secondaire">{t('clientsEmpty')}</p>
        ) : (
          <div className="jr-puces">
            {clients.map((c) => (
              <Puce key={c.id}>{c.valeur}</Puce>
            ))}
          </div>
        )}
        {peutAjouterClient ? (
          <FormulaireAjouterClient onAjoute={() => router.refresh()} placeholder={t('addDomainPlaceholder')} libelleAjouter={t('add')} />
        ) : (
          <p className="jr-secondaire" style={{ marginTop: 12 }}>
            {t('adminRequired')}
          </p>
        )}
      </Carte>

      <Carte
        titre={
          <>
            {t('exclusionsTitle')} <small>{t('exclusionsCount', { n: exclusions.length })}</small>
          </>
        }
      >
        {exclusions.length === 0 ? (
          <p className="jr-secondaire">{t('exclusionsEmpty')}</p>
        ) : (
          <Journal
            entrees={exclusions.map((e) => ({
              heure: dateCourte(e.quand, new Date(), fuseau),
              texte: e.valeur,
              note: e.raison ?? undefined,
            }))}
          />
        )}
        {peutAjouterSuppression ? (
          <FormulaireAjouterSuppression onAjoute={() => router.refresh()} placeholder={t('addExclusionPlaceholder')} libelleAjouter={t('add')} />
        ) : (
          <p className="jr-secondaire" style={{ marginTop: 12 }}>
            {t('operatorRequired')}
          </p>
        )}
      </Carte>
    </div>
  );
}

function FormulaireAjouterClient({
  onAjoute,
  placeholder,
  libelleAjouter,
}: {
  onAjoute: () => void;
  placeholder: string;
  libelleAjouter: string;
}) {
  const [valeur, setValeur] = useState('');
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function ajouter() {
    if (!valeur.trim()) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAjouterAListe(valeur.trim());
      if (res.ok) {
        setValeur('');
        onAjoute();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="jr-champ" style={{ flex: 1 }}>
          <input value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={placeholder} />
        </div>
        <Bouton taille="petit" onClick={ajouter} disabled={pending || !valeur.trim()}>
          {libelleAjouter}
        </Bouton>
      </div>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </div>
  );
}

function FormulaireAjouterSuppression({
  onAjoute,
  placeholder,
  libelleAjouter,
}: {
  onAjoute: () => void;
  placeholder: string;
  libelleAjouter: string;
}) {
  const t = useTranslations('contacts.customers');
  const [scope, setScope] = useState<'email' | 'domain' | 'linkedin'>('email');
  const [valeur, setValeur] = useState('');
  const [pending, startTransition] = useTransition();
  const [erreur, setErreur] = useState<string | null>(null);

  function ajouter() {
    if (!valeur.trim()) return;
    setErreur(null);
    startTransition(async () => {
      const res = await actionAjouterSuppression(scope, valeur.trim());
      if (res.ok) {
        setValeur('');
        onAjoute();
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={scope} onChange={(e) => setScope(e.target.value as typeof scope)}>
          {SCOPES.map((s) => (
            <option key={s.valeur} value={s.valeur}>
              {t(s.cle)}
            </option>
          ))}
        </select>
        <div className="jr-champ" style={{ flex: 1 }}>
          <input value={valeur} onChange={(e) => setValeur(e.target.value)} placeholder={placeholder} />
        </div>
        <Bouton taille="petit" onClick={ajouter} disabled={pending || !valeur.trim()}>
          {libelleAjouter}
        </Bouton>
      </div>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </div>
  );
}

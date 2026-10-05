'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import type { LigneClientExclusion } from '@jay-reach/core';
import { Bouton, Carte, Champ, Journal, Puce } from '../ui';
import { actionAjouterAListe, actionAjouterSuppression } from '../../app/actions/contacts';
import { dateCourte } from '../../lib/dates';

export interface TableExclusionsProps {
  lignes: readonly LigneClientExclusion[];
  /** Droit ADMIN — RLS de `customer_lists`/`customer_list_entries` (voir `ajouterAListe`, `packages/core/src/fonctions/contacts.ts`). */
  peutAjouterClient: boolean;
  /** Droit OPERATOR — RLS de `suppressions`. */
  peutAjouterSuppression: boolean;
  /** `true` si `customer_list_entries` OU `suppressions` dépasse le plafond (`LIMITE_CONTACTS_GLOBAL`, tour de correction 1). */
  tronque: boolean;
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
 *
 * Une seule portée de traduction (`contacts`, comme `page.tsx`) — pas de
 * sous-espace `contacts.customers` : le garde-fou des clés mortes
 * (`packages/i18n/src/cles-utilisees.test.ts::clesMortesSous`) vérifie une
 * clé en cherchant sa forme littérale complète depuis le préfixe déclaré ;
 * un sous-espace supplémentaire lui aurait fait rater tout ce qui est
 * référencé plus bas dans l'arbre (tour de correction 1, Important 3).
 */
export function TableExclusions({ lignes, peutAjouterClient, peutAjouterSuppression, tronque, fuseau }: TableExclusionsProps) {
  const t = useTranslations('contacts');

  const clients = lignes.filter((l) => l.type === 'client');
  const exclusions = lignes.filter((l) => l.type !== 'client');

  return (
    <div className="jr-deux-colonnes">
      {tronque && <p className="jr-secondaire">{t('truncated')}</p>}
      <Carte
        titre={
          <>
            {t('customers.clientsTitle')} <small>{t('customers.clientsCount', { n: clients.length })}</small>
          </>
        }
      >
        {clients.length === 0 ? (
          <p className="jr-secondaire">{t('customers.clientsEmpty')}</p>
        ) : (
          <div className="jr-puces">
            {clients.map((c) => (
              <Puce key={c.id}>{c.valeur}</Puce>
            ))}
          </div>
        )}
        {peutAjouterClient ? (
          <FormulaireAjouterClient
            libelle={t('customers.addDomainPlaceholder')}
            libelleAjouter={t('customers.add')}
          />
        ) : (
          <p className="jr-secondaire" style={{ marginTop: 12 }}>
            {t('customers.adminRequired')}
          </p>
        )}
      </Carte>

      <Carte
        titre={
          <>
            {t('customers.exclusionsTitle')} <small>{t('customers.exclusionsCount', { n: exclusions.length })}</small>
          </>
        }
      >
        {exclusions.length === 0 ? (
          <p className="jr-secondaire">{t('customers.exclusionsEmpty')}</p>
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
          <FormulaireAjouterSuppression
            libelle={t('customers.addExclusionPlaceholder')}
            libelleAjouter={t('customers.add')}
            libellesScope={{
              email: t('customers.scopeEmail'),
              domain: t('customers.scopeDomain'),
              linkedin: t('customers.scopeLinkedin'),
            }}
          />
        ) : (
          <p className="jr-secondaire" style={{ marginTop: 12 }}>
            {t('customers.operatorRequired')}
          </p>
        )}
      </Carte>
    </div>
  );
}

function FormulaireAjouterClient({
  libelle,
  libelleAjouter,
}: {
  libelle: string;
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
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Champ libelle={libelle} id="contacts-ajouter-client" className="jr-champ-large">
          <input id="contacts-ajouter-client" value={valeur} onChange={(e) => setValeur(e.target.value)} />
        </Champ>
        <Bouton taille="petit" onClick={ajouter} disabled={pending || !valeur.trim()}>
          {libelleAjouter}
        </Bouton>
      </div>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </div>
  );
}

function FormulaireAjouterSuppression({
  libelle,
  libelleAjouter,
  libellesScope,
}: {
  libelle: string;
  libelleAjouter: string;
  libellesScope: Record<'email' | 'domain' | 'linkedin', string>;
}) {
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
      } else {
        setErreur(res.error);
      }
    });
  }

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <Champ id="contacts-ajouter-exclusion-portee">
          <select
            id="contacts-ajouter-exclusion-portee"
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
          >
            {SCOPES.map((s) => (
              <option key={s.valeur} value={s.valeur}>
                {libellesScope[s.valeur]}
              </option>
            ))}
          </select>
        </Champ>
        <Champ libelle={libelle} id="contacts-ajouter-exclusion-valeur" className="jr-champ-large">
          <input id="contacts-ajouter-exclusion-valeur" value={valeur} onChange={(e) => setValeur(e.target.value)} />
        </Champ>
        <Bouton taille="petit" onClick={ajouter} disabled={pending || !valeur.trim()}>
          {libelleAjouter}
        </Bouton>
      </div>
      {erreur && <small className="jr-secondaire">{erreur}</small>}
    </div>
  );
}
